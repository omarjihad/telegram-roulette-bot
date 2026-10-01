import { Schema, model, Document, Types } from 'mongoose';

/** One row per person who opened a listing, so its view count counts people, not visits. */
export interface IExchangeView extends Document {
  listing: Types.ObjectId;
  telegramId: number;
  createdAt: Date;
}

const viewSchema = new Schema<IExchangeView>(
  {
    listing: { type: Schema.Types.ObjectId, ref: 'ExchangeListing', required: true },
    telegramId: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

viewSchema.index({ listing: 1, telegramId: 1 }, { unique: true });

export const ExchangeView = model<IExchangeView>('ExchangeView', viewSchema);
