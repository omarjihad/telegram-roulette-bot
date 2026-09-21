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
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await closeClient(activeClient);
  activeClient = client;
  activeAccountId = telegramId;
  attachDeliveryCommandListener(client);
  return { telegramId, username, firstName, phoneMasked: maskPhone(phone) };
}

export async function initializeDeliveryAccount() {
  const account = await DeliveryAccount.findOne({ singleton: 'main', isActive: true }).select('+encryptedSession');
  if (!account) return false;
  try {
    const client = new TelegramClient(new StringSession(decrypt(account.encryptedSession)), env.DELIVERY_API_ID, env.DELIVERY_API_HASH, {
      connectionRetries: 5,
    });
    await client.connect();
    activeClient = client;
    activeAccountId = account.telegramId;
    attachDeliveryCommandListener(client);
    await DeliveryAccount.updateOne({ _id: account._id }, { lastConnectedAt: new Date() });
    logger.info({ telegramId: account.telegramId }, 'delivery account connected');
    return true;
  } catch (err) {
    logger.error({ err }, 'delivery account connection failed');
    return false;
  }
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
  if (!account) return { configured: false, username: null, firstName: null, phoneMasked: null, lastConnectedAt: null };
  return {
    configured: true,
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
  if (!activeClient || activeAccountId === null) {
    throw new AppError('حساب التسليم غير متصل حالياً. حاول بعد قليل.', 503, 'DELIVERY_ACCOUNT_OFFLINE');
  }

  const user = await User.findOne({ telegramId });
  if (!user) throw new AppError('المستخدم غير موجود.', 404, 'USER_NOT_FOUND');

  const username = user.username?.trim();
  let target: string | number = telegramId;
  try {
    // A username gives the delivery account a resolvable Telegram entity. For
    // users without usernames, GramJS can still use an entity cached in the
    // delivery session (for example after a previous Telegram interaction).
    target = username ? `@${username.replace(/^@/, '')}` : telegramId;
    await activeClient.sendMessage(target, {
      message: '✅ تم التحقق من إضافة حساب التسليم إلى جهات اتصالك. يمكنك الآن الرجوع إلى البوت وإكمال استلام الجائزة.',
    });
  } catch (err) {
    logger.info({ err, telegramId }, 'delivery verification message failed');
    throw new AppError(
      'فشل إرسال رسالة التحقق. أضف حساب التسليم إلى جهات اتصالك أولاً ثم اضغط تحقق مرة ثانية.',
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

export async function hasVerifiedDeliveryContact(telegramId: number) {
  if (!activeClient || activeAccountId === null) return false;
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

  if (!activeClient || activeAccountId === null) {
    throw new AppError('حساب التسليم غير متصل حالياً. حاول بعد قليل.', 503, 'DELIVERY_ACCOUNT_OFFLINE');
  }

  let entity: any;
  try {
    const username = profile?.username?.trim().replace(/^@/, '');
    if (username) {
      const resolved = await activeClient.invoke(new Api.contacts.ResolveUsername({ username }));
      const matchingUser = resolved.users?.find((candidate: any) => Number(candidate.id) === telegramId);
      entity = matchingUser ?? resolved.users?.[0];
    }
    if (!entity) entity = await activeClient.getEntity(telegramId);
  } catch (err) {
    throw new AppError('تعذر الوصول إلى حساب المستخدم في Telegram حالياً.', 503, 'DELIVERY_PROFILE_UNAVAILABLE');
  }

  try {
    const full = await activeClient.invoke(new Api.users.GetFullUser({ id: entity }));
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