import type { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { User } from '../models/index.js';
import { unauthorized } from '../utils/httpError.js';

export const COOKIE_NAME = 'pt_token';

interface TokenPayload {
  sub: string;
  v: number;
}

export function signToken(userId: string, tokenVersion: number) {
  return jwt.sign({ sub: userId, v: tokenVersion } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: `${env.JWT_EXPIRES_DAYS}d`,
  });
}

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: env.JWT_EXPIRES_DAYS * 86400 * 1000,
    path: '/',
  };
}

/** Requires a valid session (httpOnly cookie, or `Authorization: Bearer` for API clients). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE_NAME] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as unknown as TokenPayload;
    const user = await User.findById(payload.sub).select('tokenVersion').lean();
    if (!user || (user.tokenVersion ?? 0) !== payload.v) return next(unauthorized('Session expired'));
    req.userId = payload.sub;
    next();
  } catch {
    next(unauthorized('Session expired'));
  }
}
