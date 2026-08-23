import type { Ctx } from '../../db/queries.ts';
import {
  getPantry, addPantryItem, removePantryItem, clearPantryKind,
} from '../../db/queries.ts';
import { RECIPES } from '../../domain/recipes.ts';
import { unusedPantry } from '../../domain/pantry.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, optString } from './args.ts';

const KINDS = ['staple', 'fresh'] as const;

/**
 * Two lists, not an inventory. No quantities and nothing decrements — see
 * migrations/0005_pantry.sql for why that is a decision rather than a shortcut.
 */
export async function setPantry(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const replaceKind = optString(args, 'replace_kind');
  if (replaceKind !== null && !KINDS.includes(replaceKind as (typeof KINDS)[number])) {
    throw new ArgError('"replace_kind" must be "staple" or "fresh".');
  }

  const add = args['add'];
  const remove = args['remove'];
  if (add === undefined && remove === undefined && replaceKind === null) {
    throw new ArgError('Nothing to do. Send "add", "remove", or "replace_kind".');
  }

  let cleared = 0;
  // Replace before adding, so "here is what is fresh now" is one call and does
  // not leave last week's list behind.
  if (replaceKind !== null) cleared = await clearPantryKind(ctx, replaceKind);

  const added: string[] = [];
  if (add !== undefined && add !== null) {
    if (!Array.isArray(add)) throw new ArgError('"add" must be an array.');
    if (add.length > 100) throw new ArgError('"add" is capped at 100 items.');
    for (const [i, entry] of add.entries()) {
      let item: string;
      let kind: string;
      if (typeof entry === 'string') {
        item = entry;
        kind = replaceKind ?? 'staple';
      } else if (typeof entry === 'object' && entry !== null) {
        const e = entry as Record<string, unknown>;
        if (typeof e['item'] !== 'string') throw new ArgError(`add[${i}].item must be a string.`);
        item = e['item'];
        const k = e['kind'] ?? replaceKind ?? 'staple';
        if (typeof k !== 'string' || !KINDS.includes(k as (typeof KINDS)[number])) {
          throw new ArgError(`add[${i}].kind must be "staple" or "fresh".`);
        }
        kind = k;
      } else {
        throw new ArgError(`add[${i}] must be a string or an object.`);
      }
      const clean = item.trim().toLowerCase();
      if (clean.length < 2 || clean.length > 60) {
        throw new ArgError(`add[${i}] "${item}" must be 2-60 characters.`);
      }
      await addPantryItem(ctx, clean, kind);
      added.push(`${clean} (${kind})`);
    }
  }

  const removed: string[] = [];
  if (remove !== undefined && remove !== null) {
    if (!Array.isArray(remove)) throw new ArgError('"remove" must be an array.');
    for (const entry of remove) {
      if (typeof entry !== 'string') throw new ArgError('"remove" must be strings.');
      if (await removePantryItem(ctx, entry)) removed.push(entry.trim().toLowerCase());
    }
  }

  const pantry = await getPantry(ctx);
  return {
    saved: true,
    cleared,
    added,
    removed,
    staples: pantry.filter((x) => x.kind === 'staple').map((x) => x.item),
    fresh: pantry.filter((x) => x.kind === 'fresh').map((x) => x.item),
  };
}

/** What is in the house, plus what nothing in the recipe book uses. */
export async function getPantryTool(ctx: Ctx, _args: ToolArgs): Promise<unknown> {
  const pantry = await getPantry(ctx);
  const allIngredients = RECIPES.flatMap((r) => r.ingredients ?? []);
  return {
    staples: pantry.filter((x) => x.kind === 'staple').map((x) => x.item),
    fresh: pantry.filter((x) => x.kind === 'fresh').map((x) => x.item),
    total: pantry.length,
    // Honest answer to "what am I going to do with this", and a cheap prompt to
    // add a recipe that uses it.
    used_by_no_recipe: unusedPantry(pantry, allIngredients),
    note:
      pantry.length === 0
        ? 'No pantry set up. This is two lists, not an inventory: staples are what they always have, fresh is a short list of what is in the house right now.'
        : null,
  };
}
