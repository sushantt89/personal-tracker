import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

const incomeSourceSchema = new Schema(
  {
    userId: ownerField,
    name: { type: String, required: true, trim: true, maxlength: 60 },
    color: { type: String, default: '#10b981' },
    defaultHourlyRate: { type: Number, min: 0 },
    isJobBased: { type: Boolean, default: false }, // e.g. Cleaning: income comes from jobs
    /** Default arrangement for jobs from this source: own business, or working under a contractor */
    workType: { type: String, enum: ['own', 'subcontract'], default: 'own' },
    contractorId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    archived: { type: Boolean, default: false },
  },
  baseOptions,
);
incomeSourceSchema.index({ userId: 1, name: 1 }, { unique: true });

export const IncomeSource = model('IncomeSource', incomeSourceSchema);
