import { BattleProfile } from '../models/BattleProfile';
import { BattleWeeklyStat } from '../models/BattleWeeklyStat';
import { BattleTournament, BattleTournamentEntry, BattleTournamentMode, IBattleTournament } from '../models/BattleTournament';
import { Settings } from '../models/Settings';
import { User } from '../models/User';
import { writeAudit } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getBotInstance } from '../bot/instance';
import { listAllAdminTelegramIds } from './admin.service';
import { runBroadcast } from './broadcast.service';
import { findUserByLookup } from './user.service';
import {
  BATTLE_SKINS,
  START_SIZES,
  THROW_SHOP,
  battleIsPublic,
  battleLevel,
  displayName,
  forgetBattlePublicCache,
  profileFor,
  weekKey,
} from './battle.service';

// ───────────────────────── Tournaments ─────────────────────────

export const TOURNAMENT_MODES: Record<BattleTournamentMode, { ar: string; how: string }> = {
  longest: { ar: 'أطول وقت متصدر', how: 'أكثر واحد يبقى متصدر (الأول بالترتيب) خلال وقت البطولة هو الفائز' },
  final: { ar: 'متصدر النهاية', how: 'اللي يكون متصدر (الأول بالترتيب) بآخر ثانية من البطولة هو الفائز' },
};
const MAX_MINUTES = 7 * 24 * 60;
// A permanent ad unlock (×20 / ×50) given by a developer.
const FOREVER = new Date('2100-01-01T00:00:00Z');

const fmtDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} ساعة و ${m} دقيقة`;
  if (m) return `${m} دقيقة${r ? ` و ${r} ثانية` : ''}`;
  return `${r} ثانية`;
};
const fmtMinutes = (minutes: number) => fmtDuration(minutes * 60);
const baghdadTime = (d: Date) =>
  new Date(d.getTime() + 3 * 3600e3).toISOString().slice(11, 16) + ' (بتوقيت بغداد)';

/** A button that opens MF Battle from a bot message (/start battle). */
function playButton() {
  if (!env.BOT_USERNAME) return undefined;
  return [{ text: '⚔️ ادخل MF Battle', url: `https://t.me/${env.BOT_USERNAME}?start=battle` }];
}

let runningCache: { value: IBattleTournament | null; at: number } = { value: null, at: 0 };
function forgetRunning() {
  runningCache = { value: null, at: 0 };
}
export async function runningTournament() {
  if (Date.now() - runningCache.at < 2000) return runningCache.value;
  const value = await BattleTournament.findOne({ status: 'running' }).sort({ startedAt: -1 });
  runningCache = { value, at: Date.now() };
  return value;
}

function ranked(t: Pick<IBattleTournament, 'standings'>) {
  return Object.values(t.standings ?? {})
    .map((e) => ({ telegramId: Number(e.telegramId), name: String(e.name ?? ''), leadSeconds: Math.round(Number(e.leadSeconds) || 0), bestMass: Math.round(Number(e.bestMass) || 0) }))
    .sort((a, b) => b.leadSeconds - a.leadSeconds || b.bestMass - a.bestMass);
}

export function tournamentView(t: IBattleTournament | null) {
  if (!t) return null;
  const top = ranked(t).slice(0, 10);
  return {
    id: String(t._id),
    status: t.status,
    mode: t.mode,
    modeName: TOURNAMENT_MODES[t.mode].ar,
    how: TOURNAMENT_MODES[t.mode].how,
    minutes: t.minutes,
    startedAt: t.startedAt,
    endsAt: t.endsAt,
    current: t.current ? { telegramId: t.current.telegramId, name: t.current.name, mass: t.current.mass } : null,
    top,
    winner: t.winner,
  };
}

function startText(t: IBattleTournament) {
  return [
    '🏆 بدت بطولة MF Battle!',
    '',
    `⏱️ المدة: ${fmtMinutes(t.minutes)} — تخلص الساعة ${baghdadTime(t.endsAt)}`,
    `🎯 طريقة الفوز: ${TOURNAMENT_MODES[t.mode].how}.`,
    '',
    'ادخل هسه، كُل الأصغر منك وتصدّر الساحة 🔥',
  ].join('\n');
}

