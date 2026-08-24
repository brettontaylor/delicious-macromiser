/**
 * Tool registry. One entry per tool: JSON Schema for the model, a handler that
 * receives validated-enough args plus the request context.
 *
 * Kept small on purpose (ARCHITECTURE.md §5, design principle 3): a few good
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
import { importDays } from './import_days.ts';
import { listRecipes } from './list_recipes.ts';
import { correctMeal, deleteMeal } from './correct_meal.ts';
import { getNextMeal } from './get_next_meal.ts';
import { getPendingCaptures, resolveCapture } from './captures.ts';
import { correctWorkout, deleteWorkout } from './correct_workout.ts';
import { setTrainingPlan, getTrainingPlanTool } from './training_plan.ts';
import { setPantry, getPantryTool } from './pantry.ts';

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
        recipe_slug: str(
          'Slug of a dish from the user’s recipe book. When set, macros come from ' +
            'the recipe and kcal/protein_g/fat_g/carb_g are not required. See list_recipes.',
        ),
        servings: num('How many servings of the recipe. Defaults to 1. Only with recipe_slug.'),
        capture_id: str(
          'Id of the app capture this meal came from, from get_pending_captures. ' +
            'Closes the capture in the same call.',
        ),
      },
      // kcal and macros are required only when there is no recipe_slug; that is
      // enforced in the handler, which JSON Schema cannot express cleanly here.
      required: ['description'],
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
  {
    name: 'import_days',
    description: DESCRIPTIONS.import_days,
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          description: 'One object per calendar day. Up to 60 per call.',
          items: {
            type: 'object',
            properties: {
              date: str('The day these entries belong to, YYYY-MM-DD. Required.'),
              meals: {
                type: 'array',
                description: 'Up to 20 meals for this day. Omit if none are known.',
                items: {
                  type: 'object',
                  properties: {
                    description: str('What was eaten, in the user’s own words.'),
                    kcal: num('Total calories, including any from alcohol.'),
                    protein_g: num('Grams of protein.'),
                    fat_g: num('Grams of fat.'),
                    carb_g: num('Grams of carbohydrate, excluding alcohol.'),
                    fiber_g: num('Grams of fiber. Optional.'),
                    alcohol_g: num(ARG_DOCS.alcohol_g),
                    meal_type: {
                      type: 'string',
                      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
                      description: 'Optional.',
                    },
                    confidence: {
                      type: 'string',
                      enum: ['high', 'medium', 'low'],
                      description: ARG_DOCS.confidence,
                    },
                  },
                  required: ['description', 'kcal', 'protein_g', 'fat_g', 'carb_g', 'confidence'],
                  additionalProperties: false,
                },
              },
              workout: {
                type: 'object',
                description: 'One training session for this day. Omit if none.',
                properties: {
                  session_label: str('Free text, e.g. "Pull" or "Day A". Optional.'),
                  notes: str('Optional.'),
                  sets: {
                    type: 'array',
                    description: 'Every set of the session. set_no defaults to position.',
                    items: {
                      type: 'object',
                      properties: {
                        exercise: str('The lift name as the user said it; the server normalizes it.'),
                        set_no: num('1-based position. Optional — defaults to array order.'),
                        reps: num('Reps completed. Omit if unknown rather than guessing.'),
                        weight_lb: num('Load in pounds. Omit if unknown rather than guessing.'),
                        rpe: num('1-10. Optional.'),
                        completed: {
                          type: 'boolean',
                          description: 'False when the set was attempted but target reps were missed.',
                        },
                      },
                      required: ['exercise'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['sets'],
                additionalProperties: false,
              },
              bodyweight: {
                type: 'object',
                description: 'Weigh-in for this day. Omit if none.',
                properties: {
                  weight_lb: num('Bodyweight in pounds.'),
                  waist_in: num('Waist in inches.'),
                },
                additionalProperties: false,
              },
            },
            required: ['date'],
            additionalProperties: false,
          },
        },
      },
      required: ['days'],
      additionalProperties: false,
    },
    handler: importDays,
  },
  {
    name: 'list_recipes',
    description: DESCRIPTIONS.list_recipes,
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Optional substring of a title or slug.'),
        min_protein_g: num('Optional. Only recipes with at least this much protein per serving.'),
        max_kcal: num('Optional. Only recipes at or under this many calories per serving.'),
        max_missing: num(
          'Optional. Only recipes missing at most this many pantry ingredients. ' +
            'Ignored when no pantry is set up.',
        ),
      },
      additionalProperties: false,
    },
    handler: listRecipes,
  },
  {
    name: 'correct_meal',
    description: DESCRIPTIONS.correct_meal,
    inputSchema: {
      type: 'object',
      properties: {
        meal_id: str('Id of the meal to fix, from get_today or get_history.'),
        description: str('Corrected description. Optional.'),
        kcal: num('Corrected calories. Optional.'),
        protein_g: num('Corrected protein in grams. Optional.'),
        fat_g: num('Corrected fat in grams. Optional.'),
        carb_g: num('Corrected carbohydrate in grams. Optional.'),
        fiber_g: num('Corrected fiber in grams. Optional.'),
        alcohol_g: num('Corrected pure ethanol in grams. Optional.'),
        meal_type: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
          description: 'Optional.',
        },
      },
      required: ['meal_id'],
      additionalProperties: false,
    },
    handler: correctMeal,
  },
  {
    name: 'delete_meal',
    description: DESCRIPTIONS.delete_meal,
    inputSchema: {
      type: 'object',
      properties: {
        meal_id: str('Id of the meal to remove, from get_today or get_history.'),
      },
      required: ['meal_id'],
      additionalProperties: false,
    },
    handler: deleteMeal,
  },
  {
    name: 'get_next_meal',
    description: DESCRIPTIONS.get_next_meal,
    inputSchema: {
      type: 'object',
      properties: {
        days: num('How far back to read the habit, 7-90. Defaults to 30.'),
      },
      additionalProperties: false,
    },
    handler: getNextMeal,
  },
  {
    name: 'get_pending_captures',
    description: DESCRIPTIONS.get_pending_captures,
    inputSchema: {
      type: 'object',
      properties: { limit: num('How many to return, 1-50. Defaults to 20.') },
      additionalProperties: false,
    },
    handler: getPendingCaptures,
  },
  {
    name: 'resolve_capture',
    description: DESCRIPTIONS.resolve_capture,
    inputSchema: {
      type: 'object',
      properties: {
        capture_id: str('From get_pending_captures.'),
        state: {
          type: 'string',
          enum: ['unusable'],
          description: 'Only "unusable". A logged capture is closed by log_meal.',
        },
        reason: str('What made it impossible to estimate. Required, and repeated to the user.'),
      },
      required: ['capture_id', 'state', 'reason'],
      additionalProperties: false,
    },
    handler: resolveCapture,
  },
  {
    name: 'correct_workout',
    description: DESCRIPTIONS.correct_workout,
    inputSchema: {
      type: 'object',
      properties: {
        workout_id: str('From get_last_performance or get_history.'),
        session_label: str('Corrected label, e.g. "Pull". Optional.'),
        notes: str('Corrected notes. Optional.'),
        sets: {
          type: 'array',
          description: 'Only the sets that are wrong. Others are left alone.',
          items: {
            type: 'object',
            properties: {
              set_no: num('Which set in the session, 1-based. Required.'),
              reps: num('Corrected reps, or null if genuinely unknown.'),
              weight_lb: num('Corrected load in pounds, or null if unknown.'),
              rpe: num('Corrected RPE, 1-10, or null.'),
              completed: {
                type: 'boolean',
                description: 'False when the set was attempted but the target was missed.',
              },
              remove: {
                type: 'boolean',
                description: 'True to delete a set that never happened.',
              },
            },
            required: ['set_no'],
            additionalProperties: false,
          },
        },
      },
      required: ['workout_id'],
      additionalProperties: false,
    },
    handler: correctWorkout,
  },
  {
    name: 'delete_workout',
    description: DESCRIPTIONS.delete_workout,
    inputSchema: {
      type: 'object',
      properties: { workout_id: str('From get_last_performance or get_history.') },
      required: ['workout_id'],
      additionalProperties: false,
    },
    handler: deleteWorkout,
  },
  {
    name: 'set_training_plan',
    description: DESCRIPTIONS.set_training_plan,
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'array',
          description: 'One entry per weekday to set. Others are left alone.',
          items: {
            type: 'object',
            properties: {
              weekday: str('Weekday name ("Tuesday") or 0-6 with 0 = Sunday.'),
              kind: {
                type: 'string',
                enum: ['lift', 'active', 'rest'],
                description: 'lift = a training session; active = walk/mobility; rest = off.',
              },
              label: str('What the day is, e.g. "Lower body", "Pull", "Long walk".'),
              notes: str('Standing rules for this day, in the user’s own words.'),
            },
            required: ['weekday', 'kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['days'],
      additionalProperties: false,
    },
    handler: setTrainingPlan,
  },
  {
    name: 'get_training_plan',
    description: DESCRIPTIONS.get_training_plan,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: getTrainingPlanTool,
  },
  {
    name: 'set_pantry',
    description: DESCRIPTIONS.set_pantry,
    inputSchema: {
      type: 'object',
      properties: {
        add: {
          type: 'array',
          description: 'Items to add. Strings, or {item, kind} objects.',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  item: str('The ingredient, in plain words.'),
                  kind: { type: 'string', enum: ['staple', 'fresh'] },
                },
                required: ['item'],
                additionalProperties: false,
              },
            ],
          },
        },
        remove: { type: 'array', items: { type: 'string' }, description: 'Items to drop.' },
        replace_kind: {
          type: 'string',
          enum: ['staple', 'fresh'],
          description: 'Clear this list before adding — use for "here is what is fresh now".',
        },
      },
      additionalProperties: false,
    },
    handler: setPantry,
  },
  {
    name: 'get_pantry',
    description: DESCRIPTIONS.get_pantry,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: getPantryTool,
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
