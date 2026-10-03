import type { FieldDef } from '../components/EntityForm';
import { localToday } from './format';

const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }));

export const expenseFields: FieldDef[] = [
  { name: 'amount', label: 'Amount', type: 'money', required: true, quick: true, autoFocus: true, span: 6 },
  { name: 'date', label: 'Date', type: 'date', required: true, quick: true, span: 6 },
  { name: 'categoryId', label: 'Category', type: 'category', quick: true },
  { name: 'paymentMethod', label: 'Payment method', type: 'paymentMethod', quick: true },
  { name: 'merchant', label: 'Merchant', type: 'text', quick: true },
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'isRecurring', label: 'Recurring expense', type: 'switch' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const expenseDefaults = () => ({ date: localToday(), amount: '', paymentMethod: 'Card', isRecurring: false });

export const incomeFields: FieldDef[] = [
  { name: 'amount', label: 'Amount', type: 'money', required: true, quick: true, autoFocus: true },
  { name: 'date', label: 'Date', type: 'date', required: true, quick: true },
  { name: 'incomeSourceId', label: 'Income source', type: 'source', quick: true },
  { name: 'clientId', label: 'Client / customer', type: 'client', quick: true },
  { name: 'status', label: 'Status', type: 'select', options: opts(['expected', 'pending', 'paid', 'cancelled']), quick: true },
  { name: 'paymentMethod', label: 'Payment method', type: 'paymentMethod' },
  { name: 'description', label: 'Description', type: 'text' },
  { name: 'hoursWorked', label: 'Hours worked', type: 'number' },
  { name: 'paidDate', label: 'Paid date', type: 'date', showIf: (v) => v.status === 'paid' },
  { name: 'invoiceNumber', label: 'Invoice number', type: 'text' },
  { name: 'recurring.enabled', label: 'Repeats (next entries are created for you)', type: 'switch', showIf: (v) => !v.recurringParentId },
  { name: 'recurring.frequency', label: 'Frequency', type: 'select', options: opts(['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']), showIf: (v) => !!v.recurring?.enabled && !v.recurringParentId, helper: 'Upcoming entries are added as “expected” about a month ahead' },
  { name: 'recurring.until', label: 'Repeat until (optional)', type: 'date', showIf: (v) => !!v.recurring?.enabled && !v.recurringParentId },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const incomeDefaults = () => ({ date: localToday(), amount: '', status: 'paid', paymentMethod: 'Bank transfer', recurring: { enabled: false } });

export const workTypeOptions = [
  { value: 'own', label: 'My own business (I invoice the client)' },
  { value: 'subcontract', label: 'Working under a contractor (I invoice the contractor)' },
  { value: 'employee', label: 'Employee (shifts for an employer, paid as wages)' },
];

export const jobFields: FieldDef[] = [
  { name: 'clientId', label: 'Client or employer', type: 'client', clientType: 'client', required: false, quick: true, autoFocus: true },
  { name: 'incomeSourceId', label: 'Income source', type: 'source', quick: true },
  { name: 'workType', label: 'Working as', type: 'select', options: workTypeOptions, quick: true, helper: 'Leave as-is to use the income source default' },
  { name: 'contractorId', label: 'Contractor (who pays you)', type: 'client', clientType: 'contractor', quick: true, showIf: (v) => v.workType === 'subcontract', helper: 'Pick one or type a new name' },
  { name: 'date', label: 'Date', type: 'date', required: true, quick: true, span: 4 },
  { name: 'startTime', label: 'Start', type: 'time', quick: true, span: 4 },
  { name: 'endTime', label: 'End', type: 'time', span: 4 },
  { name: 'amount', label: 'Amount', type: 'money', quick: true, span: 4, helper: 'Leave empty if you don’t know the pay yet' },
  { name: 'amountEstimated', label: 'This amount is an estimate (actual pay not known yet)', type: 'switch', showIf: (v) => Number(v.amount) > 0 },
  { name: 'hoursWorked', label: 'Hours worked', type: 'number', span: 4 },
  { name: 'status', label: 'Status', type: 'select', options: opts(['scheduled', 'in_progress', 'completed', 'cancelled']), span: 4 },
  { name: 'h-addr', label: 'Address', type: 'heading' },
  { name: 'address.line1', label: 'Street address', type: 'text', quick: true, span: 12 },
  { name: 'address.suburb', label: 'Suburb', type: 'text', span: 5 },
  { name: 'address.state', label: 'State', type: 'text', span: 3 },
  { name: 'address.postcode', label: 'Postcode', type: 'text', span: 4 },
  { name: 'meetingPoint', label: 'Meeting / starting point', type: 'text', span: 12 },
  { name: 'h-details', label: 'Details', type: 'heading' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'tasks', label: 'Tasks', type: 'tags' },
  { name: 'rooms', label: 'Rooms', type: 'number', span: 6 },
  { name: 'bathrooms', label: 'Bathrooms', type: 'number', span: 6 },
  { name: 'specialInstructions', label: 'Special instructions', type: 'textarea' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const jobDefaults = () => ({ date: localToday(), status: 'scheduled', tasks: [], address: {} });

export const taskFields: FieldDef[] = [
  { name: 'title', label: 'Title', type: 'text', required: true, quick: true, autoFocus: true, span: 12 },
  { name: 'date', label: 'Date', type: 'date', required: true, quick: true, span: 4 },
  { name: 'startTime', label: 'Start', type: 'time', quick: true, span: 4 },
  { name: 'endTime', label: 'End', type: 'time', quick: true, span: 4 },
  { name: 'category', label: 'Category', type: 'select', options: opts(['appointment', 'personal', 'study', 'reminder', 'event', 'work', 'other']), quick: true, span: 4 },
  { name: 'priority', label: 'Priority', type: 'select', options: opts(['low', 'medium', 'high']), quick: true, span: 4 },
  { name: 'status', label: 'Status', type: 'select', options: opts(['not_started', 'in_progress', 'completed', 'cancelled']), span: 4 },
  { name: 'location', label: 'Location', type: 'text', span: 12 },
  { name: 'recurrence.frequency', label: 'Repeats', type: 'select', options: opts(['none', 'daily', 'weekly', 'fortnightly', 'monthly']) },
  { name: 'recurrence.until', label: 'Repeat until', type: 'date', showIf: (v) => v.recurrence?.frequency && v.recurrence.frequency !== 'none' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
/** Extra switch for the task/event form, added only when a Google account is connected. */
export const addToGoogleField: FieldDef = { name: 'addToGoogle', label: 'Add to Google Calendar', type: 'switch' };
/** Whether a saved task is (or would be) in Google Calendar, for pre-setting that switch. */
export const taskInGoogle = (t: { category?: string; sync?: { calendarInclude?: boolean; calendarOptOut?: boolean; googleCalendarEventId?: string } }, syncTypes: string[] = [], syncOn = false) =>
  !t.sync?.calendarOptOut && (!!t.sync?.calendarInclude || !!t.sync?.googleCalendarEventId || (syncOn && syncTypes.includes(t.category === 'appointment' ? 'appointment' : t.category === 'event' ? 'event' : 'task')));

export const taskDefaults = (date = localToday()) => ({ date, category: 'personal', priority: 'medium', status: 'not_started', recurrence: { frequency: 'none' } });

export const billFields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, quick: true, autoFocus: true },
  { name: 'amount', label: 'Amount', type: 'money', required: true, quick: true },
  { name: 'frequency', label: 'Frequency', type: 'select', options: opts(['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'custom']), required: true, quick: true },
  { name: 'customIntervalDays', label: 'Every N days', type: 'number', showIf: (v) => v.frequency === 'custom', min: 1 },
  { name: 'dueDate', label: 'Next / first due date', type: 'date', required: true, quick: true },
  { name: 'categoryId', label: 'Category', type: 'category', quick: true },
  { name: 'paymentMethod', label: 'Payment method', type: 'paymentMethod' },
  { name: 'reminderDays', label: 'Remind me (days before)', type: 'number' },
  { name: 'startDate', label: 'Start date', type: 'date' },
  { name: 'endDate', label: 'End date', type: 'date' },
  { name: 'autoRenew', label: 'Auto-renews', type: 'switch' },
  { name: 'autoPay', label: 'Paid automatically (direct debit)', type: 'switch' },
  { name: 'active', label: 'Active', type: 'switch' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const billDefaults = () => ({ frequency: 'monthly', dueDate: localToday(), reminderDays: 3, autoRenew: true, autoPay: false, active: true });

export const clientFields: FieldDef[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, autoFocus: true },
  { name: 'type', label: 'Type', type: 'select', options: [{ value: 'client', label: 'Client (customer)' }, { value: 'contractor', label: 'Contractor (business I work under)' }] },
  { name: 'contactName', label: 'Contact person', type: 'text', showIf: (v) => v.type === 'contractor' },
  { name: 'abn', label: 'ABN', type: 'text', showIf: (v) => v.type === 'contractor' },
  { name: 'incomeSourceId', label: 'Income source', type: 'source' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'text' },
  { name: 'address.line1', label: 'Street address', type: 'text', span: 12 },
  { name: 'address.suburb', label: 'Suburb', type: 'text', span: 5 },
  { name: 'address.state', label: 'State', type: 'text', span: 3 },
  { name: 'address.postcode', label: 'Postcode', type: 'text', span: 4 },
  { name: 'defaultRate', label: 'Default rate', type: 'money' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
export const clientDefaults = () => ({ type: 'client', address: {} });

/** Rebuild formatted address so it stays in sync with edited parts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withFormattedAddress(v: any) {
  if (!v.address) return v;
  const a = v.address;
  const locality = [a.suburb, a.state, a.postcode].filter(Boolean).join(' ');
  return { ...v, address: { ...a, formatted: [a.line1, locality].filter(Boolean).join(', ') } };
}
