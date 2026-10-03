import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  findOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock('telegram', () => {
  let n = 0;
  class TelegramClient {
    id = ++n;
    connected = false;
    async connect() {
      mocks.events.push(`connect:${this.id}`);
      this.connected = true;
    }
    async getMe() {
      return { id: 1 };
    }
    async destroy() {
      mocks.events.push(`destroy:${this.id}`);
      this.connected = false;
    }
    async disconnect() {
      this.connected = false;
    }
    addEventHandler() {}
  }
  return { TelegramClient, Api: {} };
});
vi.mock('telegram/events', () => ({ NewMessage: class {} }));
vi.mock('telegram/sessions', () => ({ StringSession: class { save() { return ''; } } }));
vi.mock('telegram/Password', () => ({ computeCheck: vi.fn() }));
vi.mock('../models/DeliveryAccount', () => ({ DeliveryAccount: { findOne: mocks.findOne, updateOne: mocks.updateOne } }));
vi.mock('../models/User', () => ({ User: {} }));
vi.mock('../config/env', () => ({ env: { DELIVERY_API_ID: 1, DELIVERY_API_HASH: 'h', SESSION_SECRET: 'secret', BOT_TOKEN: 't' } }));
vi.mock('../config/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./deliveryCommand.service', () => ({ handleDeliveryCommand: vi.fn() }));

import { initializeDeliveryAccount } from './deliveryAccount.service';

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update('secret').digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url')).join('.');
}
const account = { _id: 'a', telegramId: 1, encryptedSession: encrypt('session') };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.findOne.mockReturnValue({ select: () => Promise.resolve(account) });
});

describe('delivery account connection', () => {
  it("waits while another server holds the account, so the session isn't used twice", async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    expect(await initializeDeliveryAccount()).toBe(false);
    expect(mocks.events).toEqual([]);
  });

  it('closes the old connection before opening a new one', async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    await initializeDeliveryAccount();
    await initializeDeliveryAccount();
    const second = mocks.events.findIndex((e) => e.startsWith('connect:') && e !== mocks.events[0]);
    const destroyFirst = mocks.events.indexOf(mocks.events[0].replace('connect', 'destroy'));
    expect(destroyFirst).toBeGreaterThan(-1);
    expect(destroyFirst).toBeLessThan(second);
  });
});

