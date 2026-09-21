import { nanoid } from 'nanoid';
import { env } from '../config/env';
import { getSettings, ISettings } from '../models/Settings';
import { IUser } from '../models/User';

const TOKEN_ROTATION_MS = 30 * 60 * 1000;
const ACCESS_WINDOW_MS = 30 * 60 * 1000;

export function parseDemoToken(startParam?: string | null): string | null {
  if (!startParam) return null;
  const match = startParam.match(/^demo_([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export async function ensureDemoToken(settings: ISettings) {
  const now = Date.now();
  const updatedAt = settings.demoAccessTokenUpdatedAt?.getTime() ?? 0;
  if (!settings.demoAccessToken || now - updatedAt >= TOKEN_ROTATION_MS) {
    settings.demoAccessToken = nanoid(18);
    settings.demoAccessTokenUpdatedAt = new Date(now);
    await settings.save();
  }
  return settings.demoAccessToken;
}

export async function getDemoAccessLink() {
  const settings = await getSettings();
  if (!settings.demoModeEnabled || !env.BOT_USERNAME) return null;
  const token = await ensureDemoToken(settings);
  return `https://t.me/${env.BOT_USERNAME}?start=demo_${token}`;
}

export async function grantDemoAccess(user: IUser, token: string | null) {
  if (!token) return false;
  const settings = await getSettings();
  if (!settings.demoModeEnabled) return false;
  const currentToken = await ensureDemoToken(settings);
  if (token !== currentToken) return false;
  user.demoAccessUntil = new Date(Date.now() + ACCESS_WINDOW_MS);
  await user.save();
  return true;
}

export function hasDemoAccess(user: Pick<IUser, 'demoAccessUntil'>) {
  return Boolean(user.demoAccessUntil && user.demoAccessUntil.getTime() > Date.now());
}