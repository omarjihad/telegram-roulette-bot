import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gFindOne: vi.fn(),
  gFindOneAndUpdate: vi.fn(),
  gUpdateOne: vi.fn(),
  eFindOne: vi.fn(),
  eFindOneAndUpdate: vi.fn(),
  eUpdateOne: vi.fn(),
  eCreate: vi.fn(),
  eFind: vi.fn(),
  config: vi.fn(),
  userExists: vi.fn(),
  membership: vi.fn(),
}));

vi.mock('../models/Giveaway', () => ({
  Giveaway: { findOne: mocks.gFindOne, findOneAndUpdate: mocks.gFindOneAndUpdate, updateOne: mocks.gUpdateOne },
  GiveawayEntry: {
    findOne: mocks.eFindOne,
    findOneAndUpdate: mocks.eFindOneAndUpdate,
    updateOne: mocks.eUpdateOne,
    create: mocks.eCreate,
    find: (...a: unknown[]) => ({ select: () => ({ lean: () => mocks.eFind(...a) }) }),
  },
  getGiveawayConfig: mocks.config,
}));
vi.mock('../models/User', () => ({ User: { exists: mocks.userExists } }));
vi.mock('../models/Counter', () => ({ nextSequence: vi.fn(async () => 1) }));
vi.mock('./forcedSub.service', () => ({ checkMembershipStatus: mocks.membership }));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import {
  drawNext,
  forwardedChannelPost,
  giveawayKeyboard,
  joinGiveaway,
  parsePostLink,
  pickWeighted,
  recordReferral,
  rememberUsernameThread,
  verifyComment,
  winnersKeyboard,
  winnersText,
} from './giveaway.service';

const user = { id: 7, is_bot: false, first_name: 'Omar', username: 'omar' };
const bot = {
  sendMessage: vi.fn(async () => ({ message_id: 99 })),
  editMessageText: vi.fn(async () => true),
  editMessageReplyMarkup: vi.fn(async () => true),
  getChatMember: vi.fn(),
  getMe: vi.fn(async () => ({ id: 1 })),
} as never;

function giveaway(over: Record<string, unknown> = {}) {
  return {
    _id: 'G1',
    seq: 3,
    status: 'open',
    channelId: -1001,
    channelUsername: 'gifts',
    postId: 10,
    discussionId: -2002,
    usernamePostId: 11,
    count: 4,
    winners: [] as never[],
    dropped: [] as number[],
    save: vi.fn(),
    ...over,
  };
}

