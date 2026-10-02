import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq, dateOpt, moneyReq, moneyOpt, ref, externalSyncSchema } from './_common.js';

export const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'custom'] as const;

const billSchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    amount: moneyReq,
    frequency: { type: String, enum: FREQUENCIES, required: true, default: 'monthly' },
    customIntervalDays: { type: Number, min: 1, max: 3650 },
    /** First due date; subsequent due dates are derived from frequency. */
    dueDate: dateReq,
    startDate: dateOpt,
    endDate: dateOpt,
    categoryId: ref('Category'),
    paymentMethod: { type: String, maxlength: 60 },
    autoRenew: { type: Boolean, default: true },
    autoPay: { type: Boolean, default: false },
    reminderDays: { type: Number, default: 3, min: 0, max: 60 },
    active: { type: Boolean, default: true },
    notes: { type: String, maxlength: 2000 },
    sync: externalSyncSchema,
  },
  baseOptions,
);

export const RecurringBill = model('RecurringBill', billSchema);
