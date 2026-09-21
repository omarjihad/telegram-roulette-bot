import { Schema, model, Document } from 'mongoose';

export interface IForcedChat extends Document {
  chatId: string; // Telegram chat id or @username, normalized
  title?: string;
  type: 'channel' | 'group' | 'unknown';
  inviteLink?: string;
  addedBy: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const forcedChatSchema = new Schema<IForcedChat>(
  {
    chatId: { type: String, required: true, unique: true, index: true },
    title: String,
    type: { type: String, enum: ['channel', 'group', 'unknown'], default: 'unknown' },
    inviteLink: String,
    addedBy: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ForcedChat = model<IForcedChat>('ForcedChat', forcedChatSchema);
