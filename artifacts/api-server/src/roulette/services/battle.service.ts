import { HydratedDocument } from 'mongoose';
import { customAlphabet } from 'nanoid';
import { IUser, User } from '../models/User';
import { BattleControl, BattleProfile, BattleSettings, IBattleProfile } from '../models/BattleProfile';
import { BattleLayoutCode } from '../models/BattleLayoutCode';
import { BattleWeeklyStat } from '../models/BattleWeeklyStat';
import { BattleTournament } from '../models/BattleTournament';
import { getSettings } from '../models/Settings';
import { verifyTelegramInitData } from '../utils/telegramAuth';
import { getAdminRole } from './admin.service';
import { consumeAdView } from './games.service';
import { AdView } from '../models/AdView';
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
  rarity: 'common' | 'rare' | 'legendary' | 'mythic';
  pack?: 'onepiece';
}

/** Every skin in the game. The artwork lives in the game app; the server knows ids and prices. */
export const BATTLE_SKINS: BattleSkin[] = [
  { id: 'fly', name: { ar: 'الذبانة', en: 'Fly' }, price: 0, rarity: 'common' },
  { id: 'mf', name: { ar: 'MF', en: 'MF' }, price: 0, rarity: 'common' },
  { id: 'joyboy', name: { ar: 'جوي بوي', en: 'Joy Boy' }, price: 2999, rarity: 'mythic', pack: 'onepiece' },
  { id: 'roger', name: { ar: 'روجر', en: 'Roger' }, price: 2499, rarity: 'mythic', pack: 'onepiece' },
  { id: 'kaido', name: { ar: 'كايدو', en: 'Kaido' }, price: 1499, rarity: 'legendary', pack: 'onepiece' },
  { id: 'zoro', name: { ar: 'زورو', en: 'Zoro' }, price: 1299, rarity: 'legendary', pack: 'onepiece' },
  { id: 'sanji', name: { ar: 'سانجي', en: 'Sanji' }, price: 999, rarity: 'legendary', pack: 'onepiece' },
  { id: 'imu', name: { ar: 'إيمو ساما', en: 'Imu-sama' }, price: 499, rarity: 'rare', pack: 'onepiece' },
  { id: 'whitebeard', name: { ar: 'اللحية البيضاء', en: 'Whitebeard' }, price: 349, rarity: 'rare', pack: 'onepiece' },
  { id: 'usopp', name: { ar: 'أوسوب', en: 'Usopp' }, price: 149, rarity: 'common', pack: 'onepiece' },
];
export const DEFAULT_SKIN = 'fly';
/** Limited packs: on sale for this many days after the game opens; owners keep them forever. */
export const SKIN_PACKS = { onepiece: { name: { ar: 'حزمة ون بيس', en: 'One Piece pack' }, days: 7 } } as const;

/** When a pack stops selling (null: the game has not opened to everyone yet, so it is on sale). */
export function packEndsAt(pack: keyof typeof SKIN_PACKS) {
  const launch = env.MF_BATTLE_LAUNCH_DATE ? new Date(env.MF_BATTLE_LAUNCH_DATE) : null;
  if (!launch || Number.isNaN(launch.getTime())) return null;
  return new Date(launch.getTime() + SKIN_PACKS[pack].days * 86400000);
}
function onSale(skin: BattleSkin, now = new Date()) {
  if (!skin.pack) return true;
  const end = packEndsAt(skin.pack);
  return !end || now < end;
}

/** Throw speeds in the shop: ×1 and ×2 free, ×5 / ×10 bought, ×20 / ×50 opened by ads for 15 minutes. */
export const THROW_SHOP = [
  { level: 0, label: '×1', price: 0 },
  { level: 1, label: '×2', price: 0 },
  { level: 2, label: '×5', price: 400 },
  { level: 3, label: '×10', price: 900 },
  { level: 4, label: '×20', ads: 1, minutes: 15 },
  { level: 5, label: '×50', ads: 2, minutes: 15 },
] as const;
export const THROW_AD_MINUTES = 15;
/** Start sizes in the shop: each life starts with this mass. */
export const START_SIZES = [
  { mass: 20, price: 0 },
  { mass: 50, price: 300 },
  { mass: 100, price: 800 },
  { mass: 200, price: 1800 },
  { mass: 400, price: 3500 },
] as const;

