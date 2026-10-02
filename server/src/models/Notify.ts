import { Schema, model } from 'mongoose';
import { ownerField } from './_common.js';

/** A browser/phone that agreed to receive notifications. */
const pushSubscriptionSchema = new Schema(
  {
    userId: ownerField,
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    userAgent: String,
  },
  { timestamps: true },
);
export const PushSubscription = model('PushSubscription', pushSubscriptionSchema);

/** What has already been sent, so nothing is sent twice. Entries expire after 120 days. */
const notificationLogSchema = new Schema({
  userId: ownerField,
  channel: { type: String, enum: ['email', 'push'], required: true },
  key: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 120 * 86400 },
});
notificationLogSchema.index({ userId: 1, channel: 1, key: 1 }, { unique: true });
export const NotificationLog = model('NotificationLog', notificationLogSchema);

/** Small server-wide key/value store (e.g. generated web-push keys). */
const appConfigSchema = new Schema({ key: { type: String, unique: true, required: true }, value: Schema.Types.Mixed });
export const AppConfig = model('AppConfig', appConfigSchema);

/** Per-user state of an in-app notification: when it first appeared, and whether it was read or dismissed. Expires after 120 days. */
const alertStateSchema = new Schema({
  userId: ownerField,
  key: { type: String, required: true },
  firstSeenAt: { type: Date, default: Date.now },
  readAt: Date,
  dismissedAt: Date,
  createdAt: { type: Date, default: Date.now, expires: 120 * 86400 },
});
alertStateSchema.index({ userId: 1, key: 1 }, { unique: true });
export const AlertState = model('AlertState', alertStateSchema);
