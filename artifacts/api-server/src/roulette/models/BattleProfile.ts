import { Schema, model, Document, Types } from 'mongoose';

export type BattleQuality = 'low' | 'medium' | 'high';
export type BattleJoystick = 'fixed' | 'floating';

/** Where one on-screen control sits: centre as a fraction of the screen, size and opacity. */
export interface BattleControl {
  x: number;
  y: number;
  s: number;
  o: number;
}

export interface BattleSettings {
  darkMode: boolean;
  chat: boolean;
  sound: boolean;
  quality: BattleQuality;
  joystick: BattleJoystick;
}

/** A player's MF Battle account: MF coins, skins, settings and control layout. */
export interface IBattleProfile extends Document {
  user: Types.ObjectId;
  telegramId: number;
  coins: number;
  skin: string;
  ownedSkins: string[];
  settings: BattleSettings;
  // Control id -> position/size/opacity; missing ids use the game's defaults.
  layout: Record<string, BattleControl>;
  bestMass: number;
  // Experience from online games; the level comes from it (battleLevel()).
  xp: number;
  kills: number;
  totalMatches: number;
  totalSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

const battleProfileSchema = new Schema<IBattleProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true, unique: true, index: true },
    coins: { type: Number, default: 0, min: 0 },
    skin: { type: String, default: 'classic' },
    ownedSkins: { type: [String], default: ['classic'] },
    settings: {
      darkMode: { type: Boolean, default: true },
      chat: { type: Boolean, default: true },
      sound: { type: Boolean, default: true },
      quality: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
      joystick: { type: String, enum: ['fixed', 'floating'], default: 'fixed' },
    },
    layout: { type: Schema.Types.Mixed, default: {} },
    bestMass: { type: Number, default: 0 },
    xp: { type: Number, default: 0, min: 0 },
    kills: { type: Number, default: 0, min: 0 },
    totalMatches: { type: Number, default: 0 },
    totalSeconds: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false }
);

export const BattleProfile = model<IBattleProfile>('BattleProfile', battleProfileSchema);
