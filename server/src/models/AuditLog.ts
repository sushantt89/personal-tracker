import { Schema, model } from 'mongoose';
import { ownerField } from './_common.js';

/** Append-only audit trail of changes to financial records. */
const auditSchema = new Schema(
  {
    userId: ownerField,
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, enum: ['create', 'update', 'delete'], required: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ userId: 1, entity: 1, entityId: 1, createdAt: -1 });

export const AuditLog = model('AuditLog', auditSchema);
