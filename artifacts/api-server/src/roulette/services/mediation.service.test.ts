import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  userFindOne: vi.fn(),
  ticketFindOne: vi.fn(),
  ticketFindOneAndUpdate: vi.fn(),
  ticketCreate: vi.fn(),
  ticketFind: vi.fn(),
  ticketUpdateOne: vi.fn(),
  nextSequence: vi.fn(),
}));

vi.mock('../models/Settings', () => ({ getSettings: mocks.settings }));
vi.mock('../models/User', () => ({ User: { findOne: mocks.userFindOne } }));
vi.mock('../models/MediationTicket', () => ({
  OPEN_MEDIATION_STATUSES: ['waiting_join', 'waiting_mediator', 'in_progress'],
  MediationTicket: {
    findOne: mocks.ticketFindOne,
    findOneAndUpdate: mocks.ticketFindOneAndUpdate,
    create: mocks.ticketCreate,
    find: mocks.ticketFind,
    updateOne: mocks.ticketUpdateOne,
    aggregate: vi.fn().mockResolvedValue([{ sum: 9, count: 2 }]),
  },
}));
vi.mock('../models/ExchangeListing', () => ({ ExchangeListing: { findById: vi.fn() } }));
vi.mock('../models/Counter', () => ({ nextSequence: mocks.nextSequence }));
vi.mock('./exchange.service', () => ({ exchangeAllowed: (s: { exchangePublic: boolean }, r: string | null) => s.exchangePublic || r !== null }));
vi.mock('./admin.service', () => ({ listAllAdminTelegramIds: vi.fn().mockResolvedValue([1000]) }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import {
  attachMediationBot,
  completeByMediatorMessage,
  createTicket,
  expireMediationTickets,
  handleJoinRequest,
  lookupPartner,
  rateMediator,
  remindWaitingTickets,
  takeTicket,
} from './mediation.service';

const bot = {
  sendMessage: vi.fn().mockResolvedValue({ message_id: 9 }),
  approveChatJoinRequest: vi.fn().mockResolvedValue(true),
  declineChatJoinRequest: vi.fn().mockResolvedValue(true),
  getChatAdministrators: vi.fn().mockResolvedValue([{ user: { id: 500, username: 'mid1', is_bot: false } }, { user: { id: 1, is_bot: true } }]),
  getChatMember: vi.fn(),
  editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
};
attachMediationBot(bot as never);

const CHAT = -100123;
const me = { _id: new mongoose.Types.ObjectId(), telegramId: 10, username: 'buyer', firstName: 'B' } as never;
const select = (v: unknown) => ({ select: () => Object.assign(Promise.resolve(v), { lean: () => Promise.resolve(v) }) });

function ticket(over: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    number: 1001,
    requester: { telegramId: 10, username: 'buyer', requestedAt: null },
    partner: { telegramId: 20, username: 'seller', requestedAt: null },
    status: 'waiting_join',
    chatId: CHAT,
    expiresAt: new Date(Date.now() + 60_000),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ exchangePublic: false, mediationGroupLink: 'https://t.me/+abcdef', mediationChatId: CHAT });
  mocks.userFindOne.mockReturnValue(select({ _id: new mongoose.Types.ObjectId(), telegramId: 20, username: 'seller', firstName: 'S', isBanned: false }));
  mocks.ticketFindOne.mockResolvedValue(null);
});

