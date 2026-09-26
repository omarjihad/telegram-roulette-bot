import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { createCaptchaChallenge, verifyCaptchaAnswer } from '../services/captcha.service';
import { tryQualifyReferral } from '../services/referral.service';
import { tryCountContestReferral } from '../services/contest.service';
import { AppError } from '../utils/AppError';
import mongoose from 'mongoose';

export const requestCaptcha = asyncHandler(async (req: Request, res: Response) => {
  const user = req.dbUser!;
  if (user.captchaPassed) {
    return res.json({ ok: true, alreadyPassed: true });
  }
  const challenge = await createCaptchaChallenge(user._id as mongoose.Types.ObjectId, user.telegramId);
  return res.json({ ok: true, alreadyPassed: false, challenge });
});

export const submitCaptcha = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, answer } = req.body as { sessionId?: string; answer?: number };
  if (!sessionId || typeof answer !== 'number') {
    throw new AppError('sessionId and answer are required', 422, 'VALIDATION_ERROR');
  }

  await verifyCaptchaAnswer(sessionId, req.telegramId!, answer);

  const user = req.dbUser!;
  user.captchaPassed = true;
  user.captchaPassedAt = new Date();
  await user.save();

  await tryQualifyReferral(user._id as mongoose.Types.ObjectId);
  await tryCountContestReferral(user._id as mongoose.Types.ObjectId);

  res.json({ ok: true });
});
