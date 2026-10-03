import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, ref } from './_common.js';

/** One budget plan per user (monthly figures). */
const budgetSchema = new Schema(
  {
    userId: { ...ownerField, unique: true },
    monthlyIncomeTarget: { type: Number, default: 0, min: 0 },
    monthlySpendingLimit: { type: Number, default: 0, min: 0 },
    expectedVariableExpenses: { type: Number, default: 0, min: 0 },
    monthlySavingsTarget: { type: Number, default: 0, min: 0 },
    emergencyFundTarget: { type: Number, default: 0, min: 0 },
    currentSavings: { type: Number, default: 0, min: 0 },
    currentEmergencyFund: { type: Number, default: 0, min: 0 },
    /** Money available to spend right now (bank balance), as last entered by the user. The Assistant rolls it forward from `asOf` using the income and expenses recorded since. */
    balance: { amount: { type: Number, min: -100_000_000, max: 100_000_000 }, asOf: { type: String } },
    categoryBudgets: {
      type: [new Schema({ categoryId: { ...ref('Category'), required: true }, amount: { type: Number, required: true, min: 0 } }, { _id: false })],
      default: [],
    },
  },
  baseOptions,
);

export const Budget = model('Budget', budgetSchema);
