import { Schema, model, Document, Types } from 'mongoose';

/** An offer sent to a listing's owner through the bot (instead of messaging them directly). */
export interface IExchangeOffer extends Document {
  listing: Types.ObjectId;
  fromUser: Types.ObjectId;
  fromTelegramId: number;
  toTelegramId: number;
  // 'buy': an offer of money; 'trade': the sender's own account (details + photos).
  kind: 'buy' | 'trade';
  message: string;
  photoCount: number;
  status: 'pending' | 'accepted' | 'rejected';
  ownerMessage?: { chatId: number; messageId: number } | null;
  decidedAt?: Date | null;
  createdAt: Date;
}

const offerSchema = new Schema<IExchangeOffer>(
  {
    listing: { type: Schema.Types.ObjectId, ref: 'ExchangeListing', required: true, index: true },
    fromUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fromTelegramId: { type: Number, required: true, index: true },
    toTelegramId: { type: Number, required: true },
    kind: { type: String, enum: ['buy', 'trade'], default: 'buy' },
    message: { type: String, required: true, maxlength: 1500 },
    photoCount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    ownerMessage: { type: { _id: false, chatId: Number, messageId: Number }, default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ExchangeOffer = model<IExchangeOffer>('ExchangeOffer', offerSchema);
