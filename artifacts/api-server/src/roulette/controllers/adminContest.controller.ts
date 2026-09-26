import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { writeAudit } from '../models/AuditLog';
import {
  announceContestWinner,
  getContestAdminState,
  setContestEndsAt,
  startNewContestRound,
} from '../services/contest.service';

function parseEndsAt(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AppError('تاريخ غير صالح', 422, 'VALIDATION_ERROR');
  return date;
}

async function audit(req: Request, action: string, metadata: Record<string, unknown> = {}) {
  await writeAudit({
    actorId: req.telegramId!,
    actorUsername: req.dbUser?.username ?? '',
    action,
    target: 'invite_race',
    metadata,
  });
}

export const adminGetContest = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ ok: true, contest: await getContestAdminState() });
});

export const adminSetContestEndsAt = asyncHandler(async (req: Request, res: Response) => {
  const endsAt = parseEndsAt((req.body as { endsAt?: unknown }).endsAt);
  await setContestEndsAt(endsAt);
  await audit(req, 'contest.ends_at', { endsAt });
  res.json({ ok: true, contest: await getContestAdminState() });
});

export const adminAnnounceContestWinner = asyncHandler(async (req: Request, res: Response) => {
  const winner = await announceContestWinner();
  await audit(req, 'contest.announce_winner', { winner });
  res.json({ ok: true, contest: await getContestAdminState() });
});

export const adminStartContestRound = asyncHandler(async (req: Request, res: Response) => {
  const round = await startNewContestRound(parseEndsAt((req.body as { endsAt?: unknown }).endsAt));
  await audit(req, 'contest.new_round', { round });
  res.json({ ok: true, contest: await getContestAdminState() });
});
