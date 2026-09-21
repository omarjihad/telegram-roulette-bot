import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { getBotInstance } from '../bot/instance';
import { createSubscriptionTask, deleteTask, listTasks, updateTask } from '../services/task.service';

export const adminListTasks = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ ok: true, tasks: await listTasks() });
});

export const adminCreateTask = asyncHandler(async (req: Request, res: Response) => {
  const { taskType, chatId, verificationChatId, folderLink, title, rewardPoints } = req.body as {
    taskType?: 'subscription' | 'folder' | 'profile_name' | 'profile_bio';
    chatId?: string;
    verificationChatId?: string;
    folderLink?: string;
    title?: string;
    rewardPoints?: number;
  };
  if (typeof rewardPoints !== 'number') throw new AppError('rewardPoints is required', 422, 'VALIDATION_ERROR');
  if (!taskType || taskType === 'subscription' ? !chatId : taskType === 'folder' ? !verificationChatId || !folderLink : false) {
    throw new AppError('Task fields are incomplete', 422, 'VALIDATION_ERROR');
  }
  const task = await createSubscriptionTask(
    getBotInstance(),
    { taskType, chatId, verificationChatId, folderLink, title, rewardPoints },
    req.telegramId!,
    req.dbUser!.username,
  );
  res.json({ ok: true, task });
});

export const adminUpdateTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await updateTask(getBotInstance(), req.params.id, req.body, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, task });
});

export const adminDeleteTask = asyncHandler(async (req: Request, res: Response) => {
  await deleteTask(req.params.id, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true });
});