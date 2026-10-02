import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

/** A user's connected Google account. The refresh token is encrypted at rest and never sent to the browser. */
const googleAccountSchema = new Schema(
  {
    userId: { ...ownerField, unique: true },
    googleEmail: String,
    refreshTokenEnc: { type: String, required: true, select: false },
    scopes: { type: [String], default: [] },
    connectedAt: { type: Date, default: Date.now },
    needsReconnect: { type: Boolean, default: false },
    lastError: String,
    lastCalendarSyncAt: Date,
    lastCalendarPullAt: Date,
    /** Cache of Drive folder ids by path, e.g. "Invoices/2026/October" → id */
    driveFolders: { type: Map, of: String, default: {} },
  },
  baseOptions,
);

export const GoogleAccount = model('GoogleAccount', googleAccountSchema);
