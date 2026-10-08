import mongoose, { HydratedDocument } from 'mongoose';
import { IUser, User } from '../models/User';
import { AdView, AdPurpose } from '../models/AdView';
import { GameSession } from '../models/GameSession';
import { getSettings, ISettings, Settings } from '../models/Settings';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { t } from '../i18n';

const HOUR_MS = 60 * 60 * 1000;
/** Points needed for one points-wheel spin (see performSpin). */
export const POINTS_PER_SPIN = 5;
/** How long a confirmed ad can wait to be spent before it's ignored. */
const AD_CLAIM_WINDOW_MS = 15 * 60 * 1000;
/** Extra time allowed after the round's clock for the result to reach the server. */
const FINISH_GRACE_MS = 30 * 1000;
/** The snake moves one cell every ~150ms, so no bite can come faster than this. */
const MIN_MS_PER_FOOD = 300;
/** A new ziggurat brick needs at least this long to slide over the tower. */
const MIN_MS_PER_FLOOR = 300;
/** A ziggurat round has no clock; after this long it no longer pays. */
const ZIGGURAT_MAX_MINUTES = 30;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function gamesAllowed(settings: Pick<ISettings, 'gamesPublic'>, adminRole: string | null) {
  return settings.gamesPublic || adminRole !== null;
}

function assertAllowed(settings: ISettings, adminRole: string | null) {
  if (!gamesAllowed(settings, adminRole)) throw new AppError(t('قريباً', 'Coming soon'), 403, 'GAMES_COMING_SOON');
}

export async function getGamesStatus(user: HydratedDocument<IUser>, adminRole: string | null) {
  const settings = await getSettings();
  const cooldownMs = settings.snakeFreeCooldownHours * HOUR_MS;
  const freeReadyAt = user.lastFreeGameAt ? new Date(user.lastFreeGameAt.getTime() + cooldownMs) : new Date(0);
  const zigguratFreeReadyAt = user.lastFreeZigguratAt ? new Date(user.lastFreeZigguratAt.getTime() + cooldownMs) : new Date(0);
  const adTaskReward = settings.adTaskReward;
  return {
    allowed: gamesAllowed(settings, adminRole),
    comingSoon: !settings.gamesPublic,
    blockId: settings.adsgramBlockId,
    spinPoints: user.spinPoints,
    snake: {
      durationSec: settings.snakeDurationSec,
      pointsPerFood: settings.snakePointsPerFood,
      freeMaxFood: settings.snakeFreeMaxFood,
      adMaxFood: settings.snakeAdMaxFood,
      freeReady: Date.now() >= freeReadyAt.getTime(),
      freeReadyAt,
    },
    ziggurat: {
      pointsPerFloor: settings.zigguratPointsPerFloor,
      maxFloors: settings.zigguratMaxFloors,
      freeReady: Date.now() >= zigguratFreeReadyAt.getTime(),
      freeReadyAt: zigguratFreeReadyAt,
    },
    adTask: {
      reward: adTaskReward,
      adsPerSpin: adTaskReward > 0 ? Math.ceil(POINTS_PER_SPIN / adTaskReward) : null,
    },
  };
}

/**
 * Spends one finished ad. With ADSGRAM_REWARD_KEY set, only views Adsgram confirmed through
 * the Reward URL count; the client retries for a few seconds because the callback can land
 * just after the ad closes. Without a key (testing), the client's word is taken.
 */
export async function consumeAdView(telegramId: number, purpose: AdPurpose) {
  if (!env.ADSGRAM_REWARD_KEY) {
    await AdView.create({ telegramId, source: 'client', consumedAt: new Date(), consumedFor: purpose });
    return;
  }
  const view = await AdView.findOneAndUpdate(
    {
      telegramId,
      source: 'adsgram_callback',
      consumedAt: null,
      createdAt: { $gte: new Date(Date.now() - AD_CLAIM_WINDOW_MS) },
    },
    { $set: { consumedAt: new Date(), consumedFor: purpose } },
    { sort: { createdAt: 1 }, new: true }
  );
  if (!view) throw new AppError(t('لم يتم تأكيد مشاهدة الإعلان بعد', 'The ad view is not confirmed yet'), 409, 'AD_NOT_CONFIRMED');
}

