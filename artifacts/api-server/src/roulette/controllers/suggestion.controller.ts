import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { getBotInstance } from '../bot/instance';
import { logger } from '../config/logger';
import {
  createSuggestion,
  decideSuggestion,
  listMySuggestions,
  listSuggestions,
  markSuggestionDecided,
  notifyAdminsNewSuggestion,
  parseRewardChoice,
  SUGGESTION_MAX,
  SUGGESTION_MIN,
} from '../services/suggestion.service';

const bot = () => {
  try {
    return getBotInstance();
  } catch {
    return null;
  }
};

const view = (s: { seq: number; text: string; status: string; reward?: unknown; note?: string | null; createdAt: Date; decidedAt?: Date | null }) => ({
  seq: s.seq,
  text: s.text,
  status: s.status,
  reward: s.reward ?? null,
  note: s.note ?? null,
  createdAt: s.createdAt,
  decidedAt: s.decidedAt ?? null,
});

export const getMySuggestions = asyncHandler(async (req: Request, res: Response) => {
  const items = await listMySuggestions(req.telegramId!);
  res.json({ ok: true, items: items.map(view), min: SUGGESTION_MIN, max: SUGGESTION_MAX });
});

export const postSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const s = await createSuggestion(req.dbUser!, (req.body as { text?: unknown }).text);
  notifyAdminsNewSuggestion(bot(), s).catch((err) => logger.warn({ err }, 'suggestion admin notice failed'));
  res.json({ ok: true, suggestion: view(s) });
});

export const adminListSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const items = await listSuggestions(String(req.query.status ?? ''));
  res.json({
    ok: true,
    items: items.map((s) => ({ ...view(s), telegramId: s.telegramId, name: s.name, username: s.username ?? null, decidedByName: s.decidedByName ?? null })),
  });
});

export const adminDecideSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const seq = Number(req.params.seq);
  if (!Number.isInteger(seq) || seq < 1) throw new AppError('Suggestion not found', 404, 'NOT_FOUND');
  const body = (req.body ?? {}) as { accept?: boolean; reward?: unknown; note?: string };
  const accept = Boolean(body.accept);
  const s = await decideSuggestion({
    seq,
    accept,
    reward: accept ? parseRewardChoice(body.reward) : undefined,
    note: typeof body.note === 'string' ? body.note : null,
    adminId: req.telegramId!,
    adminName: req.dbUser?.username ? `@${req.dbUser.username}` : req.dbUser?.firstName || String(req.telegramId),
  });
  await markSuggestionDecided(bot(), s);
  res.json({ ok: true, suggestion: view(s) });
});
