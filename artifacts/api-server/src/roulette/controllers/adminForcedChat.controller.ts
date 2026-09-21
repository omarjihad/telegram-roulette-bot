import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  addForcedChat,
  removeForcedChat,
  listForcedChats,
  clearAllForcedChats,
} from '../services/forcedChatAdmin.service';
import { getBotInstance } from '../bot/instance';
import { AppError } from '../utils/AppError';

export const adminListForcedChats = asyncHandler(async (req: Request, res: Response) => {
  const chats = await listForcedChats();
  res.json({ ok: true, chats });
});

export const adminAddForcedChat = asyncHandler(async (req: Request, res: Response) => {
  const { input } = req.body as { input?: string };
  if (!input) throw new AppError('input is required', 422, 'VALIDATION_ERROR');
  const chat = await addForcedChat(getBotInstance(), input, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, chat });
});

export const adminRemoveForcedChat = asyncHandler(async (req: Request, res: Response) => {
  const chat = await removeForcedChat(req.params.chatId, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, chat });
});

export const adminClearForcedChats = asyncHandler(async (req: Request, res: Response) => {
  await clearAllForcedChats(req.telegramId!, req.dbUser!.username);
  res.json({ ok: true });
});
