import { Schema, model, Document, Types } from 'mongoose';

export interface ICaptchaSession extends Document {
  user: Types.ObjectId;
  telegramId: number;
  correctAnswer: number;
  options: number[];
  isSolved: boolean;
  solvedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const captchaSessionSchema = new Schema<ICaptchaSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    correctAnswer: { type: Number, required: true },
    options: { type: [Number], required: true },
    isSolved: { type: Boolean, default: false },
    solvedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

captchaSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CaptchaSession = model<ICaptchaSession>('CaptchaSession', captchaSessionSchema);
