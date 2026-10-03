import crypto from 'node:crypto';
import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { NewMessage } from 'telegram/events';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { DeliveryAccount } from '../models/DeliveryAccount';
import { User } from '../models/User';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
import { handleDeliveryCommand } from './deliveryCommand.service';
import { t } from '../i18n';

const LOGIN_TTL_MS = 10 * 60 * 1000;
const pendingLogins = new Map<
  number,
  {
    client: TelegramClient;
    phone: string;
    phoneCodeHash: string;
    isCodeViaApp: boolean;
    expiresAt: number;
    passwordRequired?: boolean;
    passwordHint?: string | null;
  }
>();
let activeClient: TelegramClient | null = null;
let activeAccountId: number | null = null;

function credentials() {
  if (!env.DELIVERY_API_ID || !env.DELIVERY_API_HASH) {
    throw new AppError('إعدادات Telegram للحساب المستخدم غير مكتملة على السيرفر.', 503, 'DELIVERY_API_NOT_CONFIGURED');
  }
  return { apiId: env.DELIVERY_API_ID, apiHash: env.DELIVERY_API_HASH };
}

function encryptionKey() {
  return crypto.createHash('sha256').update(env.SESSION_SECRET).digest();
}

function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(value: string): string {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted delivery session');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

function maskPhone(phone: string): string {
  const clean = phone.replace(/[^\d+]/g, '');
  if (clean.length < 5) return '••••';
  return `${clean.slice(0, 3)}••••${clean.slice(-2)}`;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const candidate = err as { errorMessage?: string; message?: string };
    return candidate.errorMessage || candidate.message || '';
  }
  return String(err);
}

function isPasswordRequired(err: unknown) {
  return errorMessage(err).includes('SESSION_PASSWORD_NEEDED');
}

async function closeClient(client: TelegramClient | null) {
  if (!client) return;
  await client.disconnect().catch(() => undefined);
}

function attachDeliveryCommandListener(client: TelegramClient) {
  client.addEventHandler(
    async (event) => {
      const text = event.message.message;
      if (!text || !/^[/.](?:فحص|تم|كشف|الاوامر)(?:@\w+)?(?:\s|$)/u.test(text.trim())) return;
      const chatId = event.chatId;
      if (chatId === undefined || chatId === null) return;
      try {
        const response = await handleDeliveryCommand(
          String(text),
          String(chatId),
          Boolean(event.isPrivate),
          activeAccountId ?? 0,
        );
        if (response) await client.sendMessage(chatId, { message: response });
      } catch (err) {
        logger.error({ err, command: text }, 'delivery account command failed');
        await client
          .sendMessage(chatId, { message: `⚠️ ${err instanceof Error ? err.message : 'صار خطأ، حاول مرة ثانية.'}` })
          .catch((sendErr) => logger.warn({ err: sendErr }, 'failed to send delivery command error'));
      }
    },
    new NewMessage({ outgoing: true }),
  );
}

/** People added to the delivery account's contacts since the last start (avoids repeat calls). */
const addedContacts = new Set<number>();
let syncRunning = false;

function floodWaitSeconds(err: unknown) {
  const m = errorMessage(err).match(/FLOOD_WAIT_(\d+)|A wait of (\d+) seconds/);
  return m ? Number(m[1] ?? m[2]) : 0;
}

type TgUser = Api.User;

/**
 * Adds a Telegram user to the delivery account's contacts. Needs a user object that
 * carries its access hash: one that messaged the account, resolved from a @username, or
 * already known to the session. Returns what happened, never throws.
 */
