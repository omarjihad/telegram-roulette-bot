import { Request, Response, NextFunction } from 'express';
import { verifyTelegramInitData } from '../utils/telegramAuth';
import { findOrCreateUser } from '../services/user.service';
import { getSettings } from '../models/Settings';
import { getAdminRole } from '../services/admin.service';
import { AppError } from '../utils/AppError';
import { getClaimTaskByToken, parseTaskTokenFromStartParam } from '../services/claimTask.service';
import { parseGeneralReferralToken, registerGeneralReferralIfNew, registerReferralIfNew } from '../services/referral.service';
import { logger } from '../config/logger';
import { grantDemoAccess, hasDemoAccess, parseDemoToken } from '../services/demo.service';
import { checkAllForcedChats } from '../services/forcedSub.service';
import { getBotInstance } from '../bot/instance';
import { parseContestToken, registerContestReferralIfNew } from '../services/contest.service';

/**
 * Every Mini App API request must carry the raw Telegram initData string in the
 * `X-Telegram-Init-Data` header. We verify its HMAC signature (proving it really came
 * from Telegram and wasn't forged/edited client-side) before trusting anything in it —
 * per section 5 of the spec, we never trust a client-supplied user_id directly.
 */
export async function miniAppAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const initData = req.header('X-Telegram-Init-Data');
    if (!initData) {
      throw new AppError('Missing Telegram init data', 401, 'UNAUTHORIZED');
    }

    const parsed = verifyTelegramInitData(initData);
    const { user, isNew } = await findOrCreateUser(parsed.user);

    if (user.isBanned) {
      throw new AppError('Your account is banned', 403, 'BANNED');
    }

    const settings = await getSettings();
    const role = await getAdminRole(user.telegramId);
    const demoToken = parseDemoToken(parsed.startParam);
    const grantedNow = await grantDemoAccess(user, demoToken);
    if (settings.maintenanceMode && role === null && !grantedNow && !hasDemoAccess(user)) {
      throw new AppError('Under maintenance', 503, 'MAINTENANCE');
    }

    // forcedSubOk is only a convenience flag for the UI. It is never a permanent pass:
    // every authenticated Mini App request re-checks live Telegram membership so a user
    // cannot subscribe once, leave later, and keep using spins/inventory/tasks.
    if (process.env.NODE_ENV !== 'test' && !parsed.startParam?.startsWith('demo_') && role === null) {
      const forcedSubStatus = await checkAllForcedChats(getBotInstance(), user.telegramId);
      user.forcedSubOk = forcedSubStatus.allOk;
      await user.save();
      // The Mini App needs /me to decide which gate to render. Keep the gate
      // status endpoint available as well; every other feature remains locked
      // until Telegram confirms membership.
      const canLoadGateState = req.path === '/me' || req.path === '/forced-sub/status';
      if (!forcedSubStatus.allOk && !canLoadGateState) {
        throw new AppError('Forced subscription required', 403, 'FORCED_SUB_REQUIRED');
      }
    }

    // A direct Mini App link carries its referral token in signed initData.start_param.
    // Capture it during authentication so the relationship exists before the first
    // forced-subscription or captcha request, regardless of which route the app calls first.
    const taskToken = parseTaskTokenFromStartParam(parsed.startParam);
    const generalReferralToken = parseGeneralReferralToken(parsed.startParam);
    if (generalReferralToken) {
      const outcome = await registerGeneralReferralIfNew({
        newUser: user,
        referralToken: generalReferralToken,
        isBrandNewUser: isNew,
      });
      logger.info({ outcome, generalReferralToken, newUserId: user.telegramId }, 'general referral registration attempt');
    }
    const contestToken = parseContestToken(parsed.startParam);
    if (contestToken && isNew) {
      const outcome = await registerContestReferralIfNew({ newUser: user, token: contestToken, isBrandNewUser: isNew });
      logger.info({ outcome, contestToken, newUserId: user.telegramId }, 'invite race registration attempt');
    }
    if (taskToken && (isNew || settings.demoModeEnabled)) {
      const task = await getClaimTaskByToken(taskToken);
      if (task) {
        const outcome = await registerReferralIfNew({
          newUser: user,
          task,
          isBrandNewUser: isNew,
          demoMode: settings.demoModeEnabled,
        });
        logger.info({ outcome, taskToken, newUserId: user.telegramId }, 'referral registration attempt (mini app auth)');
      }
    }

    // The captcha is enforced here as well, not only by the Mini App UI, so nothing can
    // be used (and no referral can be counted) before it is solved.
    if (process.env.NODE_ENV !== 'test' && role === null && !user.captchaPassed) {
      const captchaOpen = ['/me', '/forced-sub/status', '/captcha/request', '/captcha/submit'];
      if (!captchaOpen.includes(req.path)) {
        throw new AppError('Captcha required', 403, 'CAPTCHA_REQUIRED');
      }
    }

    req.dbUser = user;
    req.telegramId = user.telegramId;
    req.adminRole = role;
    (req as Request & { isNewUser?: boolean; startParam?: string }).isNewUser = isNew;
    (req as Request & { isNewUser?: boolean; startParam?: string }).startParam = parsed.startParam;

    next();
  } catch (err) {
    next(err);
  }
}
