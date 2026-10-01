import { Schema, model, Document, Types } from 'mongoose';

export type MediationStatus = 'waiting_join' | 'waiting_mediator' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
export const OPEN_MEDIATION_STATUSES: MediationStatus[] = ['waiting_join', 'waiting_mediator', 'in_progress'];

interface Party {
  user: Types.ObjectId;
  telegramId: number;
  username?: string | null;
  name?: string | null;
  // When this side sent its join request to the mediation group.
  requestedAt?: Date | null;
}

/**
 * A request for an MF middleman. Both sides ask to join the mediation group within 15
 * minutes; then the middlemen are pinged, and the one who takes the ticket gets both
 * sides let into the group.
 */
export interface IMediationTicket extends Document {
  number: number;
  requester: Party;
  partner: Party;
  listing?: Types.ObjectId | null;
  status: MediationStatus;
  expiresAt: Date;
  chatId?: number | null;
  groupMessageId?: number | null;
  mediatorTelegramId?: number | null;
  mediatorUsername?: string | null;
  mediatorName?: string | null;
  takenAt?: Date | null;
  completedAt?: Date | null;
  closedAt?: Date | null;
  createdAt: Date;
}

const partySchema = new Schema<Party>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    telegramId: { type: Number, required: true },
    username: { type: String, default: null },
    name: { type: String, default: null },
    requestedAt: { type: Date, default: null },
  },
  { _id: false }
);

const ticketSchema = new Schema<IMediationTicket>(
  {
    number: { type: Number, required: true, unique: true },
    requester: { type: partySchema, required: true },
    partner: { type: partySchema, required: true },
    listing: { type: Schema.Types.ObjectId, ref: 'ExchangeListing', default: null },
    status: {
      type: String,
      enum: ['waiting_join', 'waiting_mediator', 'in_progress', 'completed', 'expired', 'cancelled'],
      default: 'waiting_join',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    chatId: { type: Number, default: null },
    groupMessageId: { type: Number, default: null },
    mediatorTelegramId: { type: Number, default: null, index: true },
    mediatorUsername: { type: String, default: null },
    mediatorName: { type: String, default: null },
    takenAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ 'requester.telegramId': 1, status: 1 });
ticketSchema.index({ 'partner.telegramId': 1, status: 1 });

export const MediationTicket = model<IMediationTicket>('MediationTicket', ticketSchema);
