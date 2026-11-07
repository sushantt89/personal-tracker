import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

/** One room measured with the Room Measure tool (walls, doors, windows, fixtures). The whole room is kept as one document. */
const roomMeasureSchema = new Schema(
  {
    userId: ownerField,
    roomId: { type: String, required: true, maxlength: 80 },
    data: { type: Schema.Types.Mixed, required: true },
    clientUpdated: Number,
  },
  { ...baseOptions, minimize: false },
);
roomMeasureSchema.index({ userId: 1, roomId: 1 }, { unique: true });

export const RoomMeasure = model('RoomMeasure', roomMeasureSchema);
