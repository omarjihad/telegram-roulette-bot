import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ role: vi.fn(), decide: vi.fn(), mark: vi.fn(), prizes: vi.fn() }));

vi.mock('../services/admin.service', () => ({ getAdminRole: mocks.role }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../models/Prize', () => ({ Prize: { find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: mocks.prizes }) }) }) }) } }));
vi.mock('../services/suggestion.service', () => ({
  decideSuggestion: mocks.decide,
  markSuggestionDecided: mocks.mark,
  suggestionAdminKeyboard: (seq: number) => ({ inline_keyboard: [[{ text: 'main', callback_data: `sg:a:${seq}:none` }]] }),
}));

import { registerSuggestionActions } from './suggestionActions';

function fakeBot() {
  const handlers: Record<string, Array<(x: unknown) => Promise<void>>> = {};
  const bot = {
    on: (ev: string, fn: (x: unknown) => Promise<void>) => { (handlers[ev] ??= []).push(fn); },
    answerCallbackQuery: vi.fn(async (_id: string, _o?: unknown) => true),
    editMessageReplyMarkup: vi.fn(async (_m: unknown, _o: unknown) => true),
    sendMessage: vi.fn(async (_c: number, _t: string) => ({ message_id: 1 })),
  };
  const emit = async (ev: string, x: unknown) => { for (const fn of handlers[ev] ?? []) await fn(x); };
  registerSuggestionActions(bot as never);
  return { bot, emit };
}

const q = (data: string, from = 1) => ({ id: 'q', data, from: { id: from, username: 'boss' }, message: { chat: { id: from }, message_id: 50 } });

describe('suggestion buttons for the admins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role.mockImplementation(async (id: number) => (id === 1 ? 'owner' : null));
    mocks.decide.mockImplementation(async (p: { seq: number }) => ({ seq: p.seq, adminMessages: [] }));
  });

  it('only admins can decide', async () => {
    const { bot, emit } = fakeBot();
    await emit('callback_query', q('sg:r:5', 9));
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q', { text: 'هذا للمطورين فقط 🔒', show_alert: true });
  });

  it('accept with points, a spin, a prize, or reject; every copy is updated', async () => {
    const { emit } = fakeBot();
    await emit('callback_query', q('sg:a:5:pts:10'));
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 5, accept: true, reward: { type: 'points', points: 10 }, adminId: 1, adminName: '@boss' }));
    await emit('callback_query', q('sg:a:5:spin'));
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ reward: { type: 'daily_spin' } }));
    await emit('callback_query', q('sg:a:5:pz:64b000000000000000000001'));
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ reward: { type: 'prize', prizeId: '64b000000000000000000001' } }));
    await emit('callback_query', q('sg:r:5'));
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ accept: false }));
    expect(mocks.mark).toHaveBeenCalledTimes(4);
  });

  it('"points" shows amounts, and "another number" takes the next message', async () => {
    const { bot, emit } = fakeBot();
    await emit('callback_query', q('sg:p:5'));
    const markup = bot.editMessageReplyMarkup.mock.calls[0][0] as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(markup.inline_keyboard.flat().map((b) => b.callback_data)).toContain('sg:a:5:pts:25');

    await emit('callback_query', q('sg:pc:5'));
    await emit('message', { chat: { id: 1, type: 'private' }, from: { id: 1, username: 'boss' }, text: '٧' });
    expect(mocks.decide).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 5, reward: { type: 'points', points: 7 } }));
  });

  it('a failed decision is shown to the admin', async () => {
    const { bot, emit } = fakeBot();
    mocks.decide.mockRejectedValueOnce(new Error('الجائزة نفدت من المخزون'));
    await emit('callback_query', q('sg:a:5:pz:64b000000000000000000001'));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith('q', { text: '⚠️ الجائزة نفدت من المخزون', show_alert: true });
  });
});