/** Starts a tournament; with broadcast, every player is told how long it lasts and how to win. */
export async function startTournament(input: { minutes: unknown; mode: unknown; broadcast: unknown }, actor: { id: number; username?: string }) {
  const minutes = Math.floor(Number(input.minutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new AppError('حدد مدة البطولة بالدقائق (1 إلى 10080)', 422, 'VALIDATION_ERROR');
  const mode = input.mode === 'final' ? 'final' : input.mode === 'longest' ? 'longest' : null;
  if (!mode) throw new AppError('اختار نوع البطولة', 422, 'VALIDATION_ERROR');
  if (await BattleTournament.exists({ status: 'running' })) throw new AppError('اكو بطولة شغالة هسه، خلّصها أو ألغيها أول', 409, 'TOURNAMENT_RUNNING');
  const now = new Date();
  const t = await BattleTournament.create({
    status: 'running',
    mode,
    minutes,
    startedAt: now,
    endsAt: new Date(now.getTime() + minutes * 60000),
    startedBy: actor.id,
    announced: input.broadcast === true,
  });
  forgetRunning();
  await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'battle.tournament.start', target: String(t._id), metadata: { minutes, mode, broadcast: t.announced } });
  let broadcast: { total: number; to: 'all' | 'developers' } | null = null;
  if (t.announced) {
    // While the game is for developers only, the news goes to the developers only.
    const open = await battleIsPublic();
    const ids = open ? (await User.find({ isBanned: false }, { telegramId: 1 })).map((u) => u.telegramId) : await listAllAdminTelegramIds();
    broadcast = { total: ids.length, to: open ? 'all' : 'developers' };
    void runBroadcast(getBotInstance(), startText(t), { scope: 'direct', telegramIds: ids }, playButton(), actor.id, actor.username).catch((err) =>
      logger.warn({ err }, 'tournament broadcast failed')
    );
  }
  return { tournament: tournamentView(t), broadcast };
}

/**
 * What a game room reports every few seconds: who was first among the real players and for
 * how long. Returns the running tournament (if any) for the room to show on the players' screens.
 */
export async function reportLeaders(input: { lead?: unknown; current?: unknown; room?: unknown; players?: unknown }) {
  noteRoom(String(input.room || 'main'), Number(input.players) || 0);
  let t = await runningTournament();
  if (!t) return { tour: null };
  const now = new Date();
  if (t.endsAt <= now) {
    void finishDueTournaments().catch((err) => logger.warn({ err }, 'tournament finish failed'));
    return { tour: null };
  }
  const inc: Record<string, number> = {};
  const set: Record<string, unknown> = {};
  const max: Record<string, number> = {};
  const lead = Array.isArray(input.lead) ? input.lead.slice(0, 20) : [];
  for (const row of lead) {
    if (!Array.isArray(row)) continue;
    const id = Number(row[0]);
    const seconds = Number(row[2]);
    if (!Number.isSafeInteger(id) || id <= 0 || !(seconds > 0)) continue;
    const key = `standings.${id}`;
    inc[`${key}.leadSeconds`] = Math.min(60, seconds);
    set[`${key}.telegramId`] = id;
    set[`${key}.name`] = String(row[1] ?? '').slice(0, 24);
    max[`${key}.bestMass`] = Math.max(0, Math.floor(Number(row[3]) || 0));
  }
  const cur = input.current as { telegramId?: unknown; name?: unknown; mass?: unknown } | null | undefined;
  if (cur && Number.isSafeInteger(Number(cur.telegramId)) && Number(cur.telegramId) > 0) {
    const mass = Math.max(0, Math.floor(Number(cur.mass) || 0));
    const id = Number(cur.telegramId);
    const prev = t.current;
    // Two rooms (Railway and Cloudflare) can both report: the bigger leader wins.
    const prevFresh = prev && now.getTime() - new Date(prev.at).getTime() < 6000;
    if (!prevFresh || prev.telegramId === id || prev.mass <= mass) {
      set.current = { telegramId: id, name: String(cur.name ?? '').slice(0, 24), mass, at: now };
    }
    max[`standings.${id}.bestMass`] = Math.max(max[`standings.${id}.bestMass`] ?? 0, mass);
    set[`standings.${id}.telegramId`] = id;
    set[`standings.${id}.name`] = String(cur.name ?? '').slice(0, 24);
  }
  if (Object.keys(inc).length || Object.keys(set).length || Object.keys(max).length) {
    const update: Record<string, unknown> = {};
    if (Object.keys(inc).length) update.$inc = inc;
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(max).length) update.$max = max;
    t = (await BattleTournament.findOneAndUpdate({ _id: t._id, status: 'running' }, update, { new: true })) ?? t;
    runningCache = { value: t, at: Date.now() };
  }
  // The name shown in the game: the leader by time, or who is first right now.
  const top = t.mode === 'longest' ? ranked(t)[0] : null;
  return {
    tour: {
      mode: t.mode,
      endsAt: t.endsAt.getTime(),
      leader: (t.mode === 'longest' ? (top ? [top.name, Math.round(top.leadSeconds)] : null) : t.current ? [t.current.name, t.current.mass] : null) as [string, number] | null,
    },
  };
}

