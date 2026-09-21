import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  findOrCreateUser: vi.fn(),
  getSettings: vi.fn(),
  getAdminRole: vi.fn(),
  getTask: vi.fn(),
  registerReferral: vi.fn(),
  parseGeneralReferralToken: vi.fn(),
  registerGeneralReferralIfNew: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../utils/telegramAuth', () => ({ verifyTelegramInitData: mocks.verify }));
vi.mock('../services/user.service', () => ({ findOrCreateUser: mocks.findOrCreateUser }));
vi.mock('../models/Settings', () => ({ getSettings: mocks.getSettings }));
vi.mock('../services/admin.service', () => ({ getAdminRole: mocks.getAdminRole }));
vi.mock('../services/claimTask.service', () => ({
  getClaimTaskByToken: mocks.getTask,
  parseTaskTokenFromStartParam: (value?: string | null) =>
    value?.match(/^task_([A-Za-z0-9_-]+)$/)?.[1] ?? null,
}));
vi.mock('../services/referral.service', () => ({
  registerReferralIfNew: mocks.registerReferral,
  parseGeneralReferralToken: mocks.parseGeneralReferralToken,
  registerGeneralReferralIfNew: mocks.registerGeneralReferralIfNew,
}));
vi.mock('../config/logger', () => ({ logger: { info: mocks.loggerInfo } }));

import { miniAppAuth } from './miniAppAuth';

const user = {
  _id: 'invitee-id',
  telegramId: 200,
  isBanned: false,
};

function request(): Request {
  return { header: () => 'signed-telegram-init-data' } as unknown as Request;
}

describe('Mini App direct-link attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockReturnValue({
      user: { id: user.telegramId, first_name: 'Invitee' },
      startParam: 'task_firstTask',
    });
    mocks.findOrCreateUser.mockResolvedValue({ user, isNew: true });
    mocks.getSettings.mockResolvedValue({ maintenanceMode: false });
    mocks.getAdminRole.mockResolvedValue(null);
    mocks.getTask.mockResolvedValue({ _id: 'task-id', referrerTelegramId: 100, status: 'pending' });
    mocks.registerReferral.mockResolvedValue('registered');
    mocks.parseGeneralReferralToken.mockReturnValue(null);
  });

  it('registers a signed direct-link task before allowing the first route through', async () => {
    const next = vi.fn();

    await miniAppAuth(request(), {} as Response, next);

    expect(mocks.getTask).toHaveBeenCalledWith('firstTask');
    expect(mocks.registerReferral).toHaveBeenCalledWith({
      newUser: user,
      task: expect.objectContaining({ _id: 'task-id' }),
      isBrandNewUser: true,
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not replay attribution for an existing user or an invalid task parameter', async () => {
    mocks.findOrCreateUser.mockResolvedValue({ user, isNew: false });
    await miniAppAuth(request(), {} as Response, vi.fn());
    expect(mocks.getTask).not.toHaveBeenCalled();
    expect(mocks.registerReferral).not.toHaveBeenCalled();

    mocks.findOrCreateUser.mockResolvedValue({ user, isNew: true });
    mocks.verify.mockReturnValue({ user: { id: user.telegramId }, startParam: 'not-a-task' });
    await miniAppAuth(request(), {} as Response, vi.fn());
    expect(mocks.getTask).not.toHaveBeenCalled();
    expect(mocks.registerReferral).not.toHaveBeenCalled();
  });
});