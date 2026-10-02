import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq, dateOpt, timeField, externalSyncSchema } from './_common.js';

export const TASK_CATEGORIES = ['appointment', 'personal', 'study', 'reminder', 'event', 'work', 'other'] as const;
export const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'cancelled'] as const;

const taskSchema = new Schema(
  {
    userId: ownerField,
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 2000 },
    date: dateReq,
    startTime: timeField,
    endTime: timeField,
    location: { type: String, maxlength: 300 },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'not_started' },
    category: { type: String, enum: TASK_CATEGORIES, default: 'personal' },
    notes: { type: String, maxlength: 2000 },
    recurrence: {
      frequency: { type: String, enum: ['none', 'daily', 'weekly', 'fortnightly', 'monthly'], default: 'none' },
      until: dateOpt,
    },
    /** Completed/cancelled dates for individual occurrences of a recurring task. */
    occurrenceStatus: { type: Map, of: String, default: {} },
    sync: externalSyncSchema,
  },
  baseOptions,
);
taskSchema.index({ userId: 1, date: 1 });

export const Task = model('Task', taskSchema);
