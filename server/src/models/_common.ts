import { Schema, Types } from 'mongoose';
import { DATE_RE, TIME_RE } from '../utils/dates.js';

/** Shared schema options: timestamps, `id` instead of `_id`, no `__v` in API output. */
export const baseOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
} as const;

export const ownerField = { type: Schema.Types.ObjectId, ref: 'User', required: true as const, index: true };
const dateMatch: [RegExp, string] = [DATE_RE, 'Date must be YYYY-MM-DD'];
export const dateReq = { type: String, required: true as const, match: dateMatch };
export const dateOpt = { type: String, match: dateMatch };
export const timeField = { type: String, match: [TIME_RE, 'Time must be HH:mm'] as [RegExp, string] };
const round = (v: number) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const moneyBase = {
  type: Number,
  min: [0, 'Amount cannot be negative'] as [number, string],
  max: [10_000_000, 'Amount is unrealistically large'] as [number, string],
  set: round,
};
export const moneyReq = { ...moneyBase, required: true as const };
export const moneyOpt = moneyBase;
export const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model, default: null });
export type Id = Types.ObjectId;

export const addressSchema = new Schema(
  {
    line1: String,
    suburb: String,
    state: String,
    postcode: String,
    country: String,
    formatted: String,
    lat: Number,
    lng: Number,
    geoKey: String, // the address text that lat/lng were looked up for
  },
  { _id: false },
);

/** Placeholder for external sync (Google Calendar / Drive). Stored per record to avoid duplicates. */
export const externalSyncSchema = new Schema(
  {
    googleCalendarEventId: String,
    googleDriveFileId: String,
    googleDriveLink: String,
    syncedAt: Date,
    calendarOptOut: { type: Boolean, default: false }, // user chose not to put this record in Google Calendar
    syncError: String,
  },
  { _id: false },
);
