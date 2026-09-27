import { Schema, model, Document, Types } from 'mongoose';

/** One snake round. The server decides its limits; the client only reports what happened. */
export interface IGameSession extends Document {
  user: Types.ObjectId;
  telegramId: number;
  mode: 'free' | 'ad';
  maxFood: number;
  pointsPerFood: number;
  durationSec: number;
  status: 'playing' | 'finished' | 'died' | 'abandoned';
  food: number;
  reward: number;
  startedAt: Date;
  finishedAt?: Date | null;
  createdAt: Date;
}

const gameSessionSchema = new Schema<IGameSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true, index: true },
    mode: { type: String, enum: ['free', 'ad'], required: true },
    maxFood: { type: Number, required: true },
    pointsPerFood: { type: Number, required: true },
    durationSec: { type: Number, required: true },
    status: { type: String, enum: ['playing', 'finished', 'died', 'abandoned'], default: 'playing', index: true },
    food: { type: Number, default: 0 },
    reward: { type: Number, default: 0 },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const GameSession = model<IGameSession>('GameSession', gameSessionSchema);
