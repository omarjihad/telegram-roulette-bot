import { Schema, model, Document, Types } from 'mongoose';

export type ReferralStatus = 'pending' | 'qualified' | 'rejected';

export interface IReferral extends Document {
  referrer: Types.ObjectId; // the inviter
  referrerTelegramId: number;
  invitee: Types.ObjectId; // the invited user
  inviteeTelegramId: number;
  status: ReferralStatus;
  forcedSubOkAt?: Date | null;
  captchaOkAt?: Date | null;
  qualifiedAt?: Date | null;
  rewardGranted: boolean;
  // The single ClaimTask (prize-specific invite link) this referral was made through.
  // Set once at creation and never changed — this is what makes it impossible for the
  // same invited friend to count toward two different prizes at once.
  creditedTaskId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const referralSchema = new Schema<IReferral>(
  {
    referrer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referrerTelegramId: { type: Number, required: true, index: true },
    invitee: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // one user can only ever be referred once
    inviteeTelegramId: { type: Number, required: true, unique: true },
    status: { type: String, enum: ['pending', 'qualified', 'rejected'], default: 'pending', index: true },
    forcedSubOkAt: { type: Date, default: null },
    captchaOkAt: { type: Date, default: null },
    qualifiedAt: { type: Date, default: null },
    rewardGranted: { type: Boolean, default: false },
    creditedTaskId: { type: Schema.Types.ObjectId, ref: 'ClaimTask', default: null, index: true },
  },
  { timestamps: true }
);

export const Referral = model<IReferral>('Referral', referralSchema);
