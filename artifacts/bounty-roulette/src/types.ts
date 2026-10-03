export interface ShowcaseResponse {
  ok: true;
  prizes: Array<{
    key: string;
    name: string;
    icon: string;
    imageUrl: string | null;
    stock: number;
    active: boolean;
    probability: number;
  }>;
  botUsername: string;
  configured: boolean;
  spinCooldownHours: number;
}

export interface MeResponse {
  ok: true;
  user: {
    telegramId: number;
    username?: string;
    firstName?: string;
    photoUrl?: string;
    captchaPassed: boolean;
    forcedSubOk: boolean;
    totalSpins: number;
    spinPoints: number;
    spinCredits: number;
  };
  wheel: {
    ready: boolean;
    nextSpinAt: string;
    lastSpin: { won: boolean; prizeName: string | null; prizeIcon: string | null; prizeImageUrl: string | null; prizeKey: string | null } | null;
  };
  isAdmin: boolean;
  adminRole: 'owner' | 'developer' | null;
  // The invite race is hidden everywhere while this is false.
  contestEnabled?: boolean;
  // Snake game + ad task are open to everyone (otherwise only admins, others see "coming soon").
  gamesPublic?: boolean;
  // Exchange section is open to everyone (otherwise only admins, others see "coming soon").
  exchangePublic?: boolean;
  // The user's saved language (null until they pick one).
  language?: 'ar' | 'en' | null;
}

export interface ForcedSubMissing {
  chatId: string;
  title: string;
  isSubscribed: boolean;
  inviteLink?: string;
}

export type SpinResult =
  | {
      won: true;
      prizeName: string;
      prizeKey: string;
      prizeIcon: string;
      prizeImageUrl: string | null;
      userPrizeId: string;
      expiresAt: string;
      nextSpinAt: string;
    }
  | {
      won: false;
      nextSpinAt: string;
    };

export interface RecentWin {
  id: string;
  imageUrl: string | null;
  icon: string;
  wonAt: string;
}

export interface RecentWinsResponse {
  ok: true;
  wins: RecentWin[];
}

export interface InventoryItem {
  id: string;
  prizeName: string;
  icon: string;
  imageUrl: string | null;
  source: 'wheel' | 'referral' | 'store' | 'daily';
  wonAt: string;
  expiresAt: string | null;
  status: 'active' | 'claim_requested' | 'approved' | 'delivered' | 'rejected' | 'expired';
  task: {
    link: string | null;
    requiredCount: number;
    creditedCount: number;
    status: 'pending' | 'completed' | 'expired';
  } | null;
}

export interface DeveloperItem {
  telegramId: number;
  username?: string;
  role: 'owner' | 'developer';
  createdAt: string;
}

export interface ReferralData {
  link: string | null;
  pending: number;
  qualified: number;
  total: number;
  referrals: Array<{
    id: string;
    status: string;
    createdAt: string;
    qualifiedAt?: string;
    invitee: { name: string; photoUrl: string | null; profileLink: string } | null;
  }>;
  tasks: Array<{
    id: string;
    prizeName: string;
    link: string | null;
    requiredCount: number;
    creditedCount: number;
    status: 'pending' | 'completed' | 'expired';
    expiresAt: string;
  }>;
  subscriptionTasks: Array<{
    id: string;
    title: string;
    taskType: 'subscription' | 'folder' | 'profile_name' | 'profile_bio';
    chatId: string;
    verificationChatId: string | null;
    chatType: 'channel' | 'group' | 'unknown';
    inviteLink: string | null;
    folderLink: string | null;
    profileRequirement: string | null;
    rewardPoints: number;
    claimed: boolean;
  }>;
  referralRewards: {
    rewardPoints: number;
    requiredReferrals: number;
    claimedMilestones: number;
    availableMilestones: number;
  };
  rules: string[];
}

export interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface DailyLoginResponse {
  ok: true;
  result: {
    claimed: boolean;
    alreadyClaimed: boolean;
    streakDay: number;
    claimedDays: number[];
    nextClaimAt: string;
    spinPoints: number;
    spinCredits: number;
    reward: {
      day: number;
      type: 'points' | 'prize';
      points: number | null;
      prizeKey: string | null;
      prizeName: string | null;
      prizeIcon: string | null;
      prizeImageUrl: string | null;
    };
  };
}

