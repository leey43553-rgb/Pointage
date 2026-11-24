import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SettingsRow {
  id: number;
  company_name: string;
  logo_data_url: string | null;
  official_start_time: string;
  grace_minutes: number;
  allowed_network_prefix: string;
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

const APP_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = path.join(APP_ROOT_DIR, 'pointage.db');

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

  const now = getLocalDateTimeIso();
  const existingSettings = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(
      `INSERT INTO settings (id, company_name, logo_data_url, official_start_time, grace_minutes, allowed_network_prefix, updated_at)
       VALUES (1, 'Mon Entreprise', NULL, '09:00', 10, '', ?)`
    ).run(now);
  }

  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (adminCount.count === 0) {
    const defaultPasswordHash = bcrypt.hashSync('change me on first login', 10);
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
