import { Container, getContainer } from '@cloudflare/containers';

/**
 * Settings the bot reads from its environment. Add them in the Cloudflare dashboard:
 * Workers & Pages -> mf-roulette-bot -> Settings -> Variables and Secrets (type: Secret).
 */
const PASSED_TO_BOT = [
  'BOT_TOKEN',
  'MONGODB_URI',
  'SESSION_SECRET',
  'OWNER_ID',
  'MINI_APP_URL',
  'BOT_USERNAME',
  'MINI_APP_SHORT_NAME',
  'GAMEPLAY_ENABLED',
  'BOT_POLLING_ENABLED',
  'BACKGROUND_JOBS_ENABLED',
  'ADSGRAM_REWARD_KEY',
  'DELIVERY_API_ID',
  'DELIVERY_API_HASH',
  'SUPPORT_USERNAME',
  'DELIVERY_CONTACT_USERNAME',
  'ESCALATION_GROUP_USERNAME',
] as const;
const REQUIRED = ['BOT_TOKEN', 'MONGODB_URI', 'SESSION_SECRET', 'OWNER_ID'] as const;

type BotEnv = Env & Partial<Record<(typeof PASSED_TO_BOT)[number], string>>;

const PORT = 8080;

function botEnvVars(env: BotEnv): Record<string, string> {
  const vars: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: String(PORT),
    BASE_PATH: '/',
    CLIENT_DIST_DIR: '/app/artifacts/bounty-roulette/dist/public',
  };
  for (const key of PASSED_TO_BOT) {
    const value = env[key];
    if (typeof value === 'string' && value !== '') vars[key] = value.trim();
  }
  return vars;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The bot itself: the repository's Docker image, kept running all the time. It polls
 * Telegram, runs the background jobs and keeps the delivery account connected, so it must
 * never be put to sleep for being "idle".
 */
export class BotContainer extends Container<BotEnv> {
  defaultPort = PORT;
  sleepAfter = '24h';
  pingEndpoint = 'localhost/api/healthz';

  constructor(ctx: DurableObjectState<{}>, env: BotEnv) {
    super(ctx, env);
    this.envVars = botEnvVars(env);
  }

  // Never stop for inactivity: returning without stopping renews the activity timer.
  override async onActivityExpired() {}

  override onStart() {
    console.log('bot container started');
  }

  override onStop(params: unknown) {
    console.log('bot container stopped', JSON.stringify(params));
  }

  override onError(error: unknown) {
    console.error('bot container error', error);
    throw error;
  }

  /**
   * Starts the bot if it isn't running. When the settings changed since it was started
   * (a secret was added or edited), it is restarted so it picks them up.
   */
  async ensureRunning(): Promise<string> {
    const wanted = await sha256(JSON.stringify(this.envVars));
    const started = await this.ctx.storage.get<string>('envHash');
    const state = await this.getState();
    const up = state.status === 'running' || state.status === 'healthy';
    if (up && started && started !== wanted) {
      await this.stop('SIGTERM');
      for (let i = 0; i < 30; i++) {
        const s = await this.getState();
        if (s.status !== 'running' && s.status !== 'healthy' && s.status !== 'stopping') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!up || started !== wanted) {
      await this.startAndWaitForPorts({ ports: PORT, cancellationOptions: { portReadyTimeoutMS: 120_000 } });
      await this.ctx.storage.put('envHash', wanted);
      return 'started';
    }
    return 'running';
  }
}

function missingSettings(env: BotEnv) {
  return REQUIRED.filter((k) => !env[k]);
}

function setupPage(missing: string[]) {
  const list = missing.map((k) => `<li><code>${k}</code></li>`).join('');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
      `<body style="font-family:system-ui;background:#0f172a;color:#fff;padding:24px;direction:rtl">` +
      `<h2>⚙️ البوت يحتاج إعدادات</h2><p>ضيف هذني من Cloudflare: Settings ← Variables and Secrets:</p><ul>${list}</ul></body>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export default {
  /** Every request (Mini App, API, Adsgram reward URL) goes to the one bot container. */
  async fetch(request: Request, env: BotEnv): Promise<Response> {
    const missing = missingSettings(env);
    if (missing.length) return setupPage(missing);

    // The app rate-limits by IP and trusts one proxy hop: hand it the visitor's real IP.
    const headers = new Headers(request.headers);
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    headers.set('x-forwarded-proto', 'https');
    const forwarded = new Request(request, { headers });

    try {
      return await getContainer(env.BOT).fetch(forwarded);
    } catch (err) {
      console.error('container fetch failed', err);
      return new Response('البوت يشتغل الآن، حاول بعد دقيقة… / The bot is starting, try again in a minute…', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30' },
      });
    }
  },

  /** Cron: keep the bot running even when nobody opens the Mini App. */
  async scheduled(_event: ScheduledController, env: BotEnv, ctx: ExecutionContext): Promise<void> {
    if (missingSettings(env).length) return;
    const bot = getContainer(env.BOT) as unknown as DurableObjectStub<BotContainer>;
    ctx.waitUntil(
      bot.ensureRunning().then(
        (r) => console.log('cron:', r),
        (err) => console.error('cron: could not start the bot', err)
      )
    );
  },
} satisfies ExportedHandler<BotEnv>;
