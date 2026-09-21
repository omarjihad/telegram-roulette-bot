import { Schema, model, Document } from 'mongoose';

export interface IAuditLog extends Document {
  actorId: number;
  actorUsername?: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Number, required: true, index: true },
    actorUsername: String,
    action: { type: String, required: true, index: true },
    target: String,
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);

export async function writeAudit(entry: {
  actorId: number;
  actorUsername?: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await AuditLog.create(entry);
}