describe('lookupPartner', () => {
  it('finds the other side by username and refuses yourself', async () => {
    const res = await lookupPartner(me, 'developer', '@Seller');
    expect(res.partner).toMatchObject({ telegramId: 20, username: 'seller' });
    mocks.userFindOne.mockReturnValue(select({ telegramId: 10, username: 'buyer', isBanned: false }));
    await expect(lookupPartner(me, 'developer', 'buyer')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it("tells you when the person hasn't opened the bot", async () => {
    mocks.userFindOne.mockReturnValue(select(null));
    await expect(lookupPartner(me, 'developer', 'ghost_user')).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND' });
  });

  it('is off until the group is linked', async () => {
    mocks.settings.mockResolvedValue({ exchangePublic: true, mediationGroupLink: '', mediationChatId: null });
    await expect(lookupPartner(me, null, 'seller')).rejects.toMatchObject({ code: 'MEDIATION_OFF' });
  });
});

describe('createTicket', () => {
  it('opens a 15-minute ticket and tells the other side', async () => {
    mocks.nextSequence.mockResolvedValue(1001);
    mocks.ticketCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), status: 'waiting_join', ...d }));
    const res = await createTicket(me, 'developer', { username: 'seller' });
    expect(res.ticket.number).toBe(1001);
    expect(res.ticket.groupLink).toBe('https://t.me/+abcdef');
    const ms = new Date(res.ticket.expiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60_000);
    expect(ms).toBeLessThanOrEqual(15 * 60_000);
    expect(bot.sendMessage).toHaveBeenCalledWith(20, expect.stringContaining('#1001'), expect.anything());
  });

  it('refuses while a ticket is still waiting', async () => {
    mocks.ticketFindOne.mockResolvedValueOnce(ticket());
    await expect(createTicket(me, 'developer', { username: 'seller' })).rejects.toMatchObject({ code: 'TICKET_OPEN' });
  });
});

describe('join requests', () => {
  const req = (id: number, chat = CHAT) => ({ chat: { id: chat }, from: { id } }) as never;

  it('ignores other chats and people without a ticket', async () => {
    expect(await handleJoinRequest(req(10, -999))).toBe(false);
    mocks.ticketFindOneAndUpdate.mockResolvedValue(null);
    expect(await handleJoinRequest(req(77))).toBe(false);
  });

  it('waits for the second side, then pings the middlemen', async () => {
    mocks.ticketFindOneAndUpdate.mockResolvedValueOnce(ticket({ requester: { telegramId: 10, requestedAt: new Date() } }));
    await handleJoinRequest(req(10));
    expect(bot.sendMessage).not.toHaveBeenCalledWith(CHAT, expect.anything(), expect.anything());

    const both = ticket({ requester: { telegramId: 10, requestedAt: new Date() }, partner: { telegramId: 20, requestedAt: new Date() } });
    mocks.ticketFindOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce(both).mockResolvedValueOnce({ ...both, status: 'waiting_mediator' });
    await handleJoinRequest(req(20));
    const groupCall = bot.sendMessage.mock.calls.find((c) => c[0] === CHAT);
    expect(groupCall?.[1]).toContain('@mid1');
    expect(groupCall?.[2].reply_markup.inline_keyboard[0][0].callback_data).toBe(`med_take_${both._id}`);
  });
});

describe('takeTicket', () => {
  it('only lets group admins take it, then lets both sides in', async () => {
    bot.getChatMember.mockResolvedValueOnce({ status: 'member' });
    expect(await takeTicket(String(new mongoose.Types.ObjectId()), { id: 600 } as never, CHAT)).toHaveProperty('error');

    bot.getChatMember.mockResolvedValueOnce({ status: 'administrator' });
    mocks.ticketFindOneAndUpdate.mockResolvedValueOnce(ticket({ status: 'in_progress' }));
    const res = await takeTicket(String(new mongoose.Types.ObjectId()), { id: 500, username: 'mid1', first_name: 'M' } as never, CHAT);
    expect(res).toHaveProperty('ticket');
    expect(bot.approveChatJoinRequest).toHaveBeenCalledWith(CHAT, 10);
    expect(bot.approveChatJoinRequest).toHaveBeenCalledWith(CHAT, 20);
    expect(bot.sendMessage).toHaveBeenCalledWith(CHAT, expect.stringContaining('راح يتوسطلكم'), expect.anything());
  });

  it('can only be taken once', async () => {
    bot.getChatMember.mockResolvedValueOnce({ status: 'creator' });
    mocks.ticketFindOneAndUpdate.mockResolvedValueOnce(null);
    expect(await takeTicket(String(new mongoose.Types.ObjectId()), { id: 500 } as never, CHAT)).toHaveProperty('error');
  });
});

