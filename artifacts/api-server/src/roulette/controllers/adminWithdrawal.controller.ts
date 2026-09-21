import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  listPendingWithdrawals,
  listReferralsForWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
} from '../services/withdrawal.service';
import { AppError } from '../utils/AppError';

export const adminListWithdrawals = asyncHandler(async (req: Request, res: Response) => {
  const items = await listPendingWithdrawals();
  res.json({ ok: true, items });
});

export const adminViewReferralsForWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const { referrals } = await listReferralsForWithdrawal(req.params.id);

  res.json({
    ok: true,
    referrals: referrals.map((r) => ({
      invitee: r.invitee,
      status: r.status,
      createdAt: r.createdAt,
      forcedSubOkAt: r.forcedSubOkAt,
      captchaOkAt: r.captchaOkAt,
      qualifiedAt: r.qualifiedAt,
    })),
  });
});

export const adminApproveWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const result = await approveWithdrawal(req.params.id, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, result });
});

export const adminRejectWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body as { reason?: string };
  if (!reason) throw new AppError('reason is required', 422, 'VALIDATION_ERROR');
  const result = await rejectWithdrawal(req.params.id, reason, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, result });
});
