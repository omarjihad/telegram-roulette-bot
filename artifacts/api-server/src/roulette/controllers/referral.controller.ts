import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { claimReferralMilestone, getGeneralReferralLink, getReferralStats } from '../services/referral.service';
import { AppError } from '../utils/AppError';
import { buildTaskLink } from '../services/claimTask.service';
import { listTasksForUser } from '../services/task.service';

export const getMyReferrals = asyncHandler(async (req: Request, res: Response) => {
  const stats = await getReferralStats(req.telegramId!);
  const subscriptionTasks = req.dbUser ? await listTasksForUser(req.dbUser._id) : [];

  res.json({
    ok: true,
    link: req.dbUser ? await getGeneralReferralLink(req.dbUser) : null,
    pending: stats?.pending ?? 0,
    qualified: stats?.qualified ?? 0,
    total: stats?.total ?? 0,
    referrals: (stats?.referrals ?? []).map((r) => {
      const invitee = r.invitee as unknown as {
        telegramId?: number;
        username?: string;
        firstName?: string;
        photoUrl?: string;
      } | null;
      return {
        id: r._id,
        status: r.status,
        createdAt: r.createdAt,
        qualifiedAt: r.qualifiedAt,
        invitee: invitee
          ? {
              name: invitee.username ? '@' + invitee.username : invitee.firstName || 'مستخدم',
              photoUrl: invitee.photoUrl ?? null,
              // Opens their Telegram profile directly — by @username when they have one
              // (most reliable), otherwise by numeric ID via Telegram's tg://user scheme.
              profileLink: invitee.username ? `https://t.me/${invitee.username}` : `tg://user?id=${invitee.telegramId}`,
            }
          : null,
      };
    }),
    tasks: (stats?.tasks ?? []).map((task) => {
      const userPrize = task.userPrize as unknown as { prizeNameSnapshot?: string } | null;
      return {
        id: task._id,
        prizeName: userPrize?.prizeNameSnapshot ?? 'جائزة',
        link: buildTaskLink(task.token),
        requiredCount: task.requiredCount,
        creditedCount: task.creditedCount,
        status: task.status,
        expiresAt: task.expiresAt,
      };
    }),
    subscriptionTasks: subscriptionTasks.map(({ task, claimed }) => ({
      id: task._id,
      title: task.title,
      taskType: task.taskType,
      chatId: task.chatId,
      verificationChatId: task.verificationChatId ?? null,
      chatType: task.chatType,
      inviteLink: task.inviteLink ?? null,
      folderLink: task.folderLink ?? null,
      profileRequirement: task.profileRequirement ?? null,
      rewardPoints: task.rewardPoints,
      claimed,
    })),
    referralRewards: stats?.referralRewards ?? {
      rewardPoints: 1.2,
      requiredReferrals: 20,
      claimedMilestones: 0,
      availableMilestones: 0,
    },
    rules: [
      'كل جائزة تربحها من العجلة لها رابط دعوة خاص فيها بس، تلقاه في حقيبتك.',
      'ممنوع دعوة أشخاص من غير محتوى Bounty.',
      'ممنوع استخدام أرقام أو حسابات وهمية.',
      'أي إحالة مخالفة قد يتم إلغاؤها.',
      'يجب على الشخص المدعو إكمال الاشتراك الإجباري والكابتشا حتى تُحتسب.',
      'كل شخص مدعو يُحتسب لجائزة واحدة فقط طوال الوقت.',
      'ممنوع حظر البوت: إذا الشخص المدعو حظر البوت تنحذف دعوته وما تنحسب.',
    ],
  });
});

export const postClaimReferralMilestone = asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await claimReferralMilestone(req.telegramId!);
    res.json({ ok: true, result });
  } catch (err: any) {
    if (err?.code === 'REFERRAL_MILESTONE_NOT_READY') {
      throw new AppError('تحتاج 20 إحالة مؤهلة حتى تستلم المكافأة', 409, 'REFERRAL_MILESTONE_NOT_READY');
    }
    throw err;
  }
});