async function addUserAsContact(client: TelegramClient, user: TgUser, fallbackName?: string | null) {
  const id = Number(user.id.toString());
  if (user.bot || user.self || user.deleted) return 'skipped' as const;
  if (user.contact || addedContacts.has(id)) {
    addedContacts.add(id);
    return 'already' as const;
  }
  const firstName = (user.firstName || fallbackName || user.username || `MF ${id}`).slice(0, 64);
  try {
    await client.invoke(
      new Api.contacts.AddContact({
        id: await client.getInputEntity(user),
        firstName,
        lastName: (user.lastName || '').slice(0, 64),
        phone: '',
        addPhonePrivacyException: false,
      })
    );
    addedContacts.add(id);
    logger.info({ telegramId: id }, 'delivery account added a contact');
    return 'added' as const;
  } catch (err) {
    logger.warn({ err: errorMessage(err), telegramId: id }, 'delivery account could not add contact');
    if (floodWaitSeconds(err)) return 'flood' as const;
    return 'failed' as const;
  }
}

/** Finds a user the delivery account can address: by @username, or from its own cache. */
async function resolveTelegramUser(client: TelegramClient, telegramId: number, username?: string | null) {
  const clean = username?.trim().replace(/^@/, '');
  if (clean) {
    try {
      const resolved = await client.invoke(new Api.contacts.ResolveUsername({ username: clean }));
      const match = resolved.users?.find((u) => Number(u.id.toString()) === telegramId) ?? resolved.users?.[0];
      if (match instanceof Api.User) return match;
    } catch (err) {
      logger.info({ err: errorMessage(err), telegramId }, 'delivery account could not resolve username');
    }
  }
  try {
    const entity = await client.getEntity(telegramId);
    if (entity instanceof Api.User) return entity;
  } catch {
    // Not in the session's cache (no @username and never talked to the account).
  }
  return null;
}

/**
 * Adds a bot user to the delivery account's contacts (used when they verify, when their
 * withdrawal is approved, and from the admin panel). Best effort: never throws.
 */
export async function addDeliveryContact(telegramId: number) {
  const client = await ensureDeliveryClient();
  if (!client) return 'offline' as const;
  if (addedContacts.has(telegramId)) return 'already' as const;
  const dbUser = await User.findOne({ telegramId }).select('username firstName').lean();
  const tgUser = await resolveTelegramUser(client, telegramId, dbUser?.username);
  if (!tgUser) return 'unresolvable' as const;
  return addUserAsContact(client, tgUser, dbUser?.firstName);
}

/** Anyone who writes to the delivery account in private is added to its contacts. */
function attachAutoContactListener(client: TelegramClient) {
  client.addEventHandler(async (event) => {
    if (!event.isPrivate) return;
    try {
      const sender = await event.message.getSender();
      if (sender instanceof Api.User) await addUserAsContact(client, sender);
    } catch (err) {
      logger.warn({ err: errorMessage(err) }, 'auto-contact from incoming message failed');
    }
  }, new NewMessage({ incoming: true }));
}

/**
 * Goes through the account's private chats and adds everyone who isn't a contact yet
 * (people who wrote before this feature existed). Slow on purpose to stay clear of
 * Telegram's flood limits; stops at the first flood wait.
 */
export async function syncDeliveryContacts(limit = 300) {
  const client = await ensureDeliveryClient();
  if (!client) throw new AppError('حساب التسليم غير متصل حالياً.', 503, 'DELIVERY_ACCOUNT_OFFLINE');
  if (syncRunning) return { added: 0, already: 0, failed: 0, stoppedByFlood: false, running: true };
  syncRunning = true;
  const result = { added: 0, already: 0, failed: 0, stoppedByFlood: false, running: false };
  try {
    for await (const dialog of client.iterDialogs({ limit })) {
      const entity = dialog.entity;
      if (!(entity instanceof Api.User) || entity.bot || entity.self || entity.deleted) continue;
      const r = await addUserAsContact(client, entity);
      if (r === 'added') {
        result.added += 1;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } else if (r === 'already') result.already += 1;
      else if (r === 'flood') {
        result.stoppedByFlood = true;
        break;
      } else if (r === 'failed') result.failed += 1;
    }
  } finally {
    syncRunning = false;
  }
  logger.info(result, 'delivery contacts sync finished');
  return result;
}

