import { CaptchaSession } from '../models/CaptchaSession';
import { secureRandomFloat } from '../utils/random';
import { AppError } from '../utils/AppError';
import { Types } from 'mongoose';

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function randInt(min: number, max: number): number {
  return Math.floor(secureRandomFloat() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(secureRandomFloat() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Creates a new captcha challenge. The correct answer is stored server-side only;
 * the client only ever receives the operands and the 3 shuffled option values.
 */
export async function createCaptchaChallenge(userId: Types.ObjectId, telegramId: number) {
  const a = randInt(1, 12);
  const b = randInt(1, 12);
  const correctAnswer = a + b;

  const wrong1 = correctAnswer + randInt(1, 4);
  let wrong2 = correctAnswer - randInt(1, 4);
  if (wrong2 === correctAnswer || wrong2 === wrong1 || wrong2 < 0) {
    wrong2 = correctAnswer + randInt(5, 8);
  }

  const options = shuffle([correctAnswer, wrong1, wrong2]);

  const session = await CaptchaSession.create({
    user: userId,
    telegramId,
    correctAnswer,
    options,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return {
    sessionId: session._id.toString(),
    question: `${a} + ${b} = ?`,
    options,
  };
}

export async function verifyCaptchaAnswer(sessionId: string, telegramId: number, selectedAnswer: number) {
  const session = await CaptchaSession.findOne({ _id: sessionId, telegramId });
  if (!session) throw new AppError('Captcha session not found or expired', 404, 'CAPTCHA_NOT_FOUND');
  if (session.isSolved) throw new AppError('Captcha already solved', 409, 'CAPTCHA_ALREADY_SOLVED');
  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError('Captcha expired', 410, 'CAPTCHA_EXPIRED');
  }

  const isCorrect = session.correctAnswer === selectedAnswer;
  if (!isCorrect) {
    throw new AppError('Incorrect answer', 400, 'CAPTCHA_WRONG');
  }

  session.isSolved = true;
  session.solvedAt = new Date();
  await session.save();

  return true;
}
