import { Schema, model, Document, Types } from 'mongoose';

/**
 * Channel giveaways (سحوبات). A developer writes the giveaway post in a channel themselves
 * (premium emoji, quotes…) and forwards it to the bot; the bot adds the buttons to that post
 * and publishes a "write your username" post whose comments verify the bot was started.
 */

/** A channel people must join (condition 1). */
export interface GiveawayChat {
  chatId: string; // numeric id as text, e.g. "-1001234567890"
  title: string;
  username?: string | null;
}

export interface GiveawayWinner {
  telegramId: number;
  name: string;
  username?: string | null;
  number: number; // their participant number
  place: number; // 1 = first place
}

export interface IGiveaway extends Document {
  seq: number; // #1, #2 … used in buttons and links
  status: 'open' | 'stopped';
  channelId: number;
  channelTitle: string;
  channelUsername?: string | null;
  postId: number; // the developer's giveaway post
  discussionId?: number | null; // the channel's comments group
  usernamePostId?: number | null; // the bot's "write your username" post in the channel
  usernameThreadId?: number | null; // that post's comment thread in the comments group
  count: number; // participants so far (also their numbers)
  winners: GiveawayWinner[];
  dropped: number[]; // people taken out of the draw (excluded winners, left a channel)
  winnersPostId?: number | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

const winnerSchema = new Schema<GiveawayWinner>(
  {
    telegramId: { type: Number, required: true },
    name: { type: String, default: '' },
    username: { type: String, default: null },
    number: { type: Number, default: 0 },
    place: { type: Number, required: true },
  },
  { _id: false }
);

const giveawaySchema = new Schema<IGiveaway>(
  {
    seq: { type: Number, required: true, unique: true },
    status: { type: String, enum: ['open', 'stopped'], default: 'open' },
    channelId: { type: Number, required: true },
    channelTitle: { type: String, default: '' },
    channelUsername: { type: String, default: null },
    postId: { type: Number, required: true },
    discussionId: { type: Number, default: null },
    usernamePostId: { type: Number, default: null },
    usernameThreadId: { type: Number, default: null },
    count: { type: Number, default: 0 },
    winners: { type: [winnerSchema], default: [] },
    dropped: { type: [Number], default: [] },
    winnersPostId: { type: Number, default: null },
    createdBy: { type: Number, required: true },
  },
  { timestamps: true }
);
giveawaySchema.index({ channelId: 1, postId: 1 }, { unique: true });

export const Giveaway = model<IGiveaway>('Giveaway', giveawaySchema);

/** One person in one giveaway: verified (condition 3), joined, who invited them, bonus chances. */
export interface IGiveawayEntry extends Document {
  giveaway: Types.ObjectId;
  telegramId: number;
  name: string;
  username?: string | null;
  verifiedAt?: Date | null; // wrote their username under the "write your username" post, bot started
  joinedAt?: Date | null;
  number?: number | null; // participant number (#)
  referredBy?: number | null; // came in through this person's boost link
  bonus: number; // people who joined through their link: extra chances in the draw
  createdAt: Date;
  updatedAt: Date;
}

const entrySchema = new Schema<IGiveawayEntry>(
  {
    giveaway: { type: Schema.Types.ObjectId, ref: 'Giveaway', required: true },
    telegramId: { type: Number, required: true },
    name: { type: String, default: '' },
    username: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: null },
    number: { type: Number, default: null },
    referredBy: { type: Number, default: null },
    bonus: { type: Number, default: 0 },
  },
  { timestamps: true }
);
entrySchema.index({ giveaway: 1, telegramId: 1 }, { unique: true });
entrySchema.index({ giveaway: 1, joinedAt: 1 });

export const GiveawayEntry = model<IGiveawayEntry>('GiveawayEntry', entrySchema);

/** Giveaway settings: the channels people must join (condition 1), for every giveaway. */
export interface IGiveawayConfig extends Document {
  singleton: 'main';
  required: GiveawayChat[];
}

const configSchema = new Schema<IGiveawayConfig>({
  singleton: { type: String, default: 'main', unique: true },
  required: {
    type: [new Schema<GiveawayChat>({ chatId: String, title: String, username: { type: String, default: null } }, { _id: false })],
    default: [],
  },
});

export const GiveawayConfig = model<IGiveawayConfig>('GiveawayConfig', configSchema);

export async function getGiveawayConfig() {
  return (await GiveawayConfig.findOne({ singleton: 'main' })) ?? (await GiveawayConfig.create({ singleton: 'main', required: [] }));
}