/** Coins for reaching a level: every fifth level pays a big bonus. */
export const levelReward = (level: number) => (level % 5 === 0 ? level * 60 : level * 15);
export const LEVEL_TABLE_SIZE = 50;

/** Throw levels this profile may use right now. */
export function allowedThrows(p: Pick<IBattleProfile, 'throwOwned' | 'x20Until' | 'x50Until'>, now = Date.now()) {
  const out: number[] = [];
  for (let l = 0; l <= Math.max(1, p.throwOwned ?? 1); l++) out.push(l);
  if (p.x20Until && new Date(p.x20Until).getTime() > now) out.push(4);
  if (p.x50Until && new Date(p.x50Until).getTime() > now) out.push(5);
  return out;
}
export const startMassOf = (p: Pick<IBattleProfile, 'sizeOwned'>) => START_SIZES[Math.min(START_SIZES.length - 1, Math.max(0, p.sizeOwned ?? 0))].mass;

const FREE_SKINS = BATTLE_SKINS.filter((s) => s.price === 0).map((s) => s.id);
const SKIN_IDS = new Set(BATTLE_SKINS.map((s) => s.id));

/** The on-screen controls the layout editor can move. */
export const BATTLE_CONTROL_IDS = ['joystick', 'split', 'throw', 'double', 'chat', 'leaderboard', 'mass', 'minimap', 'zoom', 'net'] as const;

const QUALITIES = ['low', 'medium', 'high'] as const;
const JOYSTICKS = ['fixed', 'floating'] as const;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Whether MF Battle is open to everyone (developers can switch it from their panel).
let publicCache = { value: false, at: 0 };
export async function battleIsPublic() {
  if (Date.now() - publicCache.at < 10000) return publicCache.value;
  const value = (await getSettings()).battlePublic === true;
  publicCache = { value, at: Date.now() };
  return value;
}
export function forgetBattlePublicCache() {
  publicCache = { value: false, at: 0 };
}

/** Developers always; everyone else once the game is opened to all. */
export async function assertBattleAllowed(adminRole: string | null) {
  if (!adminRole && !(await battleIsPublic())) throw new AppError(t('قريباً', 'Coming soon'), 403, 'BATTLE_COMING_SOON');
}

export function displayName(user: Pick<IUser, 'firstName' | 'username' | 'telegramId'>) {
  return user.firstName || (user.username ? `@${user.username}` : String(user.telegramId));
}

export async function profileFor(user: HydratedDocument<IUser>) {
  const existing = await BattleProfile.findOne({ telegramId: user.telegramId });
  if (existing) return existing;
  try {
    return await BattleProfile.create({
      user: user._id,
      telegramId: user.telegramId,
      coins: STARTER_COINS,
      skin: DEFAULT_SKIN,
      ownedSkins: FREE_SKINS,
    });
  } catch {
    // Two first requests at once: the other one created it.
    const again = await BattleProfile.findOne({ telegramId: user.telegramId });
    if (!again) throw new AppError('Could not open your MF Battle account', 500, 'BATTLE_PROFILE');
    return again;
  }
}

/** Level from experience: level L needs 50·(L−1)² xp (2 → 50, 5 → 800, 10 → 4050). */
export function battleLevel(xp: number) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
  return { level, xp: Math.floor(Math.max(0, xp)), levelXp: 50 * (level - 1) ** 2, nextXp: 50 * level ** 2 };
}

/** What eating someone online is worth: bigger victims give more coins and experience. */
export function killReward(victimMass: number) {
  const m = Math.max(0, Number(victimMass) || 0);
  return { coins: Math.min(50, 1 + Math.floor(m / 200)), xp: Math.min(500, 10 + Math.floor(m / 20)) };
}

