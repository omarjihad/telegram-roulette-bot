import { describe, expect, it, vi } from 'vitest';

process.env.BOT_TOKEN = 'unit-test-bot-token';
process.env.MONGODB_URI = 'mongodb://unit-test';
process.env.OWNER_ID = '1';
process.env.WEBAPP_SECRET = 'unit-test-webapp-secret';
process.env.BOT_USERNAME = 'MfRuLiTbot';
process.env.MINI_APP_SHORT_NAME = 'MFR';

vi.mock('../models/ClaimTask', () => ({ ClaimTask: {} }));
vi.mock('../models/Settings', () => ({ getSettings: vi.fn() }));
vi.mock('./notification.service', () => ({ createNotification: vi.fn() }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const { buildTaskLink, parseTaskTokenFromStartParam } = await import('./claimTask.service');

describe('Mini App claim-task links', () => {
  it('keeps distinct task tokens in direct /MFR startapp links', () => {
    expect(buildTaskLink('firstTask')).toBe('https://t.me/MfRuLiTbot/MFR?startapp=task_firstTask');
    expect(buildTaskLink('secondTask')).toBe('https://t.me/MfRuLiTbot/MFR?startapp=task_secondTask');
  });

  it('only accepts the task parameter format passed from signed init data', () => {
    expect(parseTaskTokenFromStartParam('task_firstTask')).toBe('firstTask');
    expect(parseTaskTokenFromStartParam('firstTask')).toBeNull();
    expect(parseTaskTokenFromStartParam('task_firstTask&task_secondTask')).toBeNull();
  });
});