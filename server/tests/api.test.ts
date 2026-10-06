import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

let mongo: MongoMemoryServer;
let app: Express;
const TODAY = '2026-10-01';
const SAMPLE = `Hi SUSHANT
Your schedule for Friday 2 OCT.
Meet at Goodwood Road McDonald's at 8:45am.
Sonia 8:45am ($25)
25 Angus Street
Goodwood, SA, Australia
Andrew Dana - 10am ($30)
2 Chessington Avenue
Frewville, SA, Australia
Bron B - 11:30am ($30)
25 Clifton St Hawthorn 5062
Kitchen, 2 bathrooms, 3 rooms.
Dusting and wipedown surfaces, vacuum and mop floor.
Change the bed in master bedroom.`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.UPLOAD_DIR = './tmp-test-uploads';
  await mongoose.connect(mongo.getUri());
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  const fs = await import('node:fs/promises');
  await fs.rm('./tmp-test-uploads', { recursive: true, force: true });
});

describe('API end-to-end', () => {
  const agent = () => request.agent(app);
  let a: ReturnType<typeof agent>;
  let cleaningId: string;

  it('registers and authenticates', async () => {
    a = agent();
    const r = await a.post('/api/auth/register').send({ name: 'Sushant', email: 'S@example.com', password: 'password123' });
    expect(r.status).toBe(201);
    expect(r.body.user.passwordHash).toBeUndefined();
    const me = await a.get('/api/auth/me');
    expect(me.body.user.email).toBe('s@example.com');
    const unauth = await request(app).get('/api/jobs');
    expect(unauth.status).toBe(401);
    const sources = await a.get('/api/income-sources');
    cleaningId = sources.body.items.find((s: { name: string }) => s.name === 'Cleaning').id;
    expect(cleaningId).toBeTruthy();
  });

  it('parses without saving, then imports', async () => {
    const p = await a.post(`/api/import/parse?today=${TODAY}`).send({ text: SAMPLE });
    expect(p.status).toBe(200);
    expect(p.body.summary).toMatchObject({ jobCount: 3, totalAmount: 85 });
    expect((await a.get('/api/jobs')).body.total).toBe(0);

    const c = await a.post('/api/import/commit').send({ sourceMessage: SAMPLE, incomeSourceId: cleaningId, jobs: p.body.jobs });
    expect(c.status).toBe(201);
    expect(c.body.jobs).toHaveLength(3);
    expect(c.body.incomeCreated).toBe(3);

    const again = await a.post('/api/import/commit').send({ sourceMessage: SAMPLE, incomeSourceId: cleaningId, jobs: p.body.jobs });
    expect(again.status).toBe(409);

    const p2 = await a.post(`/api/import/parse?today=${TODAY}`).send({ text: SAMPLE });
    expect(p2.body.alreadyImported).toBeTruthy();
    expect(p2.body.jobs[0].duplicateOfJobId).toBeTruthy();

    const clients = await a.get('/api/clients');
    expect(clients.body.total).toBe(3);
  });

  it('syncs linked income when a job changes, and invoices completed jobs', async () => {
    const jobs = (await a.get('/api/jobs')).body.items;
    const sonia = jobs.find((j: { clientName: string }) => j.clientName === 'Sonia');
    await a.patch(`/api/jobs/${sonia.id}`).send({ amount: 28 }).expect(200);
    const inc = (await a.get(`/api/income?jobId=${sonia.id}`)).body.items[0];
    expect(inc.amount).toBe(28);

    const done = await a.post('/api/jobs/complete-past?today=2026-10-05').send({});
    expect(done.body.updated).toBe(3);

    const cand = await a.get(`/api/invoices/candidates?from=2026-10-01&to=2026-10-31&incomeSourceId=${cleaningId}`);
    expect(cand.body.items).toHaveLength(3);
    expect(cand.body.total).toBe(88);

    const items = cand.body.items.map((j: { id: string; date: string; clientName: string; amount: number }) => ({ jobId: j.id, date: j.date, description: `Cleaning – ${j.clientName}`, quantity: 1, rate: j.amount }));
    const inv = await a.post('/api/invoices').send({ issueDate: '2026-10-05', dueDate: '2026-10-12', clientName: 'Agency', incomeSourceId: cleaningId, items });
    expect(inv.status).toBe(201);
    expect(inv.body.number).toBe('INV-2026-0001');
    expect(inv.body.total).toBe(88);

    const dupInv = await a.post('/api/invoices').send({ issueDate: '2026-10-05', dueDate: '2026-10-12', clientName: 'Agency', items });
    expect(dupInv.status).toBe(409);

    const pdf = await a.get(`/api/invoices/${inv.body.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1000);

    await a.post(`/api/invoices/${inv.body.id}/status`).send({ status: 'sent' }).expect(200);
    const overdue = await a.get('/api/invoices?status=overdue&today=2026-10-20');
    expect(overdue.body.items).toHaveLength(1);

    const paid = await a.post(`/api/invoices/${inv.body.id}/status?today=2026-10-20`).send({ status: 'paid', updateIncome: true });
    expect(paid.body.incomeUpdated).toBe(3);
    const paidIncome = await a.get('/api/income?status=paid');
    expect(paidIncome.body.total).toBe(3);

    const blocked = await a.delete(`/api/jobs/${sonia.id}`);
    expect(blocked.status).toBe(409);
  });

  it('bills, budget, dashboard and required income', async () => {
    const cats = (await a.get('/api/categories')).body.items;
    const insurance = cats.find((c: { name: string }) => c.name === 'Insurance');
    const bill = await a.post('/api/bills').send({ name: 'Car insurance', amount: 120, frequency: 'monthly', dueDate: '2026-09-15', categoryId: insurance.id });
    expect(bill.status).toBe(201);
    await a.post('/api/bills').send({ name: 'Phone', amount: 30, frequency: 'fortnightly', dueDate: '2026-10-03' }).expect(201);
    await a.put('/api/budget').send({ expectedVariableExpenses: 700, monthlySavingsTarget: 500, categoryBudgets: [{ categoryId: insurance.id, amount: 100 }] }).expect(200);

    const summary = (await a.get('/api/bills/summary')).body;
    expect(summary.monthlyBills).toBe(185); // 120 + 30*26/12
    expect(summary.minimumMonthlyIncome).toBe(1385);

    const pay = await a.post(`/api/bills/${bill.body.id}/pay`).send({ occurrence: '2026-10-15' });
    expect(pay.status).toBe(201);
    expect((await a.post(`/api/bills/${bill.body.id}/pay`).send({ occurrence: '2026-10-15' })).status).toBe(409);

    await a.post('/api/expenses').send({ date: '2026-10-02', amount: 23.5, categoryId: cats.find((c: { name: string }) => c.name === 'Fuel').id, merchant: 'Shell' }).expect(201);
    const bad = await a.post('/api/expenses').send({ date: '2026-13-40', amount: -5 });
    expect(bad.status).toBe(400);

    const d = (await a.get('/api/dashboard?from=2026-10-01&to=2026-10-31&today=2026-10-20')).body;
    expect(d.money.incomeReceived).toBe(88);
    expect(d.money.expenses).toBe(143.5);
    expect(d.work.jobsThisMonth).toBe(3);
    expect(d.work.avgPerJob).toBeCloseTo(29.33, 2);
    expect(d.required.minimumMonthlyIncome).toBe(1385);
    expect(d.charts.expenseByCategory.length).toBe(2);

    const alerts = (await a.get('/api/alerts?today=2026-10-20')).body.items;
    expect(alerts.some((x: { id: string }) => x.id.startsWith('budget-'))).toBe(true);
    const insights = (await a.get('/api/insights?today=2026-10-20')).body.items;
    expect(insights.find((i: { id: string }) => i.id === 'jobs-month').text).toContain('3 jobs');
  });

  it('search, calendar, reports, tasks, documents', async () => {
    const s = (await a.get('/api/search?q=andrew')).body.results;
    expect(s.some((r: { type: string }) => r.type === 'job')).toBe(true);
    expect(s.some((r: { type: string }) => r.type === 'income')).toBe(true);
    expect(s.some((r: { type: string }) => r.type === 'client')).toBe(true);

    await a.post('/api/tasks').send({ title: 'Study', date: '2026-10-01', startTime: '18:00', category: 'study', recurrence: { frequency: 'daily' } }).expect(201);
    const cal = (await a.get('/api/calendar?from=2026-10-01&to=2026-10-07')).body.items;
    expect(cal.filter((e: { type: string }) => e.type === 'task')).toHaveLength(7);
    expect(cal.filter((e: { type: string }) => e.type === 'job')).toHaveLength(3);

    const rep = (await a.get('/api/reports/work?from=2026-10-01&to=2026-10-31&groupBy=client')).body;
    expect(rep.rows).toHaveLength(3);
    const csv = await a.get('/api/reports/income?from=2026-10-01&to=2026-10-31&groupBy=month&format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Month,Records,Received,Expected,Total,Hours');

    const up = await a.post('/api/documents').field('meta', JSON.stringify({ kind: 'receipt', title: 'Fuel receipt' })).attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const exp = await a.post(`/api/documents/${up.body.id}/create-expense`).send({ date: '2026-10-03', amount: 50, merchant: 'BP' });
    expect(exp.status).toBe(201);
    const file = await a.get(`/api/documents/${up.body.id}/file`);
    expect(file.status).toBe(200);
  });

  it('isolates users', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Other', email: 'other@example.com', password: 'password123' }).expect(201);
    expect((await b.get('/api/jobs')).body.total).toBe(0);
    const jobs = (await a.get('/api/jobs')).body.items;
    expect((await b.get(`/api/jobs/${jobs[0].id}`)).status).toBe(404);
    expect((await b.patch(`/api/jobs/${jobs[0].id}`).send({ amount: 1 })).status).toBe(404);
    const cats = (await a.get('/api/categories')).body.items;
    expect((await b.post('/api/expenses').send({ date: '2026-10-01', amount: 5, categoryId: cats[0].id })).status).toBe(400);
  });

  it('subcontract work: income and invoices go to the contractor', async () => {
    const sources = (await a.get('/api/income-sources')).body.items;
    const freelance = sources.find((s: { name: string }) => s.name === 'Freelance');
    const msg = `Your schedule for Monday 12 Oct\nKim Lee 9am ($50)\n3 Main Rd Norwood SA 5067`;
    const p = await a.post('/api/import/parse?today=2026-10-01').send({ text: msg });
    expect(p.body.jobs).toHaveLength(1);
    const c = await a.post('/api/import/commit').send({ sourceMessage: msg, incomeSourceId: freelance.id, workType: 'subcontract', contractorName: 'Sparkle Co', jobs: p.body.jobs });
    expect(c.status).toBe(201);
    const job = c.body.jobs[0];
    expect(job.workType).toBe('subcontract');
    expect(job.contractorName).toBe('Sparkle Co');
    const contractors = (await a.get('/api/clients?type=contractor')).body.items;
    expect(contractors.map((x: { name: string }) => x.name)).toContain('Sparkle Co');
    const inc = (await a.get(`/api/income?jobId=${job.id}`)).body.items[0];
    expect(inc.clientName).toBe('Sparkle Co');
    expect(inc.description).toContain('Kim Lee');

    // Income source default: jobs created from this source inherit the contractor
    await a.patch(`/api/income-sources/${freelance.id}`).send({ workType: 'subcontract', contractorId: job.contractorId }).expect(200);
    const j2 = await a.post('/api/jobs').send({ date: '2026-10-13', clientName: 'Pat', amount: 40, incomeSourceId: freelance.id });
    expect(j2.body.workType).toBe('subcontract');
    expect(j2.body.contractorName).toBe('Sparkle Co');
    // switching a job to own business moves its income to the client
    await a.patch(`/api/jobs/${j2.body.id}`).send({ workType: 'own' }).expect(200);
    expect((await a.get(`/api/income?jobId=${j2.body.id}`)).body.items[0].clientName).toBe('Pat');

    const sub = await a.get(`/api/invoices/candidates?from=2026-10-01&to=2026-10-31&workType=subcontract&contractorId=${job.contractorId}&includeScheduled=true`);
    expect(sub.body.items.map((x: { id: string }) => x.id)).toEqual([job.id]);
    const own = await a.get('/api/invoices/candidates?from=2026-10-01&to=2026-10-31&workType=own&includeScheduled=true');
    expect(own.body.items.some((x: { id: string }) => x.id === job.id)).toBe(false);
  });

  it('invoice templates', async () => {
    const t = await a.post('/api/invoice-templates').send({ name: 'Weekly agency', billToType: 'contractor', clientName: 'Sparkle Co', items: [{ description: 'Cleaning', quantity: 1, rate: 100 }], paymentTermsDays: 14 });
    expect(t.status).toBe(201);
    expect((await a.post('/api/invoice-templates').send({ name: 'Weekly agency' })).status).toBe(409);
    const list = (await a.get('/api/invoice-templates')).body.items;
    expect(list).toHaveLength(1);
    await a.delete(`/api/invoice-templates/${t.body.id}`).expect(200);
  });

  it('reads a receipt photo locally and creates the expense on upload', async () => {
    const sharp = (await import('sharp')).default;
    const lines = ['BP MODBURY', 'TAX INVOICE', '28/09/2026 18:10', 'DIESEL           48.20', 'TOTAL           $48.20', 'GST INCLUDED      4.38', 'EFTPOS           48.20'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${lines.length * 42 + 50}"><rect width="100%" height="100%" fill="#fff"/>${lines.map((l, i) => `<text x="30" y="${50 + i * 42}" font-family="DejaVu Sans Mono, monospace" font-size="26">${l}</text>`).join('')}</svg>`;
    const jpg = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const scan = await a.post('/api/documents/scan?today=2026-10-01').attach('file', jpg, { filename: 'bp.jpg', contentType: 'image/jpeg' });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({ merchant: 'BP', categoryHint: 'Fuel', total: 48.2, gst: 4.38, date: '2026-09-28', paymentMethod: 'Card', source: 'ocr' });
    // Nothing saved by scanning
    expect((await a.get('/api/documents?q=bp.jpg')).body.items).toHaveLength(0);

    const cats = (await a.get('/api/categories')).body.items;
    const fuel = cats.find((c: { name: string }) => c.name === 'Fuel');
    const up = await a.post('/api/documents').field('meta', JSON.stringify({ kind: 'receipt', title: 'BP', createExpense: { date: '2026-09-28', amount: 48.2, merchant: 'BP', categoryId: fuel.id, paymentMethod: 'Card', gst: 4.38 } })).attach('file', jpg, { filename: 'bp.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    expect(up.body.expense).toMatchObject({ amount: 48.2, merchant: 'BP', receiptId: up.body.id });
    expect(up.body.expenseId).toBe(up.body.expense.id);
    const again = await a.post(`/api/documents/${up.body.id}/scan?today=2026-10-01`);
    expect(again.body.total).toBe(48.2);
    const bad = await a.post('/api/documents/scan').attach('file', Buffer.from('x'), { filename: 'x.heic', contentType: 'image/heic' });
    expect(bad.status).toBe(400);
  });

  it('reads iPhone HEIC photos and scanned PDFs', async () => {
    const fs = await import('node:fs');
    const heic = fs.readFileSync('tests/fixtures/receipt.heic');
    const scan = await a.post('/api/documents/scan?today=2026-10-01').attach('file', heic, { filename: 'IMG_0042.HEIC', contentType: 'image/heic' });
    expect(scan.body).toMatchObject({ merchant: 'Bunnings', total: 25.4, gst: 2.31, date: '2026-09-27', source: 'ocr' });
    // Stored as JPEG so any browser can display it (also when the browser sends a generic type)
    const up = await a.post('/api/documents').field('meta', JSON.stringify({ kind: 'receipt', title: 'Bunnings' })).attach('file', heic, { filename: 'IMG_0042.HEIC', contentType: 'application/octet-stream' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ mimeType: 'image/jpeg', originalName: 'IMG_0042.jpg' });
    const file = await a.get(`/api/documents/${up.body.id}/file`);
    expect(file.headers['content-type']).toBe('image/jpeg');

    const pdf = await a.post('/api/documents/scan?today=2026-10-01').attach('file', fs.readFileSync('tests/fixtures/scanned.pdf'), { filename: 'scan.pdf', contentType: 'application/pdf' });
    expect(pdf.body).toMatchObject({ merchant: 'Bunnings', total: 25.4, date: '2026-09-27', source: 'pdf-scan' });
  });

  it('repeating income creates the next entries by itself', async () => {
    const root = await a.post('/api/income?today=2026-10-01').send({ date: '2026-09-17', amount: 800, description: 'Fortnightly pay', status: 'paid', recurring: { enabled: true, frequency: 'fortnightly' } });
    expect(root.status).toBe(201);
    let kids = (await a.get(`/api/income?recurringParentId=${root.body.id}`)).body.items;
    // 1 Oct, 15 Oct, 29 Oct (within ~5 weeks of today); all expected, never auto-paid
    expect(kids.map((k: { date: string }) => k.date).sort()).toEqual(['2026-10-01', '2026-10-15', '2026-10-29']);
    expect(kids.every((k: { status: string; amount: number }) => k.status === 'expected' && k.amount === 800)).toBe(true);

    // A deleted entry is not re-created; time moving on adds only new ones
    const oct15 = kids.find((k: { date: string }) => k.date === '2026-10-15');
    await a.delete(`/api/income/${oct15.id}`).expect(200);
    await a.get('/api/dashboard?today=2026-10-20').expect(200);
    kids = (await a.get(`/api/income?recurringParentId=${root.body.id}`)).body.items;
    expect(kids.map((k: { date: string }) => k.date).sort()).toEqual(['2026-10-01', '2026-10-29', '2026-11-12']);

    // Changing the amount updates future expected entries only
    await a.patch(`/api/income/${root.body.id}?today=2026-10-20`).send({ amount: 850 }).expect(200);
    kids = (await a.get(`/api/income?recurringParentId=${root.body.id}`)).body.items;
    expect(kids.find((k: { date: string }) => k.date === '2026-10-01').amount).toBe(800);
    expect(kids.find((k: { date: string }) => k.date === '2026-10-29').amount).toBe(850);

    const stop = await a.post(`/api/income/${kids[0].id}/stop-recurring?today=2026-10-20`).send({});
    expect(stop.body.removed).toBe(2);
    await a.get('/api/dashboard?today=2026-12-20').expect(200);
    expect((await a.get(`/api/income?recurringParentId=${root.body.id}`)).body.total).toBe(1);
  });

  it('password reset flow', async () => {
    const r = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(r.status).toBe(200);
    const bad = await request(app).post('/api/auth/reset-password').send({ token: 'x'.repeat(64), password: 'newpassword1' });
    expect(bad.status).toBe(400);
  });
});

describe('reset everything', () => {
  it('deletes all of one account\'s data, keeps the login and leaves other accounts alone', async () => {
    const a = request.agent(app), b = request.agent(app);
    await a.post('/api/auth/register').send({ name: 'Reset Me', email: 'reset@example.com', password: 'password123' }).expect(201);
    await b.post('/api/auth/register').send({ name: 'Bystander', email: 'bystander@example.com', password: 'password123' }).expect(201);
    for (const x of [a, b]) {
      await x.post('/api/jobs').send({ date: '2026-10-02', clientName: 'Sonia', amount: 25 }).expect(201);
      await x.post('/api/expenses').send({ date: '2026-10-02', amount: 12.5, description: 'Lunch' }).expect(201);
      await x.post('/api/bills').send({ name: 'Rent', amount: 320, frequency: 'weekly', dueDate: '2026-10-05' }).expect(201);
      await x.patch('/api/settings').send({ notifications: { billReminderDays: 9 } }).expect(200);
    }
    const doc = await a.post('/api/documents').field('meta', JSON.stringify({ kind: 'receipt', title: 'Fuel', date: '2026-10-02' })).attach('file', Buffer.from('%PDF-1.4 receipt'), { filename: 'fuel.pdf', contentType: 'application/pdf' }).expect(201);

    // Needs the right password and the word DELETE
    await a.post('/api/auth/reset-data').send({ currentPassword: 'wrong-password', confirm: 'DELETE' }).expect(400);
    await a.post('/api/auth/reset-data').send({ currentPassword: 'password123', confirm: 'yes' }).expect(400);
    expect((await a.get('/api/jobs')).body.items).toHaveLength(1);

    const r = await a.post('/api/auth/reset-data').send({ currentPassword: 'password123', confirm: 'delete' }).expect(200);
    expect(r.body.deleted).toMatchObject({ Job: 1, Income: 1, Expense: 1, RecurringBill: 1, Document: 1 });
    for (const path of ['jobs', 'income', 'expenses', 'bills', 'clients', 'documents', 'tasks']) expect((await a.get(`/api/${path}`)).body.items, path).toHaveLength(0);
    await a.get(`/api/documents/${doc.body.id}/file`).expect(404);
    // Still signed in, with the starting categories and default settings back
    expect((await a.get('/api/auth/me')).body.user.email).toBe('reset@example.com');
    expect((await a.get('/api/categories')).body.items.length).toBeGreaterThan(5);
    expect((await a.get('/api/settings')).body.notifications.billReminderDays).not.toBe(9);

    // The other account is untouched
    expect((await b.get('/api/jobs')).body.items).toHaveLength(1);
    expect((await b.get('/api/expenses')).body.items).toHaveLength(1);
    expect((await b.get('/api/settings')).body.notifications.billReminderDays).toBe(9);
  });

  it('lets an invoice have no due date, and lets one be removed later', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Nodue', email: 'nodue@example.com', password: 'password123' }).expect(201);
    const items = [{ description: 'Cleaning', quantity: 1, rate: 80 }];
    const inv = (await b.post('/api/invoices').send({ issueDate: '2026-10-05', clientName: 'Agency', items, status: 'sent' }).expect(201)).body;
    expect(inv.dueDate).toBeUndefined();
    // Never overdue, however old it gets
    expect((await b.get(`/api/invoices/${inv.id}?today=2027-06-01`)).body.effectiveStatus).toBe('sent');
    expect((await b.get('/api/invoices?status=overdue&today=2027-06-01')).body.items).toHaveLength(0);
    expect((await b.get('/api/dashboard?today=2027-06-01')).status).toBe(200);
    const pdf = await b.get(`/api/invoices/${inv.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    // Add one, then take it away again
    let u = (await b.put(`/api/invoices/${inv.id}`).send({ issueDate: '2026-10-05', dueDate: '2026-10-12', clientName: 'Agency', items, status: 'sent' }).expect(200)).body;
    expect(u.dueDate).toBe('2026-10-12');
    expect((await b.get(`/api/invoices/${inv.id}?today=2026-10-20`)).body.effectiveStatus).toBe('overdue');
    u = (await b.put(`/api/invoices/${inv.id}`).send({ issueDate: '2026-10-05', dueDate: '', clientName: 'Agency', items, status: 'sent' }).expect(200)).body;
    expect(u.dueDate).toBeUndefined();
    expect((await b.get(`/api/invoices/${inv.id}?today=2026-10-20`)).body.effectiveStatus).toBe('sent');
    const copy = (await b.post(`/api/invoices/${inv.id}/duplicate`).expect(201)).body;
    expect(copy.dueDate).toBeUndefined();
  });

  it('marks several jobs completed or paid in one go', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Bulk', email: 'bulk@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-10' };
    const mk = async (extra: object) => (await b.post('/api/jobs').query(q).send({ date: '2026-10-08', startTime: '09:00', endTime: '11:00', clientName: 'Site', ...extra }).expect(201)).body;
    const j1 = await mk({ amount: 80 }), j2 = await mk({ amount: 60, amountEstimated: true }), j3 = await mk({}), j4 = await mk({ amount: 50, status: 'cancelled' }), future = await mk({ amount: 40, date: '2026-10-20' });
    const ids = [j1, j2, j3, j4, future].map((j) => j.id);

    let r = (await b.post('/api/jobs/bulk').query(q).send({ jobIds: ids, action: 'completed' }).expect(200)).body;
    expect(r).toMatchObject({ updated: 4, skipped: { cancelled: 1, noPay: 0 } });
    let jobs = (await b.get('/api/jobs?from=2026-10-01&to=2026-10-31').query(q)).body.items;
    expect(jobs.filter((j: any) => j.status === 'completed')).toHaveLength(4);
    // Completing does not mark anything as received
    expect((await b.get('/api/income?from=2026-10-01&to=2026-10-31').query(q)).body.items.filter((i: any) => i.status === 'paid')).toHaveLength(0);

    r = (await b.post('/api/jobs/bulk').query(q).send({ jobIds: ids, action: 'paid' }).expect(200)).body;
    expect(r).toMatchObject({ updated: 3, skipped: { cancelled: 1, noPay: 1 } });
    const income = (await b.get('/api/income?from=2026-10-01&to=2026-10-31').query(q)).body.items;
    expect(income.filter((i: any) => i.status === 'paid').map((i: any) => i.amount).sort()).toEqual([40, 60, 80]);
    expect(income.find((i: any) => i.amount === 80).paidDate).toBe('2026-10-10');
    jobs = (await b.get('/api/jobs?from=2026-10-01&to=2026-10-31').query(q)).body.items;
    expect(jobs.find((j: any) => j.id === j2.id).amountEstimated).toBe(false); // paid at the expected amount → it is the real figure now
    // Doing it again changes nothing
    r = (await b.post('/api/jobs/bulk').query(q).send({ jobIds: ids, action: 'paid' }).expect(200)).body;
    expect(r.updated).toBe(0);
    await b.post('/api/jobs/bulk').query(q).send({ jobIds: [], action: 'paid' }).expect(400);
  });

  it('gives the dashboard a weekly income requirement and this week\'s progress', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Weekly', email: 'weekly@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-07' }; // Wednesday; the week is Mon 5 – Sun 11 Oct
    await b.put('/api/budget').query(q).send({ expectedVariableExpenses: 2600 }).expect(200);
    await b.post('/api/income').query(q).send({ date: '2026-10-06', amount: 200, status: 'paid' }).expect(201);
    await b.post('/api/income').query(q).send({ date: '2026-10-10', amount: 150, status: 'expected' }).expect(201);
    await b.post('/api/income').query(q).send({ date: '2026-10-02', amount: 999, status: 'paid' }).expect(201); // last week
    await b.post('/api/expenses').query(q).send({ date: '2026-10-06', amount: 45, description: 'Fuel' }).expect(201);
    const d = (await b.get('/api/dashboard?from=2026-10-01&to=2026-10-31').query(q).expect(200)).body;
    expect(d.week).toMatchObject({ from: '2026-10-05', to: '2026-10-11', requiredIncome: 600, incomeReceived: 200, incomeIncludingExpected: 350, shortfall: 250, expenses: 45, changeFromPrevious: -649 });
    expect(d.week.previous).toEqual({ from: '2026-09-28', to: '2026-10-04', income: 999 });
  });

  it('marks several income records paid with the real amounts, or deletes them, in one go', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Payday', email: 'payday@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-10' };
    // Three shifts with expected pay: 3 h, 3 h and 6.5 paid hours
    const mk = async (date: string, startTime: string, endTime: string, hoursWorked: number) =>
      (await b.post('/api/jobs').query(q).send({ date, startTime, endTime, hoursWorked, clientName: 'Factory', workType: 'employee', amount: hoursWorked * 30, amountEstimated: true }).expect(201)).body;
    const jobs = [await mk('2026-10-05', '22:00', '01:00', 3), await mk('2026-10-06', '22:00', '01:00', 3), await mk('2026-10-08', '00:00', '07:00', 6.5)];
    const list = async () => (await b.get('/api/income?from=2026-10-01&to=2026-10-31').query(q)).body.items as any[];
    let inc = (await list()).sort((x, y) => x.date.localeCompare(y.date));
    expect(inc.map((i) => i.amount)).toEqual([90, 90, 195]);
    const ids = inc.map((i) => i.id);

    // Looking first changes nothing, and says these are estimates
    const look = (await b.post('/api/income/bulk-pay').query(q).send({ ids, mode: 'total', total: 400, dryRun: true }).expect(200)).body;
    expect(look).toMatchObject({ saved: false, split: 'hours', perHour: 32, total: 400, currentTotal: 375, count: 3 });
    expect(look.rows.map((r: any) => r.amount)).toEqual([96, 96, 208]);
    expect(look.rows.every((r: any) => r.estimated)).toBe(true);
    expect((await list()).every((i) => i.status === 'expected')).toBe(true);

    // One total, shared by hours: $400 over 12.5 h = $32/h
    const r = (await b.post('/api/income/bulk-pay').query(q).send({ ids, mode: 'total', total: 400 }).expect(200)).body;
    expect(r).toMatchObject({ saved: true, total: 400 });
    inc = (await list()).sort((x, y) => x.date.localeCompare(y.date));
    expect(inc.map((i) => [i.amount, i.status, i.paidDate])).toEqual([[96, 'paid', '2026-10-10'], [96, 'paid', '2026-10-10'], [208, 'paid', '2026-10-10']]);
    const js = (await b.get('/api/jobs?from=2026-10-01&to=2026-10-31').query(q)).body.items.sort((x: any, y: any) => x.date.localeCompare(y.date));
    expect(js.map((j: any) => [j.amount, j.amountEstimated, j.status])).toEqual([[96, false, 'completed'], [96, false, 'completed'], [208, false, 'completed']]);

    // An amount for each record
    await b.post('/api/income/bulk-pay').query(q).send({ ids: ids.slice(0, 2), mode: 'each', amounts: [{ id: ids[0], amount: 100 }, { id: ids[1], amount: 91.5 }] }).expect(200);
    inc = (await list()).sort((x, y) => x.date.localeCompare(y.date));
    expect(inc.map((i) => i.amount)).toEqual([100, 91.5, 208]);
    // Records with no hours are shared equally; cancelled ones are left out
    const a1 = (await b.post('/api/income').query(q).send({ date: '2026-10-09', amount: 10, status: 'expected', description: 'Tip' }).expect(201)).body;
    const a2 = (await b.post('/api/income').query(q).send({ date: '2026-10-09', amount: 10, status: 'expected', description: 'Gift' }).expect(201)).body;
    const a3 = (await b.post('/api/income').query(q).send({ date: '2026-10-09', amount: 10, status: 'cancelled', description: 'Gone' }).expect(201)).body;
    const eq = (await b.post('/api/income/bulk-pay').query(q).send({ ids: [a1.id, a2.id, a3.id], mode: 'total', total: 25.01 }).expect(200)).body;
    expect(eq).toMatchObject({ split: 'equal', perHour: null, skipped: { cancelled: 1 } });
    expect(eq.rows.map((x: any) => x.amount)).toEqual([12.5, 12.51]);
    // Keeping the amounts
    const a4 = (await b.post('/api/income').query(q).send({ date: '2026-10-09', amount: 70, status: 'pending', description: 'Refund' }).expect(201)).body;
    await b.post('/api/income/bulk-pay').query(q).send({ ids: [a4.id], paidDate: '2026-10-09' }).expect(200);
    expect((await b.get(`/api/income/${a4.id}`).query(q)).body).toMatchObject({ amount: 70, status: 'paid', paidDate: '2026-10-09' });
    await b.post('/api/income/bulk-pay').query(q).send({ ids: [a3.id] }).expect(400);
    await b.post('/api/income/bulk-pay').query(q).send({ ids: [a1.id], mode: 'total' }).expect(400);

    // Deleting several: the jobs stay
    const del = (await b.post('/api/income/bulk-delete').query(q).send({ ids: [ids[0], a1.id, a3.id] }).expect(200)).body;
    expect(del.deleted).toBe(3);
    expect(await list()).toHaveLength(4);
    expect((await b.get('/api/jobs?from=2026-10-01&to=2026-10-31').query(q)).body.items).toHaveLength(3);
    void jobs;
  });

  it('marks the jobs on an invoice, and their income, paid when the invoice is paid', async () => {
    const b = request.agent(app);
    await b.post('/api/auth/register').send({ name: 'Invoicer', email: 'invoicer@example.com', password: 'password123' }).expect(201);
    const q = { today: '2026-10-10' };
    const mk = async (extra: object) => (await b.post('/api/jobs').query(q).send({ date: '2026-10-06', startTime: '09:00', endTime: '10:00', clientName: 'Site', ...extra }).expect(201)).body;
    const j1 = await mk({ amount: 40 }), j2 = await mk({ amount: 30, amountEstimated: true }), j3 = await mk({}), later = await mk({ amount: 50, date: '2026-10-15' });
    // j2 is billed at $35 (not its $30 estimate) and j3, which had no pay at all, at $25
    const items = [{ description: 'A', quantity: 1, rate: 40, jobId: j1.id }, { description: 'B', quantity: 1, rate: 35, jobId: j2.id }, { description: 'C', quantity: 1, rate: 25, jobId: j3.id }, { description: 'D', quantity: 1, rate: 50, jobId: later.id }, { description: 'Supplies', quantity: 1, rate: 10 }];
    const inv = (await b.post('/api/invoices').query(q).send({ issueDate: '2026-10-08', clientName: 'Agency', items, status: 'sent' }).expect(201)).body;
    const incomeOf = async () => (await b.get('/api/income?from=2026-10-01&to=2026-10-31').query(q)).body.items as any[];
    expect((await incomeOf()).filter((i) => i.status === 'paid')).toHaveLength(0);

    const r = (await b.post(`/api/invoices/${inv.id}/status`).query(q).send({ status: 'paid' }).expect(200)).body;
    expect(r).toMatchObject({ incomeUpdated: 4, jobsUpdated: 3 }); // the future job itself needs no change
    const inc = await incomeOf();
    expect(inc.filter((i) => i.status === 'paid').map((i) => i.amount).sort((x, y) => x - y)).toEqual([25, 35, 40, 50]);
    expect(inc.every((i) => i.paidDate === '2026-10-10' && i.invoiceNumber === inv.number)).toBe(true);
    const jobs = (await b.get('/api/jobs?from=2026-10-01&to=2026-10-31').query(q)).body.items as any[];
    const byId = (id: string) => jobs.find((j) => j.id === id);
    expect([byId(j1.id), byId(j2.id), byId(j3.id)].map((j) => [j.amount, j.amountEstimated, j.status])).toEqual([[40, false, 'completed'], [35, false, 'completed'], [25, false, 'completed']]);
    expect(byId(later.id)).toMatchObject({ amount: 50, status: 'scheduled' }); // not worked yet, but paid

    // Paying again changes nothing; un-paying puts the income back to waiting
    expect((await b.post(`/api/invoices/${inv.id}/status`).query(q).send({ status: 'paid' }).expect(200)).body).toMatchObject({ incomeUpdated: 0, jobsUpdated: 0 });
    await b.post(`/api/invoices/${inv.id}/status`).query(q).send({ status: 'sent' }).expect(200);
    expect((await incomeOf()).every((i) => i.status === 'pending')).toBe(true);

    // An invoice saved as paid from the start does the same
    const j5 = await mk({ amount: 20 });
    await b.post('/api/invoices').query(q).send({ issueDate: '2026-10-09', clientName: 'Agency', items: [{ description: 'E', quantity: 1, rate: 20, jobId: j5.id }], status: 'paid' }).expect(201);
    expect((await incomeOf()).find((i) => i.jobId === j5.id)).toMatchObject({ status: 'paid', amount: 20 });
  });
});
