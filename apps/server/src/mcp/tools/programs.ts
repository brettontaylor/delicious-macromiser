/**
 * Programs — the standing block a session comes from.
 *
 * The same boundary as prescriptions, one level up: this stores the block the
 * model and user agreed on and hands it back. It never generates a programme,
 * never advances a load, and never parses `progression_rule` — that string is
 * coaching, it changes weekly, and it belongs to the Skill.
 */

import type { Ctx, NewProgramDay, NewProgramExercise } from '../../db/queries.ts';
import { insertProgram, getActiveProgram, setProgramStatus } from '../../db/queries.ts';
import { normalizeExercise } from '../../domain/exercise.ts';
import {
  describeTarget,
  materialize,
  patternCoverage,
  programDayFor,
  programWeekShape,
  weekOfProgram,
  type ProgramShape,
} from '../../domain/prescription.ts';
import { WEEKDAY_NAMES, weekdayIndex } from '../../domain/plan.ts';
import { localDate, localWeekday, shiftDate, isValidDate } from '../../util/date.ts';
import type { ToolArgs } from './index.ts';
import { ArgError, reqString, optString, optLocalDate } from './args.ts';

/** Accepts "Tuesday" or 0-6, matching set_training_plan so the two read alike. */
function parseWeekday(v: unknown, where: string): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (/^[0-6]$/.test(trimmed)) return Number(trimmed);
    const idx = weekdayIndex(trimmed);
    if (idx >= 0) return idx;
  }
  throw new ArgError(`${where}: weekday must be a name like "Tuesday", or 0-6 with 0 = Sunday.`);
}

function parseExercises(raw: unknown, where: string): NewProgramExercise[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError(`${where}.exercises is required and must be a non-empty array.`);
  }
  if (raw.length > 30) throw new ArgError(`${where}.exercises is capped at 30.`);

  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ArgError(`${where}.exercises[${i}] must be an object.`);
    }
    const e = entry as Record<string, unknown>;
    const name = e['exercise'];
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ArgError(`${where}.exercises[${i}].exercise is required.`);
    }
    const num = (key: string): number | null => {
      const v = e[key];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new ArgError(`${where}.exercises[${i}].${key} must be a non-negative number.`);
      }
      return v;
    };
    const repLow = num('rep_low');
    const repHigh = num('rep_high');
    if (repLow !== null && repHigh !== null && repHigh < repLow) {
      throw new ArgError(`${where}.exercises[${i}]: rep_high is below rep_low.`);
    }
    const weekOffset = num('week');
    return {
      ordinal: i + 1,
      exercise: normalizeExercise(name),
      exercise_raw: name.trim(),
      block: optString(e, 'block'),
      sets: num('sets'),
      rep_low: repLow,
      rep_high: repHigh ?? repLow,
      target_weight_lb: num('target_weight_lb'),
      // 1-based for the model ("week 2"), 0-based in storage and arithmetic.
      week_offset: weekOffset === null ? null : Math.max(0, weekOffset - 1),
      notes: optString(e, 'notes'),
    };
  });
}

export async function setProgram(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const name = reqString(args, 'name').trim();
  if (name.length < 3) throw new ArgError('NOT SAVED — "name" needs to say what the block is.');

  const raw = args['days'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ArgError('NOT SAVED — "days" is required and must be a non-empty array.');
  }
  if (raw.length > 7) throw new ArgError('NOT SAVED — a week has at most 7 days.');

  const seen = new Set<number>();
  const days: NewProgramDay[] = raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new ArgError(`days[${i}] must be an object.`);
    const d = entry as Record<string, unknown>;
    const weekday = parseWeekday(d['weekday'], `days[${i}]`);
    if (seen.has(weekday)) {
      throw new ArgError(`NOT SAVED — ${WEEKDAY_NAMES[weekday]} appears twice.`);
    }
    seen.add(weekday);
    return {
      weekday,
      day_key: optString(d, 'day_key'),
      label: optString(d, 'label'),
      exercises: parseExercises(d['exercises'], `days[${i}]`),
    };
  });

  const startedOn = optLocalDate(args, 'started_on', ctx.now, ctx.tz);
  const weeksRaw = args['weeks'];
  let weeks: number | null = null;
  if (weeksRaw !== undefined && weeksRaw !== null) {
    if (typeof weeksRaw !== 'number' || !Number.isInteger(weeksRaw) || weeksRaw < 1 || weeksRaw > 52) {
      throw new ArgError('NOT SAVED — "weeks" must be a whole number between 1 and 52.');
    }
    weeks = weeksRaw;
  }
  // Inclusive end: a 2-week block starting Monday ends 13 days later, not 14.
  const endsOn = weeks === null ? null : shiftDate(startedOn, weeks * 7 - 1);

  const { id, retired } = await insertProgram(
    ctx,
    {
      name,
      weeks,
      progression_rule: optString(args, 'progression_rule'),
      started_on: startedOn,
      ends_on: endsOn,
    },
    days,
  );

  const shape: ProgramShape = {
    weeks,
    started_on: startedOn,
    ends_on: endsOn,
    days: days.map((d) => ({ ...d, exercises: d.exercises })),
  };

  return {
    saved: true,
    program_id: id,
    name,
    weeks,
    started_on: startedOn,
    ends_on: endsOn,
    week_shape: programWeekShape(shape).map((d) => ({
      weekday: d.weekday,
      weekday_name: WEEKDAY_NAMES[d.weekday],
      label: d.label,
      exercises: d.exercises,
    })),
    // Answers "there is no hip hinge in this program at all" — the sharpest
    // observation in the source transcript, and free to compute.
    movement_patterns: patternCoverage(days.flatMap((d) => materialize({ ...d }, 0))),
    replaced_previous: retired > 0,
    reminder:
      'The block does not write sessions on its own. Each training day, call get_session — ' +
      'it returns today’s template with real history so you can set the load and call ' +
      'prescribe_session.',
  };
}

