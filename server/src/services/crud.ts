import { Router, type Request } from 'express';
import type { Model } from 'mongoose';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { parseBody } from '../middleware/validate.js';
import { notFound, badRequest } from '../utils/httpError.js';
import { audit } from './audit.js';
import { DATE_RE } from '../utils/dates.js';
import { queueCalendarSync, queueCalendarDelete, type SyncKind } from './google/calendar.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyModel = Model<any>;

export interface CrudHooks {
  /** Mutate/validate data before create. */
  beforeCreate?: (req: Request, data: any) => Promise<void> | void;
  afterCreate?: (req: Request, doc: any) => Promise<void> | void;
  beforeUpdate?: (req: Request, data: any, existing: any) => Promise<void> | void;
  afterUpdate?: (req: Request, doc: any, before: any) => Promise<void> | void;
  beforeDelete?: (req: Request, existing: any) => Promise<void> | void;
  afterDelete?: (req: Request, existing: any) => Promise<void> | void;
}

export interface CrudOptions {
  model: AnyModel;
  entity: string;
  schema: ZodObject<ZodRawShape>;
  /** Referenced ids that must belong to the same user: { categoryId: Category } */
  refs?: Record<string, AnyModel>;
  /** Fields matched by ?q= (case-insensitive) */
  searchFields?: string[];
  /** Query params mapped to exact-match filters, e.g. ['status', 'categoryId'] */
  filterFields?: string[];
  /** Extra list filters that are not a plain field match */
  extraFilter?: (req: Request, filter: Record<string, unknown>) => void;
  /** Field used for ?from=&to= ranges */
  dateField?: string;
  sort?: Record<string, 1 | -1>;
  hooks?: CrudHooks;
  /** Whether to write audit entries (financial records) */
  audited?: boolean;
  /** Keep a Google Calendar event in sync with this record type */
  calendarKind?: SyncKind;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function assertOwnedRefs(userId: string, data: Record<string, unknown>, refs?: Record<string, AnyModel>) {
  if (!refs) return;
  for (const [field, model] of Object.entries(refs)) {
    const v = data[field];
    if (v === undefined || v === null || v === '') continue;
    const exists = await model.exists({ _id: v, userId });
    if (!exists) throw badRequest(`${field} does not reference one of your records`);
  }
}

/** Generic, user-scoped CRUD router with validation, filtering, pagination and audit trail. */
export function crudRouter(opts: CrudOptions) {
  const { model, entity, schema, refs, hooks = {}, audited = true } = opts;
  const r = Router();
  const updateSchema = schema.partial();

  r.get('/', async (req, res) => {
    const userId = req.userId!;
    const filter: Record<string, unknown> = { userId };
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q && opts.searchFields?.length) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = opts.searchFields.map((f) => ({ [f]: re }));
    }
    for (const f of opts.filterFields ?? []) {
      const v = req.query[f];
      if (typeof v === 'string' && v !== '') filter[f] = v.includes(',') ? { $in: v.split(',') } : v === 'null' ? null : v;
    }
    opts.extraFilter?.(req, filter);
    if (opts.dateField) {
      const range: Record<string, string> = {};
      if (typeof req.query.from === 'string' && DATE_RE.test(req.query.from)) range.$gte = req.query.from;
      if (typeof req.query.to === 'string' && DATE_RE.test(req.query.to)) range.$lte = req.query.to;
      if (Object.keys(range).length) filter[opts.dateField] = range;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sort = opts.sort ?? (opts.dateField ? { [opts.dateField]: -1, createdAt: -1 } : { createdAt: -1 });
    const [items, total] = await Promise.all([
      model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
      model.countDocuments(filter),
    ]);
    res.json({ items: items.map((d) => d.toJSON()), total, page, limit });
  });

  r.get('/:id', async (req, res) => {
    const doc = await model.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) throw notFound(`${entity} not found`);
    res.json(doc.toJSON());
  });

  r.post('/', async (req, res) => {
    const data = parseBody(schema, req.body) as Record<string, unknown>;
    await assertOwnedRefs(req.userId!, data, refs);
    await hooks.beforeCreate?.(req, data);
    const doc = await model.create({ ...data, userId: req.userId });
    if (audited) await audit(req.userId!, entity, doc._id, 'create', undefined, doc.toJSON());
    await hooks.afterCreate?.(req, doc);
    if (opts.calendarKind) queueCalendarSync(req.userId!, opts.calendarKind, doc._id);
    res.status(201).json(doc.toJSON());
  });

  r.patch('/:id', async (req, res) => {
    const existing = await model.findOne({ _id: req.params.id, userId: req.userId });
    if (!existing) throw notFound(`${entity} not found`);
    const data = parseBody(updateSchema, req.body) as Record<string, unknown>;
    // Strip keys zod filled with undefined so partial updates do not clear fields
    for (const k of Object.keys(data)) if (data[k] === undefined && !(k in (req.body ?? {}))) delete data[k];
    await assertOwnedRefs(req.userId!, data, refs);
    const before = existing.toJSON();
    await hooks.beforeUpdate?.(req, data, existing);
    existing.set(data);
    await existing.save();
    if (audited) await audit(req.userId!, entity, existing._id, 'update', before, existing.toJSON());
    await hooks.afterUpdate?.(req, existing, before);
    if (opts.calendarKind) queueCalendarSync(req.userId!, opts.calendarKind, existing._id);
    res.json(existing.toJSON());
  });

  r.delete('/:id', async (req, res) => {
    const existing = await model.findOne({ _id: req.params.id, userId: req.userId });
    if (!existing) throw notFound(`${entity} not found`);
    await hooks.beforeDelete?.(req, existing);
    await existing.deleteOne();
    if (audited) await audit(req.userId!, entity, existing._id, 'delete', existing.toJSON());
    await hooks.afterDelete?.(req, existing);
    if (opts.calendarKind) queueCalendarDelete(req.userId!, existing.sync?.googleCalendarEventId);
    res.json({ ok: true });
  });

  return r;
}

export { z };
