import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, ref } from './_common.js';

/** Something the user is thinking of buying. The Assistant re-checks whether it is affordable every time the list is opened. */
const wishItemSchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, maxlength: 500 },
    status: { type: String, enum: ['wanted', 'bought'], default: 'wanted' },
    boughtDate: String,
    expenseId: ref('Expense'),
  },
  baseOptions,
);
wishItemSchema.index({ userId: 1, status: 1 });

export const WishItem = model('WishItem', wishItemSchema);
