import { Schema, model, Document } from 'mongoose';
import type { BattleControl } from './BattleProfile';

/** A shared control layout ("copy my settings"): anyone with the code can paste it. */
export interface IBattleLayoutCode extends Document {
  code: string;
  telegramId: number;
  layout: Record<string, BattleControl>;
  createdAt: Date;
}

const battleLayoutCodeSchema = new Schema<IBattleLayoutCode>(
  {
    code: { type: String, required: true, unique: true, index: true },
    telegramId: { type: Number, required: true, index: true },
    layout: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, minimize: false }
);

export const BattleLayoutCode = model<IBattleLayoutCode>('BattleLayoutCode', battleLayoutCodeSchema);
