import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, moneyReq, ref } from './_common.js';

/** Reusable invoice content: who it's for, standard items, notes and terms. */
const templateItemSchema = new Schema(
  {
    description: { type: String, required: true, maxlength: 500 },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    rate: moneyReq,
  },
  { _id: false },
);

const invoiceTemplateSchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    billToType: { type: String, enum: ['client', 'contractor'], default: 'client' },
    clientId: ref('Client'),
    clientName: { type: String, trim: true, maxlength: 120 },
    clientAddress: { type: String, maxlength: 500 },
    clientEmail: { type: String, maxlength: 200 },
    incomeSourceId: ref('IncomeSource'),
    items: { type: [templateItemSchema], default: [] },
    gstRate: { type: Number, min: 0, max: 100 },
    paymentTermsDays: { type: Number, min: 0, max: 365 },
    notes: { type: String, maxlength: 2000 },
    paymentDetails: { type: String, maxlength: 2000 },
  },
  baseOptions,
);
invoiceTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });

export const InvoiceTemplate = model('InvoiceTemplate', invoiceTemplateSchema);
