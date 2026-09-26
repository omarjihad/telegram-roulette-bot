import { Router } from 'express';
import { miniAppAuth } from '../middleware/miniAppAuth';
import { spinLimiter, claimLimiter, purchaseLimiter } from '../middleware/rateLimit';
import { getMe, getForcedSubStatus } from '../controllers/user.controller';
import { requestCaptcha, submitCaptcha } from '../controllers/captcha.controller';
import { getWheelStatus, spin, spinWithPoints, getWheelPrizes, getRecentDailyWins } from '../controllers/roulette.controller';
import { listMyInventory, claimPrize, shareCard } from '../controllers/inventory.controller';
import { getMyReferrals, postClaimReferralMilestone } from '../controllers/referral.controller';
import { listMyNotifications, markRead } from '../controllers/notification.controller';
import { getStoreProducts, postStorePurchase } from '../controllers/store.controller';
import { getContest, postJoinContest } from '../controllers/contest.controller';
import { getDailyLogin, postDailyLogin } from '../controllers/dailyLogin.controller';
import { getMyTasks, postClaimTask } from '../controllers/task.controller';
import { getDeliveryContact, verifyDeliveryContact } from '../controllers/deliveryAccount.controller';

const router = Router();

router.use(miniAppAuth);

router.get('/me', getMe);
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
router.get('/daily-login', getDailyLogin);
router.post('/daily-login', postDailyLogin);
router.get('/tasks', getMyTasks);
router.post('/tasks/:id/claim', postClaimTask);

router.get('/inventory', listMyInventory);
router.post('/inventory/claim', claimLimiter, claimPrize);
router.post('/inventory/share-card', shareCard);

router.get('/referrals', getMyReferrals);
router.post('/referrals/milestone/claim', postClaimReferralMilestone);

router.get('/contest', getContest);
router.post('/contest/join', postJoinContest);

router.get('/notifications', listMyNotifications);
router.post('/notifications/read', markRead);

router.get('/store/products', getStoreProducts);
router.post('/store/purchase', purchaseLimiter, postStorePurchase);

export default router;
