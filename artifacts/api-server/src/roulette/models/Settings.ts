import { Schema, model, Document } from 'mongoose';
import { ClaimTask } from './ClaimTask';

export interface ISettings extends Document {
  singleton: 'main';
  maintenanceMode: boolean;
  spinCooldownHours: number;
  prizeExpiryHours: number;
  expiryReminderIntervalHours: number;
  // Legacy referral-bonus configuration. Kept only so old data/API calls don't break;
  // no longer wired to anything — see claimReferralsRequired below for the current system.
  referralBonusEnabled: boolean;
  referralBonusPrizeKey: string | null; // references Prize.key, e.g. "referral_bonus"
  // How many qualified referrals a user must bring in (through that specific prize's own
  // link) before they're allowed to withdraw a wheel prize.
  claimReferralsRequired: number;
  wheelClaimReferralsRequired: number;
  dailyClaimReferralsRequired: number;
  referralRequirementsVersion: number;
  demoModeEnabled: boolean;
  demoAccessToken: string | null;
  demoAccessTokenUpdatedAt: Date | null;
  // Optional image sent as part of the rich "share your prize" card the bot sends the
  // user (which they then forward to friends). Stored directly in MongoDB (not local disk —
  // see the same note on Prize.imageData for why). hasShareImage=false means plain text.
  shareImageData: Buffer | null;
  shareImageMimeType: string | null;
  hasShareImage: boolean;
  // Invite race: when counting stops, which round is live, and the announced winner.
  // Invite race on/off. Off hides it everywhere in the bot and pauses all counting; data is kept.
  contestEnabled: boolean;
  contestEndsAt: Date | null;
  contestRound: number;
  contestWinner: { telegramId: number; name: string; score: number; round: number; announcedAt: Date } | null;
  updatedAt: Date;
  createdAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    singleton: { type: String, default: 'main', unique: true },
    maintenanceMode: { type: Boolean, default: false },
    spinCooldownHours: { type: Number, default: 24 },
    prizeExpiryHours: { type: Number, default: 24 },
    expiryReminderIntervalHours: { type: Number, default: 6 },
    referralBonusEnabled: { type: Boolean, default: false },
    referralBonusPrizeKey: { type: String, default: null },
    claimReferralsRequired: { type: Number, default: 7 },
    wheelClaimReferralsRequired: { type: Number, default: 7 },
    dailyClaimReferralsRequired: { type: Number, default: 7 },
    referralRequirementsVersion: { type: Number, default: 0 },
    demoModeEnabled: { type: Boolean, default: false },
    demoAccessToken: { type: String, default: null },
    demoAccessTokenUpdatedAt: { type: Date, default: null },
    shareImageData: { type: Buffer, default: null, select: false },
    shareImageMimeType: { type: String, default: null },
    hasShareImage: { type: Boolean, default: false },
    contestEnabled: { type: Boolean, default: true },
    contestEndsAt: { type: Date, default: null },
    contestRound: { type: Number, default: 1 },
    contestWinner: {
      type: new Schema(
        { telegramId: Number, name: String, score: Number, round: Number, announcedAt: Date },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: true }
);

export const Settings = model<ISettings>('Settings', settingsSchema);

export async function getSettings() {
  let settings = await Settings.findOne({ singleton: 'main' });
  if (!settings) {
    settings = await Settings.create({ singleton: 'main' });
  }
  // Existing deployments were created while daily prizes required five referrals.
  // Apply this one-time migration so both new and still-pending prize tasks use seven.
  if (settings.referralRequirementsVersion < 1) {
    settings.claimReferralsRequired = 7;
    settings.wheelClaimReferralsRequired = 7;
    settings.dailyClaimReferralsRequired = 7;
    settings.referralRequirementsVersion = 1;
    await settings.save();
    await ClaimTask.updateMany(
      { status: 'pending', requiredCount: 5 },
      { $set: { requiredCount: 7 } },
    );
  }
  return settings;
}
