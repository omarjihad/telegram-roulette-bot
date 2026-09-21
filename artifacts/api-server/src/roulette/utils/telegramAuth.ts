import crypto from 'crypto';
import { env } from '../config/env';

export interface TelegramInitDataUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  photo_url?: string;
}

export interface ParsedInitData {
  user: TelegramInitDataUser;
  authDate: number;
  startParam?: string;
  raw: URLSearchParams;
}

const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60; // 24h
const MAX_FUTURE_SKEW_SECONDS = 30;
const REQUIRED_SIGNED_FIELDS = ['auth_date', 'user', 'hash'] as const;

/**
 * Validates Telegram WebApp initData per the official algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Never trust user_id, username, or any field from the client without this check passing.
 */
export function verifyTelegramInitData(initData: string): ParsedInitData {
  if (!initData || typeof initData !== 'string') {
    throw new Error('Missing initData');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new Error('initData missing hash');
  }
  for (const field of REQUIRED_SIGNED_FIELDS) {
    if (params.getAll(field).length !== 1) {
      throw new Error(`initData ${field} must appear exactly once`);
    }
  }

  const dataCheckEntries: string[] = [];
  params.forEach((value, key) => {
    if (key === 'hash') return;
    dataCheckEntries.push(`${key}=${value}`);
  });
  dataCheckEntries.sort();
  const dataCheckString = dataCheckEntries.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    throw new Error('initData signature mismatch');
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new Error('initData auth_date invalid');
  }
  if (authDate > now + MAX_FUTURE_SKEW_SECONDS || now - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    throw new Error('initData expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('initData missing user');
  }

  const user = JSON.parse(userRaw) as TelegramInitDataUser;
  if (!user || typeof user.id !== 'number') {
    throw new Error('initData user payload invalid');
  }

  return {
    user,
    authDate,
    startParam: params.get('start_param') ?? undefined,
    raw: params,
  };
}
