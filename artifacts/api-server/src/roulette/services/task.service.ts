import mongoose from 'mongoose';
import type TelegramBot from 'node-telegram-bot-api';
import { Task, ITask } from '../models/Task';
import { UserTask } from '../models/UserTask';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { fetchChatInfo, checkMembershipStatus } from './forcedSub.service';
import { assertBotIsAdminInChat, normalizeChatIdentifier } from './forcedChatAdmin.service';
import { writeAudit } from '../models/AuditLog';
import { verifyDeliveryProfile } from './deliveryAccount.service';

export async function listTasks() {
  return Task.find({}).sort({ createdAt: -1 });
}

type TaskInput = {
  taskType?: 'subscription' | 'folder' | 'profile_name' | 'profile_bio';
  chatId?: string;
  verificationChatId?: string;
  folderLink?: string;
  profileRequirement?: string;
  title?: string;
  rewardPoints: number;
};

export async function createSubscriptionTask(
  bot: TelegramBot,
  input: TaskInput,
  actorId: number,
  actorUsername?: string
) {
  const taskType = input.taskType ?? 'subscription';
  if (!Number.isFinite(input.rewardPoints) || input.rewardPoints < 0) {
    throw new AppError('rewardPoints must be zero or greater', 422, 'VALIDATION_ERROR');
  }

  if (taskType === 'profile_name' || taskType === 'profile_bio') {
    const profileRequirement = taskType === 'profile_name' ? 'MF' : '@mfbisnes';
    const task = await Task.create({
      taskType,
      chatId: `profile:${taskType}`,
      title: input.title?.trim() || (taskType === 'profile_name' ? 'ضع شعار MF بجانب اسمك' : 'ضع @mfbisnes في البايو'),
      profileRequirement,
      chatType: 'unknown',
      rewardPoints: input.rewardPoints,
      createdBy: actorId,
      isActive: true,
    });
    await writeAudit({ actorId, actorUsername, action: 'task.add', target: String(task._id), metadata: { taskType, rewardPoints: input.rewardPoints } });
    return task;
  }

  const verificationChatId = taskType === 'folder' ? normalizeChatIdentifier(input.verificationChatId || '') : undefined;
  const chatId = taskType === 'folder' ? `folder:${actorId}:${Date.now()}` : normalizeChatIdentifier(input.chatId || '');
  if (!chatId) throw new AppError('chatId is required', 422, 'VALIDATION_ERROR');
  if (taskType === 'folder' && !verificationChatId) throw new AppError('verificationChatId is required', 422, 'VALIDATION_ERROR');
  if (taskType === 'folder' && !/^https:\/\/t\.me\/(?:addlist|joinchat)\//i.test(input.folderLink?.trim() || '')) {
    throw new AppError('folderLink must be a Telegram folder link', 422, 'VALIDATION_ERROR');
  }
  if (taskType !== 'folder' && await Task.exists({ chatId, taskType })) throw new AppError('Task already exists for this chat', 409, 'ALREADY_EXISTS');

  const checkedChatId = verificationChatId || chatId;
  await assertBotIsAdminInChat(bot, checkedChatId);
  const info = await fetchChatInfo(bot, checkedChatId);
  const task = await Task.create({
    taskType,
    chatId,
    title: input.title?.trim() || (taskType === 'folder' ? 'إضافة مجلد Telegram' : info?.title || chatId),
    chatType: info?.type ?? 'unknown',
    inviteLink: info?.inviteLink,
    verificationChatId,
    folderLink: taskType === 'folder' ? input.folderLink?.trim() : undefined,
    rewardPoints: input.rewardPoints,
    createdBy: actorId,
    isActive: true,
  });
  await writeAudit({ actorId, actorUsername, action: 'task.add', target: String(task._id), metadata: { taskType, chatId, rewardPoints: input.rewardPoints } });
  return task;
}

