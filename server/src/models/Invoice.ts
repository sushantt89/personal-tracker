import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq, dateOpt, moneyReq, moneyOpt, ref, externalSyncSchema } from './_common.js';

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'] as const;

/** Invoice line items are embedded: they are always read/written with their invoice. */
const itemSchema = new Schema(
  {
    date: dateOpt,
    description: { type: String, required: true, maxlength: 500 },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    rate: moneyReq,
    amount: moneyReq,
    jobId: ref('Job'),
    incomeId: ref('Income'),
  },
  { _id: true },
);

const invoiceSchema = new Schema(
  {
    userId: ownerField,
    number: { type: String, required: true, trim: true, maxlength: 60 },
    issueDate: dateReq,
    dueDate: dateReq,
    incomeSourceId: ref('IncomeSource'),
    clientId: ref('Client'),
    clientName: { type: String, required: true, trim: true, maxlength: 120 },
    billToType: { type: String, enum: ['client', 'contractor'], default: 'client' },
    clientAddress: { type: String, maxlength: 500 },
    clientEmail: { type: String, maxlength: 200 },
    items: { type: [itemSchema], default: [] },
    subtotal: moneyReq,
    gstRate: { type: Number, default: 0, min: 0, max: 100 },
    gstAmount: moneyReq,
    total: moneyReq,
    notes: { type: String, maxlength: 2000 },
    paymentDetails: { type: String, maxlength: 2000 },
    status: { type: String, enum: INVOICE_STATUSES, default: 'draft' },
    paidDate: dateOpt,
    periodFrom: dateOpt,
    periodTo: dateOpt,
    uploadedDocumentId: ref('Document'), // for invoices uploaded rather than generated
    sync: externalSyncSchema,
  },
  baseOptions,
);
invoiceSchema.index({ userId: 1, number: 1 }, { unique: true });
invoiceSchema.index({ userId: 1, issueDate: -1 });

export const Invoice = model('Invoice', invoiceSchema);
