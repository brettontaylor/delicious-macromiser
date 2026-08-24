/**
 * Events — log, list, correct, remove.
 *
 * The boundary, restated because it is easy to lose here: these tools store a
 * fact the user stated ("I started creatine on the 24th; expect it to cloud the
 * scale for about three weeks") and hand it back. They never decide that a
 * reading should be discounted. The Skill reads `caveat_active` and
 * `clouded_readings` and makes that call, because the physiology behind the
 * three weeks is coaching knowledge and coaching knowledge changes.
 */

import type { Ctx, EventPatch } from '../../db/queries.ts';
import {
  insertEvent,
  getAllEvents,
  getEventById,
  getEventsInRange,
  updateEvent,
  softDeleteEvent,
} from '../../db/queries.ts';
import {
  EVENT_KINDS,
  EVENT_AFFECTS,
  isEventAffects,
  isEventKind,
  activeOn,
  cloudedReadings,
  viewEvent,
} from '../../domain/events.ts';
import { localDate, isValidDate, shiftDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString, optString, optLocalDate } from './args.ts';

/** A date arg that may be explicitly null — "it never ended after all". */
function dateOrNull(args: ToolArgs, key: string): string | null | undefined {
  if (!(key in args)) return undefined;
  const v = args[key];
  if (v === null) return null;
  if (typeof v === 'string' && isValidDate(v)) return v;
  throw new ArgError(`"${key}" must be a YYYY-MM-DD date, or null to clear it.`);
}

export async function logEvent(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const kind = reqString(args, 'kind');
  if (!isEventKind(kind)) {
    throw new ArgError(`NOT SAVED — "kind" must be one of: ${EVENT_KINDS.join(', ')}.`);
  }

  const label = reqString(args, 'label').trim();
  if (label.length < 3) {
    throw new ArgError('NOT SAVED — "label" needs to say what happened, in the user’s own words.');
  }

  const today = localDate(ctx.now, ctx.tz);
  const startsOn = optLocalDate(args, 'starts_on', ctx.now, ctx.tz);

  const endsOn = dateOrNull(args, 'ends_on') ?? null;
  if (endsOn !== null && endsOn < startsOn) {
    throw new ArgError('NOT SAVED — "ends_on" is before "starts_on".');
  }

  const affectsRaw = optString(args, 'affects') ?? 'none';
  if (!isEventAffects(affectsRaw)) {
    throw new ArgError(`NOT SAVED — "affects" must be one of: ${EVENT_AFFECTS.join(', ')}.`);
  }

  let caveatUntil = dateOrNull(args, 'caveat_until') ?? null;
  if (caveatUntil !== null && caveatUntil < startsOn) {
    throw new ArgError('NOT SAVED — "caveat_until" is before "starts_on".');
  }
  // A caveat window with nothing to caveat is a contradiction. Drop it rather
  // than storing a date that no read path will ever consult.
  if (affectsRaw === 'none') caveatUntil = null;

  const id = await insertEvent(ctx, {
    kind,
    label,
    starts_on: startsOn,
    ends_on: endsOn,
    caveat_until: caveatUntil,
    affects: affectsRaw,
    notes: optString(args, 'notes'),
  });

  const row = await getEventById(ctx, id);
  return {
    logged: true,
    event_id: id,
    event: row ? viewEvent(row, today) : null,
    backdated: startsOn !== today,
    // Said back so the user can correct it in the same breath, the same way
    // log_meal states the estimate it used.
    reads_as:
      affectsRaw === 'none'
        ? 'Recorded. It will show on the trend but will not caveat any reading.'
        : caveatUntil
          ? `Recorded. ${affectsRaw} readings are flagged as clouded through ${caveatUntil}.`
          : `Recorded as affecting ${affectsRaw}, with no end to the caveat window — set caveat_until if it should lift.`,
  };
}

export async function getEvents(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const today = localDate(ctx.now, ctx.tz);
  const days = Math.min(Math.max(Number(args.days ?? 90) || 90, 1), 400);
  const start = shiftDate(today, -(days - 1));

  const [inRange, all] = await Promise.all([
    getEventsInRange(ctx, start, today),
    getAllEvents(ctx, 50),
  ]);

  const active = activeOn(inRange, today);
  return {
    as_of: today,
    window_days: days,
    // The ones that change how today's numbers read. Usually the only part
    // that matters, so it comes first.
    active: active,
    clouded_readings: cloudedReadings(inRange, today),
    all: all.map((e) => viewEvent(e, today)),
    none_recorded: all.length === 0,
  };
}

export async function correctEvent(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'event_id');
  const before = await getEventById(ctx, id);
  if (!before) {
    throw new ArgError(
      `NOT CHANGED — no event with id "${id}" (it may already be deleted). Call get_events for the right id.`,
    );
  }

  const patch: EventPatch = {};

  const label = optString(args, 'label');
  if (label !== null) patch.label = label.trim();

  const startsOn = optString(args, 'starts_on');
  if (startsOn !== null) {
    if (!isValidDate(startsOn)) throw new ArgError('"starts_on" must be YYYY-MM-DD.');
    patch.starts_on = startsOn;
  }

  const endsOn = dateOrNull(args, 'ends_on');
  if (endsOn !== undefined) patch.ends_on = endsOn;

  const caveatUntil = dateOrNull(args, 'caveat_until');
  if (caveatUntil !== undefined) patch.caveat_until = caveatUntil;

  const affects = optString(args, 'affects');
  if (affects !== null) {
    if (!isEventAffects(affects)) {
      throw new ArgError(`"affects" must be one of: ${EVENT_AFFECTS.join(', ')}.`);
    }
    patch.affects = affects;
  }

  const notes = optString(args, 'notes');
  if (notes !== null) patch.notes = notes;

  if (Object.keys(patch).length === 0) {
    throw new ArgError('NOT CHANGED — nothing to change. Send at least one field.');
  }

  // Validate against the merged row, not the patch: correcting only ends_on
  // must still be checked against the stored starts_on.
  const merged = { ...before, ...patch };
  if (merged.ends_on !== null && merged.ends_on < merged.starts_on) {
    throw new ArgError('NOT CHANGED — that would put "ends_on" before "starts_on".');
  }
  if (merged.caveat_until !== null && merged.caveat_until < merged.starts_on) {
    throw new ArgError('NOT CHANGED — that would put "caveat_until" before "starts_on".');
  }

  const ok = await updateEvent(ctx, id, patch);
  if (!ok) throw new ArgError('NOT CHANGED — the event could not be updated.');

  const after = await getEventById(ctx, id);
  const today = localDate(ctx.now, ctx.tz);
  return {
    corrected: true,
    event_id: id,
    before: viewEvent(before, today),
    after: after ? viewEvent(after, today) : null,
  };
}

export async function deleteEvent(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const id = reqString(args, 'event_id');
  const before = await getEventById(ctx, id);
  if (!before) {
    throw new ArgError(`NOT DELETED — no event with id "${id}" (it may already be deleted).`);
  }
  const ok = await softDeleteEvent(ctx, id);
  if (!ok) throw new ArgError('NOT DELETED — the event could not be removed.');

  return {
    deleted: true,
    event_id: id,
    removed: { kind: before.kind, label: before.label, starts_on: before.starts_on },
    recoverable: true,
  };
}
