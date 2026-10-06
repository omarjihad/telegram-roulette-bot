import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  profileFindOne: vi.fn(),
  profileCreate: vi.fn(),
  profileFindOneAndUpdate: vi.fn(),
  profileFindById: vi.fn(),
  profileUpdateOne: vi.fn(),
  codeCreate: vi.fn(),
  codeFindOne: vi.fn(),
  statUpdateOne: vi.fn(),
  sendPhoto: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('../models/BattleProfile', () => ({
  BattleProfile: {
    findOne: mocks.profileFindOne,
    create: mocks.profileCreate,
    findOneAndUpdate: mocks.profileFindOneAndUpdate,
    findById: mocks.profileFindById,
    updateOne: mocks.profileUpdateOne,
  },
}));
vi.mock('../models/BattleLayoutCode', () => ({ BattleLayoutCode: { create: mocks.codeCreate, findOne: mocks.codeFindOne } }));
vi.mock('../models/BattleWeeklyStat', () => ({ BattleWeeklyStat: { updateOne: mocks.statUpdateOne } }));
vi.mock('../bot/instance', () => ({ getBotInstance: () => ({ sendPhoto: mocks.sendPhoto, sendMessage: mocks.sendMessage }) }));
vi.mock('../config/env', () => ({ env: { MF_BATTLE_URL: '' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { buySkin, cleanLayout, cleanSettings, getBattleHome, getSharedLayout, recordBattleMatch, shareLayout, weekKey } from './battle.service';

const user = { _id: new mongoose.Types.ObjectId(), telegramId: 7, firstName: 'Omar', username: 'omar' } as never;

function profile(over: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    coins: 100,
    skin: 'classic',
    ownedSkins: ['classic', 'mf'],
    settings: { darkMode: true, chat: true, quality: 'medium', joystick: 'fixed' },
    layout: {},
    save: vi.fn(),
    markModified: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendPhoto.mockResolvedValue({});
  mocks.sendMessage.mockResolvedValue({});
});

describe('MF Battle', () => {
  it('is for developers only for now', async () => {
    await expect(getBattleHome(user, null)).rejects.toMatchObject({ code: 'BATTLE_COMING_SOON' });
  });

  it('opens a new account with starter coins and the free skins', async () => {
    mocks.profileFindOne.mockResolvedValue(null);
    mocks.profileCreate.mockImplementation(async (doc: Record<string, unknown>) => profile(doc));
    const home = await getBattleHome(user, 'developer');
    expect(home.profile.coins).toBe(100);
    expect(home.profile.ownedSkins).toEqual(expect.arrayContaining(['classic', 'mf']));
    expect(home.player.name).toBe('Omar');
  });

  it('buys a skin only with enough coins', async () => {
    mocks.profileFindOne.mockResolvedValue(profile({ coins: 50 }));
    mocks.profileFindOneAndUpdate.mockResolvedValue(null);
    mocks.profileFindById.mockResolvedValue(profile({ coins: 50 }));
    await expect(buySkin(user, 'developer', 'neon')).rejects.toMatchObject({ code: 'NOT_ENOUGH_COINS' });
    mocks.profileFindOneAndUpdate.mockResolvedValue(profile({ coins: 0, ownedSkins: ['classic', 'mf', 'neon'] }));
    const res = await buySkin(user, 'developer', 'neon');
    expect(res.profile.ownedSkins).toContain('neon');
    expect(mocks.profileFindOneAndUpdate.mock.calls[1][1]).toEqual({ $inc: { coins: -150 }, $push: { ownedSkins: 'neon' } });
  });

  it('keeps settings and layouts within the allowed values', () => {
    const cur = { darkMode: true, chat: true, quality: 'medium', joystick: 'fixed' } as const;
    expect(cleanSettings({ darkMode: false, quality: 'ultra', joystick: 'floating' }, cur)).toEqual({ darkMode: false, chat: true, quality: 'medium', joystick: 'floating' });
    expect(cleanLayout({ split: { x: 2, y: -1, s: 9, o: 0 }, hack: { x: 0.5, y: 0.5, s: 1, o: 1 } })).toEqual({ split: { x: 1, y: 0, s: 2, o: 0.2 } });
  });

  it('copies a layout as a code and sends it with its picture by the bot', async () => {
    mocks.codeCreate.mockResolvedValue({});
    const res = await shareLayout(user, 'developer', { layout: { split: { x: 0.8, y: 0.7, s: 1, o: 1 } }, image: 'data:image/jpeg;base64,/9j/4AAQ' });
    expect(res.code).toMatch(/^MF-[A-Z2-9]{8}$/);
    expect(mocks.sendPhoto).toHaveBeenCalledWith(7, expect.any(Buffer), { caption: expect.stringContaining(res.code) }, expect.anything());
    mocks.codeFindOne.mockResolvedValue({ code: res.code, layout: { split: { x: 0.8, y: 0.7, s: 1, o: 1 } } });
    const pasted = await getSharedLayout('developer', res.code.slice(3).toLowerCase());
    expect(pasted.layout.split.x).toBe(0.8);
  });

  it('weeks start on Monday, Baghdad time', () => {
    // Sunday 2026-10-11 23:30 Baghdad is still the week of Monday 2026-10-05.
    expect(weekKey(new Date('2026-10-11T20:30:00Z'))).toBe('2026-10-05');
    // Monday 2026-10-12 00:30 Baghdad starts a new week.
    expect(weekKey(new Date('2026-10-11T21:30:00Z'))).toBe('2026-10-12');
  });

  it('records a match into the weekly numbers', async () => {
    mocks.profileFindOne.mockReturnValue({ select: () => Promise.resolve({ skin: 'neon' }) });
    await recordBattleMatch(user, { mass: 5400, seconds: 320 });
    expect(mocks.statUpdateOne.mock.calls[0][1]).toMatchObject({ $max: { maxMass: 5400 }, $inc: { playSeconds: 320, matches: 1 } });
  });
});
