import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  /** Public address of the app. On Render this is filled in automatically from RENDER_EXTERNAL_URL. */
  CLIENT_URL: z.string().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'),
  /** Sign-in cookie only over https. Defaults to on in production; set to "false" to run the production build on plain http (e.g. Docker on localhost). */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('Personal Tracker <no-reply@example.com>'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  /** Optional key for encrypting stored Google tokens; defaults to a key derived from JWT_SECRET */
  TOKEN_ENCRYPTION_KEY: z.string().optional().default(''),
  /** Distance & travel: free OpenStreetMap services by default; set ORS_API_KEY to use OpenRouteService instead */
  NOMINATIM_URL: z.string().optional().default('https://nominatim.openstreetmap.org'),
  OSRM_URL: z.string().optional().default('https://router.project-osrm.org'),
  ORS_API_KEY: z.string().optional().default(''),
  /** Web push keys (optional — generated and stored in the database automatically when empty) */
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
