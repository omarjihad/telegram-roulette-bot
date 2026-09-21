import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  OWNER_ID: z.coerce.number().int().nonnegative().default(0),
  SESSION_SECRET: z
    .string()
    .min(1, 'SESSION_SECRET is required in production')
    .default(process.env.NODE_ENV === 'production' ? '' : 'development-only-session-secret'),
  // The account session is entered in the admin UI and encrypted into MongoDB. These are
  // only the Telegram application credentials from my.telegram.org.
  DELIVERY_API_ID: z.coerce.number().int().nonnegative().default(0),
  DELIVERY_API_HASH: z.string().optional().default(''),
  // Explicit cutover switches: importing a live bot must not start a second consumer
  // or mutate its existing database just because the preview is opened.
  GAMEPLAY_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  BOT_POLLING_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  BACKGROUND_JOBS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Left empty until the first deploy is up and you know the public URL (Render/etc),
  // then filled in and the service restarted. Must be empty OR a real https:// URL.
  MINI_APP_URL: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || /^https:\/\//.test(v), { message: 'MINI_APP_URL must be empty or start with https://' }),
  SUPPORT_USERNAME: z.string().optional().default('support'),
  // Who the user is told to DM once their withdrawal is approved.
  DELIVERY_CONTACT_USERNAME: z.string().optional().default('kk66kk6'),
  // The group to mention the delivery contact in if they take too long to respond.
  ESCALATION_GROUP_USERNAME: z.string().optional().default('CHJROB'),
  // Legacy configuration only; Telegram initData is authenticated with BOT_TOKEN.
  WEBAPP_SECRET: z.string().optional(),
  BOT_USERNAME: z.string().optional().default(''),
  // Optional: the Mini App's short name as registered in @BotFather (e.g. "app" for
  // t.me/YourBot/app). When set, referral links open straight into the Mini App instead of
  // the bot's chat first. Leave empty to keep the current ?start= link format.
  MINI_APP_SHORT_NAME: z.string().optional().default(''),
  // Absolute path to the Vite output when the API also serves the Mini App (Render/Docker).
  CLIENT_DIST_DIR: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
