import { Router } from 'express';
import { miniAppAuth } from '../middleware/miniAppAuth';
import { requireAdmin, requireOwner } from '../middleware/requireAdmin';
import {
  adminListPrizes,
  adminCreatePrize,
  adminUpdatePrize,
  adminDeletePrize,
  adminAddStock,
  adminRemoveStock,
  adminSetStock,
  adminSetPrizeActive,
  adminUploadPrizeImage,
  adminClearPrizeImage,
  adminSetStorePrice,
} from '../controllers/adminPrize.controller';
import { uploadPrizeImage, uploadSettingsImage } from '../middleware/upload';
import {
  adminListWithdrawals,
  adminViewReferralsForWithdrawal,
  adminApproveWithdrawal,
  adminRejectWithdrawal,
} from '../controllers/adminWithdrawal.controller';
import { adminBanUser, adminUnbanUser, adminListBanned, adminUnbanAll } from '../controllers/adminBan.controller';
import {
  adminListForcedChats,
  adminAddForcedChat,
  adminRemoveForcedChat,
  adminClearForcedChats,
} from '../controllers/adminForcedChat.controller';
import {
  adminListDevelopers,
  adminAddDeveloper,
  adminRemoveDeveloper,
  adminRemoveAllDevelopers,
} from '../controllers/adminDeveloper.controller';
import {
  adminGetStats,
  adminListAuditLogs,
  adminGetSettings,
  adminUpdateSettings,
  adminUploadShareImage,
  adminClearShareImage,
  adminResetGameState,
  adminCheckDuplicatePrizes,
  adminFixDuplicatePrizes,
  adminToggleMaintenance,
  adminToggleDemoMode,
  adminRunBroadcast,
} from '../controllers/adminSystem.controller';
import { adminListTasks, adminCreateTask, adminUpdateTask, adminDeleteTask } from '../controllers/adminTask.controller';
import { adminLookupUser, adminListUserReferrals } from '../controllers/adminUser.controller';
import {
  adminGetDeliveryAccount,
  adminStartDeliveryLogin,
  adminVerifyDeliveryLogin,
  adminRemoveDeliveryAccount,
} from '../controllers/deliveryAccount.controller';
import { adminListGiftLinks, adminCreateGiftLink, adminRevokeGiftLink } from '../controllers/adminGift.controller';
import { adminDeductUserPoints } from '../controllers/adminPoints.controller';
import {
  adminAnnounceContestWinner,
  adminGetContest,
  adminSetContestEndsAt,
  adminStartContestRound,
} from '../controllers/adminContest.controller';

const router = Router();

router.use(miniAppAuth, requireAdmin);

// Prizes / inventory
router.get('/prizes', adminListPrizes);
router.post('/prizes', adminCreatePrize);
router.patch('/prizes/:key', adminUpdatePrize);
router.delete('/prizes/:key', adminDeletePrize);
router.post('/prizes/:key/stock/add', adminAddStock);
router.post('/prizes/:key/stock/remove', adminRemoveStock);
router.post('/prizes/:key/stock/set', adminSetStock);
router.post('/prizes/:key/active', adminSetPrizeActive);
router.post('/prizes/:key/image', uploadPrizeImage, adminUploadPrizeImage);
router.delete('/prizes/:key/image', adminClearPrizeImage);
router.post('/prizes/:key/store-price', adminSetStorePrice);

// Withdrawals
router.get('/withdrawals', adminListWithdrawals);
router.get('/withdrawals/:id/referrals', adminViewReferralsForWithdrawal);
router.post('/withdrawals/:id/approve', adminApproveWithdrawal);
router.post('/withdrawals/:id/reject', adminRejectWithdrawal);

// Bans
router.get('/bans', adminListBanned);
router.post('/bans', adminBanUser);
router.post('/bans/unban', adminUnbanUser);
router.post('/bans/unban-all', adminUnbanAll);

// Forced subscription
router.get('/forced-chats', adminListForcedChats);
router.post('/forced-chats', adminAddForcedChat);
router.delete('/forced-chats/:chatId', adminRemoveForcedChat);
router.post('/forced-chats/clear', adminClearForcedChats);

// User tasks
router.get('/tasks', adminListTasks);
router.post('/tasks', adminCreateTask);
router.patch('/tasks/:id', adminUpdateTask);
router.delete('/tasks/:id', adminDeleteTask);

// Developers (owner-only mutations; any admin can list)
router.get('/developers', adminListDevelopers);
router.post('/developers', requireOwner, adminAddDeveloper);
router.delete('/developers/:telegramId', requireOwner, adminRemoveDeveloper);
router.post('/developers/clear', requireOwner, adminRemoveAllDevelopers);

// Stats / audit / settings / broadcast
router.get('/stats', adminGetStats);
router.get('/audit-logs', adminListAuditLogs);
router.get('/settings', adminGetSettings);
router.patch('/settings', adminUpdateSettings);
router.post('/settings/share-image', uploadSettingsImage, adminUploadShareImage);
router.delete('/settings/share-image', adminClearShareImage);
router.post('/settings/maintenance', adminToggleMaintenance);
router.post('/settings/demo-mode', adminToggleDemoMode);
router.post('/reset-game-state', requireOwner, adminResetGameState);
router.get('/prizes/check-duplicates', adminCheckDuplicatePrizes);
router.post('/prizes/fix-duplicates', adminFixDuplicatePrizes);
router.post('/broadcast', adminRunBroadcast);
router.get('/delivery-account', adminGetDeliveryAccount);
router.post('/delivery-account/login/start', requireOwner, adminStartDeliveryLogin);
router.post('/delivery-account/login/verify', requireOwner, adminVerifyDeliveryLogin);
router.delete('/delivery-account', requireOwner, adminRemoveDeliveryAccount);
router.get('/users/lookup', adminLookupUser);
router.get('/users/:query/referrals', adminListUserReferrals);

// One-use gift links
router.get('/gifts', adminListGiftLinks);
router.post('/gifts', adminCreateGiftLink);
router.delete('/gifts/:token', adminRevokeGiftLink);
router.post('/points/deduct', adminDeductUserPoints);

// Invite race
router.get('/contest', adminGetContest);
router.post('/contest/ends-at', adminSetContestEndsAt);
router.post('/contest/announce', adminAnnounceContestWinner);
router.post('/contest/new-round', adminStartContestRound);

export default router;
