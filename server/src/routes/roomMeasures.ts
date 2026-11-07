import { Router } from 'express';
import { z } from 'zod';
import { RoomMeasure } from '../models/index.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest } from '../utils/httpError.js';

/** Storage for the Room Measure tool (client/public/room-measure). Each room is saved whole, keyed by the tool's own room id. */
const r = Router();
const zRoomId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, 'Invalid room id');

r.get('/', async (req, res) => {
  const docs = await RoomMeasure.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
  res.json({ items: docs.map((d) => d.data) });
});

r.put('/:roomId', async (req, res) => {
  const roomId = parseBody(zRoomId, req.params.roomId);
  const { data } = parseBody(z.object({ data: z.record(z.string(), z.unknown()) }), req.body);
  if (data.id !== roomId) throw badRequest('Room id does not match');
  if (!Array.isArray(data.walls)) throw badRequest('Room has no walls');
  await RoomMeasure.updateOne(
    { userId: req.userId, roomId },
    { $set: { data, clientUpdated: typeof data.updated === 'number' ? data.updated : Date.now() } },
    { upsert: true },
  );
  res.json({ ok: true });
});

r.delete('/:roomId', async (req, res) => {
  const roomId = parseBody(zRoomId, req.params.roomId);
  await RoomMeasure.deleteOne({ userId: req.userId, roomId });
  res.json({ ok: true });
});

export default r;
