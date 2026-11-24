import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, getLocalDateString, PHOTOS_DIR } from './db.ts';

export const photoUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024, // 1 MB max (client compresses < 150 KB)
  },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)) {
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

export function saveAttendancePhoto(options: {
  buffer: Buffer;
  workDate: string;
  employeeId: number;
  action: 'checkin' | 'checkout';
}): string {
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

  const fileName = `${options.action}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
  const fullPath = path.resolve(targetDir, fileName);
  if (!fullPath.startsWith(PHOTOS_DIR + path.sep)) {
    throw new Error('Chemin de fichier invalide.');
  }

  fs.writeFileSync(fullPath, options.buffer);
  // Store normalized relative path with forward slashes
  return `${safeDate}/${employeeFolder}/${fileName}`;
}

export function resolveSafePhotoPath(relativePath: string | null): string | null {
  if (!relativePath) return null;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(PHOTOS_DIR, normalized);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return resolved;
}

export function cleanupOldPhotos(retentionDays: number): void {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  if (!fs.existsSync(PHOTOS_DIR)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.floor(retentionDays));
  const cutoffDateStr = getLocalDateString(cutoff);

  const oldRows = db
    .prepare(
      `SELECT id, checkin_photo, checkout_photo
       FROM attendance
       WHERE work_date < ? AND (checkin_photo IS NOT NULL OR checkout_photo IS NOT NULL)`
    )
    .all(cutoffDateStr) as Array<{
      id: number;
      checkin_photo: string | null;
      checkout_photo: string | null;
    }>;

  const clearStmt = db.prepare(
    'UPDATE attendance SET checkin_photo = NULL, checkout_photo = NULL WHERE id = ?'
  );

  for (const row of oldRows) {
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
