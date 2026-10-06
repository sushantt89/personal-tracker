import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import importRoutes from './routes/import.js';
import invoiceRoutes from './routes/invoices.js';
import analyticsRoutes from './routes/analytics.js';
import documentRoutes from './routes/documents.js';
import settingsRoutes from './routes/settings.js';
import assistantRoutes from './routes/assistant.js';
import newsRoutes from './routes/news.js';
import { workHours } from './services/workHours.js';
import { userCtx } from './utils/userCtx.js';
import googleRoutes from './routes/google.js';
import travelRoutes from './routes/travel.js';
import notificationRoutes from './routes/notifications.js';
import {
  categoriesRouter, incomeSourcesRouter, clientsRouter, jobsRouter, incomeRouter, expensesRouter, billsRouter, tasksRouter, invoiceTemplatesRouter,
} from './routes/resources.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.CLIENT_URL.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  // Google OAuth (callback is public and verified by a signed state; other routes require auth)
  app.use('/api/integrations/google', googleRoutes);

  // Everything below requires an authenticated user; every query is scoped by userId.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/categories', categoriesRouter);
  api.use('/income-sources', incomeSourcesRouter);
  api.use('/clients', clientsRouter);
  api.use('/jobs', jobsRouter);
  api.use('/income', incomeRouter);
  api.use('/expenses', expensesRouter);
  api.use('/bills', billsRouter);
  api.use('/tasks', tasksRouter);
  api.use('/invoice-templates', invoiceTemplatesRouter);
  api.use('/invoices', invoiceRoutes);
  api.use('/import', importRoutes);
  api.use('/documents', documentRoutes);
  api.use('/travel', travelRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/assistant', assistantRoutes);
  api.use('/news', newsRoutes);
  api.get('/work-hours', async (req, res) => { res.json(await workHours(req.userId!, (await userCtx(req)).today)); });
  api.use('/', analyticsRoutes);
  api.use('/', settingsRoutes);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // In production, serve the built React app from the same origin (one free web service).
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (isProd && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
