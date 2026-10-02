import { Category, IncomeSource, Settings, Budget } from '../models/index.js';

export const DEFAULT_CATEGORIES: [string, string][] = [
  ['Rent', '#6366f1'], ['Groceries', '#22c55e'], ['Fuel', '#f97316'], ['Car', '#64748b'], ['Insurance', '#0ea5e9'],
  ['Phone', '#a855f7'], ['Internet', '#14b8a6'], ['Utilities', '#eab308'], ['Subscriptions', '#ec4899'], ['Food', '#ef4444'],
  ['Entertainment', '#8b5cf6'], ['Education', '#3b82f6'], ['Shopping', '#f43f5e'], ['Transport', '#06b6d4'], ['Other', '#94a3b8'],
];

export const DEFAULT_SOURCES: { name: string; color: string; isJobBased?: boolean }[] = [
  { name: 'Cleaning', color: '#10b981', isJobBased: true },
  { name: "McDonald's", color: '#f59e0b' },
  { name: 'Freelance', color: '#6366f1' },
  { name: 'Salary', color: '#0ea5e9' },
  { name: 'Business', color: '#8b5cf6' },
  { name: 'Other', color: '#94a3b8' },
];

/** Creates default settings, categories, income sources and an empty budget for a new user. Idempotent. */
export async function ensureUserDefaults(userId: string) {
  await Settings.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });
  await Budget.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });
  if (!(await Category.exists({ userId }))) {
    await Category.insertMany(DEFAULT_CATEGORIES.map(([name, color]) => ({ userId, name, color })));
  }
  if (!(await IncomeSource.exists({ userId }))) {
    await IncomeSource.insertMany(DEFAULT_SOURCES.map((s) => ({ userId, ...s })));
  }
}
