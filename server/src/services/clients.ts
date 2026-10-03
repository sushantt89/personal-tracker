import { Client, IncomeSource } from '../models/index.js';
import { badRequest } from '../utils/httpError.js';
import { escapeRegex } from './crud.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Links a record to a client: uses clientId if given, otherwise finds (or optionally creates) a client by name. */
export async function resolveClient(userId: string, data: any, opts: { create?: boolean; address?: any; incomeSourceId?: any } = {}) {
  if (data.clientId) {
    const c = await Client.findOne({ _id: data.clientId, userId }).lean();
    if (c) data.clientName = data.clientName || c.name;
    return;
  }
  const name = typeof data.clientName === 'string' ? data.clientName.trim() : '';
  if (!name || name === 'Unknown client') return;
  const existing = await Client.findOne({ userId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean();
  if (existing) {
    data.clientId = existing._id;
    return;
  }
  if (opts.create) {
    const created = await Client.create({ userId, name, address: opts.address, incomeSourceId: opts.incomeSourceId ?? null });
    data.clientId = created._id;
  }
}

/**
 * Work arrangement for a job:
 *  - own:        you are the business → the client pays you and gets the invoice
 *  - subcontract: you work under a contractor → the contractor pays you and gets the invoice
 *  - employee:   you work shifts for an employer (the "client" is the employer) → paid as wages, never invoiced
 * Fills workType/contractor from the income source defaults when not given, and resolves contractor name/id.
 */
export async function applyWorkArrangement(userId: string, data: any, opts: { inheritFromSource?: boolean } = { inheritFromSource: true }) {
  if (opts.inheritFromSource && data.incomeSourceId && (data.workType === undefined || (data.workType === 'subcontract' && !data.contractorId && !data.contractorName))) {
    const src = await IncomeSource.findOne({ _id: data.incomeSourceId, userId }).lean();
    if (src) {
      if (data.workType === undefined) data.workType = src.workType ?? 'own';
      if (data.workType === 'subcontract' && !data.contractorId && !data.contractorName && src.contractorId) data.contractorId = src.contractorId;
    }
  }
  if (data.workType === 'own' || data.workType === 'employee') {
    data.contractorId = null;
    data.contractorName = undefined;
    return;
  }
  if (data.workType !== 'subcontract') return;
  if (data.contractorId) {
    const c = await Client.findOne({ _id: data.contractorId, userId }).lean();
    if (!c) throw badRequest('Contractor not found');
    data.contractorName = c.name;
    return;
  }
  const name = typeof data.contractorName === 'string' ? data.contractorName.trim() : '';
  if (!name) return;
  const existing = await Client.findOne({ userId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean();
  if (existing) {
    data.contractorId = existing._id;
    data.contractorName = existing.name;
    if (existing.type !== 'contractor') await Client.updateOne({ _id: existing._id }, { type: 'contractor' });
  } else {
    const created = await Client.create({ userId, name, type: 'contractor', incomeSourceId: data.incomeSourceId ?? null });
    data.contractorId = created._id;
  }
}

/** Who pays for a job (and receives the invoice). */
export function payerOf(job: any): { clientId: any; clientName?: string } {
  return job.workType === 'subcontract' && (job.contractorId || job.contractorName)
    ? { clientId: job.contractorId ?? null, clientName: job.contractorName }
    : { clientId: job.clientId ?? null, clientName: job.clientName };
}
