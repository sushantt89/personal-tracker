import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, addressSchema, ref } from './_common.js';

const clientSchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** client = the customer whose place you work at; contractor = a business you work under (and invoice) */
    type: { type: String, enum: ['client', 'contractor'], default: 'client' },
    contactName: { type: String, trim: true, maxlength: 120 },
    abn: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 40 },
    address: addressSchema,
    incomeSourceId: ref('IncomeSource'),
    defaultRate: { type: Number, min: 0 },
    notes: { type: String, maxlength: 2000 },
  },
  baseOptions,
);
clientSchema.index({ userId: 1, name: 1 });
clientSchema.index({ userId: 1, type: 1 });

export const Client = model('Client', clientSchema);
