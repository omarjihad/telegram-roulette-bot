import { HydratedDocument } from 'mongoose';
import { customAlphabet } from 'nanoid';
import { IUser } from '../models/User';
import { BattleControl, BattleProfile, BattleSettings, IBattleProfile } from '../models/BattleProfile';
import { BattleLayoutCode } from '../models/BattleLayoutCode';
import { BattleWeeklyStat } from '../models/BattleWeeklyStat';
import { getSettings } from '../models/Settings';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { t } from '../i18n';
import { getBotInstance } from '../bot/instance';

/** MF coins a new MF Battle account starts with. */
export const STARTER_COINS = 100;

/** The Adsgram interstitial block shown in MF Battle (no reward). */
export const BATTLE_INTERSTITIAL_BLOCK = 'int-52362';

export interface BattleSkin {
  id: string;
  name: { ar: string; en: string };
  price: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

/** Every skin in the game. The artwork lives in the game app; the server knows ids and prices. */
export const BATTLE_SKINS: BattleSkin[] = [
  { id: 'classic', name: { ar: 'كلاسيك', en: 'Classic' }, price: 0, rarity: 'common' },
  { id: 'mf', name: { ar: 'MF', en: 'MF' }, price: 0, rarity: 'common' },
  { id: 'ocean', name: { ar: 'المحيط', en: 'Ocean' }, price: 80, rarity: 'common' },
  { id: 'lava', name: { ar: 'الحمم', en: 'Lava' }, price: 80, rarity: 'common' },
  { id: 'neon', name: { ar: 'نيون', en: 'Neon' }, price: 150, rarity: 'rare' },
  { id: 'toxic', name: { ar: 'سام', en: 'Toxic' }, price: 150, rarity: 'rare' },
  { id: 'tiger', name: { ar: 'النمر', en: 'Tiger' }, price: 250, rarity: 'rare' },
  { id: 'snake', name: { ar: 'الحية', en: 'Snake' }, price: 300, rarity: 'epic' },
  { id: 'galaxy', name: { ar: 'المجرة', en: 'Galaxy' }, price: 400, rarity: 'epic' },
  { id: 'ziggurat', name: { ar: 'الزقورة', en: 'Ziggurat' }, price: 500, rarity: 'epic' },
  { id: 'skull', name: { ar: 'الجمجمة', en: 'Skull' }, price: 700, rarity: 'legendary' },
  { id: 'crown', name: { ar: 'التاج', en: 'Crown' }, price: 900, rarity: 'legendary' },
  { id: 'dragon', name: { ar: 'التنين', en: 'Dragon' }, price: 1200, rarity: 'legendary' },
];
const FREE_SKINS = BATTLE_SKINS.filter((s) => s.price === 0).map((s) => s.id);

/** The on-screen controls the layout editor can move. */
export const BATTLE_CONTROL_IDS = ['joystick', 'split', 'throw', 'double', 'chat', 'leaderboard', 'mass', 'minimap', 'zoom'] as const;

const QUALITIES = ['low', 'medium', 'high'] as const;
const JOYSTICKS = ['fixed', 'floating'] as const;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** The section is open to developers only for now. */
export function assertBattleAllowed(adminRole: string | null) {
  if (!adminRole) throw new AppError(t('قريباً', 'Coming soon'), 403, 'BATTLE_COMING_SOON');
}

export function displayName(user: Pick<IUser, 'firstName' | 'username' | 'telegramId'>) {
  return user.firstName || (user.username ? `@${user.username}` : String(user.telegramId));
}

async function profileFor(user: HydratedDocument<IUser>) {
  const existing = await BattleProfile.findOne({ telegramId: user.telegramId });
  if (existing) return existing;
  try {
    return await BattleProfile.create({
      user: user._id,
      telegramId: user.telegramId,
      coins: STARTER_COINS,
      skin: 'classic',
      ownedSkins: FREE_SKINS,
    });
  } catch {
    // Two first requests at once: the other one created it.
    const again = await BattleProfile.findOne({ telegramId: user.telegramId });
    if (!again) throw new AppError('Could not open your MF Battle account', 500, 'BATTLE_PROFILE');
    return again;
  }
}

function profileView(p: IBattleProfile) {
  return {
    coins: p.coins,
    skin: p.skin,
    ownedSkins: Array.from(new Set([...FREE_SKINS, ...(p.ownedSkins ?? [])])),
    settings: p.settings,
    layout: p.layout ?? {},
    bestMass: p.bestMass ?? 0,
    totalMatches: p.totalMatches ?? 0,
    totalSeconds: p.totalSeconds ?? 0,
  };
}

export async function getBattleHome(user: HydratedDocument<IUser>, adminRole: string | null) {
  assertBattleAllowed(adminRole);
  const profile = await profileFor(user);
  return {
    player: { telegramId: user.telegramId, name: displayName(user), username: user.username ?? null, photoUrl: user.photoUrl ?? null },
    profile: profileView(profile),
    skins: BATTLE_SKINS,
    week: { key: weekKey(), resetsAt: nextWeekStart() },
    // Adsgram blocks: the reward one (revenge) and the interstitial shown every second death.
    ads: { rewardBlockId: (await getSettings()).adsgramBlockId || null, interstitialBlockId: BATTLE_INTERSTITIAL_BLOCK },
  };
}

export async function buySkin(user: HydratedDocument<IUser>, adminRole: string | null, skinId: string) {
  assertBattleAllowed(adminRole);
  const skin = BATTLE_SKINS.find((s) => s.id === skinId);
  if (!skin) throw new AppError(t('السكن غير موجود', 'Skin not found'), 404, 'NOT_FOUND');
  const profile = await profileFor(user);
  if (profile.ownedSkins.includes(skin.id) || skin.price === 0) return { profile: profileView(profile) };
  // Atomic: the coins are only taken while the player still has them and doesn't own it yet.
  const updated = await BattleProfile.findOneAndUpdate(
    { _id: profile._id, coins: { $gte: skin.price }, ownedSkins: { $ne: skin.id } },
    { $inc: { coins: -skin.price }, $push: { ownedSkins: skin.id } },
    { new: true }
  );
  if (!updated) {
    const fresh = await BattleProfile.findById(profile._id);
    if (fresh?.ownedSkins.includes(skin.id)) return { profile: profileView(fresh) };
    throw new AppError(t('ما عندك عملات MF كافية', "You don't have enough MF coins"), 409, 'NOT_ENOUGH_COINS');
  }
  return { profile: profileView(updated) };
}

export async function equipSkin(user: HydratedDocument<IUser>, adminRole: string | null, skinId: string) {
  assertBattleAllowed(adminRole);
  const profile = await profileFor(user);
  if (!BATTLE_SKINS.some((s) => s.id === skinId)) throw new AppError(t('السكن غير موجود', 'Skin not found'), 404, 'NOT_FOUND');
  if (!FREE_SKINS.includes(skinId) && !profile.ownedSkins.includes(skinId)) {
    throw new AppError(t('لازم تشتري هذا السكن أولاً', 'Buy this skin first'), 409, 'SKIN_NOT_OWNED');
  }
  profile.skin = skinId;
  await profile.save();
  return { profile: profileView(profile) };
}

export function cleanSettings(input: unknown, current: BattleSettings): BattleSettings {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    darkMode: typeof v.darkMode === 'boolean' ? v.darkMode : current.darkMode,
    chat: typeof v.chat === 'boolean' ? v.chat : current.chat,
    sound: typeof v.sound === 'boolean' ? v.sound : current.sound ?? true,
    quality: QUALITIES.includes(v.quality as never) ? (v.quality as BattleSettings['quality']) : current.quality,
    joystick: JOYSTICKS.includes(v.joystick as never) ? (v.joystick as BattleSettings['joystick']) : current.joystick,
  };
}

