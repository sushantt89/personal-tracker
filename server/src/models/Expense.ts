import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq, dateOpt, moneyReq, moneyOpt, ref } from './_common.js';

const expenseSchema = new Schema(
  {
    userId: ownerField,
    date: dateReq,
    amount: moneyReq,
    categoryId: ref('Category'),
    description: { type: String, maxlength: 500 },
    merchant: { type: String, trim: true, maxlength: 120 },
    paymentMethod: { type: String, maxlength: 60 },
    isRecurring: { type: Boolean, default: false },
    billId: ref('RecurringBill'),
    billOccurrence: dateOpt, // which due date of the bill this payment covers
    receiptId: ref('Document'),
    gst: { type: Number, min: 0 },
    notes: { type: String, maxlength: 2000 },
  },
  baseOptions,
);
expenseSchema.index({ userId: 1, date: 1 });
expenseSchema.index({ userId: 1, billId: 1, billOccurrence: 1 });

export const Expense = model('Expense', expenseSchema);
