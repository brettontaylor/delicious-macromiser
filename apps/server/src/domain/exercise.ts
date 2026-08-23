/**
 * Exercise name normalization. `get_last_performance` is the differentiating
 * tool (README §2), and it only works if "back squat", "Back Squats" and
 * "barbell back squat" resolve to one key.
 *
 * Deliberately a small alias table plus a slug fallback — not fuzzy matching.
 * An unknown lift still gets a stable slug, so history accumulates from day one.
 */

const ALIASES: Record<string, string> = {
  squat: 'back_squat',
  squats: 'back_squat',
  back_squat: 'back_squat',
  barbell_back_squat: 'back_squat',
  front_squat: 'front_squat',
  bench: 'bench_press',
  bench_press: 'bench_press',
  barbell_bench_press: 'bench_press',
  flat_bench: 'bench_press',
  incline_bench: 'incline_bench_press',
  incline_bench_press: 'incline_bench_press',
  deadlift: 'deadlift',
  deadlifts: 'deadlift',
  conventional_deadlift: 'deadlift',
  rdl: 'romanian_deadlift',
  romanian_deadlift: 'romanian_deadlift',
  ohp: 'overhead_press',
  overhead_press: 'overhead_press',
  military_press: 'overhead_press',
  press: 'overhead_press',
  row: 'barbell_row',
  rows: 'barbell_row',
  barbell_row: 'barbell_row',
  bent_over_row: 'barbell_row',
  pullup: 'pull_up',
  pullups: 'pull_up',
  pull_up: 'pull_up',
  pull_ups: 'pull_up',
  chinup: 'chin_up',
  chin_up: 'chin_up',
  pulldown: 'lat_pulldown',
  lat_pulldown: 'lat_pulldown',
  lunge: 'lunge',
  lunges: 'lunge',
  suitcase_hold: 'suitcase_hold',
  leg_press: 'leg_press',
  dip: 'dip',
  dips: 'dip',
  curl: 'biceps_curl',
  curls: 'biceps_curl',
  biceps_curl: 'biceps_curl',
};

/** Lowercase, strip punctuation, collapse whitespace to underscores. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Canonical exercise key for `raw`. Falls back to the bare slug. */
export function normalizeExercise(raw: string): string {
  const slug = slugify(raw);
  if (!slug) return 'unknown';
  if (ALIASES[slug]) return ALIASES[slug]!;
  // Try dropping a trailing plural 's' before giving up on the alias table.
  if (slug.endsWith('s') && ALIASES[slug.slice(0, -1)]) return ALIASES[slug.slice(0, -1)]!;
  return slug;
}

/**
 * Movement pattern for a canonical exercise — the Skill's recovery rules
 * (COACHING-LAYER.md §3) key off this. Data, not advice: we return the
 * classification and let the Skill decide what to do with it.
 */
export function movementPattern(exercise: string): string {
  const e = exercise;
  if (/squat|lunge|leg_press|step_up/.test(e)) return 'squat';
  if (/deadlift|hinge|good_morning|hip_thrust/.test(e)) return 'hinge';
  if (/bench|dip|push_up|chest/.test(e)) return 'horizontal_push';
  if (/overhead_press|shoulder_press|lateral_raise/.test(e)) return 'vertical_push';
  if (/row|face_pull/.test(e)) return 'horizontal_pull';
  if (/pull_up|chin_up|pulldown/.test(e)) return 'vertical_pull';
  if (/curl|triceps|extension/.test(e)) return 'isolation';
  return 'other';
}
