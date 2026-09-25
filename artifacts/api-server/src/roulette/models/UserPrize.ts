import { Schema, model, Document, Types } from 'mongoose';

export type UserPrizeStatus =
  | 'active' // won, waiting on user (e.g. optional referral bonus window) or just sitting in inventory
  | 'claim_requested' // user pressed claim, withdrawal request created
  | 'approved' // developer approved, delivery account still needs to deliver
  | 'delivered' // delivery account completed the handoff
  | 'rejected' // developer rejected
  | 'expired'; // 24h window passed without claim

export interface IUserPrize extends Document {
  user: Types.ObjectId;
  telegramId: number;
  prize: Types.ObjectId;
  prizeNameSnapshot: string;
  source: 'wheel' | 'referral' | 'store' | 'daily';
  wonAt: Date;
  expiresAt: Date | null; // null = no expiry (used for referral bonuses)
  status: UserPrizeStatus;
  claimAttempts: number;
  lastExpiryNotifiedAt?: Date | null;
  spinId?: Types.ObjectId | null;
  referralId?: Types.ObjectId | null;
  // Set once the reserved stock has been returned to the bot (expired/rejected), so it is
  // never returned twice.
  stockReleasedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userPrizeSchema = new Schema<IUserPrize>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    prize: { type: Schema.Types.ObjectId, ref: 'Prize', required: true },
    prizeNameSnapshot: { type: String, required: true },
    source: { type: String, enum: ['wheel', 'referral', 'store', 'daily'], default: 'wheel' },
    wonAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, default: null, index: true },
    status: {
      type: String,
       enum: ['active', 'claim_requested', 'approved', 'delivered', 'rejected', 'expired'],
      default: 'active',
      index: true,
    },
    claimAttempts: { type: Number, default: 0 },
    lastExpiryNotifiedAt: { type: Date, default: null },
    spinId: { type: Schema.Types.ObjectId, ref: 'RouletteSpin', default: null },
    referralId: { type: Schema.Types.ObjectId, ref: 'Referral', default: null },
    stockReleasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userPrizeSchema.index({ status: 1, expiresAt: 1 });

export const UserPrize = model<IUserPrize>('UserPrize', userPrizeSchema);
