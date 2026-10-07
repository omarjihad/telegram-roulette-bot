import app from "./app";
import { logger } from "./roulette/config/logger";
import { env } from "./roulette/config/env";
import { connectDatabase, disconnectDatabase } from "./roulette/config/database";
import { createBot } from "./roulette/bot";
import { startExpirationWorker } from "./roulette/workers/expiration.worker";
import { initializeDeliveryAccount, shutdownDeliveryAccount } from "./roulette/services/deliveryAccount.service";
import { attachBattleOnline, BattleRoom } from "./roulette/battle/online";
import { battleIdentity } from "./roulette/services/battle.service";
import { reportLeaders, startTournamentWorker } from "./roulette/services/battleAdmin.service";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, '0.0.0.0', () => {
  logger.info({ port }, "Server listening");
});

// MF Battle online room (WebSocket on the same server, /api/battle/ws).
// It also reports who leads (for tournaments) the same way the Cloudflare game server does.
const battleOnline = attachBattleOnline(
  server,
  battleIdentity,
  new BattleRoom({
    log: (msg, err) => logger.warn({ err }, msg),
    report: (data) => reportLeaders({ ...data, room: "railway" }),
  }),
);

const active = env.GAMEPLAY_ENABLED && env.OWNER_ID > 0;
const bot = createBot(active && env.BOT_POLLING_ENABLED);
// getMe is read-only. No polling, webhook deletion, menu updates or messages in preview.
void bot.getMe().then((me) => {
  env.BOT_USERNAME = me.username ?? env.BOT_USERNAME;
  logger.info('Telegram credentials verified');
}).catch(() => logger.warn('Telegram verification failed; check BOT_TOKEN'));

void connectDatabase().then(() => {
  if (active && env.BACKGROUND_JOBS_ENABLED) startExpirationWorker();
  // MF Battle tournaments end on time (winner picked, developers and winner told).
  if (active) startTournamentWorker();
  if (active) void initializeDeliveryAccount();
  logger.info({ previewOnly: !active }, 'Roulette service ready; existing data preserved');
}).catch(() => {
  logger.error('Database unavailable. Check MongoDB network access and credentials. No data was changed.');
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  setTimeout(() => process.exit(1), 10000).unref();
  battleOnline.close();
  await bot.stopPolling().catch(() => undefined);
  // Before the database closes: frees the delivery account for the new server right away.
  await shutdownDeliveryAccount().catch(() => undefined);
  await disconnectDatabase();
  server.close(() => process.exit(0));
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
