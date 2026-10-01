import { Schema, model, Document } from 'mongoose';

/** A listing photo, stored in MongoDB (the container disk is wiped on every redeploy). */
export interface IExchangeImage extends Document {
  ownerTelegramId: number;
  data: Buffer;
  // Small version (made by the Mini App) used on the listing cards; older photos have none.
  thumb?: Buffer | null;
  mimeType: string;
  size: number;
  createdAt: Date;
}

const imageSchema = new Schema<IExchangeImage>(
  {
    ownerTelegramId: { type: Number, required: true, index: true },
    data: { type: Buffer, required: true },
    thumb: { type: Buffer, default: null },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

export const ExchangeImage = model<IExchangeImage>('ExchangeImage', imageSchema);
