import { Schema, model, Document } from 'mongoose';

/** A listing photo, stored in MongoDB (the container disk is wiped on every redeploy). */
export interface IExchangeImage extends Document {
  ownerTelegramId: number;
  data: Buffer;
  mimeType: string;
  size: number;
  createdAt: Date;
}

const imageSchema = new Schema<IExchangeImage>(
  {
    ownerTelegramId: { type: Number, required: true, index: true },
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

export const ExchangeImage = model<IExchangeImage>('ExchangeImage', imageSchema);
