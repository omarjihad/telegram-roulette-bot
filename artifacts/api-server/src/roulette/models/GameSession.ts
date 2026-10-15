import { Schema, model, Document, Types } from 'mongoose';

export type GameKind = 'snake' | 'ziggurat' | 'flappy' | 'timer';

/** One game round. The server decides its limits; the client only reports what happened. */
export interface IGameSession extends Document {
  // Rounds from before the ziggurat existed have no game: they are snake rounds.
  game?: GameKind;
  user: Types.ObjectId;
  telegramId: number;
  mode: 'free' | 'ad';
  maxFood: number;
  pointsPerFood: number;
  durationSec: number;
  status: 'playing' | 'finished' | 'died' | 'abandoned';
  food: number; // what the round scored: bites, floors, pipes, or the Timer's points-earning stops
  reward: number;
  // The Timer: the time to stop at on each try (ms), which tries hide the clock, and the stops.
  targets?: number[];
  blind?: boolean[];
  stops?: number[];
  startedAt: Date;
  finishedAt?: Date | null;
  createdAt: Date;
}

const gameSessionSchema = new Schema<IGameSession>(
  {
    game: { type: String, enum: ['snake', 'ziggurat', 'flappy', 'timer'], default: 'snake' },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true, index: true },
    mode: { type: String, enum: ['free', 'ad'], required: true },
    maxFood: { type: Number, required: true },
    pointsPerFood: { type: Number, required: true },
    durationSec: { type: Number, required: true },
    status: { type: String, enum: ['playing', 'finished', 'died', 'abandoned'], default: 'playing', index: true },
    food: { type: Number, default: 0 },
    reward: { type: Number, default: 0 },
    targets: { type: [Number], default: undefined },
    blind: { type: [Boolean], default: undefined },
    stops: { type: [Number], default: undefined },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const GameSession = model<IGameSession>('GameSession', gameSessionSchema);