export async function updateTask(
  bot: TelegramBot,
  id: string,
  input: { chatId?: string; verificationChatId?: string; title?: string; rewardPoints?: number; isActive?: boolean; folderLink?: string },
  actorId: number,
  actorUsername?: string
) {
  const task = await Task.findById(id);
  if (!task) throw new AppError('Task not found', 404, 'NOT_FOUND');
  if (input.rewardPoints !== undefined && (!Number.isFinite(input.rewardPoints) || input.rewardPoints < 0)) {
    throw new AppError('rewardPoints must be zero or greater', 422, 'VALIDATION_ERROR');
  }
  const requestedChatId = task.taskType === 'folder' ? input.verificationChatId : input.chatId;
  if (requestedChatId && task.taskType !== 'profile_name' && task.taskType !== 'profile_bio') {
    const chatId = normalizeChatIdentifier(requestedChatId);
    if (task.taskType !== 'folder' && await Task.exists({ chatId, taskType: task.taskType, _id: { $ne: task._id } })) throw new AppError('Task already exists for this chat', 409, 'ALREADY_EXISTS');
    await assertBotIsAdminInChat(bot, chatId);
    const info = await fetchChatInfo(bot, chatId);
    if (task.taskType === 'folder') task.verificationChatId = chatId;
    else task.chatId = chatId;
    task.chatType = info?.type ?? 'unknown';
    task.inviteLink = info?.inviteLink;
  }
  if (input.title !== undefined) task.title = input.title.trim() || task.title;
  if (input.folderLink !== undefined) {
    if (task.taskType !== 'folder' || !/^https:\/\/t\.me\/(?:addlist|joinchat)\//i.test(input.folderLink.trim())) {
      throw new AppError('folderLink must be a Telegram folder link', 422, 'VALIDATION_ERROR');
    }
    task.folderLink = input.folderLink.trim();
  }
  if (input.rewardPoints !== undefined) task.rewardPoints = input.rewardPoints;
  if (input.isActive !== undefined) task.isActive = input.isActive;
  await task.save();
  await writeAudit({ actorId, actorUsername, action: 'task.update', target: id, metadata: input });
  return task;
}

export async function deleteTask(id: string, actorId: number, actorUsername?: string) {
  const task = await Task.findByIdAndDelete(id);
  if (!task) throw new AppError('Task not found', 404, 'NOT_FOUND');
  await UserTask.deleteMany({ task: task._id });
  await writeAudit({ actorId, actorUsername, action: 'task.delete', target: id });
}

export async function listTasksForUser(userId: mongoose.Types.ObjectId | string) {
  const tasks = await Task.find({ isActive: true }).sort({ createdAt: -1 });
  const claimed = await UserTask.find({ user: userId }).select('task isRevoked').lean();
  const claimedMap = new Map(claimed.map((item) => [String(item.task), !item.isRevoked]));
  return tasks.map((task) => ({ task, claimed: claimedMap.get(String(task._id)) ?? false }));
}

export async function claimTask(bot: TelegramBot, telegramId: number, taskId: string) {
  const session = await mongoose.startSession();
  try {
    let result: { rewardPoints: number; remainingBalance: number } | null = null;
    await session.withTransaction(async () => {
      const user = await User.findOne({ telegramId }).session(session);
      const task = await Task.findOne({ _id: taskId, isActive: true }).session(session);
      if (!user || !task) throw new AppError('Task not found', 404, 'NOT_FOUND');
       let completed = false;
       if (task.taskType === 'profile_name' || task.taskType === 'profile_bio') {
          completed = await verifyDeliveryProfile(
            telegramId,
            task.taskType === 'profile_name' ? 'name' : 'bio',
            { firstName: user.firstName, lastName: user.lastName, username: user.username },
          );
       } else if (task.taskType === 'folder') {
          const membership = Boolean(task.verificationChatId)
            ? await checkMembershipStatus(bot, { chatId: task.verificationChatId! }, telegramId)
            : { isSubscribed: false, unavailable: false };
          if (membership.unavailable) {
            throw new AppError(
              'تعذر التحقق من القناة حالياً. تأكد من صحة BOT_TOKEN وأن البوت أدمن في قناة التحقق، ثم حاول مرة ثانية.',
              503,
              'CHANNEL_CHECK_UNAVAILABLE',
            );
          }
          completed = membership.isSubscribed;
       } else {
          const membership = Boolean(task.chatId)
            ? await checkMembershipStatus(bot, { chatId: task.chatId! }, telegramId)
            : { isSubscribed: false, unavailable: false };
          if (membership.unavailable) {
            throw new AppError(
              'تعذر التحقق من القناة حالياً. تأكد من صحة BOT_TOKEN وأن البوت أدمن في القناة، ثم حاول مرة ثانية.',
              503,
              'CHANNEL_CHECK_UNAVAILABLE',
            );
          }
          completed = membership.isSubscribed;
       }
       if (!completed) throw new AppError('أكمل شروط المهمة أولاً ثم حاول مرة ثانية.', 403, 'TASK_NOT_COMPLETED');

       const existing = await UserTask.findOne({ user: user._id, task: task._id }).session(session);
       if (existing && !existing.isRevoked) throw new AppError('Task already claimed', 409, 'TASK_ALREADY_CLAIMED');
       if (existing) {
         existing.isRevoked = false;
         existing.revokedAt = null;
         existing.lastVerifiedAt = new Date();
         await existing.save({ session });
       } else {
         await UserTask.create([{ user: user._id, task: task._id, telegramId, lastVerifiedAt: new Date() }], { session });
       }
       await User.updateOne({ _id: user._id }, { $inc: { spinPoints: task.rewardPoints } }, { session });
      result = { rewardPoints: task.rewardPoints, remainingBalance: user.spinPoints + task.rewardPoints };
    });
    return result;
  } finally {
    await session.endSession();
  }
}