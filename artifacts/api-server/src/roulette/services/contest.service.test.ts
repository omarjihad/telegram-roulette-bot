import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findUserById: vi.fn(),
  exists: vi.fn(),
  create: vi.fn(),
  findEntry: vi.fn(),
  updateEntry: vi.fn(),
  countEntries: vi.fn(),
  removeEntry: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('../models/User', () => ({ User: { findOne: mocks.findUser, findById: mocks.findUserById } }));
vi.mock('../models/ContestReferral', () => ({
  ContestReferral: {
    exists: mocks.exists,
    create: mocks.create,
    findOne: mocks.findEntry,
    updateOne: mocks.updateEntry,
    countDocuments: mocks.countEntries,
    findOneAndUpdate: mocks.removeEntry,
  },
}));
vi.mock('./notification.service', () => ({ createNotification: mocks.notify }));
vi.mock('./forcedSub.service', () => ({ checkAllForcedChats: vi.fn() }));
vi.mock('../bot/instance', () => ({ getBotInstance: vi.fn() }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import {
  parseContestToken,
  registerContestReferralIfNew,
  removeContestReferralForBlockedInvitee,
  tryCountContestReferral,
} from './contest.service';

const contestant = { _id: new mongoose.Types.ObjectId(), telegramId: 10 };
const newUser = (telegramId: number) => ({ _id: new mongoose.Types.ObjectId(), telegramId }) as never;

describe('invite race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notify.mockResolvedValue(undefined);
    mocks.countEntries.mockResolvedValue(5);
  });

  it('parses race start params only', () => {
    expect(parseContestToken('race_Ab12-x')).toBe('Ab12-x');
    expect(parseContestToken('ref_Ab12')).toBeNull();
  });

  it('records a brand-new user as pending for the link owner', async () => {
    mocks.findUser.mockResolvedValue(contestant);
    mocks.exists.mockResolvedValue(null);
    expect(await registerContestReferralIfNew({ newUser: newUser(20), token: 'tok', isBrandNewUser: true })).toBe('registered');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ contestantTelegramId: 10, inviteeTelegramId: 20, status: 'pending' }));
  });

  it('ignores existing users and self-invites', async () => {
    mocks.findUser.mockResolvedValue(contestant);
    expect(await registerContestReferralIfNew({ newUser: newUser(21), token: 'tok', isBrandNewUser: false })).toBe('not_new');
    expect(await registerContestReferralIfNew({ newUser: newUser(10), token: 'tok', isBrandNewUser: true })).toBe('self_referral');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('counts +1 only after forced-sub and a captcha solved after joining', async () => {
    const entry = { _id: new mongoose.Types.ObjectId(), contestant: contestant._id, contestantTelegramId: 10, createdAt: new Date(Date.now() - 60_000) };
    mocks.findEntry.mockResolvedValue(entry);
    mocks.updateEntry.mockResolvedValue({ modifiedCount: 1 });

    mocks.findUserById.mockResolvedValue({ telegramId: 22, forcedSubOk: true, captchaPassed: false });
    expect(await tryCountContestReferral(new mongoose.Types.ObjectId())).toBe(false);

    mocks.findUserById.mockResolvedValue({ telegramId: 22, forcedSubOk: true, captchaPassed: true, captchaPassedAt: new Date(Date.now() - 120_000) });
    expect(await tryCountContestReferral(new mongoose.Types.ObjectId())).toBe(false);

    mocks.findUserById.mockResolvedValue({ telegramId: 22, username: 'x', forcedSubOk: true, captchaPassed: true, captchaPassedAt: new Date() });
    expect(await tryCountContestReferral(new mongoose.Types.ObjectId())).toBe(true);
    expect(mocks.updateEntry).toHaveBeenCalledWith({ _id: entry._id, status: 'pending' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'counted' }) }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 10, title: expect.stringContaining('+1') }));
  });

  it('takes -1 when a counted invitee blocks the bot', async () => {
    mocks.removeEntry.mockResolvedValue({ status: 'counted', contestant: contestant._id, contestantTelegramId: 10 });
    mocks.findUser.mockReturnValue({ select: vi.fn().mockResolvedValue({ username: 'x' }) });
    expect(await removeContestReferralForBlockedInvitee(22)).toBe(true);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('-1') }));
  });

  it('does not notify when a still-pending invitee blocks the bot', async () => {
    mocks.removeEntry.mockResolvedValue({ status: 'pending', contestant: contestant._id, contestantTelegramId: 10 });
    expect(await removeContestReferralForBlockedInvitee(23)).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
