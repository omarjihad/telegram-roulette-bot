import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findUserById: vi.fn(),
  findReferral: vi.fn(),
  createReferral: vi.fn(),
  findPrize: vi.fn(),
  createNotification: vi.fn(),
  notifyAdmin: vi.fn(),
  creditTask: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../models/User', () => ({ User: { findOne: mocks.findUser, findById: mocks.findUserById } }));
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

import { registerReferralIfNew, tryQualifyReferral } from './referral.service';

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

describe('referrals only count after forced-sub + captcha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue(referrer);
    mocks.findReferral.mockResolvedValue(null);
    mocks.createReferral.mockResolvedValue({});
    mocks.findPrize.mockReturnValue({ select: vi.fn().mockResolvedValue(null) });
    mocks.notifyAdmin.mockResolvedValue(undefined);
  });

  it('demo mode records a pending referral and forces a fresh captcha instead of crediting the task', async () => {
    const user = Object.assign(newUser(205), { captchaPassed: true, captchaPassedAt: new Date() }) as never as {
      captchaPassed: boolean;
      captchaPassedAt?: Date;
    };
    expect(
      await registerReferralIfNew({ newUser: user as never, task: task('demoTask'), isBrandNewUser: false, demoMode: true })
    ).toBe('demo_registered');
    expect(mocks.createReferral).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(mocks.creditTask).not.toHaveBeenCalled();
    expect(user.captchaPassed).toBe(false);
    expect(user.captchaPassedAt).toBeUndefined();
  });

  function pendingReferral(createdAt: Date) {
    return {
      _id: new mongoose.Types.ObjectId(),
      referrer: referrer._id,
      referrerTelegramId: referrer.telegramId,
      status: 'pending',
      createdAt,
      creditedTaskId: new mongoose.Types.ObjectId(),
      save: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('does not credit while forced-sub or captcha is missing', async () => {
    const referral = pendingReferral(new Date(Date.now() - 1000));
    mocks.findReferral.mockResolvedValue(referral);
    mocks.findUserById.mockResolvedValue({ telegramId: 301, forcedSubOk: false, captchaPassed: true, captchaPassedAt: new Date() });
    await tryQualifyReferral(new mongoose.Types.ObjectId());
    mocks.findUserById.mockResolvedValue({ telegramId: 301, forcedSubOk: true, captchaPassed: false });
    await tryQualifyReferral(new mongoose.Types.ObjectId());
    expect(referral.status).toBe('pending');
    expect(mocks.creditTask).not.toHaveBeenCalled();
  });

  it('ignores a captcha solved before the invitee arrived through the link', async () => {
    const referral = pendingReferral(new Date());
    mocks.findReferral.mockResolvedValue(referral);
    mocks.findUserById.mockResolvedValue({
      telegramId: 302,
      forcedSubOk: true,
      captchaPassed: true,
      captchaPassedAt: new Date(Date.now() - 60_000),
    });
    await tryQualifyReferral(new mongoose.Types.ObjectId());
    expect(referral.status).toBe('pending');
    expect(mocks.creditTask).not.toHaveBeenCalled();
  });

  it('credits the task once both gates are passed after joining', async () => {
    const referral = pendingReferral(new Date(Date.now() - 60_000));
    mocks.findReferral.mockResolvedValue(referral);
    mocks.findUserById.mockResolvedValue({ telegramId: 303, forcedSubOk: true, captchaPassed: true, captchaPassedAt: new Date() });
    await tryQualifyReferral(new mongoose.Types.ObjectId());
    expect(referral.status).toBe('qualified');
    expect(mocks.creditTask).toHaveBeenCalledWith(referral.creditedTaskId);
  });
});
