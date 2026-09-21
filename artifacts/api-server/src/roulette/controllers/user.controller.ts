import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { checkAllForcedChats } from '../services/forcedSub.service';
import { checkCooldown } from '../services/roulette.service';
import { getBotInstance } from '../bot/instance';
import { tryQualifyReferral } from '../services/referral.service';
import { prizeImageUrl } from '../services/prize.service';
import mongoose from 'mongoose';

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = req.dbUser!;
  const { ready, nextSpinAt } = await checkCooldown(user);
  const lastSpin =
    user.lastSpinWon === null || user.lastSpinWon === undefined
      ? null
      : {
          won: user.lastSpinWon,
          prizeName: user.lastSpinPrizeName ?? null,
          prizeIcon: user.lastSpinPrizeIcon ?? null,
          prizeImageUrl: user.lastSpinPrizeKey ? prizeImageUrl(user.lastSpinPrizeKey, !!user.lastSpinPrizeHasImage) : null,
          prizeKey: user.lastSpinPrizeKey ?? null,
        };

  res.json({
    ok: true,
    user: {
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      photoUrl: user.photoUrl,
      captchaPassed: user.captchaPassed,
      forcedSubOk: user.forcedSubOk,
      totalSpins: user.totalSpins,
      spinPoints: user.spinPoints,
      spinCredits: user.spinCredits ?? 0,
    },
    wheel: { ready, nextSpinAt, lastSpin },
    isAdmin: req.adminRole !== null,
    adminRole: req.adminRole,
  });
});

export const getForcedSubStatus = asyncHandler(async (req: Request, res: Response) => {
  const bot = getBotInstance();
  const { allOk, missing } = await checkAllForcedChats(bot, req.telegramId!);

  if (allOk) {
    req.dbUser!.forcedSubOk = true;
    await req.dbUser!.save();
    await tryQualifyReferral(req.dbUser!._id as mongoose.Types.ObjectId);
  }

  res.json({ ok: true, allOk, missing });
});