async function tell(id: number, text: string) {
  try {
    await getBotInstance().sendMessage(id, text);
  } catch (err) {
    logger.warn({ err, id }, 'battle message failed');
  }
}

/** Ends a tournament: picks the winner and tells the developers and the winner. */
async function finish(t: IBattleTournament) {
  const list = ranked(t);
  let winner: (BattleTournamentEntry & { finalMass?: number }) | null = null;
  if (t.mode === 'longest') {
    winner = list[0] && list[0].leadSeconds > 0 ? list[0] : null;
  } else if (t.current && new Date(t.current.at).getTime() > t.endsAt.getTime() - 60000) {
    const e = t.standings?.[String(t.current.telegramId)];
    winner = { telegramId: t.current.telegramId, name: t.current.name, leadSeconds: e?.leadSeconds ?? 0, bestMass: e?.bestMass ?? t.current.mass, finalMass: t.current.mass };
  }
  await BattleTournament.updateOne({ _id: t._id }, { $set: { winner } });
  forgetRunning();

  const lines = [
    '🏁 خلصت بطولة MF Battle',
    `🎯 النوع: ${TOURNAMENT_MODES[t.mode].ar} · المدة: ${fmtMinutes(t.minutes)}`,
    '',
    winner
      ? `🥇 الفائز: ${winner.name} (${winner.telegramId})\n⏱️ وقت التصدر: ${fmtDuration(winner.leadSeconds)}\n⚖️ أعلى كتلة: ${winner.bestMass}${winner.finalMass ? `\n🏁 كتلته بالنهاية: ${winner.finalMass}` : ''}`
      : '😶 ماكو فائز (محد لعب أو محد تصدر بالنهاية)',
  ];
  if (list.length) {
    lines.push('', '📊 أكثر المتصدرين:');
    list.slice(0, 5).forEach((e, i) => lines.push(`${i + 1}. ${e.name} — ${fmtDuration(e.leadSeconds)} · أعلى كتلة ${e.bestMass}`));
  }
  const report = lines.join('\n');
  for (const id of await listAllAdminTelegramIds()) await tell(id, report);
  if (winner) {
    await tell(
      winner.telegramId,
      [
        '🏆 مبروك! انت فزت ببطولة MF Battle 🎉',
        '',
        `🎯 نوع البطولة: ${TOURNAMENT_MODES[t.mode].ar}`,
        `⏱️ تصدرت ${fmtDuration(winner.leadSeconds)}`,
        `⚖️ أعلى كتلة وصلتها: ${winner.bestMass}${winner.finalMass ? `\n🏁 كتلتك بآخر ثانية: ${winner.finalMass}` : ''}`,
        '',
        'المطورين راح يتواصلون وياك بخصوص الجائزة 🎁',
      ].join('\n')
    );
  }
}

