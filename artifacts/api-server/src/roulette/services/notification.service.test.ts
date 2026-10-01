import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUser: vi.fn(), createNotif: vi.fn(), send: vi.fn() }));

vi.mock('../models/User', () => ({ User: { findOne: mocks.findUser } }));
vi.mock('../models/Notification', () => ({ Notification: { create: mocks.createNotif } }));
vi.mock('../models/WithdrawalRequest', () => ({ WithdrawalRequest: {} }));
vi.mock('../models/DeliveryAccount', () => ({ DeliveryAccount: {} }));
vi.mock('./admin.service', () => ({ listAllAdminTelegramIds: vi.fn() }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn() } }));

import { attachBotInstance, createNotification } from './notification.service';

function userWithLanguage(language: string | null) {
  mocks.findUser.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ language }) }) });
}

describe('notifications in the user’s language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNotif.mockImplementation(async (doc: unknown) => doc);
    mocks.send.mockResolvedValue({});
    attachBotInstance({ sendMessage: mocks.send } as never);
  });

  const params = {
    userId: new mongoose.Types.ObjectId(),
    telegramId: 5,
    type: 'referral_progress' as const,
    title: { ar: 'عنوان', en: 'Title' },
    body: { ar: 'نص', en: 'Body' },
  };

  it('stores and sends English to a user who chose English', async () => {
    userWithLanguage('en');
    await createNotification(params);
    expect(mocks.createNotif).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title', body: 'Body' }));
    expect(mocks.send).toHaveBeenCalledWith(5, 'Title\n\nBody');
  });

  it('uses Arabic by default', async () => {
    userWithLanguage(null);
    await createNotification(params);
    expect(mocks.send).toHaveBeenCalledWith(5, 'عنوان\n\nنص');
  });
});