function onConnected(client: TelegramClient) {
  attachDeliveryCommandListener(client);
  attachAutoContactListener(client);
  // Catch up on people who wrote while the account wasn't adding contacts.
  setTimeout(() => {
    if (activeClient === client) void syncDeliveryContacts().catch((err) => logger.warn({ err: errorMessage(err) }, 'delivery contacts sync failed'));
  }, 30_000);
}

async function persistAndActivate(client: TelegramClient, phone: string) {
  const me = await client.getMe();
  const telegramId = Number(me.id.toString());
  const username = 'username' in me && me.username ? String(me.username) : null;
  const firstName = 'firstName' in me && me.firstName ? String(me.firstName) : null;
  const session = (client.session as StringSession).save();
  await DeliveryAccount.findOneAndUpdate(
    { singleton: 'main' },
    {
      singleton: 'main',
      telegramId,
      username,
      firstName,
      phoneMasked: maskPhone(phone),
      encryptedSession: encrypt(session),
      isActive: true,
      lastConnectedAt: new Date(),
      // A fresh login: this instance holds the connection.
      leaseOwner: INSTANCE_ID,
      leaseUntil: new Date(Date.now() + LEASE_MS),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await closeClient(activeClient);
  activeClient = client;
  activeAccountId = telegramId;
  lastConnectError = null;
  onConnected(client);
  startLeaseRenewal();
  return { telegramId, username, firstName, phoneMasked: maskPhone(phone) };
}

/** Why the last connection attempt failed (shown in the developer panel). */
let lastConnectError: string | null = null;
let connecting: Promise<boolean> | null = null;
let shuttingDown = false;

function isConnected(client: TelegramClient | null) {
  return Boolean(client && (client as unknown as { connected?: boolean }).connected !== false);
}

/** Telegram killed the saved session; only a fresh login fixes it, so retrying is pointless. */
function isDeadSession(message: string | null) {
  return Boolean(message && /AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED|SESSION_EXPIRED/.test(message));
}

// ---- One connection at a time, across server instances ----------------------------------
// Railway starts the new server before stopping the old one. If both connect with the same
// session, Telegram revokes it (AUTH_KEY_DUPLICATED) and the account has to log in again.
// A short lease in the database lets only one instance connect; it is renewed while
// connected and released on shutdown, so the next instance takes over within seconds.
const INSTANCE_ID = `${process.env.RAILWAY_DEPLOYMENT_ID ?? 'local'}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
const LEASE_MS = 90_000;
const LEASE_RENEW_MS = 30_000;
let leaseTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;

async function acquireLease() {
  const now = new Date();
  const res = await DeliveryAccount.updateOne(
    {
      singleton: 'main',
      isActive: true,
      $or: [{ leaseOwner: null }, { leaseOwner: INSTANCE_ID }, { leaseUntil: null }, { leaseUntil: { $lte: now } }],
    },
    { $set: { leaseOwner: INSTANCE_ID, leaseUntil: new Date(now.getTime() + LEASE_MS) } }
  );
  return res.modifiedCount > 0 || res.matchedCount > 0;
}

async function releaseLease() {
  await DeliveryAccount.updateOne({ singleton: 'main', leaseOwner: INSTANCE_ID }, { $set: { leaseOwner: null, leaseUntil: null } }).catch(() => undefined);
}

function startLeaseRenewal() {
  if (leaseTimer) return;
  leaseTimer = setInterval(() => {
    void acquireLease()
      .then(async (held) => {
        if (held || !activeClient) return;
        // Another instance took over: step aside so the session isn't used twice.
        logger.warn('delivery account lease lost; disconnecting this instance');
        const client = activeClient;
        activeClient = null;
        await closeClient(client);
      })
      .catch(() => undefined);
  }, LEASE_RENEW_MS);
  leaseTimer.unref?.();
}

/** Retries soon while another instance (usually the old server mid-deploy) still holds it. */
function scheduleRetry(ms = 20_000) {
  if (retryTimer || shuttingDown) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureDeliveryClient().catch(() => undefined);
  }, ms);
  retryTimer.unref?.();
}

async function destroyClient(client: TelegramClient | null) {
  if (!client) return;
  await (client as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  await closeClient(client);
}

export async function initializeDeliveryAccount() {
  if (shuttingDown) return false;
  const account = await DeliveryAccount.findOne({ singleton: 'main', isActive: true }).select('+encryptedSession');
  if (!account) return false;
  try {
    if (!env.DELIVERY_API_ID || !env.DELIVERY_API_HASH) throw new Error('DELIVERY_API_ID / DELIVERY_API_HASH are not set on the server');
    if (!(await acquireLease())) {
      lastConnectError = 'WAITING: السيرفر القديم بعده ماسك الحساب (تحديث جاري)، راح يتصل خلال ثواني';
      scheduleRetry();
      return false;
    }
    // Never two live connections with the same session: the old client goes first.
    const previous = activeClient;
    activeClient = null;
    await destroyClient(previous);
    const client = new TelegramClient(new StringSession(decrypt(account.encryptedSession)), env.DELIVERY_API_ID, env.DELIVERY_API_HASH, {
      connectionRetries: 5,
      autoReconnect: true,
    });
    try {
      await client.connect();
      // Proves the session is still valid (connect() alone succeeds with a revoked session).
      await client.getMe();
    } catch (err) {
      await destroyClient(client);
      throw err;
    }
    activeClient = client;
    activeAccountId = account.telegramId;
    onConnected(client);
    startLeaseRenewal();
    lastConnectError = null;
    await DeliveryAccount.updateOne({ _id: account._id }, { lastConnectedAt: new Date() });
    logger.info({ telegramId: account.telegramId, instance: INSTANCE_ID }, 'delivery account connected');
    return true;
  } catch (err) {
    lastConnectError = errorMessage(err) || 'unknown error';
    logger.error({ err: lastConnectError }, 'delivery account connection failed');
    return false;
  }
}

/**
 * The delivery account's live connection. GramJS reconnects a dropped connection by itself
 * (autoReconnect); a fresh client is only made when there is none. Returns null only when
 * it really can't connect.
 */
export async function ensureDeliveryClient(): Promise<TelegramClient | null> {
  if (shuttingDown) return null;
  if (activeClient && isConnected(activeClient)) return activeClient;
  // A session Telegram revoked stays dead until the developer logs in again.
  if (isDeadSession(lastConnectError)) return null;
  if (!connecting) connecting = initializeDeliveryAccount().finally(() => (connecting = null));
  await connecting;
  return activeClient && isConnected(activeClient) ? activeClient : null;
}

/** Background check (every few minutes) so the account is reconnected before anyone needs it. */
export async function keepDeliveryAccountConnected() {
  const configured = await DeliveryAccount.exists({ singleton: 'main', isActive: true });
  if (!configured) return;
  await ensureDeliveryClient();
}

/** Server shutdown: drop the connection and hand the account to the next instance right away. */
export async function shutdownDeliveryAccount() {
  shuttingDown = true;
  if (leaseTimer) clearInterval(leaseTimer);
  if (retryTimer) clearTimeout(retryTimer);
  const client = activeClient;
  activeClient = null;
  await destroyClient(client);
  await releaseLease();
}

export async function sendDeliveryLoginCode(actorId: number, phone: string) {
  const normalized = phone.trim().replace(/[^\d+]/g, '');
  if (!/^\+\d{7,15}$/.test(normalized)) {
    throw new AppError('اكتب رقم الهاتف بصيغة دولية مثل +9647xxxxxxxx.', 422, 'INVALID_PHONE');
  }
  const auth = credentials();
  const previous = pendingLogins.get(actorId);
  if (previous) await closeClient(previous.client);
  const client = new TelegramClient(new StringSession(''), auth.apiId, auth.apiHash, { connectionRetries: 5 });
  await client.connect();
  const sent = await client.sendCode(auth, normalized);
  pendingLogins.set(actorId, {
    client,
    phone: normalized,
    phoneCodeHash: sent.phoneCodeHash,
    isCodeViaApp: sent.isCodeViaApp,
    expiresAt: Date.now() + LOGIN_TTL_MS,
    passwordRequired: false,
  });
  return { isCodeViaApp: sent.isCodeViaApp, expiresInSeconds: LOGIN_TTL_MS / 1000 };
}

export async function verifyDeliveryLoginCode(actorId: number, code: string, password?: string) {
  const pending = pendingLogins.get(actorId);
  if (!pending || pending.expiresAt < Date.now()) {
    if (pending) await closeClient(pending.client);
    pendingLogins.delete(actorId);
    throw new AppError('انتهت جلسة التحقق. اطلب كوداً جديداً.', 409, 'DELIVERY_LOGIN_EXPIRED');
  }
  const auth = credentials();
  if (!pending.passwordRequired) {
    try {
      const result = await pending.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: pending.phone,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode: code.trim(),
        })
      );
      const saved = await persistAndActivate(pending.client, pending.phone);
      pendingLogins.delete(actorId);
      return { ...saved, needsPassword: false, passwordHint: null, user: result };
    } catch (err) {
      if (!isPasswordRequired(err)) {
        throw new AppError('الكود غير صحيح أو انتهت صلاحيته.', 422, 'DELIVERY_CODE_INVALID');
      }
      pending.passwordRequired = true;
      const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
      pending.passwordHint = passwordInfo.hint || null;
      if (!password) return { needsPassword: true, passwordHint: pending.passwordHint };
    }
  }

  if (!password) {
    return { needsPassword: true, passwordHint: pending.passwordHint || null };
  }
  try {
    const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(passwordInfo, password);
    await pending.client.invoke(new Api.auth.CheckPassword({ password: check }));
    const saved = await persistAndActivate(pending.client, pending.phone);
    pendingLogins.delete(actorId);
    return { ...saved, needsPassword: false, passwordHint: null };
  } catch (passwordErr) {
    throw new AppError('كلمة مرور التحقق غير صحيحة.', 422, 'DELIVERY_PASSWORD_INVALID');
  }
}

export async function getDeliveryAccountStatus() {
  const account = await DeliveryAccount.findOne({ singleton: 'main', isActive: true }).select(
    'telegramId username firstName phoneMasked isActive lastConnectedAt'
  );
  if (!account) return { configured: false, online: false, lastError: null, username: null, firstName: null, phoneMasked: null, lastConnectedAt: null };
  return {
    configured: true,
    // Whether this server is actually connected with it right now (not just saved).
    online: isConnected(activeClient),
    lastError: isConnected(activeClient) ? null : lastConnectError,
    username: account.username ?? null,
    firstName: account.firstName ?? null,
    phoneMasked: account.phoneMasked,
    lastConnectedAt: account.lastConnectedAt ?? null,
  };
}

export async function isDeliveryAccountTelegramId(telegramId: number) {
  const account = await DeliveryAccount.findOne({ singleton: 'main', isActive: true }).select('telegramId');
  return Boolean(account && account.telegramId === telegramId);
}

export async function getDeliveryContactLink() {
  const status = await getDeliveryAccountStatus();
  return {
    ...status,
    link: status.username ? `https://t.me/${status.username.replace(/^@/, '')}` : null,
  };
}

