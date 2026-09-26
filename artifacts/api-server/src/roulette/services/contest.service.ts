import mongoose, { HydratedDocument } from 'mongoose';
import { nanoid } from 'nanoid';
import { User, IUser } from '../models/User';
import { ContestReferral } from '../models/ContestReferral';
import { createNotification } from './notification.service';
import { checkAllForcedChats } from './forcedSub.service';
import { getBotInstance } from '../bot/instance';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { getSettings, ISettings } from '../models/Settings';
import { AppError } from '../utils/AppError';

export const LEADERBOARD_SIZE = 25;

/** The prize for first place. Only the #1 contestant wins it. */
export const CONTEST_PRIZE = {
  name: 'Santa Hat',
  number: '#38438',
  nftUrl: 'https://t.me/nft/SantaHat-38438',
  imageUrl: '/nft-santa-hat.jpg',
  attributes: [
    { label: 'الموديل', value: 'Cold Autumn', rarity: '2%' },
    { label: 'الرمز', value: "New Year's Eve", rarity: '2.4%' },
    { label: 'الخلفية', value: 'Satin Gold', rarity: '1.5%' },
  ],
  valueUsd: '~$17',
};

export const CONTEST_RULES = [
  'كل شخص يدخل البوت من رابطك لأول مرة ويكمل الاشتراك الإجباري والكابتشا يُحسب لك +1.',
  'إذا الشخص اللي دعوته حظر البوت تنحذف دعوته وتنقص من نقاطك -1.',
  'كل شخص يُحسب لشخص واحد بس، وما يُحسب إذا جان مسجّل بالبوت من قبل.',
  'ممنوع الحسابات الوهمية أو الأرقام المزيفة، وأي دعوة مخالفة تنلغي.',
  'المركز الأول فقط هو اللي يربح الجائزة.',
];

