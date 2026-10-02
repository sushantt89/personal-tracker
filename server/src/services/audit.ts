import { AuditLog } from '../models/index.js';

type Action = 'create' | 'update' | 'delete';

function strip(doc: unknown) {
  if (!doc || typeof doc !== 'object') return doc;
  const o = JSON.parse(JSON.stringify(doc));
  delete o.updatedAt;
  delete o.__v;
  return o;
}

/** Records a change. Never throws (audit must not break the main operation). */
export async function audit(userId: string, entity: string, entityId: unknown, action: Action, before?: unknown, after?: unknown, note?: string) {
  try {
    await AuditLog.create({ userId, entity, entityId, action, before: strip(before), after: strip(after), note });
  } catch (e) {
    console.error('Audit log failed', e);
  }
}
