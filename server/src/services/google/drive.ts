import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { GoogleAccount, Settings, Invoice, DocumentModel, User } from '../../models/index.js';
import { googleApis, isNotFound, recordGoogleError, type GoogleApis } from './client.js';
import { renderInvoicePdf } from '../invoices.js';
import { storage } from '../storage.js';
import { background } from './background.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FOLDER = 'application/vnd.google-apps.folder';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`;

async function rootName(userId: string) {
  const s = await Settings.findOne({ userId }).lean();
  return (s?.integrations?.googleDrive?.rootFolderName || 'Personal Finance').trim();
}

/** Finds or creates a folder path under My Drive, caching ids on the account. */
export async function ensureFolderPath(userId: string, apis: GoogleApis, parts: string[]): Promise<string> {
  const account = await GoogleAccount.findOne({ userId });
  const cache: Map<string, string> = (account?.driveFolders as any) ?? new Map();
  const path = [await rootName(userId), ...parts];
  let parent = 'root';
  let key = '';
  for (const name of path) {
    key = key ? `${key}/${name}` : name;
    let id = cache.get(key);
    if (id) {
      // Verify cached folder still exists (user may have deleted it)
      try {
        const f = await apis.drive.files.get({ fileId: id, fields: 'id, trashed' });
        if (f.data.trashed) id = undefined;
      } catch (e) {
        if (!isNotFound(e)) throw e;
        id = undefined;
      }
    }
    if (!id) {
      const found = await apis.drive.files.list({ q: `name='${q(name)}' and mimeType='${FOLDER}' and '${parent}' in parents and trashed=false`, fields: 'files(id)', pageSize: 1, spaces: 'drive' });
      id = found.data.files?.[0]?.id ?? undefined;
      if (!id) {
        const created = await apis.drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: [parent] }, fields: 'id' });
        id = created.data.id!;
      }
      cache.set(key, id);
    }
    parent = id;
  }
  if (account) {
    account.set('driveFolders', cache);
    await account.save();
  }
  return parent;
}

export interface UploadInput { folder: string[]; name: string; mimeType: string; data: Buffer; existingFileId?: string | null }