/** Ends every tournament whose time is up (runs every few seconds, and on demand). */
export async function finishDueTournaments() {
  for (;;) {
    const t = await BattleTournament.findOneAndUpdate(
      { status: 'running', endsAt: { $lte: new Date() } },
      { $set: { status: 'ended', endedAt: new Date() } },
      { new: true }
    );
    if (!t) return;
    forgetRunning();
    await finish(t);
  }
}

export async function endTournamentNow(actor: { id: number; username?: string }) {
  const t = await BattleTournament.findOneAndUpdate({ status: 'running' }, { $set: { status: 'ended', endedAt: new Date(), endsAt: new Date() } }, { new: true });
  if (!t) throw new AppError('ماكو بطولة شغالة', 404, 'NO_TOURNAMENT');
  forgetRunning();
  await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'battle.tournament.end', target: String(t._id) });
  await finish(t);
  return { tournament: tournamentView(await BattleTournament.findById(t._id)) };
}

export async function cancelTournament(actor: { id: number; username?: string }) {
  const t = await BattleTournament.findOneAndUpdate({ status: 'running' }, { $set: { status: 'cancelled', endedAt: new Date() } }, { new: true });
  if (!t) throw new AppError('ماكو بطولة شغالة', 404, 'NO_TOURNAMENT');
  forgetRunning();
  await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'battle.tournament.cancel', target: String(t._id) });
  return { tournament: tournamentView(t) };
}

let finishTimer: NodeJS.Timeout | null = null;
/** Checks every 10 seconds for a tournament whose time ran out. */
export function startTournamentWorker() {
  if (finishTimer) return;
  finishTimer = setInterval(() => {
    finishDueTournaments().catch((err) => logger.warn({ err }, 'tournament finish failed'));
  }, 10000);
  finishTimer.unref();
}

// ───────────────────────── Rooms online ─────────────────────────

const rooms = new Map<string, { players: number; at: number }>();
function noteRoom(room: string, players: number) {
  rooms.set(room.slice(0, 40), { players: Math.max(0, Math.min(1000, Math.floor(players))), at: Date.now() });
}
function onlineNow() {
  let n = 0;
  for (const [k, r] of rooms) {
    if (Date.now() - r.at > 15000) rooms.delete(k);
    else n += r.players;
  }
  return n;
}

// ───────────────────────── Players ─────────────────────────

async function targetUser(query: unknown) {
  const user = await findUserByLookup(String(query ?? ''));
  if (!user) throw new AppError('ما لكيت هذا المستخدم (اكتب الآيدي أو @اليوزر)', 404, 'USER_NOT_FOUND');
  return user;
}

function playerView(user: { telegramId: number; username?: string | null; firstName?: string | null }, p: InstanceType<typeof BattleProfile>) {
  const permanent = (d?: Date | null) => !!d && new Date(d).getTime() > Date.now() + 365 * 24 * 3600e3;
  return {
    telegramId: user.telegramId,
    username: user.username ?? null,
    name: displayName(user as never),
    coins: p.coins,
    level: battleLevel(p.xp ?? 0).level,
    xp: p.xp ?? 0,
    kills: p.kills ?? 0,
    bestMass: p.bestMass ?? 0,
    totalMatches: p.totalMatches ?? 0,
    skin: p.skin,
    ownedSkins: p.ownedSkins ?? [],
    throwOwned: p.throwOwned ?? 1,
    x20Forever: permanent(p.x20Until),
    x50Forever: permanent(p.x50Until),
    sizeOwned: p.sizeOwned ?? 0,
  };
}

export async function lookupPlayer(query: unknown) {
  const user = await targetUser(query);
  const p = await profileFor(user);
  return { player: playerView(user, p) };
}