describe('closing tickets', () => {
  it('cancels tickets after 15 minutes and declines the side that asked', async () => {
    const tk = ticket({ requester: { telegramId: 10, requestedAt: new Date() }, expiresAt: new Date(Date.now() - 1000) });
    mocks.ticketFind.mockReturnValue({ limit: () => Promise.resolve([tk]) });
    mocks.ticketUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    expect(await expireMediationTickets()).toBe(1);
    expect(bot.declineChatJoinRequest).toHaveBeenCalledWith(CHAT, 10);
    expect(bot.declineChatJoinRequest).not.toHaveBeenCalledWith(CHAT, 20);
  });

  it('marks a ticket done when the middleman writes تم التسليم or سلمت (م / م2 do nothing)', async () => {
    mocks.ticketFindOneAndUpdate.mockResolvedValue(ticket({ status: 'completed' }));
    expect(await completeByMediatorMessage(CHAT, 500, 'hello')).toBeNull();
    expect(await completeByMediatorMessage(CHAT, 500, 'م2')).toBeNull();
    expect(mocks.ticketFindOneAndUpdate).not.toHaveBeenCalled();
    await completeByMediatorMessage(CHAT, 500, 'تم  التسليم');
    await completeByMediatorMessage(CHAT, 500, 'سلمت');
    expect(mocks.ticketFindOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.ticketFindOneAndUpdate).toHaveBeenCalledWith(
      { chatId: CHAT, mediatorTelegramId: 500, status: 'in_progress' },
      { $set: expect.objectContaining({ status: 'completed' }) },
      expect.anything()
    );
  });

  it('cancels the ticket when the middleman writes الغاء', async () => {
    mocks.ticketFindOneAndUpdate.mockResolvedValue(ticket({ status: 'cancelled' }));
    mocks.userFindOne.mockReturnValue(select({ language: 'ar' }));
    await completeByMediatorMessage(CHAT, 500, 'الغاء');
    expect(mocks.ticketFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ status: 'cancelled' }) },
      expect.anything()
    );
    expect(bot.sendMessage).toHaveBeenCalledWith(CHAT, expect.stringContaining('تم إلغاء التذكرة'), expect.anything());
  });
});

describe('waiting for a middleman', () => {
  it('re-pings the middlemen after 10 minutes and alerts the developers after 30', async () => {
    const tk = ticket({ status: 'waiting_mediator', groupMessageId: 3, waitingMediatorAt: new Date(Date.now() - 31 * 60_000) });
    mocks.ticketFind.mockReturnValue({ limit: () => Promise.resolve([tk]) });
    mocks.ticketUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await remindWaitingTickets();
    const reping = bot.sendMessage.mock.calls.find((c) => c[0] === CHAT);
    expect(reping?.[1]).toContain('تذكير');
    expect(reping?.[2].reply_to_message_id).toBe(3);
    expect(bot.sendMessage).toHaveBeenCalledWith(1000, expect.stringContaining('30 دقيقة'));
  });
});

describe('ratings', () => {
  it('asks both sides to rate after تم التسليم, once each', async () => {
    mocks.ticketFindOneAndUpdate.mockResolvedValueOnce(ticket({ status: 'completed', mediatorTelegramId: 500, mediatorUsername: 'mid1' }));
    mocks.userFindOne.mockReturnValue(select({ language: 'ar' }));
    await completeByMediatorMessage(CHAT, 500, 'تم التسليم');
    const asks = bot.sendMessage.mock.calls.filter((c) => c[0] === 10 || c[0] === 20);
    expect(asks).toHaveLength(2);
    expect(asks[0][2].reply_markup.inline_keyboard[0]).toHaveLength(5);

    mocks.ticketFindOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce({ partnerRating: 4 });
    expect(await rateMediator(String(new mongoose.Types.ObjectId()), 20, 4)).toEqual({ partnerRating: 4 });
    expect(await rateMediator(String(new mongoose.Types.ObjectId()), 20, 9)).toBeNull();
  });
});
