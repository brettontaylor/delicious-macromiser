/**
 * The roadmap, as data.
 *
 * One source for two consumers: the /roadmap page, and the greyed placeholders
 * that sit inline where each feature will actually live. A placeholder whose
 * label drifts from the roadmap row it points at is worse than no placeholder,
 * so neither is allowed to hold its own copy of the text.
 *
 * This is reference data bundled into the Worker, exactly like the recipe
 * catalog (`domain/recipes.ts`) — no table, no sync step, no way for it to go
 * stale against a deploy. Editing this file and shipping is the update path.
 *
 * Ordering and wording track docs/ROADMAP.md. Stories track
 * docs/plans/user-stories.md.
 */

export type RoadmapStatus = 'shipped' | 'next' | 'gated';

export interface RoadmapItem {
  /** Stable anchor. Inline stubs link to `/roadmap#<id>`. */
  id: string;
  /** Epic id from user-stories.md, when there is one. */
  epic: string | null;
  title: string;
  /** One or two sentences, in the product's own voice. */
  blurb: string;
  status: RoadmapStatus;
  /** Position within `next`. Absent for shipped and gated. */
  rank?: number;
  /** YYYY-MM-DD. Shipped only. */
  shipped_on?: string;
  /** Rough size, shown as a chip. */
  size?: string;
  /** Story ids this covers. */
  stories?: string[];
  /** Gated only: what unblocks it. */
  blocked_by?: string;
}

export const ROADMAP: RoadmapItem[] = [
  // ---------- shipped, newest first ----------
  {
    id: 'events',
    epic: 'E2',
    title: 'Events and annotations',
    blurb:
      'Creatine, travel, injury and deloads marked on the trend, so a rising scale ' +
      'during a deficit explains itself.',
    status: 'shipped',
    shipped_on: '2026-08-24',
    stories: ['S-15', 'S-20', 'S-21'],
  },
  {
    id: 'briefing',
    epic: null,
    title: 'One-call briefing',
    blurb: 'The whole day in a single round trip instead of four.',
    status: 'shipped',
    shipped_on: '2026-08-24',
  },
  {
    id: 'photo-capture',
    epic: null,
    title: 'Photo capture',
    blurb: 'Snap the plate; your own model reads it next time you open a chat.',
    status: 'shipped',
    shipped_on: '2026-08-24',
  },
  {
    id: 'capture-queue',
    epic: null,
    title: 'The capture queue',
    blurb: 'Log something in the app now, have it analyzed later.',
    status: 'shipped',
    shipped_on: '2026-08-24',
  },
  {
    id: 'next-meal',
    epic: null,
    title: 'Next-meal prediction',
    blurb: 'Learned from your own logging times, never guessed.',
    status: 'shipped',
    shipped_on: '2026-08-24',
  },
  {
    id: 'pantry',
    epic: null,
    title: 'The pantry',
    blurb: 'Two lists. Recipes sort by what you already have.',
    status: 'shipped',
    shipped_on: '2026-08-24',
  },
  {
    id: 'recipes-in-app',
    epic: null,
    title: 'Recipes in the app',
    blurb: 'The book, filtered by tonight’s remaining budget.',
    status: 'shipped',
    shipped_on: '2026-08-23',
  },
  {
    id: 'training-plan',
    epic: null,
    title: 'Training plan',
    blurb: 'What today is for, not just what happened.',
    status: 'shipped',
    shipped_on: '2026-08-23',
  },
  {
    id: 'corrections',
    epic: null,
    title: 'Corrections and trends',
    blurb: 'Fix an estimate once; the next one starts from your number.',
    status: 'shipped',
    shipped_on: '2026-08-23',
  },

  // ---------- next, in order ----------
  {
    id: 'pacing',
    epic: 'E6',
    title: 'Pacing and milestones',
    blurb:
      '“100 g of protein by 2pm — your best pace yet.” Compares today against the ' +
      'same hour on other days, and marks a lift you have never hit before.',
    status: 'next',
    rank: 1,
    size: 'one evening',
    stories: ['S-12', 'S-23', 'S-25'],
  },
  {
    id: 'session',
    epic: 'E1',
    title: 'Today’s session, written down',
    blurb:
      'The actual lifts with actual loads, agreed once and kept — plus the multi-week ' +
      'block behind them. Then what you planned is compared against what you did.',
    status: 'next',
    rank: 2,
    size: 'the epic',
    stories: ['S-5', 'S-6', 'S-7', 'S-19'],
  },
  {
    id: 'weekly-budget',
    epic: 'E3',
    title: 'The weekly budget',
    blurb:
      'Budget the week, not the meal. A big Friday is fine if Thursday and Saturday ' +
      'run light — but only if you can see the week.',
    status: 'next',
    rank: 3,
    size: 'medium',
    stories: ['S-11', 'S-16', 'S-30'],
  },
  {
    id: 'adherence',
    epic: 'E5',
    title: 'Supplements and standing rules',
    blurb:
      'Set up your stack once, then one checkbox a day — alongside the rules you ' +
      'already wrote for yourself, like the 10,000 steps and the zero-alcohol day.',
    status: 'next',
    rank: 4,
    size: 'medium',
    stories: ['S-14', 'S-17'],
  },
  {
    id: 'profile',
    epic: 'E4',
    title: 'Athlete profile',
    blurb:
      'Your history, your constraints, your goal horizon — kept here rather than in ' +
      'one chat client’s private memory.',
    status: 'next',
    rank: 5,
    size: 'medium',
    stories: ['S-1', 'S-3', 'M-1'],
  },
  {
    id: 'shopping-list',
    epic: null,
    title: 'Shopping list',
    blurb: 'A week of recipes, diffed against the pantry.',
    status: 'next',
    rank: 6,
    size: 'small',
    stories: ['S-27'],
  },

  // ---------- gated ----------
  {
    id: 'wearables',
    epic: 'E7',
    title: 'Steps, sleep and recovery',
    blurb:
      'Apple Health and Whoop. Self-reported scores are not worth the friction; real ' +
      'data is, and it is the only honest answer here.',
    status: 'gated',
    blocked_by: 'needs OAuth, one integration per vendor',
  },
  {
    id: 'multi-user',
    epic: 'E8',
    title: 'More than one person',
    blurb: 'Sign up, connect, and have your data isolated at the server boundary.',
    status: 'gated',
    blocked_by: 'needs a second person who wants in',
  },
];

const BY_ID = new Map(ROADMAP.map((r) => [r.id, r]));

export function roadmapItem(id: string): RoadmapItem | null {
  return BY_ID.get(id) ?? null;
}

export function byStatus(status: RoadmapStatus): RoadmapItem[] {
  const items = ROADMAP.filter((r) => r.status === status);
  return status === 'next' ? items.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)) : items;
}

export interface RoadmapCounts {
  shipped: number;
  next: number;
  gated: number;
}

export function roadmapCounts(): RoadmapCounts {
  return {
    shipped: byStatus('shipped').length,
    next: byStatus('next').length,
    gated: byStatus('gated').length,
  };
}
