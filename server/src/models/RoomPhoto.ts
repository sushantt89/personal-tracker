import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

/** A photo taken in the Room Measure tool (of a room or one wall). Kept apart from the room so the room stays small. */
const roomPhotoSchema = new Schema(
  {
    userId: ownerField,
    roomId: { type: String, required: true, maxlength: 80 },
    photoId: { type: String, required: true, maxlength: 80 },
    data: { type: String, required: true }, // JPEG data URL, already shrunk by the tool
  },
  baseOptions,
);
roomPhotoSchema.index({ userId: 1, roomId: 1, photoId: 1 }, { unique: true });

export const RoomPhoto = model('RoomPhoto', roomPhotoSchema);
