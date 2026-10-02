import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq, dateOpt, moneyReq, moneyOpt, ref } from './_common.js';

export const INCOME_STATUSES = ['expected', 'pending', 'paid', 'cancelled'] as const;

const incomeSchema = new Schema(
  {
    userId: ownerField,
    date: dateReq,
    incomeSourceId: ref('IncomeSource'),
    clientId: ref('Client'),
    clientName: { type: String, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 500 },
    amount: moneyReq,
    hoursWorked: { type: Number, min: 0, max: 744 },
    status: { type: String, enum: INCOME_STATUSES, default: 'expected' },
    paymentMethod: { type: String, maxlength: 60 },
    paidDate: dateOpt,
    invoiceId: ref('Invoice'),
    invoiceNumber: { type: String, maxlength: 60 },
    jobId: ref('Job'),
    recurring: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] },
      until: dateOpt,
      /** Entries have been created for every occurrence up to this date (deleted ones are not re-created). */
      generatedThrough: dateOpt,
    },
    /** Set on entries the app created from a repeating income record. */
    recurringParentId: ref('Income'),
    notes: { type: String, maxlength: 2000 },
  },
  baseOptions,
);
incomeSchema.index({ userId: 1, date: 1 });
incomeSchema.index({ userId: 1, jobId: 1 });
incomeSchema.index({ recurringParentId: 1, date: 1 });

export const Income = model('Income', incomeSchema);
