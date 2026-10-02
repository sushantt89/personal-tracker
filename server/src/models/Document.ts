import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq, dateOpt, ref, externalSyncSchema } from './_common.js';

export const DOCUMENT_KINDS = ['receipt', 'invoice', 'financial', 'other'] as const;

/** Uploaded file (receipt, invoice, statement…). Storage provider is abstracted. */
const documentSchema = new Schema(
  {
    userId: ownerField,
    kind: { type: String, enum: DOCUMENT_KINDS, default: 'other' },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    originalName: String,
    mimeType: String,
    size: Number,
    storage: { type: String, enum: ['local', 'google_drive'], default: 'local' },
    storageKey: { type: String, required: true, select: false },
    sha256: { type: String, index: true },
    // Receipt metadata
    date: dateOpt,
    amount: { type: Number, min: 0 },
    merchant: { type: String, maxlength: 120 },
    categoryId: ref('Category'),
    gst: { type: Number, min: 0 },
    expenseId: ref('Expense'),
    invoiceId: ref('Invoice'),
    notes: { type: String, maxlength: 2000 },
    sync: externalSyncSchema,
  },
  baseOptions,
);

export const DocumentModel = model('Document', documentSchema);
