/**
 * Tool registry. One entry per tool: JSON Schema for the model, a handler that
 * receives validated-enough args plus the request context.
 *
 * Kept small on purpose (ARCHITECTURE.md §5, design principle 3): eight good
 * descriptions beat thirty tools. Nothing here returns advice — no
 * recommend_workout, no analyze_progress. Coaching lives in the Skill.
 */

import type { Ctx } from '../../db/queries.ts';
import { DESCRIPTIONS, ARG_DOCS } from '../descriptions.ts';
import { logMeal } from './log_meal.ts';
import { logWorkout } from './log_workout.ts';
import { logBodyweight } from './log_bodyweight.ts';
import { setGoals } from './set_goals.ts';
import { getToday } from './get_today.ts';
import { getLastPerformance } from './get_last_performance.ts';
import { getWeekSummary } from './get_week_summary.ts';
import { getHistory } from './get_history.ts';

export type ToolArgs = Record<string, unknown>;
export type ToolHandler = (ctx: Ctx, args: ToolArgs) => Promise<unknown>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

const num = (description: string) => ({ type: 'number', description });
const str = (description: string) => ({ type: 'string', description });

export const TOOLS: ToolDef[] = [
  {
    name: 'log_meal',
    description: DESCRIPTIONS.log_meal,
    inputSchema: {
      type: 'object',
      properties: {
        description: str('Verbatim description of what was eaten, in the user’s own words.'),
        kcal: num('Total calories, including any from alcohol.'),
        protein_g: num('Grams of protein.'),
        fat_g: num('Grams of fat.'),
        carb_g: num('Grams of carbohydrate, excluding alcohol.'),
        fiber_g: num('Grams of fiber. Optional.'),
        alcohol_g: num(ARG_DOCS.alcohol_g),
        meal_type: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
          description: 'Optional. Infer from context or the time of day.',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: ARG_DOCS.confidence,
        },
        when: str(ARG_DOCS.when),
        source: {
          type: 'string',
          enum: ['estimate', 'import'],
          description: ARG_DOCS.source,
        },
      },
      required: ['description', 'kcal', 'protein_g', 'fat_g', 'carb_g', 'confidence'],
      additionalProperties: false,
    },
    handler: logMeal,
  },
  {
    name: 'log_workout',
    description: DESCRIPTIONS.log_workout,
    inputSchema: {
      type: 'object',
      properties: {
        sets: {
          type: 'array',
          description: 'Every set performed in the session, across all exercises.',
          items: {
            type: 'object',
            properties: {
              exercise: str(ARG_DOCS.exercise),
              set_no: { type: 'integer', description: 'Set number within that exercise, starting at 1.' },
              reps: { type: 'integer', description: 'Reps completed.' },
              weight_lb: num('Load in pounds. Omit for bodyweight movements.'),
              rpe: num(ARG_DOCS.rpe),
              completed: {
                type: 'boolean',
                description: 'False when the set was attempted but the target reps were missed. Defaults to true.',
              },
            },
            required: ['exercise', 'set_no'],
            additionalProperties: false,
          },
        },
        session_label: str('Optional label, e.g. "Day A" or "Pull".'),
        notes: str('Optional free text: soreness, sleep, how it felt.'),
        when: str(ARG_DOCS.when),
      },
      required: ['sets'],
      additionalProperties: false,
    },
    handler: logWorkout,
  },
  {
    name: 'log_bodyweight',
    description: DESCRIPTIONS.log_bodyweight,
    inputSchema: {
      type: 'object',
      properties: {
        weight_lb: num('Bodyweight in pounds.'),
        waist_in: num('Waist measurement in inches.'),
        date: str(ARG_DOCS.date),
      },
      additionalProperties: false,
    },
    handler: logBodyweight,
  },
  {
    name: 'set_goals',
    description: DESCRIPTIONS.set_goals,
    inputSchema: {
      type: 'object',
      properties: {
        kcal: num('Daily calorie target.'),
        protein_g: num('Daily protein target in grams.'),
        fat_g: num('Daily fat target in grams.'),
        carb_g: num('Daily carbohydrate target in grams.'),
        target_weight_lb: num('Goal bodyweight in pounds.'),
        weekly_sessions: { type: 'integer', description: 'Target training sessions per week.' },
        effective_from: str('Optional YYYY-MM-DD. Omit to apply from today.'),
      },
      additionalProperties: false,
    },
    handler: setGoals,
  },
  {
    name: 'get_today',
    description: DESCRIPTIONS.get_today,
    inputSchema: {
      type: 'object',
      properties: { date: str(ARG_DOCS.date) },
      additionalProperties: false,
    },
    handler: getToday,
  },
  {
    name: 'get_last_performance',
    description: DESCRIPTIONS.get_last_performance,
    inputSchema: {
      type: 'object',
      properties: {
        exercises: {
          type: 'array',
          items: { type: 'string' },
          description:
            'One or more exercise names. Ask for every lift you are about to program, in a single call.',
        },
      },
      required: ['exercises'],
      additionalProperties: false,
    },
    handler: getLastPerformance,
  },
  {
    name: 'get_week_summary',
    description: DESCRIPTIONS.get_week_summary,
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Window length in days. Defaults to 7. Max 90.' },
        end_date: str('Optional YYYY-MM-DD for the last day of the window. Omit for today.'),
      },
      additionalProperties: false,
    },
    handler: getWeekSummary,
  },
  {
    name: 'get_history',
    description: DESCRIPTIONS.get_history,
    inputSchema: {
      type: 'object',
      properties: {
        start_date: str('First day of the range, YYYY-MM-DD.'),
        end_date: str('Last day of the range, YYYY-MM-DD.'),
        include: {
          type: 'array',
          items: { type: 'string', enum: ['meals', 'workouts', 'bodyweight'] },
          description: 'Which record types to return. Defaults to all three.',
        },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
    handler: getHistory,
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
