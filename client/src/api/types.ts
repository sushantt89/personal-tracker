export type Id = string;

export interface User { id: Id; name: string; email: string; currency: string; timezone: string; theme: 'light' | 'dark' | 'system' }
export interface Address { line1?: string; suburb?: string; state?: string; postcode?: string; country?: string; formatted?: string }
export interface Category { id: Id; name: string; color: string; archived?: boolean }
export type WorkType = 'own' | 'subcontract' | 'employee';
export interface IncomeSource { id: Id; name: string; color: string; isJobBased?: boolean; defaultHourlyRate?: number; archived?: boolean; workType?: WorkType; contractorId?: Id | null }
export interface Client { id: Id; name: string; type?: 'client' | 'contractor'; contactName?: string; abn?: string; email?: string; phone?: string; address?: Address; incomeSourceId?: Id | null; defaultRate?: number; notes?: string }

export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export interface Job {
  id: Id; title?: string; clientId?: Id | null; clientName?: string; incomeSourceId?: Id | null; workType?: WorkType; contractorId?: Id | null; contractorName?: string; date: string; startTime?: string; endTime?: string;
  amount?: number; hoursWorked?: number; address?: Address; meetingPoint?: string; description?: string; tasks: string[]; rooms?: number; bathrooms?: number;
  specialInstructions?: string; status: JobStatus; notes?: string; invoiceId?: Id | null; sourceMessage?: string; distanceKm?: number; travelMinutes?: number;
}

export type IncomeStatus = 'expected' | 'pending' | 'paid' | 'cancelled';
export interface Income {
  id: Id; date: string; incomeSourceId?: Id | null; clientId?: Id | null; clientName?: string; description?: string; amount: number; hoursWorked?: number;
  status: IncomeStatus; paymentMethod?: string; paidDate?: string; invoiceId?: Id | null; invoiceNumber?: string; jobId?: Id | null; notes?: string;
  recurring?: { enabled: boolean; frequency?: string; until?: string; generatedThrough?: string }; recurringParentId?: Id | null;
}

export interface Expense {
  id: Id; date: string; amount: number; categoryId?: Id | null; description?: string; merchant?: string; paymentMethod?: string; isRecurring?: boolean;
  billId?: Id | null; billOccurrence?: string; receiptId?: Id | null; gst?: number; notes?: string;
}

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export interface Bill {
  id: Id; name: string; amount: number; frequency: Frequency; customIntervalDays?: number; dueDate: string; startDate?: string; endDate?: string;
  categoryId?: Id | null; paymentMethod?: string; autoRenew?: boolean; autoPay?: boolean; reminderDays?: number; active?: boolean; notes?: string;
}
export interface BillDue { billId: Id; name: string; amount: number; dueDate: string; paid: boolean; categoryId?: Id | null; paymentMethod?: string; autoPay?: boolean }

