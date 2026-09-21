import { Schema, model, Document, Types } from 'mongoose';

export type NotificationType =
  | 'prize_won'
  | 'prize_expiring'
  | 'claim_pending'
  | 'claim_approved'
  | 'claim_rejected'
  | 'wheel_ready'
  | 'referral_progress'
  | 'referral_reward'
  | 'system_announcement';

export interface INotification extends Document {
  user: Types.ObjectId;
  telegramId: number;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    type: {
      type: String,
      enum: [
        'prize_won',
        'prize_expiring',
        'claim_pending',
        'claim_approved',
        'claim_rejected',
        'wheel_ready',
        'referral_progress',
        'referral_reward',
        'system_announcement',
      ],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Notification = model<INotification>('Notification', notificationSchema);
