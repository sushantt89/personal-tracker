import { z } from 'zod';
import { zDate, zOptDate, zOptTime, zMoney, zOptMoney, zOptId, zStr, zOptStr, zAddress } from '../utils/zod.js';
import { JOB_STATUSES, WORK_TYPES, INCOME_STATUSES, FREQUENCIES, TASK_CATEGORIES, TASK_STATUSES, DOCUMENT_KINDS } from '../models/index.js';

export const categorySchema = z.object({
  name: zStr(60).min(1, 'Name is required'),
  color: zOptStr(20),
  icon: zOptStr(40),
  archived: z.boolean().optional(),
});

export const incomeSourceSchema = z.object({
  name: zStr(60).min(1, 'Name is required'),
  color: zOptStr(20),
  defaultHourlyRate: zOptMoney,
  isJobBased: z.boolean().optional(),
  workType: z.enum(WORK_TYPES).optional(),
  contractorId: zOptId,
  archived: z.boolean().optional(),
});

export const clientSchema = z.object({
  name: zStr(120).min(1, 'Name is required'),
  type: z.enum(['client', 'contractor']).optional(),
  contactName: zOptStr(120),
  abn: zOptStr(30),
  email: z.union([z.string().trim().email('Invalid email'), z.literal('')]).optional(),
  phone: zOptStr(40),
  address: zAddress,
  incomeSourceId: zOptId,
  defaultRate: zOptMoney,
  notes: zOptStr(2000),
});

export const jobSchema = z.object({
  title: zOptStr(200),
  clientId: zOptId,
  clientName: zOptStr(120),
  incomeSourceId: zOptId,
  workType: z.enum(WORK_TYPES).optional(),
  contractorId: zOptId,
  contractorName: zOptStr(120),
  date: zDate,
  startTime: zOptTime,
  endTime: zOptTime,
  amount: zOptMoney,
  amountEstimated: z.boolean().optional(),
  excludeFromHours: z.boolean().optional(),
  hoursWorked: z.coerce.number().min(0).max(24).optional().nullable(),
  address: zAddress,
  meetingPoint: zOptStr(300),
  description: zOptStr(2000),
  tasks: z.array(zStr(300)).max(50).optional(),
  rooms: z.coerce.number().int().min(0).max(100).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).max(100).optional().nullable(),
  specialInstructions: zOptStr(2000),
  status: z.enum(JOB_STATUSES).optional(),
  notes: zOptStr(2000),
  distanceKm: z.coerce.number().min(0).optional().nullable(),
  travelMinutes: z.coerce.number().min(0).optional().nullable(),
});

export const incomeSchema = z.object({
  date: zDate,
  incomeSourceId: zOptId,
  clientId: zOptId,
  clientName: zOptStr(120),
  description: zOptStr(500),
  amount: zMoney,
  hoursWorked: z.coerce.number().min(0).max(744).optional().nullable(),
  status: z.enum(INCOME_STATUSES).optional(),
  paymentMethod: zOptStr(60),
  paidDate: zOptDate,
  invoiceNumber: zOptStr(60),
  jobId: zOptId,
  recurring: z.object({ enabled: z.boolean(), frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']).optional().nullable(), until: zOptDate }).optional(),
  notes: zOptStr(2000),
});

export const expenseSchema = z.object({
  date: zDate,
  amount: zMoney,
  categoryId: zOptId,
  description: zOptStr(500),
  merchant: zOptStr(120),
  paymentMethod: zOptStr(60),
  isRecurring: z.boolean().optional(),
  billId: zOptId,
  billOccurrence: zOptDate,
  receiptId: zOptId,
  contractorId: zOptId,
  gst: zOptMoney,
  notes: zOptStr(2000),
});

export const billSchema = z
  .object({
    name: zStr(120).min(1, 'Name is required'),
    amount: zMoney,
    frequency: z.enum(FREQUENCIES),
    customIntervalDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
    dueDate: zDate,
    startDate: zOptDate,
    endDate: zOptDate,
    categoryId: zOptId,
    paymentMethod: zOptStr(60),
    autoRenew: z.boolean().optional(),
    autoPay: z.boolean().optional(),
    reminderDays: z.coerce.number().int().min(0).max(60).optional(),
    active: z.boolean().optional(),
    notes: zOptStr(2000),
  });

export const taskSchema = z.object({
  title: zStr(200).min(1, 'Title is required'),
  description: zOptStr(2000),
  date: zDate,
  startTime: zOptTime,
  endTime: zOptTime,
  location: zOptStr(300),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  notes: zOptStr(2000),
  recurrence: z.object({ frequency: z.enum(['none', 'daily', 'weekly', 'fortnightly', 'monthly']), until: zOptDate }).optional(),
  /** true = put this in Google Calendar even if its category isn't in "what to sync"; false = keep it out */
  addToGoogle: z.boolean().optional(),
});

export const invoiceItemSchema = z.object({
  date: zOptDate,
  description: zStr(500).min(1, 'Item description is required'),
  quantity: z.coerce.number().min(0).max(100000).default(1),
  rate: zMoney,
  jobId: zOptId,
  incomeId: zOptId,
});

export const invoiceSchema = z.object({
  number: zOptStr(60),
  issueDate: zDate,
  dueDate: zOptDate,
  incomeSourceId: zOptId,
  clientId: zOptId,
  clientName: zStr(120).min(1, 'Client is required'),
  billToType: z.enum(['client', 'contractor']).optional(),
  clientAddress: zOptStr(500),
  clientEmail: zOptStr(200),
  items: z.array(invoiceItemSchema).min(1, 'Add at least one item').max(500),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  notes: zOptStr(2000),
  paymentDetails: zOptStr(2000),
  status: z.enum(['draft', 'sent', 'paid', 'cancelled']).optional(),
  paidDate: zOptDate,
  periodFrom: zOptDate,
  periodTo: zOptDate,
});

export const documentMetaSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS).optional(),
  title: zOptStr(200),
  date: zOptDate,
  amount: zOptMoney,
  merchant: zOptStr(120),
  categoryId: zOptId,
  gst: zOptMoney,
  expenseId: zOptId,
  invoiceId: zOptId,
  notes: zOptStr(2000),
});

export const invoiceTemplateSchema = z.object({
  name: zStr(120).min(1, 'Template name is required'),
  billToType: z.enum(['client', 'contractor']).optional(),
  clientId: zOptId,
  clientName: zOptStr(120),
  clientAddress: zOptStr(500),
  clientEmail: zOptStr(200),
  incomeSourceId: zOptId,
  items: z.array(z.object({ description: zStr(500).min(1), quantity: z.coerce.number().min(0).max(100000).default(1), rate: zMoney })).max(100).optional(),
  gstRate: z.coerce.number().min(0).max(100).optional().nullable(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  notes: zOptStr(2000),
  paymentDetails: zOptStr(2000),
});
