import { Schema, model, Document } from 'mongoose';

/** One player's numbers for one week (Monday to Monday, Baghdad time) — the weekly leaderboards. */
export interface IBattleWeeklyStat extends Document {
  week: string;
  telegramId: number;
  name: string;
  skin: string;
  maxMass: number;
  playSeconds: number;
  matches: number;
}

const battleWeeklyStatSchema = new Schema<IBattleWeeklyStat>(
  {
    week: { type: String, required: true },
    telegramId: { type: Number, required: true },
    name: { type: String, default: '' },
    skin: { type: String, default: 'classic' },
    maxMass: { type: Number, default: 0 },
    playSeconds: { type: Number, default: 0 },
    matches: { type: Number, default: 0 },
  },
  { timestamps: true }
);

battleWeeklyStatSchema.index({ week: 1, telegramId: 1 }, { unique: true });
battleWeeklyStatSchema.index({ week: 1, maxMass: -1 });
battleWeeklyStatSchema.index({ week: 1, playSeconds: -1 });
battleWeeklyStatSchema.index({ week: 1, matches: -1 });

export const BattleWeeklyStat = model<IBattleWeeklyStat>('BattleWeeklyStat', battleWeeklyStatSchema);
