import { getTelegramWebApp } from '../hooks/useTelegramWebApp';
import { tr } from '../i18n';
import type { ShowcaseResponse } from '../types';

/**
 * Website preview: opened in a normal browser (no Telegram initData) the Mini App still
 * shows every screen with sample data, so visitors (and ad-network reviewers) can see how
 * it works. Nothing is real: spins, withdrawals, invites and ads only work inside Telegram.
 */
export function isPreviewMode(): boolean {
  return !getTelegramWebApp()?.initData;
}

export class TelegramOnlyError extends Error {
  code = 'TELEGRAM_ONLY';
  status = 403;
  constructor() {
    super(tr('هذه الميزة متاحة فقط داخل تيليجرام. افتح البوت للاستخدام الكامل.', 'This feature is only available inside Telegram. Open the bot to use it.'));
  }
}

let showcase: Promise<ShowcaseResponse | null> | null = null;
export function loadShowcase(): Promise<ShowcaseResponse | null> {
  if (!showcase) {
    showcase = fetch('/api/showcase')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return showcase;
}

export async function previewBotLink(): Promise<string> {
  const data = await loadShowcase();
  return `https://t.me/${data?.botUsername || 'MfRuLiTbot'}`;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const SAMPLE_NAMES = ['@luffy_king', 'زورو', '@nami_x', 'سانجي', '@ace_fire', 'لو', '@robin', 'شانكس'];

async function previewPrizes() {
  const data = await loadShowcase();
  const prizes = (data?.prizes ?? []).filter((p) => p.active);
  if (prizes.length > 0) {
    return prizes.map((p) => ({
      key: p.key,
      name: p.name,
      icon: p.icon,
      imageUrl: p.imageUrl,
      isAvailable: p.stock !== 0,
      availability: p.stock !== 0 ? 'available' : 'out_of_stock',
    }));
  }
  return [
    { key: 'gems_3000', name: tr('3000 جوهرة', '3000 Gems'), icon: '💎', imageUrl: null, isAvailable: true, availability: 'available' },
    { key: 'gems_5000', name: tr('5000 جوهرة', '5000 Gems'), icon: '💎', imageUrl: null, isAvailable: true, availability: 'available' },
    { key: 'tg_gift', name: tr('هدية تيليجرام', 'Telegram Gift'), icon: '🎁', imageUrl: null, isAvailable: true, availability: 'available' },
  ];
}

export async function previewGet(path: string): Promise<unknown> {
  const route = path.split('?')[0];
  switch (route) {
    case '/me':
      return {
        ok: true,
        user: { telegramId: 0, firstName: tr('زائر', 'Guest'), captchaPassed: true, forcedSubOk: true, totalSpins: 12, spinPoints: 3.6, spinCredits: 2 },
        wheel: { ready: true, nextSpinAt: new Date().toISOString(), lastSpin: null },
        isAdmin: false,
        adminRole: null,
        contestEnabled: true,
        gamesPublic: true,
        language: null,
      };
    case '/daily-login':
      return {
        ok: true,
        // Not claimable, so the daily popup doesn't cover the page for website visitors.
        status: {
          canClaim: false, streakReset: false, streakDay: 3, claimedDays: [1, 2, 3], nextClaimAt: hoursFromNow(5), resetAt: null,
          reward: { day: 3, type: 'points', points: 2, prizeKey: null, prizeName: null, prizeIcon: null, prizeImageUrl: null },
        },
      };
    case '/wheel/prizes':
      return { ok: true, prizes: await previewPrizes() };
    case '/wheel/recent-wins':
      return { ok: true, wins: [] };
    case '/inventory':
      return {
        ok: true,
        items: [
          {
            id: 'preview-1', prizeName: tr('3000 جوهرة', '3000 Gems'), icon: '💎', imageUrl: null, source: 'wheel', wonAt: new Date().toISOString(),
            expiresAt: hoursFromNow(20), status: 'active',
            task: { link: null, requiredCount: 5, creditedCount: 2, status: 'pending' },
          },
        ],
      };
    case '/referrals':
      return {
        ok: true,
        link: null,
        pending: 1,
        qualified: 4,
        total: 5,
        referrals: SAMPLE_NAMES.slice(0, 3).map((name, i) => ({
          id: `r${i}`, status: i === 0 ? 'pending' : 'qualified', createdAt: new Date().toISOString(), invitee: { name, photoUrl: null, profileLink: '' },
        })),
        tasks: [],
        subscriptionTasks: [
          { id: 't1', title: tr('اشترك بقناة MF', 'Join the MF channel'), taskType: 'subscription', chatId: '', verificationChatId: null, chatType: 'channel', inviteLink: null, folderLink: null, profileRequirement: null, rewardPoints: 0.5, claimed: false },
        ],
        referralRewards: { rewardPoints: 1.2, requiredReferrals: 20, claimedMilestones: 0, availableMilestones: 0 },
        rules: [
          tr('يجب على الشخص المدعو إكمال الاشتراك الإجباري والكابتشا حتى تُحتسب.', 'The invited person must complete the required subscriptions and the captcha to count.'),
          tr('ممنوع الحسابات الوهمية.', 'Fake accounts are not allowed.'),
        ],
      };
    case '/notifications':
      return { ok: true, items: [] };
    case '/store/products':
      return { ok: true, products: [] };
    case '/games':
      return {
        ok: true, allowed: true, comingSoon: false, blockId: '', spinPoints: 3.6,
        snake: { durationSec: 30, pointsPerFood: 0.03, freeMaxFood: 7, adMaxFood: 4, freeReady: true, freeReadyAt: new Date(0).toISOString() },
        adTask: { reward: 0.2, adsPerSpin: 25 },
      };
    case '/contest':
      return {
        ok: true, joined: false, link: null, myScore: 0, myRank: null, myPending: 0, participants: SAMPLE_NAMES.length,
        leaderboard: SAMPLE_NAMES.map((name, i) => ({ rank: i + 1, name, photoUrl: null, profileLink: null, score: 40 - i * 4, isMe: false })),
        endsAt: hoursFromNow(72), closed: false, winner: null, noWinner: null, totalInvites: 190, minTotalInvites: 120,
        prize: {
          name: 'Santa Hat', number: '#38438', nftUrl: 'https://t.me/nft/SantaHat-38438', imageUrl: '/nft-santa-hat.jpg',
          attributes: [
            { label: tr('الموديل', 'Model'), value: 'Cold Autumn', rarity: '2%' },
            { label: tr('الرمز', 'Symbol'), value: "New Year's Eve", rarity: '2.4%' },
            { label: tr('الخلفية', 'Backdrop'), value: 'Satin Gold', rarity: '1.5%' },
          ],
          valueUsd: '~$17',
        },
        rules: [tr('المركز الأول فقط يربح الجائزة.', 'Only first place wins the prize.')],
      };
    case '/tasks':
      return { ok: true, tasks: [] };
    default:
      return { ok: true };
  }
}
