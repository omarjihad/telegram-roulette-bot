import { Schema, model, Document, Types } from 'mongoose';

export const REPORT_REASONS = ['scammer', 'no_middleman', 'not_owner', 'fake_info', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A user's report about a listing. Media is forwarded to the developers by the bot. */
export interface IExchangeReport extends Document {
  listing: Types.ObjectId;
  reporter: Types.ObjectId;
  reporterTelegramId: number;
  reason: ReportReason;
  description: string;
  mediaCount: number;
  status: 'open' | 'resolved';
  resolvedByTelegramId?: number | null;
  createdAt: Date;
}

const reportSchema = new Schema<IExchangeReport>(
  {
    listing: { type: Schema.Types.ObjectId, ref: 'ExchangeListing', required: true, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reporterTelegramId: { type: Number, required: true },
    reason: { type: String, enum: [...REPORT_REASONS], required: true },
    description: { type: String, required: true, maxlength: 1000 },
    mediaCount: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    resolvedByTelegramId: { type: Number, default: null },
  },
  { timestamps: true }
);

export const ExchangeReport = model<IExchangeReport>('ExchangeReport', reportSchema);