/** Ads are only required where an Adsgram block is set up (otherwise nobody could pass). */
export async function adsBlockId() {
  const settings = await getSettings();
  return settings.adsgramBlockId || null;
}

/** Spends one watched ad for an action that requires it; a no-op while ads aren't set up. */
export async function requireAd(telegramId: number, purpose: AdPurpose) {
  if (!(await adsBlockId())) return;
  await consumeAdView(telegramId, purpose);
}

/** Adsgram's server-to-server Reward URL: one call per ad watched to the end. */
export async function recordAdsgramReward(key: string, userId: string) {
  if (!env.ADSGRAM_REWARD_KEY || key !== env.ADSGRAM_REWARD_KEY) {
    throw new AppError('Forbidden', 403, 'FORBIDDEN');
  }
  const telegramId = Number(userId);
  if (!Number.isInteger(telegramId) || telegramId <= 0) throw new AppError('Bad userId', 422, 'VALIDATION_ERROR');
  await AdView.create({ telegramId, source: 'adsgram_callback' });
}

async function addPoints(userId: unknown, amount: number) {
  if (amount <= 0) return;
  await User.updateOne({ _id: userId }, { $inc: { spinPoints: round3(amount) } });
}

export async function claimAdTask(user: HydratedDocument<IUser>, adminRole: string | null) {
  const settings = await getSettings();
  assertAllowed(settings, adminRole);
  await consumeAdView(user.telegramId, 'ad_task');
  const reward = round3(settings.adTaskReward);
  await addPoints(user._id, reward);
  return { reward };
}

export async function startSnakeRound(user: HydratedDocument<IUser>, adminRole: string | null, mode: 'free' | 'ad') {
  const settings = await getSettings();
  assertAllowed(settings, adminRole);
  const now = new Date();

  if (mode === 'free') {
    const cutoff = new Date(now.getTime() - settings.snakeFreeCooldownHours * HOUR_MS);
    const claimed = await User.updateOne(
      { _id: user._id, $or: [{ lastFreeGameAt: null }, { lastFreeGameAt: { $lte: cutoff } }] },
      { $set: { lastFreeGameAt: now } }
    );
    if (claimed.modifiedCount !== 1) throw new AppError(t('الجولة المجانية غير متاحة الآن', 'The free round is not available yet'), 429, 'GAME_COOLDOWN');
  } else {
    await consumeAdView(user.telegramId, 'snake_round');
  }

  // Only one round at a time: an unfinished previous round is forfeited.
  await GameSession.updateMany({ user: user._id, status: 'playing', game: { $ne: 'ziggurat' } }, { $set: { status: 'abandoned', finishedAt: now } });

  const session = await GameSession.create({
    user: user._id,
    telegramId: user.telegramId,
    mode,
    maxFood: mode === 'free' ? settings.snakeFreeMaxFood : settings.snakeAdMaxFood,
    pointsPerFood: settings.snakePointsPerFood,
    durationSec: settings.snakeDurationSec,
    startedAt: now,
  });
  return {
    sessionId: String(session._id),
    mode,
    maxFood: session.maxFood,
    pointsPerFood: session.pointsPerFood,
    durationSec: session.durationSec,
  };
}

/**
 * Ends a round. Hitting itself loses everything; otherwise each bite is worth the round's
 * pointsPerFood. The server caps bites at the round's maximum and at what was physically
 * possible in the time played, so an edited client can't claim more.
 */
