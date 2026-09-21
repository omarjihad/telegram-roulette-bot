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