export async function verifyDeliveryContactBySending(telegramId: number) {
  const client = await ensureDeliveryClient();
  if (!client || activeAccountId === null) {
    throw new AppError(t('حساب التسليم غير متصل حالياً. حاول بعد قليل.', 'The delivery account is offline right now. Please try again shortly.'), 503, 'DELIVERY_ACCOUNT_OFFLINE');
  }

  const user = await User.findOne({ telegramId });
  if (!user) throw new AppError(t('المستخدم غير موجود.', 'User not found.'), 404, 'USER_NOT_FOUND');

  const username = user.username?.trim();
  // Add them to the delivery account's contacts first: delivering an account works far
  // more smoothly between mutual contacts. A failure here doesn't block the check.
  const tgUser = await resolveTelegramUser(client, telegramId, username);
  if (tgUser) await addUserAsContact(client, tgUser, user.firstName);
  let target: string | number | Api.User = telegramId;
  try {
    // The resolved user carries its access hash; otherwise fall back to the @username,
    // or to an entity cached in the delivery session.
    target = tgUser ?? (username ? `@${username.replace(/^@/, '')}` : telegramId);
    await client.sendMessage(target, {
      message: t('✅ تم التحقق من إضافة حساب التسليم إلى جهات اتصالك. يمكنك الآن الرجوع إلى البوت وإكمال استلام الجائزة.', '✅ Verified: the delivery account is in your contacts. You can go back to the bot and finish claiming your prize.'),
    });
  } catch (err) {
    logger.info({ err, telegramId }, 'delivery verification message failed');
    throw new AppError(
      t('فشل إرسال رسالة التحقق. أضف حساب التسليم إلى جهات اتصالك أولاً ثم اضغط تحقق مرة ثانية.', 'Could not send the check message. Add the delivery account to your contacts first, then tap verify again.'),
      409,
      'DELIVERY_CONTACT_NOT_VERIFIED'
    );
  }

  user.deliveryContactVerifiedAt = new Date();
  user.deliveryContactVerificationMethod = 'outgoing_message';
  await user.save();
  logger.info({ telegramId }, 'delivery contact verified by outgoing message');
  return { verified: true };
}