describe('giveaways', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockResolvedValue({ required: [{ chatId: '-100500', title: 'MF', username: 'mfbisnes' }] });
    mocks.membership.mockResolvedValue({ isSubscribed: true, unavailable: false });
    mocks.userExists.mockResolvedValue({ _id: 'U' });
  });

  it('colours the buttons: open (green, red, blue, green, red) and stopped (red, green, blue, red, red)', () => {
    const style = (k: ReturnType<typeof giveawayKeyboard>) => k.inline_keyboard.flat().map((b) => (b as { style?: string }).style);
    const open = giveawayKeyboard({ seq: 3, status: 'open', count: 12 });
    expect(open.inline_keyboard.flat().map((b) => b.text)).toEqual(['انقر للانضمام • 12', 'سحب فائز', 'إيقاف الانضمام', '⚡ تعزيز نسبة فوزك', 'عدد المنضمين : 12']);
    expect(style(open)).toEqual(['success', 'danger', 'primary', 'success', 'danger']);
    const stopped = giveawayKeyboard({ seq: 3, status: 'stopped', count: 12 });
    expect(style(stopped)).toEqual(['danger', 'success', 'primary', 'danger', 'danger']);
    expect(stopped.inline_keyboard[1][1].text).toBe('تشغيل الانضمام');
    expect(open.inline_keyboard[2][0].url).toBe('https://t.me/MfRuLiTbot?start=gwb_3');
  });

  it('winners post: names under a spoiler in a quote, a button each, and "draw another"', () => {
    const w = [{ telegramId: 5, name: 'Zaid', username: null, number: 2, place: 1 }];
    expect(winnersText(w)).toContain('<blockquote>1- <tg-spoiler><a href="tg://user?id=5">Zaid</a></tg-spoiler></blockquote>');
    const k = winnersKeyboard(3, w);
    expect(k.inline_keyboard[0][0]).toMatchObject({ text: '1- Zaid', url: 'tg://user?id=5' });
    expect(k.inline_keyboard.at(-1)![0]).toMatchObject({ text: 'سحب فائز اخر', callback_data: 'gw:n:3' });
    expect(winnersKeyboard(3, w, false).inline_keyboard).toHaveLength(1);
  });

  it('reads post links and forwarded channel posts', () => {
    expect(parsePostLink('https://t.me/gifts/45')).toEqual({ username: 'gifts', messageId: 45 });
    expect(parsePostLink('t.me/c/1234567/89')).toEqual({ channelId: -1001234567, messageId: 89 });
    expect(forwardedChannelPost({ forward_origin: { type: 'channel', chat: { id: -1009 }, message_id: 7 } } as never)).toEqual({ channelId: -1009, messageId: 7 });
  });

  it('draws by weight: each person who joined through your link is one more chance', () => {
    const list = [{ id: 'a', bonus: 0 }, { id: 'b', bonus: 3 }];
    expect(pickWeighted(list, () => 0.1)!.id).toBe('a'); // 0.5 of 5 → a
    expect(pickWeighted(list, () => 0.5)!.id).toBe('b'); // 2.5 of 5 → b
  });

  it('join: condition 1 first, then condition 3, then a number', async () => {
    mocks.gFindOne.mockResolvedValue(giveaway());
    mocks.eFindOne.mockResolvedValue(null);
    mocks.membership.mockResolvedValueOnce({ isSubscribed: false, unavailable: false });
    expect(await joinGiveaway(bot, 3, user as never)).toContain('الشرط 1');

    // Subscribed, but never wrote their username under the post.
    expect(await joinGiveaway(bot, 3, user as never)).toContain('الشرط 3');

    // Wrote it (verified): gets the next number.
    mocks.eFindOne.mockResolvedValue({ verifiedAt: new Date() });
    mocks.eFindOneAndUpdate.mockResolvedValueOnce({ _id: 'E', referredBy: null });
    mocks.gFindOneAndUpdate.mockResolvedValueOnce({ count: 5 });
    expect(await joinGiveaway(bot, 3, user as never)).toBe('تم تسجيل مشاركتك بنجاح، حظاً موفقاً ✅\nرقمك: #5');
    expect(mocks.eUpdateOne).toHaveBeenCalledWith({ _id: 'E' }, { $set: { number: 5 } });

    // Again: already in.
    mocks.eFindOne.mockResolvedValue({ joinedAt: new Date(), number: 5 });
    expect(await joinGiveaway(bot, 3, user as never)).toContain('مشارك بالفعل');
  });

  it('join: stopped giveaways take nobody', async () => {
    mocks.gFindOne.mockResolvedValue(giveaway({ status: 'stopped' }));
    mocks.eFindOne.mockResolvedValue(null);
    expect(await joinGiveaway(bot, 3, user as never)).toContain('متوقف');
  });

  it('join through a boost link: the inviter gets one more chance', async () => {
    mocks.gFindOne.mockResolvedValue(giveaway());
    mocks.eFindOne.mockResolvedValue({ verifiedAt: new Date() });
    mocks.eFindOneAndUpdate.mockResolvedValueOnce({ _id: 'E', referredBy: 42 }).mockResolvedValueOnce({ bonus: 1, joinedAt: new Date() });
    mocks.gFindOneAndUpdate.mockResolvedValueOnce({ count: 6 });
    await joinGiveaway(bot, 3, user as never);
    expect(mocks.eFindOneAndUpdate).toHaveBeenLastCalledWith({ giveaway: 'G1', telegramId: 42 }, { $inc: { bonus: 1 } }, { new: true, upsert: true });
  });

  it('comments under "write your username": verified when the bot was started, told to start it otherwise', async () => {
    const g = giveaway({ usernameThreadId: 500 });
    mocks.gFindOne.mockResolvedValue(g);
    const comment = {
      chat: { id: -2002, type: 'supergroup' },
      from: user,
      message_id: 600,
      reply_to_message: { message_id: 500, is_automatic_forward: true, forward_origin: { type: 'channel', chat: { id: -1001 }, message_id: 11 } },
    };
    mocks.userExists.mockResolvedValueOnce(null);
    expect(await verifyComment(comment as never)).toMatchObject({ verified: false, seq: 3, text: expect.stringContaining('لم تقم بالدخول إلى البوت بعد') });
    expect(await verifyComment(comment as never)).toMatchObject({ verified: true, text: expect.stringContaining('تم التحقق من تفعيل بوت @MfRuLiTbot') });
    expect(mocks.eUpdateOne).toHaveBeenCalledWith({ giveaway: 'G1', telegramId: 7 }, expect.objectContaining({ $set: expect.objectContaining({ verifiedAt: expect.any(Date) }) }), { upsert: true });

    // Comments elsewhere (e.g. under the giveaway post itself) are not condition 3.
    mocks.gFindOne.mockResolvedValue(null);
    expect(await verifyComment({ ...comment, message_thread_id: 400, reply_to_message: { message_id: 401 } } as never)).toBeNull();
  });

  it('remembers the comment thread from the group\'s copy of "write your username"', async () => {
    await rememberUsernameThread({ chat: { id: -2002 }, message_id: 777, is_automatic_forward: true, forward_origin: { type: 'channel', chat: { id: -1001 }, message_id: 11 } } as never);
    expect(mocks.gUpdateOne).toHaveBeenCalledWith({ channelId: -1001, usernamePostId: 11 }, { $set: { usernameThreadId: 777 } });
  });

  it('boost links never count yourself, nor someone already in', async () => {
    mocks.gFindOne.mockResolvedValue(giveaway());
    expect((await recordReferral(3, 7, 7)).ok).toBe(false);
    mocks.eFindOne.mockResolvedValueOnce({ joinedAt: new Date() });
    expect((await recordReferral(3, 42, 7)).ok).toBe(false);
    mocks.eFindOne.mockResolvedValueOnce(null);
    expect((await recordReferral(3, 42, 7)).ok).toBe(true);
  });

  it('draw: only after joining is stopped, then the next place goes up', async () => {
    mocks.gFindOne.mockResolvedValueOnce(giveaway());
    expect((await drawNext(bot, 3)).text).toContain('يجب إيقاف الانضمام');

    mocks.gFindOne.mockResolvedValueOnce(giveaway({ status: 'stopped' }));
    mocks.eFind.mockResolvedValueOnce([{ telegramId: 9, name: 'Ali', username: 'ali', number: 3, bonus: 0 }]);
    const saved = giveaway({ status: 'stopped', winners: [{ telegramId: 9, name: 'Ali', username: 'ali', number: 3, place: 1 }] });
    mocks.gFindOneAndUpdate.mockResolvedValueOnce(saved);
    const res = await drawNext(bot, 3);
    expect(res.winner).toMatchObject({ telegramId: 9, place: 1 });
    // Posted under the giveaway post, with "draw another".
    expect((bot as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).toHaveBeenCalledWith(
      -1001,
      expect.stringContaining('الفائزون'),
      expect.objectContaining({ reply_to_message_id: 10 })
    );
  });

  it('draw: someone who left a channel is dropped, a failed Telegram check is not', async () => {
    const pool = [
      { telegramId: 9, name: 'Ali', number: 1, bonus: 0 },
      { telegramId: 10, name: 'Sara', number: 2, bonus: 0 },
    ];
    // Ali comes first and left the channel: dropped, Sara wins.
    mocks.gFindOne.mockResolvedValueOnce(giveaway({ status: 'stopped' }));
    mocks.eFind.mockResolvedValueOnce(pool);
    mocks.membership.mockImplementation(async (_b: unknown, _c: unknown, id: number) => ({ isSubscribed: id !== 9, unavailable: false }));
    mocks.gFindOneAndUpdate.mockImplementationOnce(async (_q: unknown, u: { $push: { winners: unknown } }) => giveaway({ status: 'stopped', winners: [u.$push.winners] }));
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    const res = await drawNext(bot, 3);
    expect(res.winner).toMatchObject({ telegramId: 10, place: 1 });
    expect(mocks.gUpdateOne).toHaveBeenCalledWith({ _id: 'G1' }, { $addToSet: { dropped: 9 } });

    // Telegram can't tell about Ali: he still wins.
    mocks.gUpdateOne.mockClear();
    mocks.gFindOne.mockResolvedValueOnce(giveaway({ status: 'stopped' }));
    mocks.eFind.mockResolvedValueOnce(pool);
    mocks.membership.mockResolvedValue({ isSubscribed: false, unavailable: true });
    mocks.gFindOneAndUpdate.mockImplementationOnce(async (_q: unknown, u: { $push: { winners: unknown } }) => giveaway({ status: 'stopped', winners: [u.$push.winners] }));
    expect((await drawNext(bot, 3)).winner).toMatchObject({ telegramId: 9 });
    expect(mocks.gUpdateOne).not.toHaveBeenCalledWith({ _id: 'G1' }, { $addToSet: { dropped: 9 } });
    rnd.mockRestore();
  });

  it('draw: a place emptied by an exclusion is drawn first', async () => {
    const winners = [
      { telegramId: 1, name: 'A', number: 1, place: 1 },
      { telegramId: 3, name: 'C', number: 3, place: 3 },
    ];
    mocks.gFindOne.mockResolvedValueOnce(giveaway({ status: 'stopped', winners }));
    mocks.eFind.mockResolvedValueOnce([{ telegramId: 4, name: 'D', number: 4, bonus: 0 }]);
    mocks.gFindOneAndUpdate.mockResolvedValueOnce(giveaway({ status: 'stopped', winners }));
    expect((await drawNext(bot, 3)).winner).toMatchObject({ telegramId: 4, place: 2 });
    expect(mocks.gFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'G1', 'winners.place': { $ne: 2 } },
      { $push: { winners: expect.objectContaining({ place: 2 }) } },
      { new: true }
    );
  });
});
