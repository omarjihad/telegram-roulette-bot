import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  sFindOne: vi.fn(),
  sCreate: vi.fn(),
  sDecide: vi.fn(),
  sUpdate: vi.fn(),
  uFindOne: vi.fn(),
  uUpdate: vi.fn(),
  pFindOne: vi.fn(),
  pUpdate: vi.fn(),
  upCreate: vi.fn(),
  notify: vi.fn(),
  ensureTask: vi.fn(),
  admins: vi.fn(),
}));

// A query that can be awaited or chained (.select().lean() …).
type Q = Promise<unknown> & { select: () => Q; lean: () => Q; sort: () => Q; limit: () => Q };
const q = (v: unknown): Q => Object.assign(Promise.resolve(v), { select: () => q(v), lean: () => q(v), sort: () => q(v), limit: () => q(v) });

vi.mock('../models/Suggestion', () => ({
  Suggestion: {
    countDocuments: mocks.count,
    findOne: (...a: unknown[]) => q(mocks.sFindOne(...a)),
    create: mocks.sCreate,
    findOneAndUpdate: mocks.sDecide,
    updateOne: mocks.sUpdate,
  },
}));
vi.mock('../models/User', () => ({ User: { findOne: (...a: unknown[]) => q(mocks.uFindOne(...a)), updateOne: mocks.uUpdate } }));
vi.mock('../models/Prize', () => ({ Prize: { findOne: mocks.pFindOne, updateOne: mocks.pUpdate } }));
vi.mock('../models/UserPrize', () => ({ UserPrize: { create: mocks.upCreate } }));
vi.mock('../models/Counter', () => ({ nextSequence: vi.fn(async () => 7) }));
vi.mock('./notification.service', () => ({ createNotification: mocks.notify }));
vi.mock('./claimTask.service', () => ({ ensureClaimTask: mocks.ensureTask }));
vi.mock('./admin.service', () => ({ listAllAdminTelegramIds: mocks.admins }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { createSuggestion, decideSuggestion, parseRewardChoice, suggestionAdminText } from './suggestion.service';

const user = { _id: 'U1', telegramId: 7, username: 'omar', firstName: 'Omar', isBanned: false } as never;
const pending = (over: Record<string, unknown> = {}) => ({ _id: 'S1', seq: 7, telegramId: 7, text: 'أضيفوا لعبة الشطرنج للبوت', status: 'accepted', adminMessages: [], ...over });

describe('feature suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.sFindOne.mockReturnValue(null);
    mocks.sCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ ...doc, _id: 'S1', status: 'pending', createdAt: new Date() }));
    mocks.uFindOne.mockReturnValue({ _id: 'U1', telegramId: 7 });
    mocks.notify.mockResolvedValue(undefined);
    mocks.ensureTask.mockResolvedValue({ status: 'pending' });
  });

  it('takes a clear idea, at most 3 waiting, and not two within two minutes', async () => {
    await expect(createSuggestion(user, 'قصير')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(createSuggestion(user, 'x'.repeat(1001))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const s = await createSuggestion(user, '  أضيفوا لعبة الشطرنج للبوت  ');
    expect(mocks.sCreate).toHaveBeenCalledWith(expect.objectContaining({ seq: 7, telegramId: 7, name: 'Omar', username: 'omar', text: 'أضيفوا لعبة الشطرنج للبوت' }));
    expect(s).toMatchObject({ seq: 7 });

    mocks.count.mockResolvedValueOnce(3);
    await expect(createSuggestion(user, 'فكرة ثانية للبوت هنا')).rejects.toMatchObject({ code: 'SUGGESTION_LIMIT' });

    mocks.sFindOne.mockReturnValueOnce({ createdAt: new Date(Date.now() - 30_000) });
    await expect(createSuggestion(user, 'فكرة ثالثة للبوت هنا')).rejects.toMatchObject({ code: 'SUGGESTION_TOO_SOON' });

    await expect(createSuggestion({ ...(user as object), isBanned: true } as never, 'فكرة من محظور هنا')).rejects.toMatchObject({ code: 'BANNED' });
  });

  it('accepting with points gives them and tells the person', async () => {
    mocks.sDecide.mockResolvedValueOnce(pending());
    const s = await decideSuggestion({ seq: 7, accept: true, reward: { type: 'points', points: 5 }, adminId: 1, adminName: '@boss' });
    expect(mocks.sDecide).toHaveBeenCalledWith({ seq: 7, status: 'pending' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'accepted', decidedBy: 1, decidedByName: '@boss' }) }), { new: true });
    expect(mocks.uUpdate).toHaveBeenCalledWith({ _id: 'U1' }, { $inc: { spinPoints: 5 } });
    expect(s.reward).toEqual({ type: 'points', points: 5 });
    const notice = mocks.notify.mock.calls[0][0];
    expect(notice.type).toBe('suggestion_decided');
    expect(notice.body.ar).toContain('5 نقطة');
  });

  it('a prize goes to the bag with the claim steps and 24 hours', async () => {
    mocks.sDecide.mockResolvedValueOnce(pending());
    mocks.pFindOne.mockResolvedValueOnce({ _id: 'P1', name: 'زورو', isUnlimited: false });
    mocks.pUpdate.mockResolvedValueOnce({ modifiedCount: 1 });
    mocks.upCreate.mockImplementationOnce(async (doc: Record<string, unknown>) => ({ ...doc, _id: 'UP1' }));
    const before = Date.now();
    const s = await decideSuggestion({ seq: 7, accept: true, reward: { type: 'prize', prizeId: '64b000000000000000000001' }, adminId: 1, adminName: '@boss' });
    const made = mocks.upCreate.mock.calls[0][0];
    expect(made).toMatchObject({ source: 'suggestion', status: 'active', prizeNameSnapshot: 'زورو' });
    expect(made.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600e3);
    expect(mocks.ensureTask).toHaveBeenCalled();
    expect(s.reward).toMatchObject({ type: 'prize', prizeName: 'زورو' });
  });

  it('out of stock: nothing given and the suggestion waits again', async () => {
    mocks.sDecide.mockResolvedValueOnce(pending());
    mocks.pFindOne.mockResolvedValueOnce({ _id: 'P1', name: 'زورو', isUnlimited: false });
    mocks.pUpdate.mockResolvedValueOnce({ modifiedCount: 0 });
    await expect(decideSuggestion({ seq: 7, accept: true, reward: { type: 'prize', prizeId: '64b000000000000000000001' }, adminId: 1, adminName: '@boss' })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(mocks.sUpdate).toHaveBeenCalledWith({ _id: 'S1', status: 'accepted' }, { $set: { status: 'pending', decidedBy: null, decidedByName: null, decidedAt: null, note: null } });
    expect(mocks.upCreate).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('only the first admin decides', async () => {
    mocks.sDecide.mockResolvedValueOnce(null);
    mocks.sFindOne.mockReturnValueOnce({ status: 'accepted', decidedByName: '@other' });
    await expect(decideSuggestion({ seq: 7, accept: false, adminId: 1, adminName: '@boss' })).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  it('rejecting gives nothing and says so kindly', async () => {
    mocks.sDecide.mockResolvedValueOnce(pending({ status: 'rejected' }));
    await decideSuggestion({ seq: 7, accept: false, note: 'موجودة قريباً', adminId: 1, adminName: '@boss' });
    expect(mocks.uUpdate).not.toHaveBeenCalled();
    expect(mocks.notify.mock.calls[0][0].body.ar).toContain('موجودة قريباً');
  });

  it('reads the reward an admin picked', () => {
    expect(parseRewardChoice(undefined)).toEqual({ type: 'none' });
    expect(parseRewardChoice({ type: 'points', points: '2.5' })).toEqual({ type: 'points', points: 2.5 });
    expect(() => parseRewardChoice({ type: 'points', points: -1 })).toThrow();
    expect(() => parseRewardChoice({ type: 'prize', prizeId: 'nope' })).toThrow();
    expect(parseRewardChoice({ type: 'daily_spin' })).toEqual({ type: 'daily_spin' });
  });

  it('the admins\' copy says who decided and what was given', () => {
    const text = suggestionAdminText({ seq: 7, name: 'Omar', username: 'omar', telegramId: 7, text: 'a <b> idea', status: 'accepted', decidedByName: '@boss', reward: { type: 'daily_spin' }, note: null } as never);
    expect(text).toContain('a &lt;b&gt; idea');
    expect(text).toContain('✅ قبله @boss · فرة يومية إضافية');
  });
});
