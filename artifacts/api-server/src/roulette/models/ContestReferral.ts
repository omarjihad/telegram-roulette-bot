import { Schema, model, Document, Types } from 'mongoose';

/**
 * One person who joined the bot through someone's invite-race link.
 * - pending: joined, still has to finish forced-sub + captcha
 * - counted: finished both, +1 for the contestant
 * - removed: blocked the bot (a counted one becomes -1 for the contestant)
 */
export type ContestReferralStatus = 'pending' | 'counted' | 'removed';

export interface IContestReferral extends Document {
  contestant: Types.ObjectId;
  contestantTelegramId: number;
  invitee: Types.ObjectId;
  inviteeTelegramId: number;
  status: ContestReferralStatus;
  countedAt?: Date | null;
  removedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const contestReferralSchema = new Schema<IContestReferral>(
  {
    contestant: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contestantTelegramId: { type: Number, required: true, index: true },
    // A user can only ever be counted for one contestant.
    invitee: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    inviteeTelegramId: { type: Number, required: true, unique: true },
    status: { type: String, enum: ['pending', 'counted', 'removed'], default: 'pending', index: true },
    countedAt: { type: Date, default: null },
    removedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

contestReferralSchema.index({ status: 1, contestant: 1 });

export const ContestReferral = model<IContestReferral>('ContestReferral', contestReferralSchema);
