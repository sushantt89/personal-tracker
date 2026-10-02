import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';

async function main() {
  await connectDb(env.MONGODB_URI);
  const app = createApp();
  app.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));
  // Background work: repeating income, email/phone reminders, changes from Google Calendar
  startScheduler();
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
