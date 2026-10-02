import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../utils/httpError.js';

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw badRequest(
      'Validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const validateBody = (schema: ZodType) => (req: Request, _res: Response, next: NextFunction) => {
  req.body = parseBody(schema, req.body);
  next();
};
