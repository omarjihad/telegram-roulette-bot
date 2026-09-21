import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  photoUrl?: string;
  isBanned: boolean;
  bannedAt?: Date;
  bannedBy?: number;
  banReason?: string;
  captchaPassed: boolean;
  captchaPassedAt?: Date;
  forcedSubOk: boolean;
  deliveryContactVerifiedAt?: Date | null;
  deliveryContactVerificationMethod?: 'outgoing_message' | null;
  referredBy?: Types.ObjectId | null; // User who referred this user (only ever set once)
  referredByCampaign?: Types.ObjectId | null; // Which reward campaign this referral belongs to
  lastSpinAt?: Date | null;
  totalSpins: number;
  // What the user's most recent spin actually resulted in. Purely informational (never used
  // to decide anything) — its only job is letting the client show "آخر نتيجة: ..." when the
  // Wheel page is revisited during the cooldown, since the wheel's visual reel has no memory
  // of a past spin once the component remounts (navigating away and back resets its position
  // to an arbitrary resting card that has nothing to do with what was actually won).
  lastSpinWon?: boolean | null;
  lastSpinPrizeName?: string | null;
  lastSpinPrizeIcon?: string | null;
  lastSpinPrizeHasImage?: boolean | null;
  lastSpinPrizeKey?: string | null;
  // Spendable currency for the Store — +1 every time the user spins (win or lose), spent
  // on purchases. Unlike totalSpins (a lifetime stat that only ever goes up), this goes
  // down when the user buys something.
  spinPoints: number;
  spinPointsSpent: number;
  spinCredits: number;
  spinCreditsSpent: number;
  bonusDailySpins: number;
  guaranteedDailyPrizes: Types.ObjectId[];
  referralMilestoneClaims: number;
  demoAccessUntil?: Date | null;
  dailyPrizeBlockedNextSpin: boolean;
  generalReferralToken?: string | null;
  dailyStreakDay: number;
  dailyLastClaimAt?: Date | null;
  dailyClaimedDays: number[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, index: true },
    firstName: String,
    lastName: String,
    languageCode: String,
    photoUrl: String,
    isBanned: { type: Boolean, default: false, index: true },
    bannedAt: Date,
    bannedBy: Number,
    banReason: String,
    captchaPassed: { type: Boolean, default: false },
    captchaPassedAt: Date,
    forcedSubOk: { type: Boolean, default: false },
    deliveryContactVerifiedAt: { type: Date, default: null },
    deliveryContactVerificationMethod: { type: String, enum: ['outgoing_message', null], default: null },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    referredByCampaign: { type: Schema.Types.ObjectId, ref: 'ReferralCampaign', default: null },
    lastSpinAt: { type: Date, default: null },
    totalSpins: { type: Number, default: 0 },
    lastSpinWon: { type: Boolean, default: null },
    lastSpinPrizeName: { type: String, default: null },
    lastSpinPrizeIcon: { type: String, default: null },
    lastSpinPrizeHasImage: { type: Boolean, default: null },
    lastSpinPrizeKey: { type: String, default: null },
    spinPoints: { type: Number, default: 0 },
    spinPointsSpent: { type: Number, default: 0 },
    spinCredits: { type: Number, default: 0 },
    spinCreditsSpent: { type: Number, default: 0 },
  bonusDailySpins: { type: Number, default: 0 },
    guaranteedDailyPrizes: { type: [Schema.Types.ObjectId], ref: 'Prize', default: [] },
    referralMilestoneClaims: { type: Number, default: 0 },
    demoAccessUntil: { type: Date, default: null },
    dailyPrizeBlockedNextSpin: { type: Boolean, default: false },
    generalReferralToken: { type: String, default: null, unique: true, sparse: true },
    dailyStreakDay: { type: Number, default: 0 },
    dailyLastClaimAt: { type: Date, default: null },
    dailyClaimedDays: { type: [Number], default: [] },
  },
  { timestamps: true }
);

export const User = model<IUser>('User', userSchema);
