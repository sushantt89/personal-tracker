import path from 'node:path';
import { createRequire } from 'node:module';
import type { Worker } from 'tesseract.js';

/**
 * Local OCR. Runs inside this server process (on your own computer when you run the app locally).
 * Images never leave your machine, and the English language data ships with the app
 * (@tesseract.js-data/eng), so no internet connection is needed.
 */
const require = createRequire(import.meta.url);
let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function langPath() {
  // Use the compact "best_int" model: good accuracy, fast on a laptop CPU
  return path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, { langPath: langPath(), gzip: true, cacheMethod: 'none', logger: () => undefined, errorHandler: () => undefined });
      // Receipts are column-ish blocks of text; "single block" segmentation keeps lines together
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Straighten, upscale and clean the photo so text is easier to read. */
async function preprocess(data: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    const img = sharp(data, { failOn: 'none' }).rotate(); // respect phone EXIF orientation
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    const target = width < 1000 ? 1400 : width > 2200 ? 2000 : undefined;
    return await img.resize(target ? { width: target } : undefined).grayscale().normalize().sharpen().png().toBuffer();
  } catch {
    return data; // sharp unavailable or unsupported format: let Tesseract try the original
  }
}

export interface OcrText { text: string; confidence: number; source: 'ocr' | 'pdf-text' | 'pdf-scan' }

export const OCR_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const HEIC_TYPES = ['image/heic', 'image/heif'];

/** iPhone HEIC/HEIF photos → JPEG (pure JavaScript, works on every platform). */
export async function heicToJpeg(data: Buffer): Promise<Buffer> {
  const convert = (await import('heic-convert')).default;
  return Buffer.from(await convert({ buffer: data, format: 'JPEG', quality: 0.9 }));
}
export const isHeic = (mimeType: string, name = '') => HEIC_TYPES.includes(mimeType) || /\.hei[cf]$/i.test(name);

/** Scanned PDFs have no text layer: pull the page images out and read those instead (first 3 pages). */
async function scannedPdfImages(data: Buffer): Promise<Buffer[]> {
  const sharp = (await import('sharp')).default;
  const { extractImages, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const out: Buffer[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
    const images = await extractImages(pdf, p);
    // The scan is the largest image on the page (ignore logos/stamps)
    const biggest = images.filter((i) => i.width >= 300 && i.height >= 300).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (biggest) out.push(await sharp(Buffer.from(biggest.data), { raw: { width: biggest.width, height: biggest.height, channels: biggest.channels } }).png().toBuffer());
  }
  return out;
}

export async function extractText(data: Buffer, mimeType: string, timeoutMs = 90_000): Promise<OcrText> {
  if (mimeType === 'application/pdf') {
    // Digital PDFs (e-receipts, invoices) already contain text — read it directly
    const { extractText: pdfText } = await import('unpdf');
    const { text } = await pdfText(new Uint8Array(data), { mergePages: true });
    const t = (Array.isArray(text) ? text.join('\n') : text) ?? '';
    if (t.replace(/\s/g, '').length >= 20) return { text: t, confidence: 100, source: 'pdf-text' };
    const pages = await scannedPdfImages(data);
    if (!pages.length) return { text: t, confidence: 0, source: 'pdf-text' };
    const read = async () => {
      const worker = await getWorker();
      const parts: string[] = [];
      let conf = 0;
      for (const page of pages) {
        const r = await worker.recognize(await preprocess(page));
        parts.push(r.data.text ?? '');
        conf += r.data.confidence ?? 0;
      }
      return { text: parts.join('\n'), confidence: Math.round(conf / pages.length), source: 'pdf-scan' as const };
    };
    const job = queue.then(read, read);
    queue = job.catch(() => undefined);
    return Promise.race([job, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Reading the scanned PDF took too long')), timeoutMs * 2))]);
  }
  if (!OCR_IMAGE_TYPES.includes(mimeType)) throw new Error('This file type can’t be read automatically. Use a JPG, PNG, WebP, HEIC or PDF.');
  const run = async () => {
    const worker = await getWorker();
    const image = await preprocess(HEIC_TYPES.includes(mimeType) ? await heicToJpeg(data) : data);
    const result = await worker.recognize(image);
    return { text: result.data.text ?? '', confidence: Math.round(result.data.confidence ?? 0), source: 'ocr' as const };
  };
  // One recognition at a time keeps memory use low
  const job = queue.then(run, run);
  queue = job.catch(() => undefined);
  return Promise.race([job, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Reading the receipt took too long')), timeoutMs))]);
}

export async function shutdownOcr() {
  if (workerPromise) await (await workerPromise).terminate().catch(() => undefined);
  workerPromise = null;
}