function profileView(p: IBattleProfile) {
  return {
    coins: p.coins,
    ...battleLevel(p.xp ?? 0),
    kills: p.kills ?? 0,
    // Old skins were retired: anything unknown shows as the default one.
    skin: SKIN_IDS.has(p.skin) ? p.skin : DEFAULT_SKIN,
    ownedSkins: Array.from(new Set([...FREE_SKINS, ...(p.ownedSkins ?? []).filter((id) => SKIN_IDS.has(id))])),
    throws: { allowed: allowedThrows(p), owned: Math.max(1, p.throwOwned ?? 1), x20Until: p.x20Until ?? null, x50Until: p.x50Until ?? null, x50Ads: p.x50Ads ?? 0 },
    sizeOwned: p.sizeOwned ?? 0,
    startMass: startMassOf(p),
    settings: p.settings,
    layout: p.layout ?? {},
    bestMass: p.bestMass ?? 0,
    totalMatches: p.totalMatches ?? 0,
    totalSeconds: p.totalSeconds ?? 0,
  };
}

export async function getBattleHome(user: HydratedDocument<IUser>, adminRole: string | null) {
  await assertBattleAllowed(adminRole);
  const profile = await profileFor(user);
  return {
    isAdmin: !!adminRole,
    player: { telegramId: user.telegramId, name: displayName(user), username: user.username ?? null, photoUrl: user.photoUrl ?? null },
    profile: profileView(profile),
    skins: BATTLE_SKINS.map((s) => ({ ...s, onSale: onSale(s) })),
    packs: Object.fromEntries(Object.entries(SKIN_PACKS).map(([id, p]) => [id, { name: p.name, days: p.days, endsAt: packEndsAt(id as keyof typeof SKIN_PACKS) }])),
    shop: { throws: THROW_SHOP, sizes: START_SIZES, throwAdMinutes: THROW_AD_MINUTES },
    levels: Array.from({ length: LEVEL_TABLE_SIZE }, (_, i) => ({ level: i + 1, xp: battleLevel(0).levelXp + 50 * i ** 2, reward: i ? levelReward(i + 1) : 0 })),
    // A running tournament, shown on the lobby: its kind and when it ends.
    // or one that ended in the last 5 minutes (shows the winner).
    tournament: await lobbyTournament(),
    // A separate game server close to the players (lower ping); null = this server.
    wsUrl: env.MF_BATTLE_WS_URL || null,
    week: { key: weekKey(), resetsAt: nextWeekStart() },
    // Adsgram blocks: the reward one (revenge) and the interstitial shown every second death.
    ads: { rewardBlockId: (await getSettings()).adsgramBlockId || null, interstitialBlockId: BATTLE_INTERSTITIAL_BLOCK },
  };
}

async function lobbyTournament() {
  const now = new Date();
  const running = await BattleTournament.findOne({ status: 'running', endsAt: { $gt: now } }).select('mode endsAt minutes prize').lean();
  if (running) return { mode: running.mode, endsAt: running.endsAt, minutes: running.minutes, prize: running.prize || '' };
  const ended = await BattleTournament.findOne({ status: 'ended', endedAt: { $gt: new Date(now.getTime() - 5 * 60000) } })
    .sort({ endedAt: -1 })
    .select('mode endsAt endedAt winner prize')
    .lean();
  if (!ended) return null;
  const w = ended.winner;
  return {
    done: true,
    mode: ended.mode,
    prize: ended.prize || '',
    until: new Date((ended.endedAt ?? ended.endsAt).getTime() + 5 * 60000),
    winner: w ? { name: w.name, leadSeconds: Math.round(w.leadSeconds), mass: Math.round(w.finalMass ?? w.bestMass) } : null,
  };
}

