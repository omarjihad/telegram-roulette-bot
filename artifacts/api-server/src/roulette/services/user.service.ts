import { User, IUser } from '../models/User';
import { HydratedDocument } from 'mongoose';
import { TelegramInitDataUser } from '../utils/telegramAuth';
import { notifyAdminsNewUser } from './notification.service';

export async function findOrCreateUser(
  tgUser: TelegramInitDataUser
): Promise<{ user: HydratedDocument<IUser>; isNew: boolean }> {
  let user = await User.findOne({ telegramId: tgUser.id });
  let isNew = false;

  if (!user) {
    user = await User.create({
      telegramId: tgUser.id,
      username: tgUser.username,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      languageCode: tgUser.language_code,
      photoUrl: tgUser.photo_url,
    });
    isNew = true;
    // Fire-and-forget: don't let a Telegram send failure block user registration.
    notifyAdminsNewUser({
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
    }).catch(() => {});
  } else {
    // Keep profile fields fresh (username/photo change over time)
    let dirty = false;
    if (tgUser.username && user.username !== tgUser.username) {
      user.username = tgUser.username;
      dirty = true;
    }
    if (tgUser.first_name && user.firstName !== tgUser.first_name) {
      user.firstName = tgUser.first_name;
      dirty = true;
    }
    if (tgUser.last_name !== undefined && user.lastName !== tgUser.last_name) {
      user.lastName = tgUser.last_name;
      dirty = true;
    }
    if (tgUser.photo_url && user.photoUrl !== tgUser.photo_url) {
      user.photoUrl = tgUser.photo_url;
      dirty = true;
    }
    if (dirty) await user.save();
  }

  return { user, isNew };
}

export function resolveUserLookup(input: string): { byTelegramId?: number; byUsername?: string } {
  const trimmed = input.trim();
  // Telegram link: https://t.me/username
  const linkMatch = trimmed.match(/t\.me\/([A-Za-z0-9_]+)/i);
  if (linkMatch) return { byUsername: linkMatch[1].replace(/^@/, '') };

  if (trimmed.startsWith('@')) return { byUsername: trimmed.slice(1) };

  if (/^-?\d+$/.test(trimmed)) return { byTelegramId: Number(trimmed) };

  return { byUsername: trimmed };
}

export async function findUserByLookup(input: string) {
  const { byTelegramId, byUsername } = resolveUserLookup(input);
  if (byTelegramId !== undefined) return User.findOne({ telegramId: byTelegramId });
  if (byUsername) {
    const escapedUsername = byUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return User.findOne({ username: new RegExp(`^${escapedUsername}$`, 'i') });
  }
  return null;
}
