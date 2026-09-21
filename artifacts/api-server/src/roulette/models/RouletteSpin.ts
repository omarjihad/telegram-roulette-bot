import { Schema, model, Document, Types } from 'mongoose';

export interface IRouletteSpin extends Document {
  user: Types.ObjectId;
  telegramId: number;
  prize: Types.ObjectId | null; // null if the spin resulted in "better luck next time"
  prizeNameSnapshot: string;
  weightsSnapshot: Record<string, number>;
  isEmptyResult: boolean;
  mode: 'daily' | 'points';
  isGiftGuaranteed: boolean;
  createdAt: Date;
}

const rouletteSpinSchema = new Schema<IRouletteSpin>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    prize: { type: Schema.Types.ObjectId, ref: 'Prize', default: null },
    prizeNameSnapshot: { type: String, default: '' },
    weightsSnapshot: { type: Schema.Types.Mixed, default: {} },
    isEmptyResult: { type: Boolean, default: false },
    mode: { type: String, enum: ['daily', 'points'], default: 'daily', index: true },
    isGiftGuaranteed: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const RouletteSpin = model<IRouletteSpin>('RouletteSpin', rouletteSpinSchema);
