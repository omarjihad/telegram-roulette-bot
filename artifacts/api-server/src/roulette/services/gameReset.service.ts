import { User } from '../models/User';
import { UserPrize } from '../models/UserPrize';
import { Referral } from '../models/Referral';
import { ClaimTask } from '../models/ClaimTask';
import { UserTask } from '../models/UserTask';
import { WithdrawalRequest } from '../models/WithdrawalRequest';
import { RouletteSpin } from '../models/RouletteSpin';
import { writeAudit } from '../models/AuditLog';

/**
 * Resets all USER PROGRESS — never the admin's prize catalog. This is deliberately narrow:
 *
 * WIPED:
 *  - Every UserPrize (won/purchased prizes sitting in everyone's inventory)
 *  - Every Referral, ClaimTask, WithdrawalRequest, RouletteSpin (all referral/claim history)
 *  - Every user's spinPoints (Store currency) and totalSpins, reset to 0
 *  - Every user's lastSpinAt cleared, so the daily wheel is immediately available again
 *
 * NEVER TOUCHED (the whole point of keeping this narrow):
 *  - The Prize catalog itself: names, icons, uploaded images, baseWeight, stock, storePrice
 *  - Admins/developers, forced-sub channels, ban list, bot settings
 */
export async function resetGameState(actorId: number, actorUsername?: string) {
  const [userPrizes, referrals, claimTasks, userTasks, withdrawals, spins] = await Promise.all([
    UserPrize.deleteMany({}),
    Referral.deleteMany({}),
    ClaimTask.deleteMany({}),
    UserTask.deleteMany({}),
    WithdrawalRequest.deleteMany({}),
    RouletteSpin.deleteMany({}),
  ]);
  const users = await User.updateMany(
    {},
    {
      $set: {
        spinPoints: 0,
        spinPointsSpent: 0,
        spinCredits: 0,
        spinCreditsSpent: 0,
        referralMilestoneClaims: 0,
        totalSpins: 0,
        lastSpinAt: null,
        dailyStreakDay: 0,
        dailyLastClaimAt: null,
        dailyClaimedDays: [],
      },
    }
  );

  const summary = {
    userPrizesDeleted: userPrizes.deletedCount ?? 0,
    referralsDeleted: referrals.deletedCount ?? 0,
    claimTasksDeleted: claimTasks.deletedCount ?? 0,
    userTasksDeleted: userTasks.deletedCount ?? 0,
    withdrawalsDeleted: withdrawals.deletedCount ?? 0,
    spinsDeleted: spins.deletedCount ?? 0,
    usersReset: users.modifiedCount ?? 0,
  };

  await writeAudit({
    actorId,
    actorUsername,
    action: 'system.reset_game_state',
    metadata: summary,
  });

  return summary;
}
