import { Schema, model, Document, Types } from 'mongoose';

export type WithdrawalStatus = 'pending' | 'approved' | 'delivered' | 'rejected';

export interface IWithdrawalRequest extends Document {
  user: Types.ObjectId;
  telegramId: number;
  username?: string;
  userPrize: Types.ObjectId;
  prizeNameSnapshot: string;
  status: WithdrawalStatus;
  requestedAt: Date;
  decidedAt?: Date | null;
  decidedByTelegramId?: number | null;
  decidedByUsername?: string | null;
  deliveredAt?: Date | null;
  deliveredByTelegramId?: number | null;
  deliveredByUsername?: string | null;
  rejectReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalRequestSchema = new Schema<IWithdrawalRequest>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    username: String,
    userPrize: { type: Schema.Types.ObjectId, ref: 'UserPrize', required: true, unique: true },
    prizeNameSnapshot: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'delivered', 'rejected'], default: 'pending', index: true },
    requestedAt: { type: Date, required: true, default: () => new Date() },
    decidedAt: { type: Date, default: null },
    decidedByTelegramId: { type: Number, default: null },
    decidedByUsername: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    deliveredByTelegramId: { type: Number, default: null },
    deliveredByUsername: { type: String, default: null },
    rejectReason: { type: String, default: null },
  },
  { timestamps: true }
);

export const WithdrawalRequest = model<IWithdrawalRequest>('WithdrawalRequest', withdrawalRequestSchema);