export interface DailyLoginStatusResponse {
  ok: true;
  status: {
    canClaim: boolean;
    streakReset: boolean;
    streakDay: number;
    claimedDays: number[];
    nextClaimAt: string;
    resetAt: string | null;
    reward: DailyLoginResponse['result']['reward'];
  };
}

export interface ContestResponse {
  ok: true;
  joined: boolean;
  link: string | null;
  myScore: number;
  myRank: number | null;
  myPending: number;
  participants: number;
  leaderboard: Array<{ rank: number; name: string; photoUrl: string | null; profileLink: string | null; score: number; isMe: boolean }>;
  endsAt: string | null;
  closed: boolean;
  winner: { name: string; score: number; isMe: boolean } | null;
  noWinner: { reason: 'min_not_reached' | 'manual'; totalInvites: number } | null;
  totalInvites: number;
  minTotalInvites: number;
  prize: {
    name: string;
    number: string;
    nftUrl: string;
    imageUrl: string;
    attributes: Array<{ label: string; value: string; rarity: string }>;
    valueUsd: string;
  };
  rules: string[];
}

export interface GamesResponse {
  ok: true;
  allowed: boolean;
  comingSoon: boolean;
  blockId: string;
  spinPoints: number;
  snake: {
    durationSec: number;
    pointsPerFood: number;
    freeMaxFood: number;
    adMaxFood: number;
    freeReady: boolean;
    freeReadyAt: string;
  };
  adTask: { reward: number; adsPerSpin: number | null };
}

export interface SnakeRound {
  ok: true;
  sessionId: string;
  mode: 'free' | 'ad';
  maxFood: number;
  pointsPerFood: number;
  durationSec: number;
}

export type ExchangeMode = 'trade' | 'sell' | 'both';
export type ExchangeCurrency = 'usd' | 'asia' | 'zain' | 'master' | 'ton' | 'pound' | 'riyal';
export type ReportReason = 'scammer' | 'no_middleman' | 'not_owner' | 'fake_info' | 'other';

export interface ExchangeStatus {
  ok: true;
  allowed: boolean;
  comingSoon: boolean;
  isAdmin: boolean;
  middlemanGroup: string;
  currencies: ExchangeCurrency[];
  reasons: ReportReason[];
  maxImages: number;
  maxActive: number;
  myActive: number;
}

export interface ExchangeListingSummary {
  id: string;
  mode: ExchangeMode;
  details: string;
  prices: { currency: ExchangeCurrency; amount: number }[];
  pinned: boolean;
  expiresAt: string;
  status: 'active' | 'removed';
  coverUrl: string | null;
  imageCount: number;
  views: number;
  ownerName: string | null;
  createdAt: string;
}

export interface ExchangeListingDetail extends ExchangeListingSummary {
  images: string[];
  owner: { telegramId: number; username: string | null; name: string | null; profileLink: string };
  isMine: boolean;
  canModerate: boolean;
  shareLink: string | null;
  canRenew: boolean;
  reportsCount?: number;
}

export type MediationStatus = 'waiting_join' | 'waiting_mediator' | 'in_progress' | 'completed' | 'expired' | 'cancelled';

export interface MediationTicketView {
  id: string;
  number: number;
  status: MediationStatus;
  isRequester: boolean;
  expiresAt: string;
  groupLink: string | null;
  me: { requested: boolean };
  other: { name: string; requested: boolean };
  mediator: string | null;
  createdAt: string;
}

export interface ProofPostView {
  id: number;
  url: string;
  date: string | null;
  views: string | null;
  text: string;
  headlineAr: string;
  headlineEn: string;
  descAr: string;
  descEn: string;
  media: { type: 'photo' | 'video'; url: string }[];
}

export interface ProofsResponse {
  ok: true;
  channel: string;
  channelUrl: string;
  hasMore: boolean;
  posts: ProofPostView[];
}