export async function finishSnakeRound(
  user: HydratedDocument<IUser>,
  params: { sessionId: string; food: number; died: boolean }
) {
  if (!mongoose.isValidObjectId(params.sessionId)) throw new AppError('Round not found', 404, 'GAME_NOT_FOUND');
  const session = await GameSession.findOne({ _id: params.sessionId, user: user._id });
  if (!session) throw new AppError('Round not found', 404, 'GAME_NOT_FOUND');
  if (session.status !== 'playing') throw new AppError('Round already finished', 409, 'GAME_FINISHED');

  const now = new Date();
  const elapsedMs = now.getTime() - session.startedAt.getTime();
  const tooLate = elapsedMs > session.durationSec * 1000 + FINISH_GRACE_MS;

  let food = Math.max(0, Math.floor(Number(params.food) || 0));
  food = Math.min(food, session.maxFood, Math.floor(elapsedMs / MIN_MS_PER_FOOD));
  const died = Boolean(params.died);
  const reward = died || tooLate ? 0 : round3(food * session.pointsPerFood);

  const updated = await GameSession.updateOne(
    { _id: session._id, status: 'playing' },
    { $set: { status: died ? 'died' : tooLate ? 'abandoned' : 'finished', food, reward, finishedAt: now } }
  );
  if (updated.modifiedCount !== 1) throw new AppError('Round already finished', 409, 'GAME_FINISHED');

  await addPoints(user._id, reward);
  if (tooLate) logger.warn({ telegramId: user.telegramId, sessionId: session._id }, 'snake round finished too late');
  return { reward, food, died, tooLate };
}

/** Ziggurat: a free round on the snake's cooldown, or one per ad watched. */
export async function startZigguratRound(user: HydratedDocument<IUser>, adminRole: string | null, mode: 'free' | 'ad') {
  const settings = await getSettings();
  assertAllowed(settings, adminRole);
  const now = new Date();

  if (mode === 'free') {
    const cutoff = new Date(now.getTime() - settings.snakeFreeCooldownHours * HOUR_MS);
    const claimed = await User.updateOne(
      { _id: user._id, $or: [{ lastFreeZigguratAt: null }, { lastFreeZigguratAt: { $lte: cutoff } }] },
      { $set: { lastFreeZigguratAt: now } }
    );
    if (claimed.modifiedCount !== 1) throw new AppError(t('الجولة المجانية غير متاحة الآن', 'The free round is not available yet'), 429, 'GAME_COOLDOWN');
  } else {
    await consumeAdView(user.telegramId, 'ziggurat_round');
  }

  await GameSession.updateMany({ user: user._id, status: 'playing', game: 'ziggurat' }, { $set: { status: 'abandoned', finishedAt: now } });
  const session = await GameSession.create({
    game: 'ziggurat',
    user: user._id,
    telegramId: user.telegramId,
    mode,
    maxFood: settings.zigguratMaxFloors,
    pointsPerFood: settings.zigguratPointsPerFloor,
    durationSec: ZIGGURAT_MAX_MINUTES * 60,
    startedAt: now,
  });
  return { sessionId: String(session._id), mode, maxFloors: session.maxFood, pointsPerFloor: session.pointsPerFood };
}

/**
 * Ends a ziggurat round: every brick that stayed on the tower is worth pointsPerFloor.
 * Capped at the round's maximum and at what could be stacked in the time played.
 */
export async function finishZigguratRound(user: HydratedDocument<IUser>, params: { sessionId: string; floors: number }) {
  if (!mongoose.isValidObjectId(params.sessionId)) throw new AppError('Round not found', 404, 'GAME_NOT_FOUND');
  const session = await GameSession.findOne({ _id: params.sessionId, user: user._id, game: 'ziggurat' });
  if (!session) throw new AppError('Round not found', 404, 'GAME_NOT_FOUND');
  if (session.status !== 'playing') throw new AppError('Round already finished', 409, 'GAME_FINISHED');

  const now = new Date();
  const elapsedMs = now.getTime() - session.startedAt.getTime();
  const tooLate = elapsedMs > session.durationSec * 1000 + FINISH_GRACE_MS;
  let floors = Math.max(0, Math.floor(Number(params.floors) || 0));
  floors = Math.min(floors, session.maxFood, Math.floor(elapsedMs / MIN_MS_PER_FLOOR));
  const reward = tooLate ? 0 : round3(floors * session.pointsPerFood);

  const updated = await GameSession.updateOne(
    { _id: session._id, status: 'playing' },
    { $set: { status: tooLate ? 'abandoned' : 'finished', food: floors, reward, finishedAt: now } }
  );
  if (updated.modifiedCount !== 1) throw new AppError('Round already finished', 409, 'GAME_FINISHED');
  await addPoints(user._id, reward);
  if (tooLate) logger.warn({ telegramId: user.telegramId, sessionId: session._id }, 'ziggurat round finished too late');
  return { reward, floors, tooLate };
}