export async function buySkin(user: HydratedDocument<IUser>, adminRole: string | null, skinId: string) {
  await assertBattleAllowed(adminRole);
  const skin = BATTLE_SKINS.find((s) => s.id === skinId);
  if (!skin) throw new AppError(t('السكن غير موجود', 'Skin not found'), 404, 'NOT_FOUND');
  const profile = await profileFor(user);
  if (profile.ownedSkins.includes(skin.id) || skin.price === 0) return { profile: profileView(profile) };
  if (!onSale(skin)) throw new AppError(t('انتهى عرض هذه الحزمة', 'This pack is no longer on sale'), 409, 'PACK_ENDED');
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
  await assertBattleAllowed(adminRole);
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
  await assertBattleAllowed(adminRole);
  const profile = await profileFor(user);
  profile.settings = cleanSettings(input, profile.settings);
  await profile.save();
  return { profile: profileView(profile) };
}

export async function saveLayout(user: HydratedDocument<IUser>, adminRole: string | null, input: unknown) {
  await assertBattleAllowed(adminRole);
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
  await assertBattleAllowed(adminRole);
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
  await assertBattleAllowed(adminRole);
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
  await assertBattleAllowed(adminRole);
  const kind: LeaderboardType = type in LEADERBOARD_FIELDS ? (type as LeaderboardType) : 'mass';
  const field = LEADERBOARD_FIELDS[kind];
  const week = weekKey();
  const rows = await BattleWeeklyStat.find({ week, [field]: { $gt: 0 } })
    .sort({ [field]: -1, updatedAt: 1 })
    .limit(50)
    .lean();
  // The Telegram name and photo (not the in-game look), fresh from the bot's users.
  const people = await User.find({ telegramId: { $in: rows.map((r) => r.telegramId) } }).select('telegramId firstName username photoUrl').lean();
  const byId = new Map(people.map((u) => [u.telegramId, u]));
  const mine = await BattleWeeklyStat.findOne({ week, telegramId: user.telegramId }).lean();
  const myValue = mine ? Number(mine[field]) || 0 : 0;
  const myRank = myValue > 0 ? (await BattleWeeklyStat.countDocuments({ week, [field]: { $gt: myValue } })) + 1 : null;
  return {
    type: kind,
    week,
    resetsAt: nextWeekStart(),
    rows: rows.map((r, i) => {
      const u = byId.get(r.telegramId);
      return {
        rank: i + 1,
        telegramId: r.telegramId,
        name: u ? displayName(u as never) : r.name,
        photoUrl: u?.photoUrl ?? null,
        skin: r.skin,
        value: Number(r[field]) || 0,
        me: r.telegramId === user.telegramId,
      };
    }),
    me: { rank: myRank, value: myValue },
  };
}

const notEnough = () => new AppError(t('ما عندك عملات MF كافية', "You don't have enough MF coins"), 409, 'NOT_ENOUGH_COINS');

/** Buys the next throw speed (×5, then ×10). */
export async function buyThrow(user: HydratedDocument<IUser>, adminRole: string | null, level: number) {
  await assertBattleAllowed(adminRole);
  const item = THROW_SHOP.find((x) => x.level === level);
  if (!item || !('price' in item) || item.price <= 0) throw new AppError(t('هذه السرعة ما تنشرى', 'This speed is not for sale'), 400, 'BAD_THROW');
  const profile = await profileFor(user);
  if ((profile.throwOwned ?? 1) >= level) return { profile: profileView(profile) };
  if ((profile.throwOwned ?? 1) !== level - 1) throw new AppError(t('اشتري السرعة اللي قبلها أول', 'Buy the speed before it first'), 409, 'THROW_ORDER');
  const updated = await BattleProfile.findOneAndUpdate(
    { _id: profile._id, coins: { $gte: item.price }, throwOwned: level - 1 },
    { $inc: { coins: -item.price }, $set: { throwOwned: level } },
    { new: true }
  );
  if (!updated) throw notEnough();
  return { profile: profileView(updated) };
}

/**
 * A watched ad for a throw speed. Adsgram's own confirmation is used when it has arrived;
 * it often comes late (or not at all from the Cloudflare page), so the game's word that the
 * ad was watched is accepted too, at most once every 20 seconds per player (an ad is longer).
 */
