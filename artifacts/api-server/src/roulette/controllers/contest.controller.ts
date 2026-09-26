import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { getContestOverview, joinContest } from '../services/contest.service';

export const getContest = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getContestOverview(req.dbUser!)) });
});

export const postJoinContest = asyncHandler(async (req: Request, res: Response) => {
  await joinContest(req.dbUser!);
  res.json({ ok: true, ...(await getContestOverview(req.dbUser!)) });
});
