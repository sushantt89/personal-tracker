import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, addressSchema, dateReq, dateOpt, timeField, moneyReq, moneyOpt, ref, externalSyncSchema } from './_common.js';

export const JOB_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export const WORK_TYPES = ['own', 'subcontract', 'employee'] as const;

const jobSchema = new Schema(
  {
    userId: ownerField,
    title: { type: String, trim: true, maxlength: 200 },
    clientId: ref('Client'),
    clientName: { type: String, trim: true, maxlength: 120 }, // denormalised display name
    incomeSourceId: ref('IncomeSource'),
    /** own = you are the business and invoice the client; subcontract = you work under a contractor and invoice them;
     *  employee = rostered shifts for an employer who pays wages (no invoice; pay is often only known after payday) */
    workType: { type: String, enum: WORK_TYPES, default: 'own' },
    contractorId: ref('Client'),
    contractorName: { type: String, trim: true, maxlength: 120 },
    date: dateReq,
    startTime: timeField,
    endTime: timeField,
    /** total pay for the job, fuel allowance included */
    amount: moneyOpt,
    /** part of `amount` that is a fuel/travel allowance rather than pay for the work (kept apart so hourly rates stay honest) */
    fuelAllowance: moneyOpt,
    /** Pay per hour, when the job is paid by the hour (the form works `amount` out from it) */
    hourlyRate: moneyOpt,
    /** true = `amount` is only what you expect to be paid; the real figure replaces it when pay is recorded */
    amountEstimated: { type: Boolean, default: false },
    /** Left out of the work-hours tracker (e.g. a cash job that isn't part of the hours being watched) */
    excludeFromHours: { type: Boolean, default: false },
    hoursWorked: { type: Number, min: 0, max: 24 },
    address: addressSchema,
    meetingPoint: { type: String, maxlength: 300 },
    description: { type: String, maxlength: 2000 },
    tasks: { type: [String], default: [] },
    rooms: { type: Number, min: 0 },
    bathrooms: { type: Number, min: 0 },
    specialInstructions: { type: String, maxlength: 2000 },
    status: { type: String, enum: JOB_STATUSES, default: 'scheduled' },
    notes: { type: String, maxlength: 2000 },
    invoiceId: ref('Invoice'),
    importBatchId: ref('ImportBatch'),
    sourceMessage: { type: String, maxlength: 10000 },
    distanceKm: { type: Number, min: 0 },
    travelMinutes: { type: Number, min: 0 },
    sync: externalSyncSchema,
  },
  baseOptions,
);
jobSchema.index({ userId: 1, date: 1 });
jobSchema.index({ userId: 1, contractorId: 1, date: 1 });
jobSchema.index({ userId: 1, clientName: 'text', description: 'text', title: 'text' });

export const Job = model('Job', jobSchema);
