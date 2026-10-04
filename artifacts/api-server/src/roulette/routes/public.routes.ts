import { Router } from 'express';
import { miniAppAuth } from '../middleware/miniAppAuth';
import { spinLimiter, claimLimiter, purchaseLimiter } from '../middleware/rateLimit';
import { getMe, getForcedSubStatus, postLanguage } from '../controllers/user.controller';
import { requestCaptcha, submitCaptcha } from '../controllers/captcha.controller';
import { getWheelStatus, spin, spinWithPoints, spinWithAdController, getWheelPrizes, getRecentDailyWins } from '../controllers/roulette.controller';
import { listMyInventory, claimPrize, shareCard, postClaimAdStep, postClaimShareSent } from '../controllers/inventory.controller';
import { getMyReferrals, postClaimReferralMilestone } from '../controllers/referral.controller';
import { listMyNotifications, markRead } from '../controllers/notification.controller';
import { getContest, postJoinContest } from '../controllers/contest.controller';
import { getGames, postAdTaskClaim, postSnakeFinish, postSnakeStart } from '../controllers/games.controller';
import { getDailyLogin, postDailyLogin } from '../controllers/dailyLogin.controller';
import { getMyTasks, postClaimTask } from '../controllers/task.controller';
import {
  deleteExchangeListing,
  getExchange,
  getExchangeListing,
  getExchangeListings,
  getMyExchangeListings,
  postExchangeListing,
  postExchangeReport,
  postExchangeOffer,
  patchExchangeListing,
  postRenewExchangeListing,
  getExchangePostAd,
  postExchangePostAd,
} from '../controllers/exchange.controller';
import { uploadExchangeImages, uploadReportMedia } from '../middleware/upload';
import { getMediation, getMediationOfferTarget, postCancelMediationTicket, postMediationLookup, postMediationTicket } from '../controllers/mediation.controller';
import { getDeliveryContact, verifyDeliveryContact } from '../controllers/deliveryAccount.controller';

const router = Router();

router.use(miniAppAuth);

router.get('/me', getMe);
router.post('/me/language', postLanguage);
router.get('/forced-sub/status', getForcedSubStatus);
router.get('/delivery-contact', getDeliveryContact);
router.post('/delivery-contact/verify', verifyDeliveryContact);

router.post('/captcha/request', requestCaptcha);
router.post('/captcha/submit', submitCaptcha);

router.get('/wheel/status', getWheelStatus);
router.get('/wheel/prizes', getWheelPrizes);
router.get('/wheel/recent-wins', getRecentDailyWins);
router.post('/wheel/spin', spinLimiter, spin);
router.post('/points-wheel/spin', spinLimiter, spinWithPoints);
router.post('/wheel/ad-spin', spinLimiter, spinWithAdController);
router.get('/daily-login', getDailyLogin);
router.post('/daily-login', postDailyLogin);
router.get('/tasks', getMyTasks);
router.post('/tasks/:id/claim', postClaimTask);

router.get('/inventory', listMyInventory);
router.post('/inventory/claim', claimLimiter, claimPrize);
router.post('/inventory/share-card', shareCard);
router.post('/inventory/claim-steps/ad', claimLimiter, postClaimAdStep);
router.post('/inventory/claim-steps/share-sent', postClaimShareSent);

router.get('/referrals', getMyReferrals);
router.post('/referrals/milestone/claim', postClaimReferralMilestone);

router.get('/games', getGames);
router.post('/games/ad-task/claim', postAdTaskClaim);
router.post('/games/snake/start', postSnakeStart);
router.post('/games/snake/finish', postSnakeFinish);

router.get('/exchange', getExchange);
router.get('/exchange/listings', getExchangeListings);
router.get('/exchange/listings/mine', getMyExchangeListings);
router.get('/exchange/listings/:id', getExchangeListing);
router.get('/exchange/post-ad', getExchangePostAd);
router.post('/exchange/post-ad', postExchangePostAd);
router.post('/exchange/listings', purchaseLimiter, uploadExchangeImages, postExchangeListing);
router.delete('/exchange/listings/:id', deleteExchangeListing);
router.patch('/exchange/listings/:id', purchaseLimiter, uploadExchangeImages, patchExchangeListing);
router.post('/exchange/listings/:id/renew', postRenewExchangeListing);
router.post('/exchange/listings/:id/offer', purchaseLimiter, uploadExchangeImages, postExchangeOffer);
router.post('/exchange/listings/:id/report', purchaseLimiter, uploadReportMedia, postExchangeReport);

router.get('/mediation', getMediation);
router.post('/mediation/lookup', postMediationLookup);
router.get('/mediation/offer/:id', getMediationOfferTarget);
router.post('/mediation/tickets', purchaseLimiter, postMediationTicket);
router.post('/mediation/tickets/:id/cancel', postCancelMediationTicket);

router.get('/contest', getContest);
router.post('/contest/join', postJoinContest);

router.get('/notifications', listMyNotifications);
router.post('/notifications/read', markRead);


export default router;
