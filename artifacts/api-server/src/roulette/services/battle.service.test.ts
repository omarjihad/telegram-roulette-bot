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
  adExists: vi.fn(),
  adCreate: vi.fn(),
  consumeAdView: vi.fn(),
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
vi.mock('../models/BattleTournament', () => {
  const none = { select: () => none, sort: () => none, lean: async () => null };
  return { BattleTournament: { findOne: () => none } };
});
vi.mock('../models/AdView', () => ({ AdView: { exists: mocks.adExists, create: mocks.adCreate } }));
vi.mock('./games.service', () => ({ consumeAdView: mocks.consumeAdView }));
vi.mock('../models/BattleWeeklyStat', () => ({ BattleWeeklyStat: { updateOne: mocks.statUpdateOne } }));
vi.mock('../bot/instance', () => ({ getBotInstance: () => ({ sendPhoto: mocks.sendPhoto, sendMessage: mocks.sendMessage }) }));
vi.mock('../models/Settings', () => ({ getSettings: async () => ({ adsgramBlockId: '123' }) }));
vi.mock('../config/env', () => ({ env: { MF_BATTLE_URL: '' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { battleAdView, battleDirectLink, allowedThrows, battleLevel, battleUrl, buySkin, buyThrow, killReward, levelReward, cleanLayout, cleanSettings, getBattleHome, getSharedLayout, recordBattleMatch, shareLayout, weekKey } from './battle.service';

const user = { _id: new mongoose.Types.ObjectId(), telegramId: 7, firstName: 'Omar', username: 'omar' } as never;

function profile(over: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    coins: 100,
    skin: 'fly',
    ownedSkins: ['fly', 'mf'],
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

  it('gives more coins and experience for bigger kills, and levels from experience', () => {
    expect(killReward(20)).toEqual({ coins: 1, xp: 11 });
    expect(killReward(2000)).toEqual({ coins: 11, xp: 110 });
    expect(killReward(1e6)).toEqual({ coins: 50, xp: 500 });
    expect(battleLevel(0).level).toBe(1);
    expect(battleLevel(49).level).toBe(1);
    expect(battleLevel(50).level).toBe(2);
    expect(battleLevel(4050)).toMatchObject({ level: 10, levelXp: 4050, nextXp: 5000 });
    expect([levelReward(2), levelReward(5), levelReward(10)]).toEqual([30, 300, 600]);
  });

  it('defaults to the copy this server serves under /mf-battle', () => {
    expect(battleUrl()).toBe('/mf-battle');
  });

  it('opens a new account with starter coins and the free skins', async () => {
    mocks.profileFindOne.mockResolvedValue(null);
    mocks.profileCreate.mockImplementation(async (doc: Record<string, unknown>) => profile(doc));
    const home = await getBattleHome(user, 'developer');
    expect(home.profile.coins).toBe(100);
    expect(home.profile.ownedSkins).toEqual(expect.arrayContaining(['fly', 'mf']));
    expect(home.player.name).toBe('Omar');
    expect(home.ads).toEqual({ rewardBlockId: '123', interstitialBlockId: 'int-52362' });
  });

  it('buys a skin only with enough coins', async () => {
    mocks.profileFindOne.mockResolvedValue(profile({ coins: 50 }));
    mocks.profileFindOneAndUpdate.mockResolvedValue(null);
    mocks.profileFindById.mockResolvedValue(profile({ coins: 50 }));
    await expect(buySkin(user, 'developer', 'usopp')).rejects.toMatchObject({ code: 'NOT_ENOUGH_COINS' });
    mocks.profileFindOneAndUpdate.mockResolvedValue(profile({ coins: 0, ownedSkins: ['fly', 'mf', 'usopp'] }));
    const res = await buySkin(user, 'developer', 'usopp');
    expect(res.profile.ownedSkins).toContain('usopp');
    expect(mocks.profileFindOneAndUpdate.mock.calls[1][1]).toEqual({ $inc: { coins: -149 }, $push: { ownedSkins: 'usopp' } });
  });

  it('shows retired skins as the default one', async () => {
    mocks.profileFindOne.mockResolvedValue(profile({ skin: 'dragon', ownedSkins: ['fly', 'dragon', 'zoro'] }));
    const home = await getBattleHome(user, 'developer');
    expect(home.profile.skin).toBe('fly');
    expect(home.profile.ownedSkins).toEqual(['fly', 'mf', 'zoro']);
    expect(home.skins).toHaveLength(10);
    expect(home.skins.find((s) => s.id === 'joyboy')).toMatchObject({ price: 2999, rarity: 'mythic', pack: 'onepiece', onSale: true });
  });

  it('opens throw speeds in order, and ×20 / ×50 only with watched ads', async () => {
    expect(allowedThrows({ throwOwned: 1, x20Until: null, x50Until: null })).toEqual([0, 1]);
    expect(allowedThrows({ throwOwned: 3, x20Until: new Date(Date.now() + 60000), x50Until: new Date(Date.now() - 1) })).toEqual([0, 1, 2, 3, 4]);
    mocks.profileFindOne.mockResolvedValue(profile({ coins: 5000, throwOwned: 1 }));
    await expect(buyThrow(user, 'developer', 3)).rejects.toMatchObject({ code: 'THROW_ORDER' });
    mocks.profileFindOneAndUpdate.mockResolvedValue(profile({ coins: 4600, throwOwned: 2 }));
    const res = await buyThrow(user, 'developer', 2);
    expect(res.profile.throws.allowed).toEqual([0, 1, 2]);
    expect(mocks.profileFindOneAndUpdate.mock.calls.at(-1)?.[1]).toEqual({ $inc: { coins: -400 }, $set: { throwOwned: 2 } });
    await expect(buyThrow(user, 'developer', 4)).rejects.toMatchObject({ code: 'BAD_THROW' });
  });

  it('keeps settings and layouts within the allowed values', () => {
    const cur = { darkMode: true, chat: true, sound: true, quality: 'medium', joystick: 'fixed' } as const;
    expect(cleanSettings({ darkMode: false, sound: false, quality: 'ultra', joystick: 'floating' }, cur)).toEqual({ darkMode: false, chat: true, sound: false, quality: 'medium', joystick: 'floating' });
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

  it('throw-speed ads: uses the game\'s word when Adsgram is late, once per 20 seconds', async () => {
    const { AppError } = await import('../utils/AppError');
    mocks.consumeAdView.mockRejectedValue(new AppError('x', 409, 'AD_NOT_CONFIRMED'));
    mocks.adExists.mockResolvedValueOnce(null);
    await battleAdView(7);
    expect(mocks.adCreate).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 7, source: 'client', consumedFor: 'battle_throw' }));
    mocks.adExists.mockResolvedValueOnce({ _id: 'x' });
    await expect(battleAdView(7)).rejects.toMatchObject({ code: 'AD_TOO_SOON' });
    mocks.consumeAdView.mockResolvedValue(undefined);
    mocks.adCreate.mockClear();
    await battleAdView(7);
    expect(mocks.adCreate).not.toHaveBeenCalled();
  });

  it('the game\'s direct link: one tap through the Mini App, else the bot\'s /start battle', async () => {
    const { env } = await import('../config/env');
    const e = env as unknown as Record<string, string>;
    e.BOT_USERNAME = '';
    expect(battleDirectLink()).toBeNull();
    e.BOT_USERNAME = 'MfRuLiTbot';
    e.MINI_APP_SHORT_NAME = '';
    expect(battleDirectLink()).toBe('https://t.me/MfRuLiTbot?start=battle');
    e.MINI_APP_SHORT_NAME = 'MFR';
    expect(battleDirectLink()).toBe('https://t.me/MfRuLiTbot/MFR?startapp=battle');
  });
});
