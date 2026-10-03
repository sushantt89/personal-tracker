import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';
import { baseOptions } from './_common.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    /** false for accounts created with "Continue with Google" that have not chosen a password yet */
    hasPassword: { type: Boolean, default: true },
    /** Google's permanent id for this person, set the first time they sign in with Google */
    googleId: { type: String, index: { unique: true, sparse: true }, select: false },
    currency: { type: String, default: 'AUD', maxlength: 3 },
    timezone: { type: String, default: 'Australia/Adelaide' },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0 }, // bump to invalidate all sessions
  },
  {
    ...baseOptions,
    toJSON: {
      ...baseOptions.toJSON,
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        baseOptions.toJSON.transform(doc, ret);
        delete ret.passwordHash;
        delete ret.googleId;
        if (ret.hasPassword === undefined) ret.hasPassword = true;
        delete ret.resetTokenHash;
        delete ret.resetTokenExpires;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

export type UserT = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserT>;
export const User = model('User', userSchema);
