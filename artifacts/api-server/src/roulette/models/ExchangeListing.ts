import { Schema, model, Document, Types } from 'mongoose';

export type ExchangeMode = 'trade' | 'sell' | 'both';
export const EXCHANGE_CURRENCIES = ['usd', 'asia', 'zain', 'master', 'ton', 'pound', 'riyal'] as const;
export type ExchangeCurrency = (typeof EXCHANGE_CURRENCIES)[number];

/** A Bounty Rush account offered in the exchange section (trade, sale, or both). */
export interface IExchangeListing extends Document {
  owner: Types.ObjectId;
  ownerTelegramId: number;
  ownerUsername?: string | null;
  ownerName?: string | null;
  mode: ExchangeMode;
  details: string;
  price: number | null;
  currency: ExchangeCurrency | null;
  images: Types.ObjectId[];
  status: 'active' | 'removed';
  pinned: boolean;
  pinnedAt?: Date | null;
  removedAt?: Date | null;
  removedByTelegramId?: number | null;
  reportsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const listingSchema = new Schema<IExchangeListing>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerTelegramId: { type: Number, required: true, index: true },
    ownerUsername: { type: String, default: null },
    ownerName: { type: String, default: null },
    mode: { type: String, enum: ['trade', 'sell', 'both'], required: true },
    details: { type: String, required: true, maxlength: 1500 },
    price: { type: Number, default: null },
    currency: { type: String, enum: [...EXCHANGE_CURRENCIES, null], default: null },
    images: [{ type: Schema.Types.ObjectId, ref: 'ExchangeImage' }],
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true },
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
    removedAt: { type: Date, default: null },
    removedByTelegramId: { type: Number, default: null },
    reportsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

listingSchema.index({ status: 1, mode: 1, pinned: -1, createdAt: -1 });

export const ExchangeListing = model<IExchangeListing>('ExchangeListing', listingSchema);
