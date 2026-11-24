import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppFileConfig {
  port: number;
  host: string;
  sessionSecret: string;
}

export interface PublicHolidayEntry {
  date: string;
  type: 'holiday' | 'leave';
  label: string;
}

export type PhotoRequirement = 'none' | 'checkin_only' | 'both';

export interface SettingsRow {
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
  updated_at: string;
}

export interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'super_admin' | 'admin';
  must_change_password: number;
  created_at: string;
}

export interface EmployeeRow {
  id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  code: string;
  is_active: number;
  created_at: string;
}

export interface AttendanceRow {
  id: number;
  employee_id: number;
  work_date: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_ip: string | null;
  checkout_ip: string | null;
  checkin_photo: string | null;
  checkout_photo: string | null;
  is_late: number;
  late_minutes: number;
  worked_minutes: number;
  created_at: string;
}

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

const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT_DIR =
  path.basename(currentFileDir) === 'server'
    ? path.resolve(currentFileDir, '..')
    : currentFileDir;

const DEFAULT_DATA_DIR =
  process.platform === 'win32'
    ? 'C:\\ProgramData\\Pointage'
    : path.join(APP_ROOT_DIR, 'data');

const envDataDir = process.env.DATA_DIR ? process.env.DATA_DIR.trim() : '';
export const DATA_DIR = path.resolve(envDataDir || DEFAULT_DATA_DIR);
export const DB_PATH = path.join(DATA_DIR, 'pointage.db');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

function loadOrCreateAppConfig(): AppFileConfig {
  let parsed: Partial<AppFileConfig> = {};
  let needsWrite = false;

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const obj = JSON.parse(raw) as unknown;
      if (obj && typeof obj === 'object') {
        parsed = obj as Partial<AppFileConfig>;
      } else {
        needsWrite = true;
      }
    } catch {
      needsWrite = true;
    }
  } else {
    needsWrite = true;
  }

  const port =
    typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port > 0 && parsed.port < 65536
      ? parsed.port
      : 3000;
  if (port !== parsed.port) needsWrite = true;

  const host =
    typeof parsed.host === 'string' && parsed.host.trim()
      ? parsed.host.trim()
      : '0.0.0.0';
  if (host !== parsed.host) needsWrite = true;

  const sessionSecret =
    typeof parsed.sessionSecret === 'string' && parsed.sessionSecret.length >= 32
      ? parsed.sessionSecret
      : crypto.randomBytes(32).toString('hex');
  if (sessionSecret !== parsed.sessionSecret) needsWrite = true;

  const config: AppFileConfig = {
    port,
    host,
    sessionSecret,
  };

  if (needsWrite) {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // Ignore write error if config file is read-only
    }
  }

  return config;
}

export const APP_CONFIG = loadOrCreateAppConfig();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT NOT NULL DEFAULT 'Mon Entreprise',
      logo_data_url TEXT DEFAULT NULL,
      official_start_time TEXT NOT NULL DEFAULT '09:00',
      grace_minutes INTEGER NOT NULL DEFAULT 10,
      allowed_network_prefix TEXT NOT NULL DEFAULT '',
      working_days TEXT NOT NULL DEFAULT '[0,1,2,3,4]',
      public_holidays TEXT NOT NULL DEFAULT '[]',
      photo_requirement TEXT NOT NULL DEFAULT 'both',
      photo_retention_days INTEGER NOT NULL DEFAULT 90,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      checkin_time TEXT,
      checkout_time TEXT,
      checkin_ip TEXT,
      checkout_ip TEXT,
      checkin_photo TEXT DEFAULT NULL,
      checkout_photo TEXT DEFAULT NULL,
      is_late INTEGER NOT NULL DEFAULT 0,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      worked_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(employee_id, work_date)
    );

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      employee_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('checkin', 'checkout')),
      log_date TEXT NOT NULL,
      log_time TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pin_attempts (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(work_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_logs_date ON attendance_logs(log_date);
  `);

  // Migrate existing settings table if columns are missing
  const settingsCols = db.prepare('PRAGMA table_info(settings)').all() as Array<{ name: string }>;
  const colNames = new Set(settingsCols.map((c) => c.name));
  if (!colNames.has('working_days')) {
    db.exec(`ALTER TABLE settings ADD COLUMN working_days TEXT NOT NULL DEFAULT '[0,1,2,3,4]'`);
  }
  if (!colNames.has('public_holidays')) {
    db.exec(`ALTER TABLE settings ADD COLUMN public_holidays TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!colNames.has('photo_requirement')) {
    db.exec(`ALTER TABLE settings ADD COLUMN photo_requirement TEXT NOT NULL DEFAULT 'both'`);
  }
  if (!colNames.has('photo_retention_days')) {
    db.exec(`ALTER TABLE settings ADD COLUMN photo_retention_days INTEGER NOT NULL DEFAULT 90`);
  }

  // Migrate existing attendance table if photo columns are missing
  const attCols = db.prepare('PRAGMA table_info(attendance)').all() as Array<{ name: string }>;
  const attColNames = new Set(attCols.map((c) => c.name));
  if (!attColNames.has('checkin_photo')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkin_photo TEXT DEFAULT NULL`);
  }
  if (!attColNames.has('checkout_photo')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkout_photo TEXT DEFAULT NULL`);
  }

  const now = getLocalDateTimeIso();
  const existingSettings = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(
      `INSERT INTO settings (id, company_name, logo_data_url, official_start_time, grace_minutes, allowed_network_prefix, working_days, public_holidays, photo_requirement, photo_retention_days, updated_at)
       VALUES (1, 'Mon Entreprise', NULL, '09:00', 10, '', '[0,1,2,3,4]', '[]', 'both', 90, ?)`
    ).run(now);
  }

  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (adminCount.count === 0) {
    const defaultPasswordHash = bcrypt.hashSync('Admin1234', 10);
    db.prepare(
      `INSERT INTO admins (username, password_hash, role, must_change_password, created_at)
       VALUES ('admin', ?, 'super_admin', 1, ?)`
    ).run(defaultPasswordHash, now);
  }
}

export function generateUniqueEmployeeCode(): string {
  const checkStmt = db.prepare('SELECT id FROM employees WHERE code = ?');
  for (let i = 0; i < 100; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    const existing = checkStmt.get(code);
    if (!existing) {
      return code;
    }
  }
  throw new Error('Impossible de générer un code unique à 6 chiffres.');
}