export async function battleAdView(telegramId: number) {
  try {
    await consumeAdView(telegramId, 'battle_throw');
    return;
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'AD_NOT_CONFIRMED') throw err;
  }
  const recent = await AdView.exists({ telegramId, consumedFor: 'battle_throw', createdAt: { $gte: new Date(Date.now() - 20000) } });
  if (recent) throw new AppError(t('استنى شوية وجرّب الإعلان مرة ثانية', 'Wait a moment and try the ad again'), 429, 'AD_TOO_SOON');
  await AdView.create({ telegramId, source: 'client', consumedAt: new Date(), consumedFor: 'battle_throw' });
}

/** One watched ad toward ×20 (one ad) or ×50 (two ads): opens it for 15 minutes. */
export async function throwAd(user: HydratedDocument<IUser>, adminRole: string | null, level: number) {
  await assertBattleAllowed(adminRole);
  if (level !== 4 && level !== 5) throw new AppError(t('هذه السرعة ما تنفتح بإعلان', 'This speed does not open with ads'), 400, 'BAD_THROW');
  await battleAdView(user.telegramId);
  const profile = await profileFor(user);
  const until = new Date(Date.now() + THROW_AD_MINUTES * 60000);
  // Never shortens a longer unlock (a permanent one from the developers).
  const later = (d?: Date | null) => (d && new Date(d).getTime() > until.getTime() ? d : until);
  if (level === 4) {
    profile.x20Until = later(profile.x20Until);
  } else if ((profile.x50Ads ?? 0) + 1 >= 2) {
    profile.x50Until = later(profile.x50Until);
    profile.x50Ads = 0;
  } else {
    profile.x50Ads = (profile.x50Ads ?? 0) + 1;
  }
  await profile.save();
  return { profile: profileView(profile) };
}

/** Buys the next start size. */
export async function buySize(user: HydratedDocument<IUser>, adminRole: string | null, index: number) {
  await assertBattleAllowed(adminRole);
  const item = START_SIZES[index];
  if (!item || index === 0) throw new AppError(t('الحجم غير موجود', 'Size not found'), 400, 'BAD_SIZE');
  const profile = await profileFor(user);
  if ((profile.sizeOwned ?? 0) >= index) return { profile: profileView(profile) };
  if ((profile.sizeOwned ?? 0) !== index - 1) throw new AppError(t('اشتري الحجم اللي قبله أول', 'Buy the size before it first'), 409, 'SIZE_ORDER');
  const updated = await BattleProfile.findOneAndUpdate(
    { _id: profile._id, coins: { $gte: item.price }, sizeOwned: index - 1 },
    { $inc: { coins: -item.price }, $set: { sizeOwned: index } },
    { new: true }
  );
  if (!updated) throw notEnough();
  return { profile: profileView(updated) };
}

/**
 * Pays the coin reward of every level reached since the last payout (once each: the
 * levelRewarded mark only moves forward, atomically). Returns the coins paid.
 */
export async function payLevelRewards(telegramId: number) {
  const p = await BattleProfile.findOne({ telegramId }).select('xp levelRewarded');
  if (!p) return 0;
  const level = battleLevel(p.xp ?? 0).level;
  const from = p.levelRewarded ?? 1;
  if (level <= from) return 0;
  let coins = 0;
  for (let l = from + 1; l <= level; l++) coins += levelReward(l);
  const done = await BattleProfile.updateOne({ telegramId, levelRewarded: from }, { $inc: { coins }, $set: { levelRewarded: level } });
  return done.modifiedCount ? coins : 0;
}

