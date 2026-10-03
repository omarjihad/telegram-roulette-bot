import { ProofPost, ProofMedia } from '../models/ProofPost';
import { getSettings } from '../models/Settings';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';

/**
 * Proofs section: posts of the public proofs channel (t.me/MFROLET by default), read from
 * Telegram's public web preview (t.me/s/<channel>), stored, and given an Arabic and an
 * English description so the Mini App can show them without sending people away.
 */

const REFRESH_EVERY_MS = 15 * 60 * 1000;
const PAGES_PER_REFRESH = 3;
const PAGE_SIZE = 15;
const MEDIA_HOSTS = ['telesco.pe', 'cdn-telegram.org', 'telegram.org', 't.me'];

let lastRefreshAt = 0;
let refreshing: Promise<number> | null = null;

export interface ParsedPost {
  postId: number;
  date: Date | null;
  text: string;
  media: ProofMedia[];
  views: string | null;
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function absolute(url: string) {
  return url.startsWith('//') ? `https:${url}` : url;
}

export function isAllowedMediaUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && MEDIA_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Reads the posts out of one t.me/s/<channel> page. */
export function parseChannelPage(html: string, channel: string): ParsedPost[] {
  const posts: ParsedPost[] = [];
  const marker = `data-post="${channel}/`;
  const lower = html.toLowerCase();
  const lowerMarker = marker.toLowerCase();
  const starts: number[] = [];
  for (let i = lower.indexOf(lowerMarker); i !== -1; i = lower.indexOf(lowerMarker, i + 1)) starts.push(i);
  starts.forEach((start, k) => {
    const block = html.slice(start, starts[k + 1] ?? html.length);
    const idMatch = block.slice(marker.length).match(/^(\d+)/);
    if (!idMatch) return;
    const postId = Number(idMatch[1]);

    // The post's own text (a reply preview uses js-message_reply_text instead).
    const textMatch = block.match(/class="tgme_widget_message_text[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const text = textMatch ? htmlToText(textMatch[1]) : '';

    const media: ProofMedia[] = [];
    const tagRe = /<(?:a|i|div)\s[^>]*class="(tgme_widget_message_(?:photo_wrap|video_thumb|roundvideo_thumb))[^"]*"[^>]*>/g;
    for (let m = tagRe.exec(block); m; m = tagRe.exec(block)) {
      const url = m[0].match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/);
      if (!url) continue;
      const full = absolute(decodeEntities(url[1]));
      if (!isAllowedMediaUrl(full) || media.some((x) => x.url === full)) continue;
      media.push({ type: m[1] === 'tgme_widget_message_photo_wrap' ? 'photo' : 'video', url: full });
    }

    const views = block.match(/class="tgme_widget_message_views"[^>]*>([^<]+)</)?.[1]?.trim() ?? null;
    const dt = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const date = dt && !Number.isNaN(Date.parse(dt)) ? new Date(dt) : null;

    // Service messages (channel created, photo changed...) have neither text nor media.
    if (!text && media.length === 0) return;
    posts.push({ postId, date, text, media, views });
  });
  return posts;
}

