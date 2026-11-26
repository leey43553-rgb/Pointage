import bcrypt from 'bcryptjs';
import Dexie, { type Table } from 'dexie';
import type {
  CorrectionLogActionType,
  CorrectionRequestStatus,
  PhotoRequirement,
} from '../types';

export interface LocalSettingsRecord {
  id: number;
  company_name: string;
  logo_data_url: string | null;
  official_start_time: string;
  grace_minutes: number;
  allowed_network_prefix: string;
  working_days: string;
  public_holidays: string;
  photo_requirement: PhotoRequirement;
  photo_retention_days: number;
  auto_close_time: string;
  updated_at: string;
}

export interface LocalAdminRecord {
  id?: number;
  username: string;
  password_hash: string;
  role: 'super_admin' | 'admin';
  must_change_password: number;
  created_at: string;
}

export interface LocalEmployeeRecord {
  id?: number;
  first_name: string;
  last_name: string;
  job_title: string;
  code: string;
  is_active: number;
  shift_start: string | null;
  shift_end: string | null;
  grace_minutes: number | null;
  created_at: string;
}

export interface LocalAttendanceRecord {
  id?: number;
  employee_id: number;
  work_date: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_ip: string | null;
  checkout_ip: string | null;
  checkin_photo_id: number | null;
  checkout_photo_id: number | null;
  is_late: number;
  late_minutes: number;
  worked_minutes: number;
  checkout_missing: number;
  auto_closed_at: string | null;
  is_corrected: number;
  last_correction_reason: string | null;
  created_at: string;
}

export interface LocalPhotoRecord {
  id?: number;
  attendance_id: number;
  employee_id: number;
  kind: 'checkin' | 'checkout';
  work_date: string;
  blob: Blob;
  thumb_blob: Blob | null;
  created_at: string;
}

export interface LocalAttendanceLogRecord {
  id?: number;
  employee_id: number;
  employee_name: string;
  action: 'checkin' | 'checkout';
  log_date: string;
  log_time: string;
  ip_address: string;
  created_at: string;
}

export interface LocalCorrectionRequestRecord {
  id?: number;
  employee_id: number;
  work_date: string;
  punch_type: 'checkin' | 'checkout';
  requested_time: string;
  reason: string;
  status: CorrectionRequestStatus;
  reviewed_by_admin_id: number | null;
  reviewed_by_username: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface LocalCorrectionLogRecord {
  id?: number;
  attendance_id: number | null;
  employee_id: number;
  employee_name: string;
  work_date: string;
  action_type: CorrectionLogActionType;
  actor_admin_id: number | null;
  actor_username: string;
  old_value: string;
  new_value: string;
  reason: string;
  created_at: string;
}

export interface LocalPinAttemptRecord {
  key: string;
  attempts: number;
  locked_until: number;
  updated_at: number;
}

class PointageDexieDB extends Dexie {
  settings!: Table<LocalSettingsRecord, number>;
  admins!: Table<LocalAdminRecord, number>;
  employees!: Table<LocalEmployeeRecord, number>;
  attendance!: Table<LocalAttendanceRecord, number>;
  photos!: Table<LocalPhotoRecord, number>;
  attendance_logs!: Table<LocalAttendanceLogRecord, number>;
  correction_requests!: Table<LocalCorrectionRequestRecord, number>;
  correction_logs!: Table<LocalCorrectionLogRecord, number>;
  pin_attempts!: Table<LocalPinAttemptRecord, string>;

