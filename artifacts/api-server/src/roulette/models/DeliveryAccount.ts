import { Schema, model, Document } from 'mongoose';

export interface IDeliveryAccount extends Document {
  singleton: 'main';
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  phoneMasked: string;
  encryptedSession: string;
  isActive: boolean;
  lastConnectedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryAccountSchema = new Schema<IDeliveryAccount>(
  {
    singleton: { type: String, unique: true, default: 'main' },
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: null },
    firstName: { type: String, default: null },
    phoneMasked: { type: String, required: true },
    encryptedSession: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true, index: true },
    lastConnectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const DeliveryAccount = model<IDeliveryAccount>('DeliveryAccount', deliveryAccountSchema);