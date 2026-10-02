/**
 * Development seed: creates a demo account with ~4 months of realistic sample data.
 * Usage: npm run seed  (refuses to run when NODE_ENV=production)
 * Login: demo@example.com / demo12345
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb } from '../config/db.js';
import { User, Category, IncomeSource, Client, Job, Income, Expense, RecurringBill, Task, Budget, Settings, Invoice, ImportBatch, AuditLog, DocumentModel, InvoiceTemplate } from '../models/index.js';
import { ensureUserDefaults } from '../services/defaults.js';
import { addDays, todayIn, monthStart } from '../utils/dates.js';

const EMAIL = 'demo@example.com';

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  await connectDb(env.MONGODB_URI);
  const existing = await User.findOne({ email: EMAIL });
  if (existing) {
    const uid = existing._id;
    await Promise.all([Category, IncomeSource, Client, Job, Income, Expense, RecurringBill, Task, Budget, Settings, Invoice, ImportBatch, AuditLog, DocumentModel, InvoiceTemplate].map((m) => (m as typeof Job).deleteMany({ userId: uid })));
    await existing.deleteOne();
  }
  const user = await User.create({ name: 'Demo User', email: EMAIL, passwordHash: await bcrypt.hash('demo12345', 12) });
  const userId = String(user._id);
  await ensureUserDefaults(userId);
  const cats = Object.fromEntries((await Category.find({ userId })).map((c) => [c.name, c._id]));
  const srcs = Object.fromEntries((await IncomeSource.find({ userId })).map((s) => [s.name, s._id]));
  await Settings.updateOne({ userId }, { $set: { 'invoice.businessName': 'Demo Cleaning Services', 'invoice.abn': '12 345 678 901', 'invoice.paymentDetails': 'BSB 000-000 · Acc 12345678 · PayID demo@example.com', 'invoice.address': 'Adelaide SA 5000' } });

  const clientsData = [
    { name: 'Sonia', address: { line1: '25 Angus Street', suburb: 'Goodwood', state: 'SA', postcode: '5034', country: 'Australia' } },
    { name: 'Andrew Dana', address: { line1: '2 Chessington Avenue', suburb: 'Frewville', state: 'SA', postcode: '5063', country: 'Australia' } },
    { name: 'Bron B', address: { line1: '25 Clifton St', suburb: 'Hawthorn', state: 'SA', postcode: '5062', country: 'Australia' } },
    { name: 'Priya K', address: { line1: '8 Fisher Street', suburb: 'Malvern', state: 'SA', postcode: '5061', country: 'Australia' } },
  ];
  // Cleaning work is done under a contractor (they send the schedule, pay you, and get your invoice).
  const contractor = await Client.create({ userId, name: 'Sparkle Cleaning Co', type: 'contractor', contactName: 'Maria', email: 'accounts@sparkle.example', abn: '98 765 432 109', address: { line1: '10 King William St', suburb: 'Adelaide', state: 'SA', postcode: '5000', country: 'Australia', formatted: '10 King William St, Adelaide SA 5000' }, incomeSourceId: srcs.Cleaning });
  await IncomeSource.updateOne({ _id: srcs.Cleaning }, { workType: 'subcontract', contractorId: contractor._id });
  const clients = await Client.insertMany(clientsData.map((c) => ({ ...c, userId, address: { ...c.address, formatted: `${c.address.line1}, ${c.address.suburb} ${c.address.state} ${c.address.postcode}` }, incomeSourceId: srcs.Cleaning })));

  const today = todayIn(user.timezone);
  const start = addDays(monthStart(today), -95);
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const times = ['08:45', '10:00', '11:30', '13:30'];

  for (let d = start; d <= addDays(today, 10); d = addDays(d, 1)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    // Cleaning jobs Tue/Fri/Sat
    if ([2, 5, 6].includes(dow)) {
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const c = clients[Math.floor(rand() * clients.length)];
        const amount = [25, 30, 35, 40][Math.floor(rand() * 4)];
        const past = d < today;
        const [h, m] = times[i].split(':').map(Number);
        const end = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        // Priya is your own private client (Business); everyone else comes through the contractor
        const own = c.name === 'Priya K';
        const arrangement = own ? { incomeSourceId: srcs.Business, workType: 'own' } : { incomeSourceId: srcs.Cleaning, workType: 'subcontract', contractorId: contractor._id, contractorName: contractor.name };
        const job = await Job.create({ userId, clientId: c._id, clientName: c.name, ...arrangement, date: d, startTime: times[i], endTime: end, hoursWorked: 1, amount, address: c.address, status: past ? 'completed' : 'scheduled', tasks: ['Dusting', 'Vacuuming', 'Mopping'] });
        await Income.create({ userId, date: d, amount, incomeSourceId: arrangement.incomeSourceId, clientId: own ? c._id : contractor._id, clientName: own ? c.name : contractor.name, description: own ? `Job – ${c.name}` : `Job – ${c.name} (via ${contractor.name})`, hoursWorked: 1, status: past && addDays(d, 14) < today ? 'paid' : past ? 'pending' : 'expected', paidDate: past && addDays(d, 14) < today ? addDays(d, 7) : undefined, jobId: job._id, paymentMethod: 'Bank transfer' });
      }
    }
    // McDonald's fortnightly pay on Thursdays
    if (dow === 4 && Math.floor((Date.parse(d) - Date.parse(start)) / 86400000 / 7) % 2 === 0 && d <= today) {
      await Income.create({ userId, date: d, amount: 780 + Math.round(rand() * 120), incomeSourceId: srcs["McDonald's"], description: 'Fortnightly pay', hoursWorked: 32, status: 'paid', paidDate: d, paymentMethod: 'Bank transfer' });
    }
    // Daily spending
    if (d <= today) {
      if (rand() < 0.45) await Expense.create({ userId, date: d, amount: Math.round((8 + rand() * 25) * 100) / 100, categoryId: cats.Food, merchant: ['Subway', 'Cafe', 'Grill\'d', 'Bakery'][Math.floor(rand() * 4)], paymentMethod: 'Card' });
      if (dow === 0) await Expense.create({ userId, date: d, amount: Math.round((70 + rand() * 60) * 100) / 100, categoryId: cats.Groceries, merchant: ['Woolworths', 'Coles', 'Aldi'][Math.floor(rand() * 3)], paymentMethod: 'Card' });
      if (dow === 3) await Expense.create({ userId, date: d, amount: Math.round((45 + rand() * 30) * 100) / 100, categoryId: cats.Fuel, merchant: ['Shell', 'BP', 'Ampol'][Math.floor(rand() * 3)], paymentMethod: 'Card' });
      if (rand() < 0.05) await Expense.create({ userId, date: d, amount: Math.round((20 + rand() * 80) * 100) / 100, categoryId: cats.Entertainment, merchant: 'Cinema', paymentMethod: 'Card' });
    }
  }

  const bills = await RecurringBill.insertMany([
    { userId, name: 'Rent', amount: 320, frequency: 'weekly', dueDate: addDays(start, 1), categoryId: cats.Rent, paymentMethod: 'Bank transfer' },
    { userId, name: 'Car insurance', amount: 98, frequency: 'monthly', dueDate: addDays(start, 14), categoryId: cats.Insurance, paymentMethod: 'Direct debit', autoPay: true },
    { userId, name: 'Phone', amount: 45, frequency: 'monthly', dueDate: addDays(start, 20), categoryId: cats.Phone, paymentMethod: 'Card' },
    { userId, name: 'Internet', amount: 75, frequency: 'monthly', dueDate: addDays(start, 5), categoryId: cats.Internet, paymentMethod: 'Direct debit' },
    { userId, name: 'Netflix', amount: 18.99, frequency: 'monthly', dueDate: addDays(start, 9), categoryId: cats.Subscriptions, paymentMethod: 'Card' },
    { userId, name: 'Car registration', amount: 840, frequency: 'yearly', dueDate: addDays(today, 40), categoryId: cats.Car, paymentMethod: 'Card' },
    { userId, name: 'University fees', amount: 1500, frequency: 'quarterly', dueDate: addDays(start, 30), categoryId: cats.Education, paymentMethod: 'Bank transfer' },
  ]);
  // Record past bill payments as expenses
  const { billOccurrences } = await import('../services/recurrence.js');
  for (const b of bills) {
    for (const occ of billOccurrences(b as never, start, addDays(today, -1))) {
      await Expense.create({ userId, date: occ, amount: b.amount, categoryId: b.categoryId, merchant: b.name, description: b.name, paymentMethod: b.paymentMethod, isRecurring: true, billId: b._id, billOccurrence: occ });
    }
  }

  await Budget.updateOne({ userId }, { $set: {
    monthlyIncomeTarget: 3500, monthlySpendingLimit: 3000, expectedVariableExpenses: 700, monthlySavingsTarget: 500, emergencyFundTarget: 5000,
    currentSavings: 2400, currentEmergencyFund: 1800,
    categoryBudgets: [{ categoryId: cats.Food, amount: 400 }, { categoryId: cats.Groceries, amount: 450 }, { categoryId: cats.Fuel, amount: 250 }, { categoryId: cats.Entertainment, amount: 100 }],
  } });

  await Task.insertMany([
    { userId, title: 'Study – database assignment', date: today, startTime: '19:00', endTime: '21:00', category: 'study', priority: 'high' },
    { userId, title: 'Gym', date: today, startTime: '07:00', endTime: '08:00', category: 'personal', recurrence: { frequency: 'weekly' } },
    { userId, title: 'Dentist appointment', date: addDays(today, 2), startTime: '14:00', endTime: '14:45', category: 'appointment', location: 'Unley' },
    { userId, title: 'Send invoices', date: addDays(today, 1), category: 'reminder', priority: 'medium' },
  ]);

  await InvoiceTemplate.create({
    userId, name: 'Fortnightly – Sparkle Cleaning Co', billToType: 'contractor', clientId: contractor._id, clientName: contractor.name,
    clientAddress: contractor.address?.formatted, clientEmail: contractor.email, incomeSourceId: srcs.Cleaning, items: [], gstRate: 0, paymentTermsDays: 7,
    notes: 'Cleaning services as per attached schedule.', paymentDetails: 'BSB 000-000 · Acc 12345678 · PayID demo@example.com',
  });

  console.log(`Seeded demo account: ${EMAIL} / demo12345`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
