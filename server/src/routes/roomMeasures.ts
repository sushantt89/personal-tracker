import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { RoomMeasure, RoomPhoto } from '../models/index.js';
import { parseBody } from '../middleware/validate.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { heicToJpeg, isHeic } from '../services/ocr/engine.js';
import { env } from '../config/env.js';

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
  await RoomPhoto.deleteMany({ userId: req.userId, roomId });
  res.json({ ok: true });
});

/* Photos of a room or wall: one JPEG (data URL) per photo id. */
r.get('/:roomId/photos/:photoId', async (req, res) => {
  const roomId = parseBody(zRoomId, req.params.roomId), photoId = parseBody(zRoomId, req.params.photoId);
  const p = await RoomPhoto.findOne({ userId: req.userId, roomId, photoId }).lean();
  if (!p) throw notFound('Photo not found');
  res.json({ data: p.data });
});

r.put('/:roomId/photos/:photoId', async (req, res) => {
  const roomId = parseBody(zRoomId, req.params.roomId), photoId = parseBody(zRoomId, req.params.photoId);
  const { data } = parseBody(z.object({ data: z.string().max(600_000).regex(/^data:image\/jpeg;base64,/, 'Photo must be a JPEG') }), req.body);
  await RoomPhoto.updateOne({ userId: req.userId, roomId, photoId }, { $set: { data } }, { upsert: true });
  res.json({ ok: true });
});

/* A photo the phone couldn't open itself (iPhone HEIC, very large photos): convert and shrink it here, keep it, and send the small JPEG back. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(env.MAX_UPLOAD_MB, 40) * 1024 * 1024, files: 1 } });
r.post('/:roomId/photos/:photoId/original', (req, res, next) => upload.single('file')(req, res, (err) => (err ? next(badRequest(err.message)) : next())), async (req, res) => {
  const roomId = parseBody(zRoomId, req.params.roomId), photoId = parseBody(zRoomId, req.params.photoId);
  const f = req.file;
  if (!f || !f.buffer?.length) throw badRequest('No photo received');
  const heicBox = f.buffer.subarray(4, 12).toString('latin1'); // 'ftypheic', 'ftypmif1'…
  let buf: Buffer = f.buffer;
  if (isHeic(f.mimetype, f.originalname) || /^ftyp(hei|hev|mif|msf)/.test(heicBox)) buf = await heicToJpeg(buf);
  const sharp = (await import('sharp')).default;
  let out;
  try {
    out = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer({ resolveWithObject: true });
  } catch {
    throw badRequest('That file could not be opened as a photo');
  }
  const data = `data:image/jpeg;base64,${out.data.toString('base64')}`;
  await RoomPhoto.updateOne({ userId: req.userId, roomId, photoId }, { $set: { data } }, { upsert: true });
  res.json({ data, w: out.info.width, h: out.info.height });
});

r.delete('/:roomId/photos/:photoId', async (req, res) => {
  const roomId = parseBody(zRoomId, req.params.roomId), photoId = parseBody(zRoomId, req.params.photoId);
  await RoomPhoto.deleteOne({ userId: req.userId, roomId, photoId });
  res.json({ ok: true });
});

export default r;
