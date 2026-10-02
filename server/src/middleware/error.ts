import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../utils/httpError.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: `Invalid value for ${err.path}` });
  }
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: 'A record with these details already exists', details: (err as { keyValue?: unknown }).keyValue });
  }
  if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large' });
  }
  console.error(err);
  res.status(500).json({ error: isProd ? 'Something went wrong' : String((err as Error)?.message ?? err) });
}
