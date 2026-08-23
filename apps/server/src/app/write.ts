/**
 * Form handling for the editable web view.
 *
 * Plain HTML form POSTs, not fetch — the page ships no JavaScript, so it keeps
 * working on a phone with a flaky connection and there is no client state that
 * can disagree with the server. Post/Redirect/Get, so a refresh after saving
 * never re-submits.
 *
 * The write path reuses the same query helpers the MCP tools use, so an edit
 * made with a thumb and one made in a chat are indistinguishable in the log:
 * both land as source='corrected' and both teach a portion.
 */

import type { Ctx, MealPatch } from '../db/queries.ts';
import {
  getMealById, updateMeal, softDeleteMeal, rememberPortion, insertCapture,
} from '../db/queries.ts';
import { localDate } from '../util/date.ts';

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

/** Reads a number from form data. Blank means "leave alone", not zero. */
function field(form: FormData, key: string): number | undefined {
  const raw = form.get(key);
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Capture a note from the app. Deliberately does no analysis: the app has no
 * LLM, and adding one would mean holding an API key. The user's own model picks
 * this up from get_pending_captures next time they open a chat.
 */
export async function handleAppCapture(
  ctx: Ctx,
  request: Request,
  secret: string,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad form submission', { status: 400 });
  }

  const raw = form.get('note');
  const note = typeof raw === 'string' ? raw.trim() : '';
  const date = form.get('date');
  const back = `/app/${secret}${
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''
  }`;
  const sep = back.includes('?') ? '&' : '?';

  // A blank note captures nothing. Fail quietly back to the page rather than
  // queuing an empty row the model would then have to decline.
  if (note.length < 2) return seeOther(`${back}${sep}ok=emptynote`);
  if (note.length > 500) return seeOther(`${back}${sep}ok=longnote`);

  await insertCapture(ctx, {
    local_date: localDate(ctx.now, ctx.tz),
    kind: 'note',
    note,
  });

  return seeOther(`${back}${sep}ok=captured`);
}

export async function handleAppWrite(
  ctx: Ctx,
  request: Request,
  secret: string,
  remove: boolean,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad form submission', { status: 400 });
  }

  const id = form.get('meal_id');
  const date = form.get('date');
  const back = `/app/${secret}${typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''}`;

  if (typeof id !== 'string' || id === '') {
    return seeOther(`${back}${back.includes('?') ? '&' : '?'}ok=missing`);
  }

  const before = await getMealById(ctx, id);
  if (!before) {
    // Already gone — most likely a double submit or a stale tab. Not an error
    // worth a scary page; the redirect will show the current truth.
    return seeOther(`${back}${back.includes('?') ? '&' : '?'}ok=gone`);
  }

  if (remove) {
    await softDeleteMeal(ctx, id);
    return seeOther(`${back}${back.includes('?') ? '&' : '?'}ok=deleted`);
  }

  const patch: MealPatch = {};
  const kcal = field(form, 'kcal');
  const protein = field(form, 'protein_g');
  const fat = field(form, 'fat_g');
  const carb = field(form, 'carb_g');
  if (kcal !== undefined) patch.kcal = kcal;
  if (protein !== undefined) patch.protein_g = protein;
  if (fat !== undefined) patch.fat_g = fat;
  if (carb !== undefined) patch.carb_g = carb;

  const desc = form.get('description');
  if (typeof desc === 'string' && desc.trim() !== '' && desc.trim() !== before.description) {
    patch.description = desc.trim();
  }

  if (Object.keys(patch).length === 0) {
    return seeOther(`${back}${back.includes('?') ? '&' : '?'}ok=nochange`);
  }

  await updateMeal(ctx, id, patch);
  const after = await getMealById(ctx, id);

  // Same rule as correct_meal: only a change in the numbers teaches a portion.
  // A typo fix in the description should not overwrite what the phrase means.
  const moved =
    after !== null &&
    (after.kcal !== before.kcal ||
      after.protein_g !== before.protein_g ||
      after.fat_g !== before.fat_g ||
      after.carb_g !== before.carb_g);

  if (moved && after) {
    const phrase = after.description.trim();
    if (phrase.length >= 3 && phrase.length <= 120) {
      await rememberPortion(ctx, phrase, {
        kcal: after.kcal,
        protein_g: after.protein_g,
        fat_g: after.fat_g,
        carb_g: after.carb_g,
      });
    }
  }

  return seeOther(`${back}${back.includes('?') ? '&' : '?'}ok=${moved ? 'learned' : 'saved'}`);
}
