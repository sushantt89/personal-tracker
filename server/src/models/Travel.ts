import { Schema, model } from 'mongoose';
import { baseOptions, ownerField, dateReq } from './_common.js';

/** Cached address → coordinates lookups (per user), so each address is looked up once. */
const geocodeCacheSchema = new Schema(
  {
    userId: ownerField,
    key: { type: String, required: true },
    lat: Number,
    lng: Number,
    displayName: String,
    notFound: { type: Boolean, default: false },
  },
  { timestamps: true },
);
geocodeCacheSchema.index({ userId: 1, key: 1 }, { unique: true });
export const GeocodeCache = model('GeocodeCache', geocodeCacheSchema);

const stopSchema = new Schema({ label: String, kind: { type: String, enum: ['home', 'job'] }, jobId: Schema.Types.ObjectId, address: String, lat: Number, lng: Number }, { _id: false });
const legSchema = new Schema({ from: String, to: String, toJobId: Schema.Types.ObjectId, km: Number, minutes: Number }, { _id: false });

/** The driving route for one work day: home → jobs (in time order) → home. */
const travelDaySchema = new Schema(
  {
    userId: ownerField,
    date: dateReq,
    signature: String,
    stops: { type: [stopSchema], default: [] },
    legs: { type: [legSchema], default: [] },
    totalKm: { type: Number, default: 0 },
    totalMinutes: { type: Number, default: 0 },
    missing: { type: [new Schema({ jobId: Schema.Types.ObjectId, label: String, address: String, reason: String }, { _id: false })], default: [] },
    error: String,
    computedAt: Date,
  },
  baseOptions,
);
travelDaySchema.index({ userId: 1, date: 1 }, { unique: true });
export const TravelDay = model('TravelDay', travelDaySchema);