/** Keeps only known controls, each with numbers in range (anything else is dropped). */
export function cleanLayout(input: unknown): Record<string, BattleControl> {
  const out: Record<string, BattleControl> = {};
  if (!input || typeof input !== 'object') return out;
  for (const id of BATTLE_CONTROL_IDS) {
    const c = (input as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object') continue;
    const x = Number(c.x), y = Number(c.y), s = Number(c.s), o = Number(c.o);
    if (![x, y, s, o].every(Number.isFinite)) continue;
    out[id] = {
      x: Math.round(clamp(x, 0, 1) * 1000) / 1000,
      y: Math.round(clamp(y, 0, 1) * 1000) / 1000,
      s: Math.round(clamp(s, 0.5, 2) * 100) / 100,
      o: Math.round(clamp(o, 0.2, 1) * 100) / 100,
    };
  }
  return out;
}

export async function saveSettings(user: HydratedDocument<IUser>, adminRole: string | null, input: unknown) {
  assertBattleAllowed(adminRole);
  const profile = await profileFor(user);
  profile.settings = cleanSettings(input, profile.settings);
  await profile.save();
  return { profile: profileView(profile) };
}

export async function saveLayout(user: HydratedDocument<IUser>, adminRole: string | null, input: unknown) {
  assertBattleAllowed(adminRole);
  const profile = await profileFor(user);
  profile.layout = cleanLayout(input);
  profile.markModified('layout');
  await profile.save();
  return { profile: profileView(profile) };
}

const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/**
 * "Copy my settings": stores the layout under a short code and the bot sends it to the
 * player (with a picture of the layout when the game sent one), ready to share.
 */
export async function shareLayout(user: HydratedDocument<IUser>, adminRole: string | null, input: { layout?: unknown; image?: unknown }) {
  assertBattleAllowed(adminRole);
  const layout = cleanLayout(input.layout);
  if (Object.keys(layout).length === 0) throw new AppError(t('ما اكو إعدادات تحكم للنسخ', 'No control layout to copy'), 422, 'VALIDATION_ERROR');
  let code = '';
  for (let i = 0; i < 5 && !code; i++) {
    const candidate = `MF-${makeCode()}`;
    try {
      await BattleLayoutCode.create({ code: candidate, telegramId: user.telegramId, layout });
      code = candidate;
    } catch {
      // Taken (very unlikely): try another.
    }
  }
  if (!code) throw new AppError('Could not create a code, try again', 500, 'CODE_FAILED');

  const caption = t(
    `🎮 إعدادات التحكم مالتك بـ MF Battle\n\nالكود: ${code}\n\nحتى تستخدمها (إنت أو صديقك): الإعدادات ← إعدادات التحكم ← لصق، واكتب الكود.`,
    `🎮 Your MF Battle control layout\n\nCode: ${code}\n\nTo use it (you or a friend): Settings → Control settings → Paste, then enter the code.`
  );
  try {
    const bot = getBotInstance();
    const image = typeof input.image === 'string' ? input.image.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/) : null;
    const buffer = image ? Buffer.from(image[2], 'base64') : null;
    if (buffer && buffer.length > 0 && buffer.length < 900_000) {
      await bot.sendPhoto(user.telegramId, buffer, { caption }, { filename: 'layout.jpg', contentType: `image/${image![1]}` });
    } else {
      await bot.sendMessage(user.telegramId, caption);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'could not send the battle layout code');
  }
  return { code };
}

