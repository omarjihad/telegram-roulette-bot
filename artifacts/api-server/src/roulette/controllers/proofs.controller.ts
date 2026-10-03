import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { getSettings } from '../models/Settings';
import { getProofMedia, listProofs, refreshProofs, setProofHidden } from '../services/proofs.service';

/** Public (also on the website, for visitors and ad-network reviewers). */
export const getProofs = asyncHandler(async (req: Request, res: Response) => {
  const before = Number((req.query as { before?: string }).before) || undefined;
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ ok: true, ...(await listProofs(before)) });
});

export const getProofMediaFile = asyncHandler(async (req: Request, res: Response) => {
  const media = await getProofMedia(Number(req.params.postId), Number(req.params.index));
  res.setHeader('Content-Type', media.type);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(media.data);
});

export const adminRefreshProofs = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ ok: true, saved: await refreshProofs(true) });
});

export const adminSetProofHidden = asyncHandler(async (req: Request, res: Response) => {
  res.json(await setProofHidden(Number(req.params.postId), Boolean((req.body ?? {}).hidden)));
});

export const adminSetProofsChannel = asyncHandler(async (req: Request, res: Response) => {
  const channel = String((req.body ?? {}).channel ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9_]{4,64}$/.test(channel)) throw new AppError('يوزر القناة غير صالح', 422, 'VALIDATION_ERROR');
  const settings = await getSettings();
  settings.proofsChannel = channel;
  await settings.save();
  res.json({ ok: true, channel, saved: await refreshProofs(true) });
});
