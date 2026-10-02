import { Income } from '../models/index.js';
import { addDays, addMonths } from '../utils/dates.js';
import { audit } from './audit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const HORIZON_DAYS = 35; // keep roughly the next month of expected income visible

function nextDate(from: string, frequency: string, n: number, anchorDay: number): string {
  switch (frequency) {
    case 'weekly': return addDays(from, 7 * n);
    case 'fortnightly': return addDays(from, 14 * n);
    case 'quarterly': return addMonths(from, 3 * n, anchorDay);
    case 'yearly': return addMonths(from, 12 * n, anchorDay);
    default: return addMonths(from, n, anchorDay);
  }
}

/** Dates after `after` (exclusive) up to `through` (inclusive) on which a repeating income falls. */
export function occurrencesAfter(start: string, frequency: string, after: string, through: string, until?: string | null): string[] {
  const out: string[] = [];
  const anchor = Number(start.slice(8, 10));
  for (let n = 1; n < 600; n++) {
    const d = nextDate(start, frequency, n, anchor);
    if (d > through || (until && d > until)) break;
    if (d > after) out.push(d);
  }
  return out;
}

/**
 * Creates the upcoming entries for every repeating income record of a user.
 * New entries are "expected" (never marked paid automatically), linked to the original, and audited.
 * An entry you delete is not created again.
 */
export async function materialiseRecurringIncome(userId: string, today: string): Promise<number> {
  const roots = await Income.find({ userId, 'recurring.enabled': true, recurringParentId: null, status: { $ne: 'cancelled' } });
  const through = addDays(today, HORIZON_DAYS);
  let created = 0;
  for (const root of roots) {
    const freq = root.recurring?.frequency;
    if (!freq) continue;
    const after = root.recurring?.generatedThrough && root.recurring.generatedThrough > root.date ? root.recurring.generatedThrough : root.date;
    const dates = occurrencesAfter(root.date, freq, after, through, root.recurring?.until);
    for (const date of dates) {
      if (await Income.exists({ userId, recurringParentId: root._id, date })) continue;
      const doc = await Income.create({
        userId, date, amount: root.amount, incomeSourceId: root.incomeSourceId, clientId: root.clientId, clientName: root.clientName, description: root.description,
        hoursWorked: root.hoursWorked, paymentMethod: root.paymentMethod, notes: root.notes, status: 'expected', recurringParentId: root._id,
      } as any);
      await audit(userId, 'Income', doc._id, 'create', undefined, doc.toJSON(), `Repeats ${freq} from ${root.date}`);
      created++;
    }
    const newThrough = dates.length ? dates[dates.length - 1] : after;
    if (newThrough !== root.recurring?.generatedThrough) await Income.updateOne({ _id: root._id }, { 'recurring.generatedThrough': newThrough });
  }
  return created;
}
