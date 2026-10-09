import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  join: vi.fn(),
  draw: vi.fn(),
  create: vi.fn(),
  verify: vi.fn(),
  isGroup: vi.fn(),
  thread: vi.fn(),
}));

vi.mock('../services/admin.service', () => ({ getAdminRole: mocks.role }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot' } }));
vi.mock('../services/forcedSub.service', () => ({ checkMembershipStatus: vi.fn() }));
vi.mock('../services/giveaway.service', async (orig) => ({
  ...(await orig<typeof import('../services/giveaway.service')>()),
  joinGiveaway: mocks.join,
  drawNext: mocks.draw,
  createGiveaway: mocks.create,
  verifyComment: mocks.verify,
  isGiveawayGroup: mocks.isGroup,
  rememberUsernameThread: mocks.thread,
  recentGiveaways: vi.fn(async () => []),
  requiredWithRights: vi.fn(async () => []),
}));

import { registerGiveawayActions } from './giveawayActions';

function fakeBot() {
  const handlers: Record<string, Array<(x: unknown) => Promise<void>>> = {};
  const bot = {
    on: (ev: string, fn: (x: unknown) => Promise<void>) => { (handlers[ev] ??= []).push(fn); },
    answerCallbackQuery: vi.fn(async () => true),
    sendMessage: vi.fn(async (_chatId: number, _text: string, _opts?: unknown) => ({ message_id: 1 })),
    editMessageText: vi.fn(async () => true),
    getChat: vi.fn(),
  };
  const emit = async (ev: string, x: unknown) => { for (const fn of handlers[ev] ?? []) await fn(x); };
  return { bot, emit };
}

describe('giveaway buttons and messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role.mockImplementation(async (id: number) => (id === 1 ? 'owner' : null));
  });

  it('"انقر للانضمام" answers with a pop-up', async () => {
    const { bot, emit } = fakeBot();
    registerGiveawayActions(bot as never);
    mocks.join.mockResolvedValue('تم تسجيل مشاركتك بنجاح، حظاً موفقاً ✅\nرقمك: #5');
    await emit('callback_query', { id: 'q1', data: 'gw:j:3', from: { id: 5 } });
    expect(mocks.join).toHaveBeenCalledWith(bot, 3, { id: 5 });
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q1', { text: 'تم تسجيل مشاركتك بنجاح، حظاً موفقاً ✅\nرقمك: #5', show_alert: true });
  });

  it('draw / stop are for developers only', async () => {
    const { bot, emit } = fakeBot();
    registerGiveawayActions(bot as never);
    await emit('callback_query', { id: 'q2', data: 'gw:d:3', from: { id: 5 } });
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q2', { text: 'هذا الزر للمطور فقط 🔒', show_alert: true });
    expect(mocks.draw).not.toHaveBeenCalled();

    mocks.draw.mockResolvedValue({ text: 'يجب إيقاف الانضمام أولاً قبل بدء السحب' });
    await emit('callback_query', { id: 'q3', data: 'gw:n:3', from: { id: 1 } });
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q3', { text: 'يجب إيقاف الانضمام أولاً قبل بدء السحب', show_alert: true });
  });

  it('.سحب opens the menu; a forwarded channel post becomes a giveaway', async () => {
    const { bot, emit } = fakeBot();
    registerGiveawayActions(bot as never);
    await emit('message', { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '.سحب' });
    expect(bot.sendMessage.mock.calls[0][1]).toContain('السحوبات');

    await emit('callback_query', { id: 'q4', data: 'gwa:new', from: { id: 1 }, message: { chat: { id: 1, type: 'private' }, message_id: 9 } });
    mocks.create.mockResolvedValue({ ok: true, giveaway: { seq: 4, channelId: -1001, channelUsername: 'gifts', postId: 10, usernamePostId: 11 } });
    await emit('message', { chat: { id: 1, type: 'private' }, from: { id: 1 }, forward_origin: { type: 'channel', chat: { id: -1001 }, message_id: 10 } });
    expect(mocks.create).toHaveBeenCalledWith(bot, 1, -1001, 10);
    expect(bot.sendMessage.mock.calls.at(-1)?.[1]).toContain('https://t.me/gifts/11');
  });

  it('a comment under "write your username" gets its answer as a reply', async () => {
    const { bot, emit } = fakeBot();
    registerGiveawayActions(bot as never);
    mocks.isGroup.mockResolvedValue(true);
    mocks.verify.mockResolvedValue({ verified: true, seq: 3, text: 'تم التحقق من تفعيل بوت @MfRuLiTbot ✅' });
    await emit('message', { chat: { id: -2002, type: 'supergroup' }, from: { id: 7 }, message_id: 600, text: '@omar', reply_to_message: { message_id: 500 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(bot.sendMessage).toHaveBeenCalledWith(-2002, 'تم التحقق من تفعيل بوت @MfRuLiTbot ✅', { reply_to_message_id: 600, allow_sending_without_reply: true });

    // The same person again a moment later: no second answer.
    await emit('message', { chat: { id: -2002, type: 'supergroup' }, from: { id: 7 }, message_id: 601, text: '@omar', reply_to_message: { message_id: 500 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);

    // The group's copy of a channel post marks the comment thread.
    await emit('message', { chat: { id: -2002, type: 'supergroup' }, message_id: 700, is_automatic_forward: true, sender_chat: { id: -1001 } });
    expect(mocks.thread).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledTimes(2);
  });

  it('a long line in the group: those who started the bot hear back privately', async () => {
    vi.useFakeTimers();
    try {
      const { bot, emit } = fakeBot();
      registerGiveawayActions(bot as never);
      mocks.isGroup.mockResolvedValue(true);
      mocks.verify.mockResolvedValue({ verified: false, seq: 3, text: 'لم تقم بالدخول إلى البوت بعد ❌' });
      for (let id = 100; id < 108; id++) {
        await emit('message', { chat: { id: -3003, type: 'supergroup' }, from: { id }, message_id: id, text: 'x', reply_to_message: { message_id: 1 } });
      }
      mocks.verify.mockResolvedValue({ verified: true, seq: 3, text: 'تم التحقق ✅' });
      await emit('message', { chat: { id: -3003, type: 'supergroup' }, from: { id: 200 }, message_id: 200, text: 'x', reply_to_message: { message_id: 1 } });
      expect(bot.sendMessage).toHaveBeenCalledWith(200, 'تم التحقق ✅\n(سحب #3)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('another command drops the "forward the post" question', async () => {
    const { bot, emit } = fakeBot();
    registerGiveawayActions(bot as never);
    await emit('callback_query', { id: 'q5', data: 'gwa:new', from: { id: 1 }, message: { chat: { id: 1, type: 'private' }, message_id: 9 } });
    bot.sendMessage.mockClear();
    await emit('message', { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/start' });
    await emit('message', { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'hello' });
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });
});
