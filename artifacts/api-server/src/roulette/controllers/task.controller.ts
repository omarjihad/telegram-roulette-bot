import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { claimTask, listTasksForUser } from '../services/task.service';
import { getBotInstance } from '../bot/instance';

export const getMyTasks = asyncHandler(async (req: Request, res: Response) => {
  const tasks = await listTasksForUser(req.dbUser!._id);
  res.json({
    ok: true,
    tasks: tasks.map(({ task, claimed }) => ({
      id: task._id,
      title: task.title,
      taskType: task.taskType,
      chatId: task.chatId,
      verificationChatId: task.verificationChatId ?? null,
      chatType: task.chatType,
      inviteLink: task.inviteLink ?? null,
      folderLink: task.folderLink ?? null,
      profileRequirement: task.profileRequirement ?? null,
      rewardPoints: task.rewardPoints,
      claimed,
    })),
  });
});

export const postClaimTask = asyncHandler(async (req: Request, res: Response) => {
  const result = await claimTask(getBotInstance(), req.telegramId!, req.params.id);
  res.json({ ok: true, result });
});