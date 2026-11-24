import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Jimp } from 'jimp';
import multer from 'multer';
import {
  APP_ROOT_DIR,
  db,
  getLocalDateString,
  PHOTOS_DIR,
  type PhotoRow,
} from './db.ts';

const THUMB_WIDTH_PX = 200;

export const photoUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB max (client compresses < 150 KB)
  },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    // Accept standard image MIME types or generic octet-stream; real magic bytes are verified strictly below
    if (
      !mime ||
      mime.startsWith('image/') ||
      mime === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Format de photo non supporté (JPEG, PNG ou WebP uniquement).'));
    }
  },
});

function detectImageExtension(buffer: Buffer): '.jpg' | '.png' | '.webp' | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return '.png';
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
}

async function generateThumbnailBuffer(buffer: Buffer): Promise<Buffer | null> {
  try {
    const img = await Jimp.fromBuffer(buffer);
    if (img.width > THUMB_WIDTH_PX) {
      img.resize({ w: THUMB_WIDTH_PX });
    }
    return await img.getBuffer('image/jpeg', { quality: 75 });
  } catch {
    return null;
  }
}

export async function saveAttendancePhoto(options: {
  buffer: Buffer;
  workDate: string;
  employeeId: number;
  action: 'checkin' | 'checkout';
}): Promise<{ filePath: string; thumbPath: string | null }> {
  const ext = detectImageExtension(options.buffer);
  if (!ext) {
    throw new Error('Fichier image invalide.');
  }

  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(options.workDate)
    ? options.workDate
    : getLocalDateString();

  const employeeFolder = `emp-${options.employeeId}`;
  const targetDir = path.resolve(PHOTOS_DIR, safeDate, employeeFolder);
  if (!targetDir.startsWith(PHOTOS_DIR + path.sep)) {
    throw new Error('Chemin de stockage invalide.');
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const baseName = `${options.action}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const fileName = `${baseName}${ext}`;
  const fullPath = path.resolve(targetDir, fileName);
  if (!fullPath.startsWith(PHOTOS_DIR + path.sep)) {
    throw new Error('Chemin de fichier invalide.');
  }

  fs.writeFileSync(fullPath, options.buffer);
  const relFilePath = `${safeDate}/${employeeFolder}/${fileName}`;

  let relThumbPath: string | null = null;
  const thumbBuf = await generateThumbnailBuffer(options.buffer);
  if (thumbBuf) {
    const thumbName = `${baseName}_thumb.jpg`;
    const thumbFullPath = path.resolve(targetDir, thumbName);
    if (thumbFullPath.startsWith(PHOTOS_DIR + path.sep)) {
      fs.writeFileSync(thumbFullPath, thumbBuf);
      relThumbPath = `${safeDate}/${employeeFolder}/${thumbName}`;
    }
  }

  return { filePath: relFilePath, thumbPath: relThumbPath };
}

export function resolveSafePhotoPath(relativePath: string | null): string | null {
  if (!relativePath) return null;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(PHOTOS_DIR, normalized);
  if (resolved.startsWith(PHOTOS_DIR + path.sep) && fs.existsSync(resolved)) {
    return resolved;
  }

  // Fallback for legacy photos saved directly next to app root prior to DATA_DIR migration
  const legacyBase = path.resolve(APP_ROOT_DIR, 'photos');
  const legacyResolved = path.resolve(legacyBase, normalized);
  if (legacyResolved.startsWith(legacyBase + path.sep) && fs.existsSync(legacyResolved)) {
    return legacyResolved;
  }

  return null;
}

export async function resolveOrCreateThumbnailPath(photo: PhotoRow): Promise<string | null> {
  if (photo.thumb_path) {
    const existingThumb = resolveSafePhotoPath(photo.thumb_path);
    if (existingThumb) return existingThumb;
  }

  const fullPath = resolveSafePhotoPath(photo.file_path);
  if (!fullPath) return null;

  try {
    const fullBuf = fs.readFileSync(fullPath);
    const thumbBuf = await generateThumbnailBuffer(fullBuf);
    if (!thumbBuf) {
      return fullPath;
    }

    const parsed = path.posix.parse(photo.file_path.replace(/\\/g, '/'));
    const relThumbPath = `${parsed.dir}/${parsed.name}_thumb.jpg`;
    const targetThumbPath = path.resolve(PHOTOS_DIR, relThumbPath);
    if (!targetThumbPath.startsWith(PHOTOS_DIR + path.sep)) {
      return fullPath;
    }

    fs.mkdirSync(path.dirname(targetThumbPath), { recursive: true });
    fs.writeFileSync(targetThumbPath, thumbBuf);
    db.prepare('UPDATE photos SET thumb_path = ? WHERE id = ?').run(relThumbPath, photo.id);
    return targetThumbPath;
  } catch {
    return fullPath;
  }
}

export function cleanupOldPhotos(retentionDays: number): void {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.floor(retentionDays));
  const cutoffDateStr = getLocalDateString(cutoff);

  const oldPhotoRows = db
    .prepare('SELECT * FROM photos WHERE work_date < ?')
    .all(cutoffDateStr) as PhotoRow[];

  for (const p of oldPhotoRows) {
    const fp = resolveSafePhotoPath(p.file_path);
    if (fp) {
      try {
        fs.unlinkSync(fp);
      } catch {
        // ignore
      }
    }
    const tp = resolveSafePhotoPath(p.thumb_path);
    if (tp) {
      try {
        fs.unlinkSync(tp);
      } catch {
        // ignore
      }
    }
  }

  db.prepare('DELETE FROM photos WHERE work_date < ?').run(cutoffDateStr);

  const oldAttRows = db
    .prepare(
      `SELECT id, checkin_photo, checkout_photo
       FROM attendance
       WHERE work_date < ? AND (checkin_photo IS NOT NULL OR checkout_photo IS NOT NULL OR checkin_photo_id IS NOT NULL OR checkout_photo_id IS NOT NULL)`
    )
    .all(cutoffDateStr) as Array<{
      id: number;
      checkin_photo: string | null;
      checkout_photo: string | null;
    }>;

  const clearStmt = db.prepare(
    'UPDATE attendance SET checkin_photo = NULL, checkout_photo = NULL, checkin_photo_id = NULL, checkout_photo_id = NULL WHERE id = ?'
  );

  for (const row of oldAttRows) {
    const p1 = resolveSafePhotoPath(row.checkin_photo);
    if (p1) {
      try {
        fs.unlinkSync(p1);
      } catch {
        // ignore
      }
    }
    const p2 = resolveSafePhotoPath(row.checkout_photo);
    if (p2) {
      try {
        fs.unlinkSync(p2);
      } catch {
        // ignore
      }
    }
    clearStmt.run(row.id);
  }

  if (!fs.existsSync(PHOTOS_DIR)) return;

  // Remove old YYYY-MM-DD folders inside photos/
  try {
    const entries = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && entry.name < cutoffDateStr) {
        const dirPath = path.resolve(PHOTOS_DIR, entry.name);
        if (dirPath.startsWith(PHOTOS_DIR + path.sep)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    }
  } catch {
    // ignore cleanup filesystem errors
  }
}
