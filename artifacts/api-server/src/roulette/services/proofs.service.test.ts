import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../models/ProofPost', () => ({ ProofPost: {} }));
vi.mock('../models/Settings', () => ({ getSettings: vi.fn() }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { describePost, isAllowedMediaUrl, parseChannelPage, proofHeadline } from './proofs.service';

// Trimmed copy of Telegram's public channel preview markup (t.me/s/<channel>).
const PAGE = `
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="MFROLET/1" data-view="x">
  <div class="tgme_widget_message_service_text">Channel created</div>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="MFROLET/41" data-view="x">
  <div class="tgme_widget_message_grouped_wrap js-message_grouped_wrap">
    <a class="tgme_widget_message_photo_wrap grouped_media_wrap blured js-message_photo" style="left:0px;width:200px;background-image:url('https://cdn4.cdn-telegram.org/file/aaa.jpg')" href="https://t.me/MFROLET/41?single"></a>
    <a class="tgme_widget_message_photo_wrap grouped_media_wrap blured js-message_photo" style="background-image:url('https://cdn5.telesco.pe/file/bbb.jpg')" href="https://t.me/MFROLET/42?single"></a>
  </div>
  <div class="tgme_widget_message_text js-message_text" dir="auto"><i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/E29C85.png')"><b>✅</b></i> تم تسليم حساب 3000 جوهرة<br/>للفائز <a href="https://t.me/luffy">@luffy</a> &amp; شكراً</div>
  <span class="tgme_widget_message_views">1.2K</span>
  <a class="tgme_widget_message_date" href="https://t.me/MFROLET/41"><time datetime="2026-09-28T17:41:12+00:00" class="time">17:41</time></a>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="MFROLET/43" data-view="x">
  <a class="tgme_widget_message_reply" href="https://t.me/MFROLET/41"><div class="tgme_widget_message_text js-message_reply_text" dir="auto">old text</div></a>
  <a class="tgme_widget_message_video_player blured js-message_video_player" href="https://t.me/MFROLET/43">
    <i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn4.cdn-telegram.org/file/vid.jpg')"></i>
  </a>
  <span class="tgme_widget_message_views">530</span>
  <time datetime="2026-09-29T10:00:00+00:00" class="time">10:00</time>
</div></div>
<div data-post="MFROLET/44"><a class="tgme_widget_message_photo_wrap" style="background-image:url('https://evil.example.com/x.jpg')"></a><div class="tgme_widget_message_text js-message_text">Delivered 500 stars ⭐</div></div>
`;

describe('proofs channel parser', () => {
  const posts = parseChannelPage(PAGE, 'MFROLET');

  it('reads text, album photos, views and date, and skips service messages', () => {
    expect(posts.map((p) => p.postId)).toEqual([41, 43, 44]);
    const p = posts[0];
    expect(p.text).toBe('✅ تم تسليم حساب 3000 جوهرة\nللفائز @luffy & شكراً');
    expect(p.media).toEqual([
      { type: 'photo', url: 'https://cdn4.cdn-telegram.org/file/aaa.jpg' },
      { type: 'photo', url: 'https://cdn5.telesco.pe/file/bbb.jpg' },
    ]);
    expect(p.views).toBe('1.2K');
    expect(p.date?.toISOString()).toBe('2026-09-28T17:41:12.000Z');
  });

  it('takes the video thumbnail and ignores the quoted reply text', () => {
    expect(posts[1].text).toBe('');
    expect(posts[1].media).toEqual([{ type: 'video', url: 'https://cdn4.cdn-telegram.org/file/vid.jpg' }]);
  });

  it("drops media that isn't on Telegram's CDN", () => {
    expect(posts[2].media).toEqual([]);
    expect(isAllowedMediaUrl('https://cdn4.cdn-telegram.org/file/a.jpg')).toBe(true);
    expect(isAllowedMediaUrl('http://cdn4.cdn-telegram.org/file/a.jpg')).toBe(false);
    expect(isAllowedMediaUrl('https://cdn-telegram.org.evil.com/a.jpg')).toBe(false);
  });
});

describe('proof descriptions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes a headline from what the post mentions', () => {
    expect(proofHeadline('تم تسليم حساب 3000 جوهرة')).toEqual({ ar: '✅ إثبات تسليم: 💎 3000 جوهرة', en: '✅ Delivery proof: 💎 3000 Gems' });
    expect(proofHeadline('Delivered 500 stars')).toEqual({ ar: '✅ إثبات تسليم: ⭐ 500 نجمة', en: '✅ Delivery proof: ⭐ 500 Stars' });
    expect(proofHeadline('').en).toBe('✅ Proof of a prize delivered to a winner');
  });

  it('keeps the Arabic text and translates it to English', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [[['Delivered a 3000 gems account', 'x']], null, 'ar'] }));
    const d = await describePost('تم تسليم حساب 3000 جوهرة');
    expect(d.descAr).toBe('تم تسليم حساب 3000 جوهرة');
    expect(d.descEn).toBe('Delivered a 3000 gems account');
  });

  it('still describes the post when translation is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const d = await describePost('تم تسليم 500 نجمة');
    expect(d.descAr).toBe('تم تسليم 500 نجمة');
    expect(d.descEn).toBe('');
    expect(d.headlineEn).toBe('✅ Delivery proof: ⭐ 500 Stars');
  });
});
