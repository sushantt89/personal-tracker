import { z } from 'zod';
import { Types } from 'mongoose';
import { DATE_RE, TIME_RE } from './dates.js';

export const zDate = z.string().regex(DATE_RE, 'Date must be YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');
export const zTime = z.string().regex(TIME_RE, 'Time must be HH:mm (24h)');
export const zOptTime = z.union([zTime, z.literal(''), z.null()]).optional().transform((v) => (v ? v : undefined));
export const zOptDate = z.union([zDate, z.literal(''), z.null()]).optional().transform((v) => (v ? v : undefined));
export const zMoney = z.coerce.number().min(0, 'Amount cannot be negative').max(10_000_000, 'Amount is too large').transform((n) => Math.round(n * 100) / 100);
export const zOptMoney = z.union([zMoney, z.null(), z.literal('')]).optional().transform((v) => (v === '' || v === null ? undefined : v));
export const zId = z.string().refine((s) => Types.ObjectId.isValid(s), 'Invalid id');
export const zOptId = z.union([zId, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
export const zStr = (max = 500) => z.string().trim().max(max);
export const zOptStr = (max = 500) => z.string().trim().max(max).optional();

export const zAddress = z
  .object({
    line1: zOptStr(200),
    suburb: zOptStr(100),
    state: zOptStr(10),
    postcode: zOptStr(10),
    country: zOptStr(60),
    formatted: zOptStr(300),
  })
  .partial()
  .optional();