/** Uploads a file, or replaces the content of the file we uploaded before (no duplicates). */
export async function uploadOrUpdate(userId: string, apis: GoogleApis, input: UploadInput): Promise<{ fileId: string; link: string }> {
  const sha256 = crypto.createHash('sha256').update(input.data).digest('hex');
  const media = () => ({ mimeType: input.mimeType, body: Readable.from(input.data) });
  if (input.existingFileId) {
    try {
      const r = await apis.drive.files.update({ fileId: input.existingFileId, requestBody: { name: input.name, appProperties: { sha256, ptApp: 'personal-tracker' } }, media: media(), fields: 'id, webViewLink' });
      return { fileId: r.data.id!, link: r.data.webViewLink ?? `https://drive.google.com/file/d/${r.data.id}/view` };
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  const folderId = await ensureFolderPath(userId, apis, input.folder);
  const dup = await apis.drive.files.list({ q: `'${folderId}' in parents and trashed=false and appProperties has { key='sha256' and value='${sha256}' }`, fields: 'files(id, webViewLink)', pageSize: 1 });
  const existing = dup.data.files?.[0];
  if (existing?.id) return { fileId: existing.id, link: existing.webViewLink ?? `https://drive.google.com/file/d/${existing.id}/view` };
  const r = await apis.drive.files.create({ requestBody: { name: input.name, parents: [folderId], appProperties: { sha256, ptApp: 'personal-tracker' } }, media: media(), fields: 'id, webViewLink' });
  return { fileId: r.data.id!, link: r.data.webViewLink ?? `https://drive.google.com/file/d/${r.data.id}/view` };
}

const yearMonth = (date?: string | null) => {
  const d = date || new Date().toISOString().slice(0, 10);
  return { year: d.slice(0, 4), month: MONTHS[Number(d.slice(5, 7)) - 1] };
};

export async function uploadInvoice(userId: string, invoiceId: unknown) {
  const apis = await googleApis(userId);
  if (!apis) throw new Error('Google Drive is not connected');
  const inv = await Invoice.findOne({ _id: invoiceId, userId }).lean<any>();
  if (!inv) throw new Error('Invoice not found');
  const [settings, user] = await Promise.all([Settings.findOne({ userId }).lean(), User.findById(userId).lean()]);
  const pdf = await renderInvoicePdf(inv, settings, user?.currency ?? 'AUD');
  const { year, month } = yearMonth(inv.issueDate);
  try {
    const r = await uploadOrUpdate(userId, apis, {
      folder: ['Invoices', year, month], name: `${inv.number} - ${inv.clientName}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), mimeType: 'application/pdf', data: pdf, existingFileId: inv.sync?.googleDriveFileId,
    });
    await Invoice.updateOne({ _id: inv._id }, { $set: { 'sync.googleDriveFileId': r.fileId, 'sync.googleDriveLink': r.link, 'sync.syncedAt': new Date() }, $unset: { 'sync.syncError': 1 } });
    return r;
  } catch (e) {
    const msg = await recordGoogleError(userId, e, `Drive upload for invoice ${inv.number}`);
    await Invoice.updateOne({ _id: inv._id }, { $set: { 'sync.syncError': msg } });
    throw e;
  }
}

export async function uploadDocument(userId: string, docId: unknown) {
  const apis = await googleApis(userId);
  if (!apis) throw new Error('Google Drive is not connected');
  const doc = await DocumentModel.findOne({ _id: docId, userId }).select('+storageKey').lean<any>();
  if (!doc) throw new Error('Document not found');
  if (doc.sync?.googleDriveFileId) return { fileId: doc.sync.googleDriveFileId, link: doc.sync.googleDriveLink };
  const data = await storage.read(doc.storageKey);
  const { year, month } = yearMonth(doc.date);
  const folder = doc.kind === 'receipt' ? ['Receipts', year] : doc.kind === 'invoice' ? ['Invoices', year, month] : ['Financial Documents'];
  try {
    const r = await uploadOrUpdate(userId, apis, { folder, name: doc.originalName || doc.title, mimeType: doc.mimeType || 'application/octet-stream', data });
    await DocumentModel.updateOne({ _id: doc._id }, { $set: { 'sync.googleDriveFileId': r.fileId, 'sync.googleDriveLink': r.link, 'sync.syncedAt': new Date() }, $unset: { 'sync.syncError': 1 } });
    return r;
  } catch (e) {
    const msg = await recordGoogleError(userId, e, `Drive upload for ${doc.title}`);
    await DocumentModel.updateOne({ _id: doc._id }, { $set: { 'sync.syncError': msg } });
    throw e;
  }
}

/** Creates Personal Finance/{Invoices/<year>/<months>, Receipts/<year>, Financial Documents}. */
export async function setupDriveFolders(userId: string) {
  const apis = await googleApis(userId);
  if (!apis) throw new Error('Google Drive is not connected');
  const year = new Date().getFullYear().toString();
  for (const m of MONTHS) await ensureFolderPath(userId, apis, ['Invoices', year, m]);
  await ensureFolderPath(userId, apis, ['Receipts', year]);
  await ensureFolderPath(userId, apis, ['Financial Documents']);
  const rootId = await ensureFolderPath(userId, apis, []);
  await Settings.updateOne({ userId }, { 'integrations.googleDrive.rootFolderId': rootId });
  return { rootFolderId: rootId, link: folderLink(rootId) };
}

async function driveAuto(userId: string, key: 'autoUploadInvoices' | 'autoUploadDocuments') {
  const s = await Settings.findOne({ userId }).lean();
  const d = s?.integrations?.googleDrive;
  return Boolean(d?.enabled && d?.[key] !== false);
}

/** Auto-upload a sent/paid invoice (drafts stay local until you send them). */
export function queueInvoiceUpload(userId: string, invoiceId: unknown) {
  background(async () => {
    if (!(await driveAuto(userId, 'autoUploadInvoices'))) return;
    const inv = await Invoice.findOne({ _id: invoiceId, userId }).select('status').lean();
    if (!inv || !['sent', 'paid'].includes(inv.status)) return;
    if (!(await googleApis(userId))) return;
    await uploadInvoice(userId, invoiceId);
  });
}

export function queueDocumentUpload(userId: string, docId: unknown) {
  background(async () => {
    if (!(await driveAuto(userId, 'autoUploadDocuments'))) return;
    if (!(await googleApis(userId))) return;
    await uploadDocument(userId, docId);
  });
}
