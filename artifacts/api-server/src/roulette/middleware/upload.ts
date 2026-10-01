import multer from 'multer';
import { AppError } from '../utils/AppError';
import { t } from '../i18n';

// Memory storage — files are held in RAM only long enough to read req.file.buffer and save
// it into MongoDB. Deliberately NOT written to local disk: platforms like Render use an
// ephemeral container filesystem that gets wiped on every restart/redeploy, which is why
// images used to work right after upload and then silently vanish for everyone else later.
// A 5MB cap keeps this safe memory-wise.
const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function fileFilter(_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(new Error('نوع الصورة غير مدعوم (png/jpg/webp/gif فقط)'));
    return;
  }
  cb(null, true);
}

export const uploadPrizeImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
}).single('image');

const EXCHANGE_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REPORT_MEDIA_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);

/** Turns multer's own errors (too big, too many files, wrong type) into readable API errors. */
function friendly(handler: (req: never, res: never, cb: (err?: unknown) => void) => void) {
  return (req: never, res: never, next: (err?: unknown) => void) =>
    handler(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE'
            ? t('حجم الملف كبير جداً.', 'The file is too large.')
            : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? t('عدد الملفات أكثر من المسموح.', 'Too many files.')
            : t('تعذر رفع الملفات.', 'Could not upload the files.');
        return next(new AppError(msg, 422, 'UPLOAD_ERROR'));
      }
      return next(new AppError(err instanceof Error ? err.message : t('تعذر رفع الملفات.', 'Could not upload the files.'), 422, 'UPLOAD_ERROR'));
    });
}

/**
 * Up to 7 listing photos, 5MB each (the Mini App compresses them first), plus an optional
 * small "thumbs" copy of each, in the same order, for the listing cards.
 */
export const uploadExchangeImages = friendly(
  multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 14 },
    fileFilter: (_req, file, cb) =>
      EXCHANGE_IMAGE_MIME.has(file.mimetype) ? cb(null, true) : cb(new Error(t('نوع الصورة غير مدعوم.', 'Unsupported image type.'))),
  }).fields([
    { name: 'images', maxCount: 7 },
    { name: 'thumbs', maxCount: 7 },
  ]) as never
);

/** Report evidence: up to 4 photos/videos, 20MB each. */
export const uploadReportMedia = friendly(
  multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024, files: 4 },
    fileFilter: (_req, file, cb) =>
      REPORT_MEDIA_MIME.has(file.mimetype) ? cb(null, true) : cb(new Error(t('نوع الملف غير مدعوم.', 'Unsupported file type.'))),
  }).array('media', 4) as never
);

export const uploadSettingsImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).single('image');