/**
 * Gives a player something: a skin, a throw speed for good (×5 … ×50), a start size, or
 * coins (a negative amount takes coins away). The player gets a message from the bot.
 */
export async function grantPlayer(input: { user?: unknown; kind?: unknown; value?: unknown; notify?: unknown }, actor: { id: number; username?: string }) {
  const user = await targetUser(input.user);
  const p = await profileFor(user);
  const kind = String(input.kind ?? '');
  let note = '';
  if (kind === 'skin') {
    const skin = BATTLE_SKINS.find((s) => s.id === String(input.value));
    if (!skin) throw new AppError('اختار سكن صحيح', 422, 'VALIDATION_ERROR');
    await BattleProfile.updateOne({ _id: p._id }, { $addToSet: { ownedSkins: skin.id } });
    note = `🎭 سكن ${skin.name.ar}`;
  } else if (kind === 'throw') {
    const level = Math.floor(Number(input.value));
    const item = THROW_SHOP.find((x) => x.level === level);
    if (!item || level < 2) throw new AppError('اختار سرعة رمي صحيحة', 422, 'VALIDATION_ERROR');
    if (level <= 3) await BattleProfile.updateOne({ _id: p._id }, { $max: { throwOwned: level } });
    else {
      // ×20 / ×50 for good; the lower bought speeds open with them.
      await BattleProfile.updateOne({ _id: p._id }, { $set: { [level === 4 ? 'x20Until' : 'x50Until']: FOREVER }, $max: { throwOwned: 3 } });
    }
    note = `⚡ سرعة رمي ${item.label} دائمية`;
  } else if (kind === 'size') {
    const index = Math.floor(Number(input.value));
    if (!(index >= 1 && index < START_SIZES.length)) throw new AppError('اختار حجم صحيح', 422, 'VALIDATION_ERROR');
    await BattleProfile.updateOne({ _id: p._id }, { $max: { sizeOwned: index } });
    note = `⚖️ حجم بداية ${START_SIZES[index].mass}`;
  } else if (kind === 'coins') {
    const amount = Math.trunc(Number(input.value));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10_000_000) throw new AppError('اكتب عدد عملات صحيح', 422, 'VALIDATION_ERROR');
    if (amount > 0) await BattleProfile.updateOne({ _id: p._id }, { $inc: { coins: amount } });
    else await BattleProfile.updateOne({ _id: p._id }, [{ $set: { coins: { $max: [0, { $add: ['$coins', amount] }] } } }]);
    note = amount > 0 ? `🪙 ${amount} عملة MF` : `سحب ${-amount} عملة`;
  } else {
    throw new AppError('نوع الهدية غير معروف', 422, 'VALIDATION_ERROR');
  }
  await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: `battle.grant.${kind}`, target: String(user.telegramId), metadata: { value: input.value } });
  if (input.notify !== false && !(kind === 'coins' && Number(input.value) < 0)) {
    await tell(user.telegramId, `🎁 وصلتك هدية من مطوري MF Battle:\n${note}\n\nادخل اللعبة وشوفها 🔥`);
  }
  const fresh = await BattleProfile.findById(p._id);
  return { player: playerView(user, fresh ?? p), note };
}

// ───────────────────────── Broadcast & settings ─────────────────────────

/** A message to every bot user, or only to people who played MF Battle. */
export async function battleBroadcast(input: { text?: unknown; to?: unknown; button?: unknown }, actor: { id: number; username?: string }) {
  const text = String(input.text ?? '').trim().slice(0, 3500);
  if (!text) throw new AppError('اكتب نص الإذاعة', 422, 'VALIDATION_ERROR');
  const to = input.to === 'players' ? 'players' : input.to === 'developers' ? 'developers' : 'all';
  let ids: number[];
  if (to === 'players') ids = (await BattleProfile.find({}, { telegramId: 1 })).map((p) => p.telegramId);
  else if (to === 'developers') ids = await listAllAdminTelegramIds();
  else ids = (await User.find({ isBanned: false }, { telegramId: 1 })).map((u) => u.telegramId);
  void runBroadcast(getBotInstance(), text, { scope: 'direct', telegramIds: ids }, input.button === false ? undefined : playButton(), actor.id, actor.username).catch((err) =>
    logger.warn({ err }, 'battle broadcast failed')
  );
  return { total: ids.length, to };
}

