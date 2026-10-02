import { extractText } from './engine.js';
import { parseReceiptText, type ReceiptFields } from './receiptParser.js';

export interface ReceiptScan extends ReceiptFields {
  rawText: string;
  confidence: number;
  source: 'ocr' | 'pdf-text' | 'pdf-scan';
}

/** OCR + parse. Never saves anything — the caller shows the result for review. */
export async function scanReceipt(data: Buffer, mimeType: string, today: string): Promise<ReceiptScan> {
  const { text, confidence, source } = await extractText(data, mimeType);
  const fields = parseReceiptText(text, today);
  if (!text.trim()) fields.warnings.unshift(source === 'pdf-text' ? 'No text or scanned page could be found in this PDF.' : 'No text could be read. Try a sharper, well-lit photo taken straight on.');
  else if (source !== 'pdf-text' && confidence < 55) fields.warnings.unshift('The photo is hard to read — please double-check every field.');
  return { ...fields, rawText: text.trim().slice(0, 5000), confidence, source };
}

export { parseReceiptText } from './receiptParser.js';
