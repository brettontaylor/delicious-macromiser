/**
 * Argument coercion. The model supplies these, so nothing here trusts input:
 * every value is checked, and a bad one raises rather than silently becoming 0.
 *
 * Silent write failures are the worst bug in this system (ARCHITECTURE.md
 * pitfall #5), and a meal logged as 0 kcal is a silent failure with extra steps.
 */

import { isValidDate, localDate } from '../../util/date.ts';

export class ArgError extends Error {}

export function reqString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ArgError(`"${key}" is required and must be a non-empty string.`);
  }
  return v.trim();
}

export function optString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ArgError(`"${key}" must be a string.`);
  return v.trim();
}

export function reqNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ArgError(`"${key}" is required and must be a finite number.`);
  }
  return v;
}

export function optNumber(args: Record<string, unknown>, key: string): number | null {
  const v = args[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ArgError(`"${key}" must be a finite number.`);
  }
  return v;
}

/** Non-negative number, defaulting when absent. Macros are never negative. */
export function optNonNegative(args: Record<string, unknown>, key: string, dflt: number): number {
  const v = optNumber(args, key);
  if (v === null) return dflt;
  if (v < 0) throw new ArgError(`"${key}" cannot be negative.`);
  return v;
}

export function optInt(args: Record<string, unknown>, key: string): number | null {
  const v = optNumber(args, key);
  if (v === null) return null;
  if (!Number.isInteger(v)) throw new ArgError(`"${key}" must be a whole number.`);
  return v;
}

export function optEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  const v = optString(args, key);
  if (v === null) return null;
  if (!allowed.includes(v as T)) {
    throw new ArgError(`"${key}" must be one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

export function reqEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = optEnum(args, key, allowed);
  if (v === null) throw new ArgError(`"${key}" is required and must be one of: ${allowed.join(', ')}.`);
  return v;
}

/** Explicit YYYY-MM-DD, or today in `tz` when absent. */
export function optLocalDate(
  args: Record<string, unknown>,
  key: string,
  now: Date,
  tz: string,
): string {
  const v = optString(args, key);
  if (v === null) return localDate(now, tz);
  if (isValidDate(v)) return v;
  throw new ArgError(`"${key}" must be a valid date in YYYY-MM-DD form.`);
}

/**
 * `when` accepts a full ISO timestamp or a bare date. A bare date resolves to
 * that calendar day; a timestamp is converted into the user's tz.
 */
export function resolveWhen(
  args: Record<string, unknown>,
  now: Date,
  tz: string,
): { localDate: string; backdated: boolean } {
  const v = optString(args, 'when');
  if (v === null) return { localDate: localDate(now, tz), backdated: false };
  if (isValidDate(v)) return { localDate: v, backdated: v !== localDate(now, tz) };

  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) {
    throw new ArgError('"when" must be an ISO8601 timestamp or a YYYY-MM-DD date.');
  }
  const d = localDate(parsed, tz);
  return { localDate: d, backdated: d !== localDate(now, tz) };
}