  constructor() {
    super('PointageDB');
    this.version(1).stores({
      settings: 'id',
      admins: '++id, &username, role',
      employees: '++id, &code, is_active, first_name, last_name',
      attendance: '++id, &[employee_id+work_date], employee_id, work_date, checkout_missing',
      photos: '++id, &[attendance_id+kind], attendance_id, employee_id, work_date',
      attendance_logs: '++id, employee_id, log_date',
      correction_requests: '++id, employee_id, work_date, status, [employee_id+work_date+punch_type]',
      correction_logs: '++id, employee_id, work_date, action_type',
      pin_attempts: 'key',
    });
  }
}

export const localDb = new PointageDexieDB();

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalTimeString(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function getLocalDateTimeIso(date: Date = new Date()): string {
  return `${getLocalDateString(date)}T${getLocalTimeString(date)}`;
}

let initPromise: Promise<void> | null = null;

export async function ensureLocalDbInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await localDb.open();
      const now = getLocalDateTimeIso();

      const existingSettings = await localDb.settings.get(1);
      if (!existingSettings) {
        await localDb.settings.put({
          id: 1,
          company_name: 'Mon Entreprise',
          logo_data_url: null,
          official_start_time: '09:00',
          grace_minutes: 10,
          allowed_network_prefix: '',
          working_days: '[0,1,2,3,4]',
          public_holidays: '[]',
          photo_requirement: 'both',
          photo_retention_days: 90,
          auto_close_time: '23:59',
          updated_at: now,
        });
      }

      const adminCount = await localDb.admins.count();
      if (adminCount === 0) {
        const defaultPasswordHash = bcrypt.hashSync('Admin1234', 10);
        await localDb.admins.add({
          username: 'admin',
          password_hash: defaultPasswordHash,
          role: 'super_admin',
          must_change_password: 1,
          created_at: now,
        });
      }

      // Run photo retention cleanup on startup
      const settings = await localDb.settings.get(1);
      if (settings && settings.photo_retention_days > 0) {
        await cleanupLocalOldPhotos(settings.photo_retention_days);
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function generateUniqueLocalEmployeeCode(): Promise<string> {
  const randomDigits = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return String(100000 + (arr[0] % 900000));
    }
    return String(100000 + Math.floor(Math.random() * 900000));
  };

  for (let i = 0; i < 100; i++) {
    const code = randomDigits();
    const existing = await localDb.employees.where('code').equals(code).first();
    if (!existing) {
      return code;
    }
  }
  throw new Error('Impossible de générer un code unique à 6 chiffres.');
}

export async function createThumbnailBlob(sourceBlob: Blob, maxWidth = 200): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(sourceBlob);
    try {
      const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((res) => resolve(res), 'image/jpeg', 0.72);
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export async function cleanupLocalOldPhotos(retentionDays: number): Promise<void> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.floor(retentionDays));
  const cutoffDateStr = getLocalDateString(cutoff);

  const oldPhotos = await localDb.photos.where('work_date').below(cutoffDateStr).toArray();
  if (oldPhotos.length === 0) return;

  const ids = oldPhotos.map((p) => p.id!).filter((id) => Number.isFinite(id));
  await localDb.photos.bulkDelete(ids);

  const oldAtts = await localDb.attendance.where('work_date').below(cutoffDateStr).toArray();
  for (const att of oldAtts) {
    if (att.id && (att.checkin_photo_id || att.checkout_photo_id)) {
      await localDb.attendance.update(att.id, {
        checkin_photo_id: null,
        checkout_photo_id: null,
      });
    }
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export async function exportLocalBackupBlob(): Promise<Blob> {
  await ensureLocalDbInitialized();
  const [
    settings,
    admins,
    employees,
    attendance,
    photos,
    attendanceLogs,
    correctionRequests,
    correctionLogs,
  ] = await Promise.all([
    localDb.settings.toArray(),
    localDb.admins.toArray(),
    localDb.employees.toArray(),
    localDb.attendance.toArray(),
    localDb.photos.toArray(),
    localDb.attendance_logs.toArray(),
    localDb.correction_requests.toArray(),
    localDb.correction_logs.toArray(),
  ]);

  const serializedPhotos = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      attendance_id: p.attendance_id,
      employee_id: p.employee_id,
      kind: p.kind,
      work_date: p.work_date,
      created_at: p.created_at,
      data_url: await blobToDataUrl(p.blob),
    }))
  );

  const payload = {
    version: 1,
    exported_at: getLocalDateTimeIso(),
    engine: 'IndexedDB (Dexie)',
    settings,
    admins,
    employees,
    attendance,
    photos: serializedPhotos,
    attendance_logs: attendanceLogs,
    correction_requests: correctionRequests,
    correction_logs: correctionLogs,
  };

  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
