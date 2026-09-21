import { Schema, model, Document } from 'mongoose';

export type TaskType = 'subscription' | 'folder' | 'profile_name' | 'profile_bio';

export interface ITask extends Document {
  title: string;
  taskType: TaskType;
  chatId?: string;
  chatType: 'channel' | 'group' | 'unknown';
  inviteLink?: string;
  verificationChatId?: string;
  folderLink?: string;
  profileRequirement?: string;
  rewardPoints: number;
  isActive: boolean;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true },
    taskType: { type: String, enum: ['subscription', 'folder', 'profile_name', 'profile_bio'], default: 'subscription', index: true },
    chatId: { type: String, index: true },
    chatType: { type: String, enum: ['channel', 'group', 'unknown'], default: 'unknown' },
    inviteLink: String,
    verificationChatId: String,
    folderLink: String,
    profileRequirement: String,
    rewardPoints: { type: Number, required: true, min: 0, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Task = model<ITask>('Task', taskSchema);