export function parseContestToken(startParam?: string | null): string | null {
  if (!startParam) return null;
  const match = startParam.match(/^race_([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export function buildContestLink(token: string): string | null {
  if (!env.BOT_USERNAME) return null;
  return env.MINI_APP_SHORT_NAME
    ? `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=race_${token}`
    : `https://t.me/${env.BOT_USERNAME}?start=race_${token}`;
}

/** Link that opens the race section directly (for channels/posts). */
export function buildContestSectionLink(): string | null {
  if (!env.BOT_USERNAME) return null;
  return env.MINI_APP_SHORT_NAME
    ? `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=race`
    : `https://t.me/${env.BOT_USERNAME}?start=race`;
}

/** Entries before rounds existed have no `round` field and belong to round 1. */
function roundFilter(round: number) {
  return round === 1 ? { round: { $in: [1, null] } } : { round };
}

/** Counting stops once the end date passes or the winner of this round is announced. */
export function isContestClosed(settings: Pick<ISettings, 'contestEndsAt' | 'contestWinner' | 'contestRound'>, now = new Date()) {
  const round = settings.contestRound ?? 1;
  if (settings.contestWinner && settings.contestWinner.round === round) return true;
  return Boolean(settings.contestEndsAt && settings.contestEndsAt.getTime() <= now.getTime());
}

function profileLink(user: { username?: string; telegramId: number }) {
  return user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.telegramId}`;
}

function displayName(user: { username?: string; firstName?: string }) {
  return user.username ? '@' + user.username : user.firstName || 'مستخدم';
}

/** Called after the user read the intro and pressed "continue": gives them their link. */
export async function joinContest(user: HydratedDocument<IUser>) {
  if (!user.contestToken) user.contestToken = nanoid(12);
  if (!user.contestJoinedAt) user.contestJoinedAt = new Date();
  await user.save();
  return buildContestLink(user.contestToken);
}

/** A brand-new user opened someone's race link: record it, counted later once qualified. */
export async function registerContestReferralIfNew(params: {
  newUser: HydratedDocument<IUser>;
  token: string;
  isBrandNewUser: boolean;
}): Promise<'registered' | 'not_new' | 'self_referral' | 'already_referred' | 'contestant_not_found' | 'contest_closed'> {
  const { newUser, token, isBrandNewUser } = params;
  if (!isBrandNewUser) return 'not_new';
  const settings = await getSettings();
  if (isContestClosed(settings)) return 'contest_closed';
  const contestant = await User.findOne({ contestToken: token, contestJoinedAt: { $ne: null } });
  if (!contestant) return 'contestant_not_found';
  if (contestant.telegramId === newUser.telegramId) return 'self_referral';
  if (await ContestReferral.exists({ invitee: newUser._id })) return 'already_referred';

  try {
    await ContestReferral.create({
      contestant: contestant._id,
      contestantTelegramId: contestant.telegramId,
      invitee: newUser._id,
      inviteeTelegramId: newUser.telegramId,
      status: 'pending',
      round: settings.contestRound ?? 1,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 'already_referred';
    throw err;
  }
  return 'registered';
}

/** +1 for the contestant once the invitee has passed forced-sub and a captcha after joining. */
export async function tryCountContestReferral(inviteeUserId: mongoose.Types.ObjectId) {
  const entry = await ContestReferral.findOne({ invitee: inviteeUserId, status: 'pending' });
  if (!entry) return false;
  const settings = await getSettings();
  const round = settings.contestRound ?? 1;
  if ((entry.round ?? 1) !== round || isContestClosed(settings)) return false;

  const invitee = await User.findById(inviteeUserId);
  if (!invitee || invitee.botBlocked) return false;
  if (!invitee.forcedSubOk || !invitee.captchaPassed || !invitee.captchaPassedAt) return false;
  if (invitee.captchaPassedAt.getTime() < entry.createdAt.getTime()) return false;

  if (process.env.NODE_ENV !== 'test') {
    const { allOk } = await checkAllForcedChats(getBotInstance(), invitee.telegramId);
    if (!allOk) return false;
  }

  const counted = await ContestReferral.updateOne(
    { _id: entry._id, status: 'pending' },
    { $set: { status: 'counted', countedAt: new Date() } }
  );
  if (counted.modifiedCount !== 1) return false;

  const score = await ContestReferral.countDocuments({ contestant: entry.contestant, status: 'counted', ...roundFilter(round) });
  await createNotification({
    userId: entry.contestant,
    telegramId: entry.contestantTelegramId,
    type: 'referral_progress',
    title: '🏆 سباق الدعوات: +1',
    body: `انضم ${displayName(invitee)} عن طريق رابطك وأكمل الشروط.\nنقاطك الحالية: ${score} 🔥`,
  }).catch((err) => logger.warn({ err }, 'failed to notify contestant'));
  return true;
}

/** The invitee blocked the bot: the entry is removed for good (-1 if it was counted). */
export async function removeContestReferralForBlockedInvitee(inviteeTelegramId: number) {
  const settings = await getSettings();
  const round = settings.contestRound ?? 1;
  // Results are frozen once the race is closed.
  if (isContestClosed(settings)) return false;
  const entry = await ContestReferral.findOneAndUpdate(
    { inviteeTelegramId, status: { $in: ['pending', 'counted'] }, ...roundFilter(round) },
    { $set: { status: 'removed', removedAt: new Date() } },
    { new: false }
  );
  if (!entry || entry.status !== 'counted') return false;

  const invitee = await User.findOne({ telegramId: inviteeTelegramId }).select('username firstName');
  const score = await ContestReferral.countDocuments({ contestant: entry.contestant, status: 'counted', ...roundFilter(round) });
  await createNotification({
    userId: entry.contestant,
    telegramId: entry.contestantTelegramId,
    type: 'referral_progress',
    title: '🏆 سباق الدعوات: -1',
    body: `${invitee ? displayName(invitee) : 'مستخدم'} حظر البوت، فانحذفت دعوته من السباق.\nنقاطك الحالية: ${score}`,
  }).catch((err) => logger.warn({ err }, 'failed to notify contestant'));
  return true;
}

async function rankRound(round: number) {
  return ContestReferral.aggregate<{ _id: mongoose.Types.ObjectId; score: number; lastAt: Date }>([
    { $match: { status: 'counted', ...roundFilter(round) } },
    { $group: { _id: '$contestant', score: { $sum: 1 }, lastAt: { $max: '$countedAt' } } },
    // Ties go to whoever reached the score first.
    { $sort: { score: -1, lastAt: 1 } },
  ]);
}

async function buildLeaderboard(rows: Array<{ _id: mongoose.Types.ObjectId; score: number }>, meId?: unknown) {
  const top = rows.slice(0, LEADERBOARD_SIZE);
  const people = await User.find({ _id: { $in: top.map((r) => r._id) } }).select('username firstName photoUrl telegramId');
  const byId = new Map(people.map((p) => [String(p._id), p]));
  return top.map((row, i) => {
    const person = byId.get(String(row._id));
    return {
      rank: i + 1,
      telegramId: person?.telegramId ?? null,
      name: person ? displayName(person) : 'مستخدم',
      photoUrl: person?.photoUrl ?? null,
      profileLink: person ? profileLink(person) : null,
      score: row.score,
      isMe: meId !== undefined && String(row._id) === String(meId),
    };
  });
}

export async function getContestOverview(user: HydratedDocument<IUser>) {
  const settings = await getSettings();
  const round = settings.contestRound ?? 1;
  const rows = await rankRound(round);
  const myIndex = rows.findIndex((r) => String(r._id) === String(user._id));
  const joined = Boolean(user.contestJoinedAt && user.contestToken);
  const winner = settings.contestWinner && settings.contestWinner.round === round ? settings.contestWinner : null;

  return {
    joined,
    link: joined ? buildContestLink(user.contestToken!) : null,
    myScore: myIndex >= 0 ? rows[myIndex].score : 0,
    myRank: myIndex >= 0 ? myIndex + 1 : null,
    myPending: joined ? await ContestReferral.countDocuments({ contestant: user._id, status: 'pending', ...roundFilter(round) }) : 0,
    participants: rows.length,
    leaderboard: await buildLeaderboard(rows, user._id),
    endsAt: settings.contestEndsAt,
    closed: isContestClosed(settings),
    winner: winner ? { name: winner.name, score: winner.score, isMe: winner.telegramId === user.telegramId } : null,
    prize: CONTEST_PRIZE,
    rules: CONTEST_RULES,
  };
}

// ───────────── Admin ─────────────

export async function getContestAdminState() {
  const settings = await getSettings();
  const round = settings.contestRound ?? 1;
  const rows = await rankRound(round);
  return {
    round,
    endsAt: settings.contestEndsAt,
    closed: isContestClosed(settings),
    winner: settings.contestWinner && settings.contestWinner.round === round ? settings.contestWinner : null,
    participants: rows.length,
    joinedCount: await User.countDocuments({ contestJoinedAt: { $ne: null } }),
    top: await buildLeaderboard(rows.slice(0, 5)),
    sectionLink: buildContestSectionLink(),
    prize: CONTEST_PRIZE,
  };
}

export async function setContestEndsAt(endsAt: Date | null) {
  if (endsAt && Number.isNaN(endsAt.getTime())) throw new AppError('تاريخ غير صالح', 422, 'VALIDATION_ERROR');
  const settings = await getSettings();
  settings.contestEndsAt = endsAt;
  await settings.save();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tells everyone who joined the race who won, throttled for Telegram's rate limits. */
async function broadcastWinner(text: string, skipTelegramId: number) {
  const bot = getBotInstance();
  const cursor = User.find({ contestJoinedAt: { $ne: null }, botBlocked: { $ne: true }, isBanned: { $ne: true } })
    .select('telegramId')
    .cursor();
  for await (const person of cursor) {
    if (person.telegramId === skipTelegramId) continue;
    await bot.sendMessage(person.telegramId, text).catch(() => undefined);
    await sleep(50);
  }
}

/** Closes the round and announces #1 as the winner. */
export async function announceContestWinner() {
  const settings = await getSettings();
  const round = settings.contestRound ?? 1;
  if (settings.contestWinner && settings.contestWinner.round === round) {
    throw new AppError('تم إعلان الفائز لهذه الجولة مسبقاً', 409, 'ALREADY_ANNOUNCED');
  }
  const [first] = await rankRound(round);
  if (!first) throw new AppError('ماكو أي متسابق عنده دعوات بعد', 409, 'NO_CONTESTANTS');

  const person = await User.findById(first._id).select('telegramId username firstName');
  if (!person) throw new AppError('الفائز غير موجود', 404, 'USER_NOT_FOUND');
  const name = displayName(person);
  const now = new Date();

  settings.contestWinner = { telegramId: person.telegramId, name, score: first.score, round, announcedAt: now };
  if (!settings.contestEndsAt || settings.contestEndsAt.getTime() > now.getTime()) settings.contestEndsAt = now;
  await settings.save();

  const prizeTitle = `${CONTEST_PRIZE.name} ${CONTEST_PRIZE.number}`;
  await createNotification({
    userId: person._id as mongoose.Types.ObjectId,
    telegramId: person.telegramId,
    type: 'referral_reward',
    title: '🏆 مبروك! فزت بسباق الدعوات',
    body: `أنت المركز الأول بـ ${first.score} دعوة 🔥\nربحت هدية ${prizeTitle} NFT 🎁\n${CONTEST_PRIZE.nftUrl}\n\nتواصل ويّا الإدارة حتى تستلم هديتك.`,
  }).catch((err) => logger.warn({ err }, 'failed to notify race winner'));

  const text =
    `🏁 انتهى سباق الدعوات!\n\n🏆 الفائز: ${name}\n🔥 عدد الدعوات: ${first.score}\n🎁 الجائزة: ${prizeTitle} NFT\n\n` +
    'شكراً لكل المشاركين، ترقبوا السباق الجاي 👀';
  void broadcastWinner(text, person.telegramId).catch((err) => logger.warn({ err }, 'race winner broadcast failed'));

  logger.info({ round, winner: person.telegramId, score: first.score }, 'invite race winner announced');
  return settings.contestWinner;
}

/** Starts a fresh round: scores start from zero, everyone keeps their personal link. */
export async function startNewContestRound(endsAt: Date | null) {
  const settings = await getSettings();
  settings.contestRound = (settings.contestRound ?? 1) + 1;
  settings.contestWinner = null;
  settings.contestEndsAt = endsAt;
  await settings.save();
  return settings.contestRound;
}
