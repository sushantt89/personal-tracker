import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** File storage abstraction. Local disk now; Google Drive provider can implement the same interface. */
export interface StorageProvider {
  readonly name: 'local' | 'google_drive';
  save(userId: string, buffer: Buffer, originalName: string, folder: string): Promise<{ key: string }>;
  read(key: string): Promise<Buffer>;
  /** Put a file back at a known key (used when a copy is recovered from Google Drive). */
  restore(key: string, buffer: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
  /** Delete every file stored for one user. */
  removeAll(userId: string): Promise<void>;
}

const root = path.resolve(env.UPLOAD_DIR);

class LocalStorage implements StorageProvider {
  readonly name = 'local' as const;
  async save(userId: string, buffer: Buffer, originalName: string, folder: string) {
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const key = path.posix.join(userId, folder.replace(/[^a-zA-Z0-9/_-]/g, ''), `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    const full = path.join(root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
    return { key };
  }
  private resolve(key: string) {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async read(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async restore(key: string, buffer: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
  }
  async removeAll(userId: string) {
    if (!/^[a-f0-9]{24}$/i.test(userId)) throw new Error('Invalid user id');
    await fs.rm(this.resolve(userId), { recursive: true, force: true });
  }
  async remove(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

export const storage: StorageProvider = new LocalStorage();
