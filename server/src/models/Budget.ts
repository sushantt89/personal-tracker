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
    categoryBudgets: {
      type: [new Schema({ categoryId: { ...ref('Category'), required: true }, amount: { type: Number, required: true, min: 0 } }, { _id: false })],
      default: [],
    },
  },
  baseOptions,
);

export const Budget = model('Budget', budgetSchema);
