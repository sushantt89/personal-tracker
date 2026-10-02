import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

/** Record of a Paste & Import, used to prevent importing the same message twice. */
const importBatchSchema = new Schema(
  {
    userId: ownerField,
    messageHash: { type: String, required: true },
    sourceMessage: { type: String, maxlength: 10000 },
    kind: { type: String, enum: ['schedule', 'payment', 'mixed'], default: 'schedule' },
    jobIds: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
    incomeIds: [{ type: Schema.Types.ObjectId, ref: 'Income' }],
  },
  baseOptions,
);
importBatchSchema.index({ userId: 1, messageHash: 1 });

export const ImportBatch = model('ImportBatch', importBatchSchema);