export async function getSharedLayout(adminRole: string | null, rawCode: string) {
  assertBattleAllowed(adminRole);
  const code = String(rawCode ?? '').trim().toUpperCase();
  const normalized = code.startsWith('MF-') ? code : `MF-${code}`;
  const found = await BattleLayoutCode.findOne({ code: normalized });
  if (!found) throw new AppError(t('الكود غير صحيح', 'Code not found'), 404, 'NOT_FOUND');
  return { code: found.code, layout: cleanLayout(found.layout) };
}

// ───────────── Weekly leaderboard ─────────────

const BAGHDAD_MS = 3 * 3600e3;
const DAY = 24 * 3600e3;

/** Monday 00:00 (Baghdad time) of the week `now` falls in, as a UTC Date. */
function weekStart(now = new Date()) {
  const local = new Date(now.getTime() + BAGHDAD_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight - daysSinceMonday * DAY - BAGHDAD_MS);
}

export function weekKey(now = new Date()) {
  return new Date(weekStart(now).getTime() + BAGHDAD_MS).toISOString().slice(0, 10);
}

export function nextWeekStart(now = new Date()) {
  return new Date(weekStart(now).getTime() + 7 * DAY);
}

export const LEADERBOARD_FIELDS = { mass: 'maxMass', time: 'playSeconds', matches: 'matches' } as const;
export type LeaderboardType = keyof typeof LEADERBOARD_FIELDS;

export async function getLeaderboard(user: HydratedDocument<IUser>, adminRole: string | null, type: string) {
  assertBattleAllowed(adminRole);
  const kind: LeaderboardType = type in LEADERBOARD_FIELDS ? (type as LeaderboardType) : 'mass';
  const field = LEADERBOARD_FIELDS[kind];
  const week = weekKey();
  const rows = await BattleWeeklyStat.find({ week, [field]: { $gt: 0 } })
    .sort({ [field]: -1, updatedAt: 1 })
    .limit(50)
    .lean();
  const mine = await BattleWeeklyStat.findOne({ week, telegramId: user.telegramId }).lean();
  const myValue = mine ? Number(mine[field]) || 0 : 0;
  const myRank = myValue > 0 ? (await BattleWeeklyStat.countDocuments({ week, [field]: { $gt: myValue } })) + 1 : null;
  return {
    type: kind,
    week,
    resetsAt: nextWeekStart(),
    rows: rows.map((r, i) => ({ rank: i + 1, telegramId: r.telegramId, name: r.name, skin: r.skin, value: Number(r[field]) || 0, me: r.telegramId === user.telegramId })),
    me: { rank: myRank, value: myValue },
  };
}

/**
 * Called by the game server when a match ends (used once the game itself is live):
 * adds the match to this week's numbers and the player's all-time stats.
 */
export async function recordBattleMatch(user: Pick<IUser, 'telegramId' | 'firstName' | 'username'>, match: { mass: number; seconds: number }) {
  const mass = Math.max(0, Math.floor(Number(match.mass) || 0));
  const seconds = Math.max(0, Math.floor(Number(match.seconds) || 0));
  const profile = await BattleProfile.findOne({ telegramId: user.telegramId }).select('skin');
  await BattleWeeklyStat.updateOne(
    { week: weekKey(), telegramId: user.telegramId },
    {
      $max: { maxMass: mass },
      $inc: { playSeconds: seconds, matches: 1 },
      $set: { name: displayName(user as never), skin: profile?.skin ?? 'classic' },
    },
    { upsert: true }
  );
  await BattleProfile.updateOne({ telegramId: user.telegramId }, { $max: { bestMass: mass }, $inc: { totalMatches: 1, totalSeconds: seconds } });
}

/** Where the MF Battle game is hosted (Cloudflare), shown to developers in the Mini App. */
export function battleUrl() {
  return env.MF_BATTLE_URL || null;
}
