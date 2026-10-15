import { Schema, model, Document, Types } from 'mongoose';

/** What an accepted suggestion earned (chosen by the admin who accepted it). */
export type SuggestionRewardType = 'none' | 'points' | 'daily_spin' | 'prize';

export interface SuggestionReward {
  type: SuggestionRewardType;
  points?: number | null;
  prizeName?: string | null;
  userPrize?: Types.ObjectId | null;
}

/** A feature suggestion sent from the Mini App, reviewed by the admins. */
export interface ISuggestion extends Document {
  seq: number; // #1, #2 …
  user: Types.ObjectId;
  telegramId: number;
  username?: string | null;
  name: string;
  text: string;
  status: 'pending' | 'accepted' | 'rejected';
  decidedBy?: number | null;
  decidedByName?: string | null;
  decidedAt?: Date | null;
  reward?: SuggestionReward | null;
  note?: string | null; // the admin's words to the person
  adminMessages: Array<{ chatId: number; messageId: number }>;
  createdAt: Date;
  updatedAt: Date;
}

const suggestionSchema = new Schema<ISuggestion>(
  {
    seq: { type: Number, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true, index: true },
    username: { type: String, default: null },
    name: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: Number, default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    reward: {
      type: new Schema<SuggestionReward>(
        {
          type: { type: String, enum: ['none', 'points', 'daily_spin', 'prize'], default: 'none' },
          points: { type: Number, default: null },
          prizeName: { type: String, default: null },
          userPrize: { type: Schema.Types.ObjectId, ref: 'UserPrize', default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    note: { type: String, default: null, maxlength: 500 },
    adminMessages: { type: [{ chatId: Number, messageId: Number, _id: false }], default: [] },
  },
  { timestamps: true }
);
suggestionSchema.index({ telegramId: 1, createdAt: -1 });

export const Suggestion = model<ISuggestion>('Suggestion', suggestionSchema);