export async function getProgram(ctx: Ctx, _args: ToolArgs): Promise<unknown> {
  const prog = await getActiveProgram(ctx);
  const today = localDate(ctx.now, ctx.tz);

  if (!prog) {
    return {
      no_program_set: true,
      // Distinguished from "today is a rest day" for the same reason
      // get_training_plan distinguishes no_plan_set.
      note: 'No block has been set up. Offer to build one rather than implying there is nothing planned.',
      program: null,
    };
  }

  const shape: ProgramShape = {
    weeks: prog.weeks,
    started_on: prog.started_on,
    ends_on: prog.ends_on,
    days: prog.days,
  };
  const week = weekOfProgram(shape, today);

  return {
    no_program_set: false,
    program: {
      program_id: prog.id,
      name: prog.name,
      weeks: prog.weeks,
      started_on: prog.started_on,
      ends_on: prog.ends_on,
      // Null means today falls outside the block. Say the block is over rather
      // than serving its last week forever.
      week_of: week === null ? null : week + 1,
      expired: week === null,
      // Verbatim, never parsed. Apply it; do not substitute a better one.
      progression_rule: prog.progression_rule,
    },
    days: prog.days.map((d) => ({
      weekday: d.weekday,
      weekday_name: WEEKDAY_NAMES[d.weekday],
      day_key: d.day_key,
      label: d.label,
      exercises: materialize(d, week ?? 0).map((t) => ({
        exercise: t.exercise,
        as_written: t.exercise_raw,
        block: t.block,
        reads_as: describeTarget(t),
        target_weight_lb: t.target_weight_lb,
      })),
    })),
    movement_patterns: patternCoverage(prog.days.flatMap((d) => materialize(d, week ?? 0))),
  };
}

export async function endProgram(ctx: Ctx, args: ToolArgs): Promise<unknown> {
  const prog = await getActiveProgram(ctx);
  if (!prog) throw new ArgError('NOT CHANGED — there is no active block to end.');

  const status = optString(args, 'status') ?? 'completed';
  if (status !== 'completed' && status !== 'abandoned') {
    throw new ArgError('"status" must be "completed" or "abandoned".');
  }
  const ok = await setProgramStatus(ctx, prog.id, status);
  if (!ok) throw new ArgError('NOT CHANGED — the block could not be ended.');

  return {
    ended: true,
    program_id: prog.id,
    name: prog.name,
    status,
    note:
      status === 'abandoned'
        ? 'Marked abandoned. Sessions already logged against it are untouched.'
        : 'Marked complete. Sessions already logged against it are untouched.',
  };
}

/** Today's template, for `get_session` and `prescribe_session(from_program)`.
 *  Exported rather than duplicated so the read and the write cannot drift. */
export async function todaysTemplate(ctx: Ctx, date: string) {
  const prog = await getActiveProgram(ctx);
  if (!prog) return null;

  const shape: ProgramShape = {
    weeks: prog.weeks,
    started_on: prog.started_on,
    ends_on: prog.ends_on,
    days: prog.days,
  };
  const week = weekOfProgram(shape, date);
  if (week === null) return { program: prog, week: null, day: null, targets: [] };

  const weekday = weekdayIndex(localWeekday(new Date(date + 'T12:00:00Z'), 'UTC'));
  const day = programDayFor(shape, weekday);
  return {
    program: prog,
    week,
    day,
    targets: day ? materialize(day, week) : [],
  };
}

export { isValidDate };
