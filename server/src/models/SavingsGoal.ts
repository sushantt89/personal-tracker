import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

/** Something to save up for by a date (a fee, a bond, a trip). Money put aside is recorded as contributions. */
const savingsGoalSchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    target: { type: Number, required: true, min: 0.01 },
    /** YYYY-MM-DD the money is needed by */
    dueDate: { type: String, required: true },
    /** YYYY-MM-DD the plan started (the day the goal was created) */
    startDate: { type: String, required: true },
    /** What was already put aside when the goal was created */
    startingSaved: { type: Number, default: 0, min: 0 },
    contributions: {
      type: [new Schema({ date: { type: String, required: true }, amount: { type: Number, required: true }, note: { type: String, maxlength: 200 } })],
      default: [],
    },
    archived: { type: Boolean, default: false },
  },
  baseOptions,
);
savingsGoalSchema.index({ userId: 1, archived: 1 });

export const SavingsGoal = model('SavingsGoal', savingsGoalSchema);
