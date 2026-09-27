import { Schema, model, Document, Types } from 'mongoose';

/**
 * One completed rewarded ad, reported by Adsgram's server-to-server Reward URL.
 * The Mini App then spends it on something (the ad task reward or an extra snake round),
 * so a user can only be rewarded for ads Adsgram actually confirmed.
 */
export interface IAdView extends Document {
  telegramId: number;
  source: 'adsgram_callback' | 'client';
  consumedAt?: Date | null;
  consumedFor?: 'ad_task' | 'snake_round' | null;
  createdAt: Date;
}

const adViewSchema = new Schema<IAdView>(
  {
    telegramId: { type: Number, required: true, index: true },
    source: { type: String, enum: ['adsgram_callback', 'client'], required: true },
    consumedAt: { type: Date, default: null },
    consumedFor: { type: String, enum: ['ad_task', 'snake_round', null], default: null },
  },
  { timestamps: true }
);

adViewSchema.index({ telegramId: 1, consumedAt: 1, createdAt: 1 });

export const AdView = model<IAdView>('AdView', adViewSchema);