/** Pays the coins and experience for one online kill; tells the game the new level. */
export async function rewardBattleKill(telegramId: number, victimMass: number) {
  const got = killReward(victimMass);
  const before = await BattleProfile.findOneAndUpdate(
    { telegramId },
    { $inc: { coins: got.coins, xp: got.xp, kills: 1 } },
    { new: false }
  ).select('xp');
  if (!before) return null;
  const was = battleLevel(before.xp ?? 0).level;
  const now = battleLevel((before.xp ?? 0) + got.xp).level;
  const levelCoins = now > was ? await payLevelRewards(telegramId) : 0;
  return { coins: got.coins + levelCoins, level: now, levelUp: now > was };
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
      $set: { name: displayName(user as never), skin: profile?.skin ?? DEFAULT_SKIN },
    },
    { upsert: true }
  );
  // Experience for playing too: a little for time alive and for how big you got.
  const xp = Math.min(300, Math.floor(seconds / 6) + Math.floor(mass / 100));
  await BattleProfile.updateOne({ telegramId: user.telegramId }, { $max: { bestMass: mass }, $inc: { totalMatches: 1, totalSeconds: seconds, xp } });
  await payLevelRewards(user.telegramId);
}

/**
 * Who is joining the online room: checks the signed Telegram initData (like every API
 * call), that the account may use MF Battle (developers for now), and loads the skin.
 */
export async function battleIdentityData(initData: string) {
  let parsed;
  try {
    parsed = verifyTelegramInitData(initData);
  } catch {
    throw new AppError(t('افتح اللعبة من داخل البوت', 'Open the game from the bot'), 401, 'UNAUTHORIZED');
  }
  const user = await User.findOne({ telegramId: parsed.user.id });
  if (!user) throw new AppError(t('افتح البوت أول مرة', 'Open the bot first'), 401, 'UNAUTHORIZED');
  if (user.isBanned) throw new AppError(t('حسابك محظور', 'Your account is banned'), 403, 'BANNED');
  await assertBattleAllowed(await getAdminRole(user.telegramId));
  const profile = await profileFor(user);
  return {
    telegramId: user.telegramId,
    name: displayName(user).slice(0, 24),
    skin: SKIN_IDS.has(profile.skin) ? profile.skin : DEFAULT_SKIN,
    level: battleLevel(profile.xp ?? 0).level,
    startMass: startMassOf(profile),
    throws: { throwOwned: profile.throwOwned ?? 1, x20Until: profile.x20Until ?? null, x50Until: profile.x50Until ?? null },
  };
}

/** A finished online life, by Telegram id (used by the Cloudflare game server too). */
export async function recordBattleMatchById(telegramId: number, match: { mass: number; seconds: number }) {
  const user = await User.findOne({ telegramId }).select('telegramId firstName username');
  if (user) await recordBattleMatch(user, match);
}

/**
 * Who is joining the online room: checks the signed Telegram initData (like every API
 * call), that the account may use MF Battle (developers for now), and loads the skin.
 */
export async function battleIdentity(initData: string) {
  const d = await battleIdentityData(initData);
  return {
    ...d,
    // Checked on every throw, so a 15-minute ad unlock ends on time mid-game.
    canThrow: (lv: number) => allowedThrows(d.throws).includes(lv),
    record: (match: { mass: number; seconds: number }) => recordBattleMatchById(d.telegramId, match),
    onKill: (victimMass: number) => rewardBattleKill(d.telegramId, victimMass),
  };
}

/** Where the API server itself serves the MF Battle files (same domain as the Mini App). */
export const MF_BATTLE_PATH = '/mf-battle';

/**
 * A link that opens MF Battle from anywhere in Telegram. With the Mini App's short name it
 * opens the roulette app, which goes straight into the game (startapp=battle); without it,
 * the bot's chat answers /start battle with an "enter the game" button.
 */
export function battleDirectLink() {
  if (!env.BOT_USERNAME) return null;
  return env.MINI_APP_SHORT_NAME
    ? `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=battle`
    : `https://t.me/${env.BOT_USERNAME}?start=battle`;
}

/** MF Battle's address: MF_BATTLE_URL when set (e.g. Cloudflare), otherwise this server's /mf-battle. */
export function battleUrl() {
  return env.MF_BATTLE_URL || MF_BATTLE_PATH;
}
