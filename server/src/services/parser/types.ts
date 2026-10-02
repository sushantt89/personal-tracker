export interface ParsedAddress {
  line1?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
  formatted?: string;
}

export interface ParsedJob {
  tempId: string;
  clientName: string;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string;
  hours?: number;
  amount?: number;
  address: ParsedAddress;
  description?: string;
  tasks: string[];
  rooms?: number;
  bathrooms?: number;
  specialInstructions?: string;
  meetingPoint?: string;
  sourceText: string;
  confidence: number; // 0..1
  warnings: string[];
  duplicateOfJobId?: string | null;
}

export interface ParsedPayment {
  tempId: string;
  amount: number;
  date?: string;
  payer?: string;
  reference?: string;
  description: string;
  sourceText: string;
  warnings: string[];
}

export interface ParseResult {
  kind: 'schedule' | 'payment' | 'mixed' | 'unknown';
  recipientName?: string;
  scheduleDate?: string;
  meetingPoint?: string;
  meetingTime?: string;
  jobs: ParsedJob[];
  payments: ParsedPayment[];
  summary: { jobCount: number; paymentCount: number; totalAmount: number; addressCount: number; dateCount: number; dates: string[] };
  warnings: string[];
  unparsedLines: string[];
}
