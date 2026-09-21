import { Admin, AdminRole } from '../models/Admin';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export async function getAdminRole(telegramId: number): Promise<AdminRole | null> {
  if (telegramId === env.OWNER_ID) return 'owner';
  const admin = await Admin.findOne({ telegramId });
  return admin?.role ?? null;
}

export async function isAdmin(telegramId: number): Promise<boolean> {
  const role = await getAdminRole(telegramId);
  return role !== null;
}

export async function isOwner(telegramId: number): Promise<boolean> {
  return telegramId === env.OWNER_ID;
}

export async function addDeveloper(telegramId: number, username: string | undefined, addedBy: number) {
  if (telegramId === env.OWNER_ID) {
    throw new AppError('Cannot add the owner as a developer', 400, 'OWNER_IMMUTABLE');
  }
  const existing = await Admin.findOne({ telegramId });
  if (existing) throw new AppError('Already a developer', 409, 'ALREADY_ADMIN');
  return Admin.create({ telegramId, username, role: 'developer', addedBy });
}

export async function removeDeveloper(telegramId: number, actingId: number) {
  if (telegramId === env.OWNER_ID) {
    throw new AppError('The owner cannot be removed', 403, 'OWNER_PROTECTED');
  }
  const actingRole = await getAdminRole(actingId);
  if (actingRole !== 'owner') {
    throw new AppError('Only the owner can remove developers', 403, 'FORBIDDEN');
  }
  const res = await Admin.deleteOne({ telegramId, role: 'developer' });
  if (res.deletedCount === 0) throw new AppError('Developer not found', 404, 'NOT_FOUND');
}

export async function removeAllDevelopers(actingId: number) {
  const actingRole = await getAdminRole(actingId);
  if (actingRole !== 'owner') {
    throw new AppError('Only the owner can remove developers', 403, 'FORBIDDEN');
  }
  await Admin.deleteMany({ role: 'developer' });
}

export async function listDevelopers() {
  return Admin.find({}).sort({ createdAt: 1 });
}

/** All currently-known admin Telegram IDs (owner + developers), for broadcast/notify. */
export async function listAllAdminTelegramIds(): Promise<number[]> {
  const devs = await Admin.find({}, { telegramId: 1 });
  const ids = new Set<number>(devs.map((d) => d.telegramId));
  ids.add(env.OWNER_ID);
  return Array.from(ids);
}
