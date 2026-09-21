import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findReferral: vi.fn(),
  createReferral: vi.fn(),
  findPrize: vi.fn(),
  createNotification: vi.fn(),
  notifyAdmin: vi.fn(),
  creditTask: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../models/User', () => ({ User: { findOne: mocks.findUser } }));
vi.mock('../models/Referral', () => ({
  Referral: { findOne: mocks.findReferral, create: mocks.createReferral },
}));
vi.mock('../models/UserPrize', () => ({ UserPrize: { findById: mocks.findPrize } }));
vi.mock('./notification.service', () => ({
  createNotification: mocks.createNotification,
  notifyAdminsNewReferral: mocks.notifyAdmin,
}));
vi.mock('./claimTask.service', () => ({ creditReferralToTask: mocks.creditTask }));
vi.mock('../config/logger', () => ({ logger: { warn: mocks.loggerWarn } }));

import { registerReferralIfNew } from './referral.service';

const referrer = {
  _id: new mongoose.Types.ObjectId(),
  telegramId: 100,
};

function newUser(telegramId: number) {
  return {
    _id: new mongoose.Types.ObjectId(),
    telegramId,
    username: undefined,
    firstName: 'Invitee',
    save: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function task(token: string, referrerTelegramId = referrer.telegramId) {
  return {
    _id: new mongoose.Types.ObjectId(),
    token,
    referrerTelegramId,
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
    userPrize: new mongoose.Types.ObjectId(),
  } as never;
}

describe('direct-link referral attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue(referrer);
    mocks.findReferral.mockResolvedValue(null);
    mocks.createReferral.mockResolvedValue({});
    mocks.findPrize.mockReturnValue({ select: vi.fn().mockResolvedValue(null) });
    mocks.notifyAdmin.mockResolvedValue(undefined);
  });

  it('attaches two newly invited users to their distinct claim tasks', async () => {
    const firstUser = newUser(201);
    const secondUser = newUser(202);

    expect(await registerReferralIfNew({ newUser: firstUser, task: task('firstTask'), isBrandNewUser: true })).toBe('registered');
    expect(await registerReferralIfNew({ newUser: secondUser, task: task('secondTask'), isBrandNewUser: true })).toBe('registered');

    expect(mocks.createReferral).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ inviteeTelegramId: 201, creditedTaskId: expect.any(mongoose.Types.ObjectId) })
    );
    expect(mocks.createReferral).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ inviteeTelegramId: 202, creditedTaskId: expect.any(mongoose.Types.ObjectId) })
    );
    expect(mocks.createReferral.mock.calls[0][0].creditedTaskId).not.toEqual(
      mocks.createReferral.mock.calls[1][0].creditedTaskId
    );
  });

  it('rejects self-referrals and replayed/non-new users without creating records', async () => {
    const user = newUser(100);
    expect(await registerReferralIfNew({ newUser: user, task: task('selfTask'), isBrandNewUser: true })).toBe('self_referral');
    expect(await registerReferralIfNew({ newUser: newUser(203), task: task('replayedTask'), isBrandNewUser: false })).toBe('not_new');
    expect(mocks.createReferral).not.toHaveBeenCalled();
  });

  it('rejects a second attribution when the invitee already has a referral', async () => {
    mocks.findReferral.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    expect(await registerReferralIfNew({ newUser: newUser(204), task: task('alreadyUsed'), isBrandNewUser: true })).toBe(
      'already_referred'
    );
    expect(mocks.createReferral).not.toHaveBeenCalled();
  });
});