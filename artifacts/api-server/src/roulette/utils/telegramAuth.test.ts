import crypto from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

process.env.BOT_TOKEN = 'unit-test-bot-token';
process.env.MONGODB_URI = 'mongodb://unit-test';
process.env.OWNER_ID = '1';
process.env.WEBAPP_SECRET = 'unit-test-webapp-secret';

const { verifyTelegramInitData } = await import('./telegramAuth');
const TEST_NOW_SECONDS = 1_700_000_000;

function signedInitData(entries: Array<[string, string]>): string {
  const params = new URLSearchParams(entries);
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN!).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.append('hash', hash);
  return params.toString();
}

function validEntries(authDate = TEST_NOW_SECONDS): Array<[string, string]> {
  return [
    ['auth_date', String(authDate)],
    ['user', JSON.stringify({ id: 12345, first_name: 'Test' })],
  ];
}

describe('verifyTelegramInitData auth_date validation', () => {
  afterAll(() => {
    vi.useRealTimers();
  });

  it('rejects invalid and nonpositive auth_date values', () => {
    vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW_SECONDS * 1000);

    expect(() => verifyTelegramInitData(signedInitData(validEntries(0)))).toThrow(/auth_date invalid/);
    expect(() => verifyTelegramInitData(signedInitData([['auth_date', 'not-a-timestamp'], ...validEntries().slice(1)]))).toThrow(
      /auth_date invalid/
    );
  });

  it('allows a small clock skew but rejects timestamps too far in the future', () => {
    vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW_SECONDS * 1000);

    expect(verifyTelegramInitData(signedInitData(validEntries(TEST_NOW_SECONDS + 30))).authDate).toBe(TEST_NOW_SECONDS + 30);
    expect(() => verifyTelegramInitData(signedInitData(validEntries(TEST_NOW_SECONDS + 31)))).toThrow(/initData expired/);
  });

  it('rejects duplicate required signed fields', () => {
    vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW_SECONDS * 1000);
    const entries = [...validEntries(), ['auth_date', String(TEST_NOW_SECONDS)] as [string, string]];

    expect(() => verifyTelegramInitData(signedInitData(entries))).toThrow(/auth_date must appear exactly once/);
  });

  it('returns start_param only when it is covered by the Telegram HMAC', () => {
    vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW_SECONDS * 1000);
    const signed = signedInitData([...validEntries(), ['start_param', 'task_firstTask']]);

    expect(verifyTelegramInitData(signed).startParam).toBe('task_firstTask');
    expect(() => verifyTelegramInitData(signed.replace('task_firstTask', 'task_tampered'))).toThrow(
      /initData signature mismatch/
    );
  });
});