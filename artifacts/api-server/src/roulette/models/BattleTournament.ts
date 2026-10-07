import { Schema, model, Document } from 'mongoose';

/**
 * An MF Battle tournament started by a developer. Two kinds:
 *  - longest: whoever stays first (among real players) for the most time wins;
 *  - final:   whoever is first when the time runs out wins.
 */
export type BattleTournamentMode = 'longest' | 'final';

export interface BattleTournamentEntry {
  telegramId: number;
  name: string;
  leadSeconds: number;
  bestMass: number;
}

export interface IBattleTournament extends Document {
  status: 'running' | 'ended' | 'cancelled';
  mode: BattleTournamentMode;
  minutes: number;
  startedAt: Date;
  endsAt: Date;
  startedBy: number;
  announced: boolean;
  // The prize / description the developer wrote (shown to players and in the messages).
  prize: string;
  // telegramId -> entry (only players who were first at some point).
  standings: Record<string, BattleTournamentEntry>;
  // Who is first right now, as last reported by a game room.
  current: { telegramId: number; name: string; mass: number; at: Date } | null;
  winner: (BattleTournamentEntry & { finalMass?: number }) | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const battleTournamentSchema = new Schema<IBattleTournament>(
  {
    status: { type: String, enum: ['running', 'ended', 'cancelled'], default: 'running', index: true },
    mode: { type: String, enum: ['longest', 'final'], required: true },
    minutes: { type: Number, required: true, min: 1 },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: true, index: true },
    startedBy: { type: Number, required: true },
    announced: { type: Boolean, default: false },
    prize: { type: String, default: '', maxlength: 300 },
    standings: { type: Schema.Types.Mixed, default: {} },
    current: { type: Schema.Types.Mixed, default: null },
    winner: { type: Schema.Types.Mixed, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

export const BattleTournament = model<IBattleTournament>('BattleTournament', battleTournamentSchema);
