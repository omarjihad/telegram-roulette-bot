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
  // Highest level whose coin reward was paid.
  levelRewarded: number;
  // Throw speeds: bought up to this level (0 ×1, 1 ×2 free, 2 ×5, 3 ×10); ×20 and ×50 open for
  // 15 minutes after watching ads (×50 needs two: x50Ads counts the first).
  throwOwned: number;
  x20Until?: Date | null;
  x50Until?: Date | null;
  x50Ads: number;
  // Start size bought (index into START_SIZES).
  sizeOwned: number;
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
    levelRewarded: { type: Number, default: 1 },
    throwOwned: { type: Number, default: 1, min: 1, max: 3 },
    x20Until: { type: Date, default: null },
    x50Until: { type: Date, default: null },
    x50Ads: { type: Number, default: 0 },
    sizeOwned: { type: Number, default: 0, min: 0 },
    totalMatches: { type: Number, default: 0 },
    totalSeconds: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false }
);

export const BattleProfile = model<IBattleProfile>('BattleProfile', battleProfileSchema);
