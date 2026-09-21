import { Schema, model, Document, Types } from 'mongoose';

export type ClaimTaskStatus = 'pending' | 'completed' | 'expired';

/**
 * A ClaimTask is created automatically the moment a user wins a wheel prize.
 * It represents "invite N real, qualified friends through THIS prize's own link
 * before you can withdraw it". Each task has its own unique token/link, so
 * referrals made for one prize can never be reused to unlock a different prize:
 * a Referral row can only ever be credited to the one task it was created for
 * (enforced by Referral.invitee being globally unique — see Referral.ts).
 */
export interface IClaimTask extends Document {
  userPrize: Types.ObjectId; // the specific UserPrize this task unlocks (1:1)
  user: Types.ObjectId; // the referrer (prize winner)
  referrerTelegramId: number;
  token: string; // used in the deep link: https://t.me/<bot>?start=task_<token>
  requiredCount: number;
  creditedCount: number;
  status: ClaimTaskStatus;
  expiresAt: Date; // mirrors the UserPrize's own expiry — same 24h window
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const claimTaskSchema = new Schema<IClaimTask>(
  {
    userPrize: { type: Schema.Types.ObjectId, ref: 'UserPrize', required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referrerTelegramId: { type: Number, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    requiredCount: { type: Number, required: true, default: 5 },
    creditedCount: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['pending', 'completed', 'expired'], default: 'pending', index: true },
    expiresAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ClaimTask = model<IClaimTask>('ClaimTask', claimTaskSchema);