async function fetchPage(channel: string, before?: number) {
  const url = `https://t.me/s/${encodeURIComponent(channel)}${before ? `?before=${before}` : ''}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MFRouletteBot/1.0)', 'Accept-Language': 'ar,en;q=0.8' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`t.me/s returned ${res.status}`);
  return res.text();
}

const PRIZE_PATTERNS: { re: RegExp; ar: (n?: string) => string; en: (n?: string) => string }[] = [
  { re: /(\d[\d,.]*)?\s*(?:جوهر|جواهر|gems?\b|💎)/i, ar: (n) => `💎 ${n ? n + ' ' : ''}جوهرة`, en: (n) => `💎 ${n ? n + ' ' : ''}Gems` },
  { re: /(\d[\d,.]*)?\s*(?:نجم|نجوم|stars?\b|⭐)/i, ar: (n) => `⭐ ${n ? n + ' ' : ''}نجمة`, en: (n) => `⭐ ${n ? n + ' ' : ''}Stars` },
  { re: /(?:رصيد|كارت|asia|اسيا|آسيا|زين|zain)\s*(\d[\d,.]*)?/i, ar: (n) => `📱 رصيد${n ? ' ' + n : ''}`, en: (n) => `📱 Phone credit${n ? ' ' + n : ''}` },
  { re: /(?:بريميوم|premium)/i, ar: () => '👑 تيليجرام بريميوم', en: () => '👑 Telegram Premium' },
  { re: /(?:nft|هدية|هدايا|gift)/i, ar: () => '🎁 هدية تيليجرام', en: () => '🎁 Telegram gift' },
  { re: /(?:حساب|account)/i, ar: () => '🎮 حساب', en: () => '🎮 Account' },
];

/** Short headline from what the post mentions, e.g. "✅ تسليم: 💎 3000 جوهرة". */
export function proofHeadline(text: string) {
  for (const p of PRIZE_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      const n = m[1]?.replace(/[,.]$/, '');
      return { ar: `✅ إثبات تسليم: ${p.ar(n)}`, en: `✅ Delivery proof: ${p.en(n)}` };
    }
  }
  return { ar: '✅ إثبات تسليم جائزة لأحد الفائزين', en: '✅ Proof of a prize delivered to a winner' };
}

/** Free Google Translate endpoint; any failure just leaves the description untranslated. */
export async function translate(text: string, to: 'ar' | 'en'): Promise<{ text: string; from: string } | null> {
  if (!text.trim()) return null;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text.slice(0, 1800))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as [Array<[string, string]>, unknown, string];
    const out = (data?.[0] ?? []).map((part) => part?.[0] ?? '').join('').trim();
    return out ? { text: out, from: String(data?.[2] ?? '') } : null;
  } catch {
    return null;
  }
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

/** Arabic and English descriptions of a post, from its own text. */
export async function describePost(text: string) {
  const headline = proofHeadline(text);
  if (!text.trim()) {
    return { headlineAr: headline.ar, headlineEn: headline.en, descAr: '', descEn: '' };
  }
  let descAr = text;
  let descEn = text;
  if (hasArabic(text)) {
    descEn = (await translate(text, 'en'))?.text ?? '';
  } else {
    descAr = (await translate(text, 'ar'))?.text ?? '';
  }
  return { headlineAr: headline.ar, headlineEn: headline.en, descAr, descEn };
}

/** Fetches the newest posts of the channel and stores them. Returns how many were saved. */
export async function refreshProofs(force = false): Promise<number> {
  if (!force && Date.now() - lastRefreshAt < REFRESH_EVERY_MS) return 0;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const settings = await getSettings();
    const channel = (settings.proofsChannel || 'MFROLET').replace(/^@/, '');
    let saved = 0;
    let before: number | undefined;
    try {
      for (let page = 0; page < PAGES_PER_REFRESH; page++) {
        const posts = parseChannelPage(await fetchPage(channel, before), channel);
        if (posts.length === 0) break;
        for (const p of posts) {
          const existing = await ProofPost.findOne({ channel, postId: p.postId }).select('describedText');
          const needsText = !existing || existing.describedText !== p.text;
          const described = needsText ? await describePost(p.text) : null;
          await ProofPost.updateOne(
            { channel, postId: p.postId },
            {
              $set: {
                date: p.date,
                text: p.text,
                media: p.media,
                views: p.views,
                ...(described ? { ...described, describedText: p.text } : {}),
              },
            },
            { upsert: true }
          );
          saved += 1;
        }
        const oldest = Math.min(...posts.map((p) => p.postId));
        if (!Number.isFinite(oldest) || oldest <= 1) break;
        before = oldest;
      }
      lastRefreshAt = Date.now();
      logger.info({ channel, saved }, 'proofs channel refreshed');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, channel }, 'proofs channel refresh failed');
      // Don't hammer Telegram after a failure; try again on the next cycle.
      lastRefreshAt = Date.now() - REFRESH_EVERY_MS + 2 * 60 * 1000;
    }
    return saved;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function listProofs(before?: number) {
  const settings = await getSettings();
  const channel = (settings.proofsChannel || 'MFROLET').replace(/^@/, '');
  if ((await ProofPost.countDocuments({ channel })) === 0) await refreshProofs(true);
  else void refreshProofs();
  const filter: Record<string, unknown> = { channel, hidden: false };
  if (before) filter.postId = { $lt: before };
  const posts = await ProofPost.find(filter).sort({ postId: -1 }).limit(PAGE_SIZE + 1).lean();
  const page = posts.slice(0, PAGE_SIZE);
  return {
    channel,
    channelUrl: `https://t.me/${channel}`,
    hasMore: posts.length > PAGE_SIZE,
    posts: page.map((p) => ({
      id: p.postId,
      url: `https://t.me/${channel}/${p.postId}`,
      date: p.date,
      views: p.views,
      text: p.text,
      headlineAr: p.headlineAr,
      headlineEn: p.headlineEn,
      descAr: p.descAr,
      descEn: p.descEn,
      media: p.media.map((m, i) => ({ type: m.type, url: `/api/proofs/media/${p.postId}/${i}` })),
    })),
  };
}

/** Streams a post's photo through our server (Telegram's CDN links rotate and can be blocked). */
export async function getProofMedia(postId: number, index: number) {
  const settings = await getSettings();
  const channel = (settings.proofsChannel || 'MFROLET').replace(/^@/, '');
  const post = await ProofPost.findOne({ channel, postId }).select('media').lean();
  const item = post?.media?.[index];
  if (!item || !isAllowedMediaUrl(item.url)) throw new AppError('Not found', 404, 'NOT_FOUND');
  let res = await fetch(item.url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res || !res.ok) {
    // The CDN link expired: refresh the channel once and retry with the new link.
    await refreshProofs(true);
    const again = await ProofPost.findOne({ channel, postId }).select('media').lean();
    const fresh = again?.media?.[index];
    if (!fresh || !isAllowedMediaUrl(fresh.url)) throw new AppError('Not found', 404, 'NOT_FOUND');
    res = await fetch(fresh.url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res || !res.ok) throw new AppError('Media unavailable', 502, 'MEDIA_UNAVAILABLE');
  }
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new AppError('Not an image', 415, 'UNSUPPORTED');
  return { data: Buffer.from(await res.arrayBuffer()), type };
}

export async function setProofHidden(postId: number, hidden: boolean) {
  const settings = await getSettings();
  const channel = (settings.proofsChannel || 'MFROLET').replace(/^@/, '');
  await ProofPost.updateOne({ channel, postId }, { $set: { hidden } });
  return { ok: true };
}