/**
 * Whether the user already passed the contact check. Stored in the database: a dropped
 * connection to the delivery account must not send verified users back to the check.
 */
export async function hasVerifiedDeliveryContact(telegramId: number) {
  const user = await User.findOne({ telegramId }).select('deliveryContactVerifiedAt deliveryContactVerificationMethod');
  return Boolean(user?.deliveryContactVerifiedAt && user.deliveryContactVerificationMethod === 'outgoing_message');
}

/**
 * Reads the Telegram profile through the logged-in user session. Bot API cannot reliably
 * read another user's full name/bio, so profile tasks must use the delivery account.
 * Connectivity/entity failures are operational errors: callers must not treat them as proof
 * that the user removed the requirement.
 */
export async function verifyDeliveryProfile(
  telegramId: number,
  requirement: 'name' | 'bio',
  profile?: { firstName?: string; lastName?: string; username?: string },
): Promise<boolean> {
  // The Mini App init data is signed by Telegram and contains the current display
  // name, so the name requirement does not need the delivery account to resolve
  // the user. Bio still requires GramJS because Bot API does not expose `about`.
  if (requirement === 'name' && profile) {
    const name = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim().toLowerCase();
    return name.includes('mf');
  }

  const client = await ensureDeliveryClient();
  if (!client || activeAccountId === null) {
    throw new AppError('حساب التسليم غير متصل حالياً. حاول بعد قليل.', 503, 'DELIVERY_ACCOUNT_OFFLINE');
  }

  let entity: any;
  try {
    const username = profile?.username?.trim().replace(/^@/, '');
    if (username) {
      const resolved = await client.invoke(new Api.contacts.ResolveUsername({ username }));
      const matchingUser = resolved.users?.find((candidate: any) => Number(candidate.id) === telegramId);
      entity = matchingUser ?? resolved.users?.[0];
    }
    if (!entity) entity = await client.getEntity(telegramId);
  } catch (err) {
    throw new AppError('تعذر الوصول إلى حساب المستخدم في Telegram حالياً.', 503, 'DELIVERY_PROFILE_UNAVAILABLE');
  }

  try {
    const full = await client.invoke(new Api.users.GetFullUser({ id: entity }));
    const telegramUser = (full as any).user ?? entity;
    const about = String((full as any).fullUser?.about ?? '').toLowerCase();
    return about.includes('@mfbisnes') || about.includes('mfbisnes');
  } catch (err) {
    throw new AppError('تعذر قراءة ملف المستخدم في Telegram حالياً.', 503, 'DELIVERY_PROFILE_UNAVAILABLE');
  }
}

export async function removeDeliveryAccount() {
  await closeClient(activeClient);
  activeClient = null;
  activeAccountId = null;
  pendingLogins.clear();
  await DeliveryAccount.deleteMany({ singleton: 'main' });
}