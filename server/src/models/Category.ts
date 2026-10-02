import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

/** Expense categories (customisable). */
const categorySchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 60 },
    color: { type: String, default: '#6366f1' },
    icon: String,
    archived: { type: Boolean, default: false },
  },
  baseOptions,
);
categorySchema.index({ userId: 1, name: 1 }, { unique: true });

export const Category = model('Category', categorySchema);