/** One-time move of the ziggurat rate to 0.01 per brick (later admin changes are kept). */
export async function applyZigguratRateV2() {
  const res = await Settings.updateOne(
    { singleton: 'main', zigguratRateV2: { $ne: true } },
    { $set: { zigguratPointsPerFloor: 0.01, zigguratRateV2: true } }
  );
  return res.modifiedCount > 0;
}

// ───────────── Admin ─────────────

const EDITABLE = [
  'gamesPublic',
  'adsgramBlockId',
  'adsgramInterstitialBlockId',
  'adTaskReward',
  'snakePointsPerFood',
  'snakeFreeMaxFood',
  'snakeAdMaxFood',
  'snakeDurationSec',
  'snakeFreeCooldownHours',
  'zigguratPointsPerFloor',
  'zigguratMaxFloors',
] as const;

export async function getGamesAdminSettings() {
  const settings = await getSettings();
  const dayAgo = new Date(Date.now() - 24 * HOUR_MS);
  const [ads, adsConfirmed, lastConfirmed, rounds] = await Promise.all([
    AdView.countDocuments({ createdAt: { $gte: dayAgo } }),
    // Views Adsgram itself reported to this server (Reward URL).
    AdView.countDocuments({ source: 'adsgram_callback', createdAt: { $gte: dayAgo } }),
    AdView.findOne({ source: 'adsgram_callback' }).sort({ createdAt: -1 }).select('createdAt').lean(),
    GameSession.countDocuments({ createdAt: { $gte: dayAgo } }),
  ]);
  return {
    ...Object.fromEntries(EDITABLE.map((k) => [k, settings[k]])),
    rewardUrlConfigured: Boolean(env.ADSGRAM_REWARD_KEY),
    last24h: { ads, adsConfirmed, rounds },
    lastConfirmedAt: lastConfirmed?.createdAt ?? null,
  };
}

/** Did Adsgram report a view by this person (its Reward URL) since `since`? For the admin's ad check. */
export async function adsgramConfirmedSince(telegramId: number, since: Date) {
  const view = await AdView.findOne({ telegramId, source: 'adsgram_callback', createdAt: { $gte: since } }).select('createdAt').lean();
  return { confirmed: Boolean(view), at: view?.createdAt ?? null, rewardUrlConfigured: Boolean(env.ADSGRAM_REWARD_KEY) };
}

export async function updateGamesAdminSettings(input: Record<string, unknown>) {
  const settings = await getSettings();
  for (const key of EDITABLE) {
    if (!(key in input)) continue;
    const value = input[key];
    if (key === 'gamesPublic') {
      settings.gamesPublic = Boolean(value);
    } else if (key === 'adsgramBlockId') {
      const id = String(value ?? '').trim();
      if (!/^[A-Za-z0-9-]+$/.test(id)) throw new AppError('رقم البلوك غير صالح', 422, 'VALIDATION_ERROR');
      settings.adsgramBlockId = id;
    } else if (key === 'adsgramInterstitialBlockId') {
      const id = String(value ?? '').trim();
      if (id && !/^int-\d+$/.test(id)) throw new AppError('بلوك الإعلان البيني لازم يكون مثل int-12345', 422, 'VALIDATION_ERROR');
      settings.adsgramInterstitialBlockId = id;
    } else {
      const n = Number(value);
      const integer = key === 'snakeFreeMaxFood' || key === 'snakeAdMaxFood' || key === 'snakeDurationSec' || key === 'zigguratMaxFloors';
      if (!Number.isFinite(n) || n < 0 || (integer && (!Number.isInteger(n) || n < 1))) {
        throw new AppError(`قيمة غير صالحة: ${key}`, 422, 'VALIDATION_ERROR');
      }
      if (key === 'snakeDurationSec' && n < 10) throw new AppError('مدة الجولة لازم 10 ثواني على الأقل', 422, 'VALIDATION_ERROR');
      (settings as unknown as Record<string, number>)[key] = n;
    }
  }
  await settings.save();
  return getGamesAdminSettings();
}