export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled';
export type TaskCategory = 'appointment' | 'personal' | 'study' | 'reminder' | 'event' | 'work' | 'other';
export interface Task {
  id: Id; title: string; description?: string; date: string; startTime?: string; endTime?: string; location?: string; priority: 'low' | 'medium' | 'high';
  status: TaskStatus; category: TaskCategory; notes?: string; recurrence?: { frequency: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'; until?: string };
}

export interface InvoiceItem { _id?: string; date?: string; description: string; quantity: number; rate: number; amount?: number; jobId?: Id | null; incomeId?: Id | null }
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
export interface Invoice {
  id: Id; number: string; issueDate: string; dueDate: string; incomeSourceId?: Id | null; clientId?: Id | null; clientName: string; billToType?: 'client' | 'contractor'; clientAddress?: string; clientEmail?: string;
  items: InvoiceItem[]; subtotal: number; gstRate: number; gstAmount: number; total: number; notes?: string; paymentDetails?: string; status: InvoiceStatus;
  effectiveStatus: InvoiceStatus; paidDate?: string; periodFrom?: string; periodTo?: string; sync?: { googleDriveLink?: string; googleDriveFileId?: string; googleCalendarEventId?: string; syncError?: string };
}

export interface DocumentRec {
  id: Id; kind: 'receipt' | 'invoice' | 'financial' | 'other'; title: string; originalName?: string; mimeType?: string; size?: number; date?: string; amount?: number;
  merchant?: string; categoryId?: Id | null; gst?: number; expenseId?: Id | null; invoiceId?: Id | null; notes?: string; createdAt: string; duplicate?: boolean;
  sync?: { googleDriveLink?: string; googleDriveFileId?: string; syncError?: string };
}

export interface Budget {
  monthlyIncomeTarget: number; monthlySpendingLimit: number; expectedVariableExpenses: number; monthlySavingsTarget: number; emergencyFundTarget: number;
  currentSavings: number; currentEmergencyFund: number; categoryBudgets: { categoryId: Id; amount: number }[];
}

export interface Settings {
  paymentMethods: string[];
  travel: TravelSettings;
  notifications: { billReminders: boolean; billReminderDays: number; invoiceReminders: boolean; jobReminders: boolean; budgetAlerts: boolean; taskReminders: boolean; emailEnabled: boolean; emailHour: number; pushEnabled: boolean; inAppPopups?: boolean };
  invoice: { businessName: string; abn: string; address: string; email: string; phone: string; paymentDetails: string; numberFormat: string; nextSequence: number; paymentTermsDays: number; defaultNotes: string; gstRegistered: boolean; gstRate: number; logoDataUrl: string };
  integrations: { googleDrive: { enabled: boolean; rootFolderName: string; rootFolderId?: string; autoUploadInvoices: boolean; autoUploadDocuments: boolean }; googleCalendar: { enabled: boolean; calendarId: string; syncTypes: string[]; twoWay?: boolean } };
}

export interface Alert { id: string; type: string; severity: 'info' | 'warning' | 'error'; title: string; message: string; date?: string; link?: string }
export interface InboxAlert extends Alert { key: string; read: boolean; firstSeenAt: string }
export interface AlertInbox { items: InboxAlert[]; unread: number }
export interface Insight { id: string; kind: string; tone: 'neutral' | 'positive' | 'attention'; text: string; value?: number }
export interface CalendarEvent { id: string; type: 'task' | 'job' | 'bill' | 'invoice'; refId: string; date: string; startTime?: string; endTime?: string; title: string; amount?: number; status?: string; location?: string; category?: string; priority?: string; recurring?: boolean }
export interface List<T> { items: T[]; total: number }

export interface ParsedJob {
  tempId: string; clientName: string; date?: string; startTime?: string; endTime?: string; hours?: number; amount?: number; address: Address; description?: string;
  tasks: string[]; rooms?: number; bathrooms?: number; specialInstructions?: string; meetingPoint?: string; sourceText: string; confidence: number; warnings: string[];
  duplicateOfJobId?: string | null;
}
export interface ParsedPayment { tempId: string; amount: number; date?: string; payer?: string; reference?: string; description: string; sourceText: string; warnings: string[] }
export interface ParseResponse {
  kind: 'schedule' | 'payment' | 'mixed' | 'unknown'; recipientName?: string; scheduleDate?: string; meetingPoint?: string; meetingTime?: string;
  jobs: ParsedJob[]; payments: ParsedPayment[]; warnings: string[]; unparsedLines: string[];
  summary: { jobCount: number; paymentCount: number; totalAmount: number; addressCount: number; dateCount: number; dates: string[] };
  suggestedWorkType?: WorkType; suggestedContractorId?: string | null;
  /** 'roster' = a shift list for an employer (pay usually unknown); 'message' = a schedule or payment message */
  format?: 'roster' | 'message'; text?: string; ocrConfidence?: number;
  messageHash: string; alreadyImported: { at: string; jobCount: number } | null; suggestedIncomeSourceId: string | null;
  paymentMatches: Record<string, { incomeId?: string; invoiceId?: string; label: string }[]>;
}

export interface InvoiceTemplate {
  id: Id; name: string; billToType?: 'client' | 'contractor'; clientId?: Id | null; clientName?: string; clientAddress?: string; clientEmail?: string;
  incomeSourceId?: Id | null; items: { description: string; quantity: number; rate: number }[]; gstRate?: number | null; paymentTermsDays?: number | null;
  notes?: string; paymentDetails?: string;
}

export interface IntegrationStatus {
  provider: string; configured: boolean; connected: boolean; message: string;
  email?: string; needsReconnect?: boolean; lastError?: string | null; lastCalendarSyncAt?: string | null; missingScopes?: string[];
}
export interface Integrations { googleCalendar: IntegrationStatus; googleDrive: IntegrationStatus; ocr: IntegrationStatus; travel: IntegrationStatus }

export interface ReceiptScan {
  merchant?: string; abn?: string; date?: string; total?: number; gst?: number; paymentMethod?: string; categoryHint?: string;
  items: { description: string; amount: number }[]; warnings: string[]; rawText: string; confidence: number; source: 'ocr' | 'pdf-text' | 'pdf-scan';
}

export interface TravelLeg { from: string; to: string; toJobId?: string; km: number; minutes: number }
export interface TravelDay {
  id: string; date: string; stops: { label: string; kind: 'home' | 'job'; jobId?: string; address: string }[]; legs: TravelLeg[];
  totalKm: number; totalMinutes: number; missing: { jobId: string; label: string; address: string; reason: string }[]; error?: string | null;
  computedAt?: string; signature?: string; fuel: { litres: number; cost: number };
}
export interface TravelSettings { enabled: boolean; homeAddress: string; homeLat?: number; homeLng?: number; startFrom: 'home' | 'first_job'; returnHome: boolean; fuelPricePerLitre: number; litresPer100km: number; countryCode: string }