export async function setBattlePublic(open: boolean, actor: { id: number; username?: string }) {
  await Settings.updateOne({ singleton: 'main' }, { $set: { battlePublic: open } }, { upsert: true });
  forgetBattlePublicCache();
  await writeAudit({ actorId: actor.id, actorUsername: actor.username, action: 'battle.public', metadata: { open } });
  return { public: open };
}

// ───────────────────────── Panel ─────────────────────────

export async function battleAdminHome() {
  const dayAgo = new Date(Date.now() - 24 * 3600e3);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600e3);
  const [profiles, newToday, newWeek, weekPlayers, sums, topKills, topMass, skinCounts, running, history] = await Promise.all([
    BattleProfile.countDocuments({}),
    BattleProfile.countDocuments({ createdAt: { $gte: dayAgo } }),
    BattleProfile.countDocuments({ createdAt: { $gte: weekAgo } }),
    BattleWeeklyStat.countDocuments({ week: weekKey() }),
    BattleProfile.aggregate([{ $group: { _id: null, matches: { $sum: '$totalMatches' }, seconds: { $sum: '$totalSeconds' }, kills: { $sum: '$kills' }, coins: { $sum: '$coins' } } }]),
    BattleProfile.find({ kills: { $gt: 0 } }).sort({ kills: -1 }).limit(5).select('telegramId kills'),
    BattleProfile.find({ bestMass: { $gt: 0 } }).sort({ bestMass: -1 }).limit(5).select('telegramId bestMass'),
    BattleProfile.aggregate([{ $unwind: '$ownedSkins' }, { $group: { _id: '$ownedSkins', n: { $sum: 1 } } }]),
    runningTournament(),
    BattleTournament.find({ status: { $ne: 'running' } }).sort({ startedAt: -1 }).limit(5),
  ]);
  const ids = [...new Set([...topKills, ...topMass].map((p) => p.telegramId))];
  const users = await User.find({ telegramId: { $in: ids } }).select('telegramId firstName username');
  const nameOf = (id: number) => {
    const u = users.find((x) => x.telegramId === id);
    return u ? displayName(u) : String(id);
  };
  const s = sums[0] ?? { matches: 0, seconds: 0, kills: 0, coins: 0 };
  return {
    public: await battleIsPublic(),
    stats: {
      online: onlineNow(),
      profiles,
      newToday,
      newWeek,
      weekPlayers,
      matches: s.matches,
      hours: Math.round(s.seconds / 3600),
      kills: s.kills,
      coins: s.coins,
      topKills: topKills.map((p) => ({ telegramId: p.telegramId, name: nameOf(p.telegramId), value: p.kills })),
      topMass: topMass.map((p) => ({ telegramId: p.telegramId, name: nameOf(p.telegramId), value: p.bestMass })),
      skins: Object.fromEntries(skinCounts.map((x: { _id: string; n: number }) => [x._id, x.n])),
    },
    tournament: tournamentView(running && running.endsAt > new Date() ? running : null),
    history: history.map((t) => tournamentView(t)),
    modes: Object.fromEntries(Object.entries(TOURNAMENT_MODES).map(([k, v]) => [k, v.ar])),
    skins: BATTLE_SKINS.map((x) => ({ id: x.id, name: x.name.ar })),
    throws: THROW_SHOP.filter((x) => x.level >= 2).map((x) => ({ level: x.level, label: x.label })),
    sizes: START_SIZES.map((x, i) => ({ index: i, mass: x.mass })).filter((x) => x.index > 0),
  };
}
