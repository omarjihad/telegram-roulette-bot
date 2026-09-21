import { Schema, model, Document } from 'mongoose';

export type AdminRole = 'owner' | 'developer';

export interface IAdmin extends Document {
  telegramId: number;
  username?: string;
  role: AdminRole;
  addedBy: number;
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema = new Schema<IAdmin>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    role: { type: String, enum: ['owner', 'developer'], required: true },
    addedBy: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Admin = model<IAdmin>('Admin', adminSchema);
