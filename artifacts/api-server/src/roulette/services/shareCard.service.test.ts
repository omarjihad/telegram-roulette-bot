import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));
vi.mock('../models/Settings', () => ({ Settings: { findOne: mocks.findOne, updateOne: mocks.updateOne } }));
vi.mock('../config/env', () => ({ env: { BOT_TOKEN: 't', OWNER_ID: 0, MINI_APP_URL: 'https://app.example' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../bot/instance', () => ({ getBotInstance: vi.fn() }));

import { prepareShareCard } from './shareCard.service';

const select = (v: unknown) => ({ select: () => Promise.resolve(v) });

describe('share card', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shares to private chats only, and falls back to text when the photo fails', async () => {
    mocks.findOne.mockReturnValue(select({ hasShareImage: true, shareImageData: null }));
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return { status: 200, json: async () => (body.result.type === 'photo' ? { ok: false, description: 'WEBPAGE_MEDIA_EMPTY' } : { ok: true, result: { id: 'prep1' } }) };
      })
    );
    const id = await prepareShareCard({ userId: 1, resultId: 'cs_x', title: 't', caption: 'c', buttonText: 'b', link: 'https://t.me/x' });
    expect(id).toBe('prep1');
    expect(bodies.map((b) => (b.result as { type: string }).type)).toEqual(['photo', 'article']);
    expect(bodies[0]).toMatchObject({ allow_user_chats: true, allow_group_chats: false, allow_channel_chats: false, allow_bot_chats: false });
  });
});
