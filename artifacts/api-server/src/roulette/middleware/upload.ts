import multer from 'multer';

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

export const uploadSettingsImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
}).single('image');
