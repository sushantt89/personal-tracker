import { Schema, model } from 'mongoose';
import { baseOptions, ownerField } from './_common.js';

const settingsSchema = new Schema(
  {
    userId: { ...ownerField, unique: true },
    paymentMethods: { type: [String], default: ['Card', 'Cash', 'Bank transfer', 'PayID', 'Direct debit'] },
    notifications: {
      billReminders: { type: Boolean, default: true },
      billReminderDays: { type: Number, default: 3, min: 0, max: 60 },
      invoiceReminders: { type: Boolean, default: true },
      jobReminders: { type: Boolean, default: true },
      budgetAlerts: { type: Boolean, default: true },
      taskReminders: { type: Boolean, default: true },
      /** Delivery: a daily email summary and/or notifications on your phone/computer */
      emailEnabled: { type: Boolean, default: false },
      emailHour: { type: Number, default: 7, min: 0, max: 23 },
      pushEnabled: { type: Boolean, default: false },
      /** Show a small pop-up inside the app when a new notification appears */
      inAppPopups: { type: Boolean, default: true },
    },
    invoice: {
      businessName: { type: String, default: '' },
      abn: { type: String, default: '' },
      address: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      paymentDetails: { type: String, default: '' },
      numberFormat: { type: String, default: 'INV-{YYYY}-{SEQ}' },
      nextSequence: { type: Number, default: 1, min: 1 },
      paymentTermsDays: { type: Number, default: 7, min: 0, max: 365 },
      defaultNotes: { type: String, default: 'Thank you for your business.' },
      gstRegistered: { type: Boolean, default: false },
      gstRate: { type: Number, default: 10, min: 0, max: 100 },
      logoDataUrl: { type: String, default: '', maxlength: 400_000 },
    },
    travel: {
      enabled: { type: Boolean, default: false },
      homeAddress: { type: String, default: '' },
      homeLat: Number,
      homeLng: Number,
      startFrom: { type: String, enum: ['home', 'first_job'], default: 'home' },
      returnHome: { type: Boolean, default: true },
      fuelPricePerLitre: { type: Number, default: 2.0, min: 0, max: 20 },
      litresPer100km: { type: Number, default: 8.0, min: 0, max: 50 },
      countryCode: { type: String, default: 'au', maxlength: 2 },
    },
    integrations: {
      googleDrive: {
        enabled: { type: Boolean, default: false },
        rootFolderName: { type: String, default: 'Personal Finance' },
        rootFolderId: String,
        autoUploadInvoices: { type: Boolean, default: true },
        autoUploadDocuments: { type: Boolean, default: true },
      },
      googleCalendar: {
        enabled: { type: Boolean, default: false },
        calendarId: { type: String, default: 'primary' },
        syncTypes: { type: [String], default: ['job', 'appointment', 'bill'] },
        /** Bring time/date changes made in Google Calendar back into the app */
        twoWay: { type: Boolean, default: true },
        /** Show the events already in your Google Calendar on the app's calendar and My Day (read-only) */
        showGoogleEvents: { type: Boolean, default: true },
      },
    },
  },
  baseOptions,
);

export const Settings = model('Settings', settingsSchema);
