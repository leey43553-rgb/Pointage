import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppFileConfig {
  port: number;
  host: string;
  sessionSecret: string;
  openAtLogin: boolean;
  startMinimized: boolean;
  startupConfigured: boolean;
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
  auto_close_time: string;
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
  shift_start: string | null;
  shift_end: string | null;
  grace_minutes: number | null;
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

export interface PhotoRow {
  id: number;
  attendance_id: number;
  employee_id: number;
  kind: 'checkin' | 'checkout';
  work_date: string;
  file_path: string;
  thumb_path: string | null;
  created_at: string;
}

export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CorrectionRequestRow {
  id: number;
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

export type CorrectionLogActionType =
  | 'manual_add'
  | 'manual_edit'
  | 'request_approved'
  | 'request_rejected'
  | 'auto_close';

export interface CorrectionLogRow {
  id: number;
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

  const openAtLogin = typeof parsed.openAtLogin === 'boolean' ? parsed.openAtLogin : true;
  if (openAtLogin !== parsed.openAtLogin) needsWrite = true;

  const startMinimized = typeof parsed.startMinimized === 'boolean' ? parsed.startMinimized : true;
  if (startMinimized !== parsed.startMinimized) needsWrite = true;

  const startupConfigured =
    typeof parsed.startupConfigured === 'boolean' ? parsed.startupConfigured : false;
  if (startupConfigured !== parsed.startupConfigured) needsWrite = true;

  const config: AppFileConfig = {
    port,
    host,
    sessionSecret,
    openAtLogin,
    startMinimized,
    startupConfigured,
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

export function updateAppFileConfig(
  patch: Partial<Pick<AppFileConfig, 'openAtLogin' | 'startMinimized' | 'startupConfigured'>>
): AppFileConfig {
  if (typeof patch.openAtLogin === 'boolean') {
    APP_CONFIG.openAtLogin = patch.openAtLogin;
  }
  if (typeof patch.startMinimized === 'boolean') {
    APP_CONFIG.startMinimized = patch.startMinimized;
  }
  if (typeof patch.startupConfigured === 'boolean') {
    APP_CONFIG.startupConfigured = patch.startupConfigured;
  }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(APP_CONFIG, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Ignore write error if read-only
  }
  return { ...APP_CONFIG };
}

type SqlParam = string | number | bigint | Uint8Array | null;

export interface DbRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface DbStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): DbRunResult;
}

export type DbEngineName = 'node:sqlite' | 'sql.js (WebAssembly)';

export interface DbAdapter {
  engine: DbEngineName;
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult;
  backup(destPath: string): Promise<void>;
  close(): void;
}

function normalizeParam(val: unknown): SqlParam {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') {
    return val;
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return val;
  }
  return String(val);
}

function normalizeParams(params: unknown[]): SqlParam[] {
  return params.map(normalizeParam);
}

async function createNodeSqliteAdapter(dbPath: string): Promise<DbAdapter | null> {
  if (process.env.FORCE_SQLJS === '1') {
    return null;
  }

  try {
    const modName = 'node:sqlite';
    const sqliteMod = (await import(/* @vite-ignore */ modName)) as {
      DatabaseSync?: new (location: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          get(...params: SqlParam[]): unknown;
          all(...params: SqlParam[]): unknown[];
          run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
        };
        close(): void;
      };
    };

    if (!sqliteMod || typeof sqliteMod.DatabaseSync !== 'function') {
      return null;
    }

    const DatabaseSyncCtor = sqliteMod.DatabaseSync;
    // Probe instantiation in memory to confirm SQLite is actually enabled in this runtime
    const probe = new DatabaseSyncCtor(':memory:');
    probe.close();

    const nativeDb = new DatabaseSyncCtor(dbPath);
    try {
      nativeDb.exec('PRAGMA journal_mode = DELETE;');
    } catch {
      // ignore pragma errors
    }
    nativeDb.exec('PRAGMA foreign_keys = ON;');

    let txDepth = 0;

    return {
      engine: 'node:sqlite',
      prepare(sql: string): DbStatement {
        const stmt = nativeDb.prepare(sql);
        return {
          get(...params: unknown[]) {
            return stmt.get(...normalizeParams(params));
          },
          all(...params: unknown[]) {
            return stmt.all(...normalizeParams(params));
          },
          run(...params: unknown[]): DbRunResult {
            const res = stmt.run(...normalizeParams(params));
            return {
              changes: Number(res.changes ?? 0),
              lastInsertRowid: Number(res.lastInsertRowid ?? 0),
            };
          },
        };
      },
      exec(sql: string): void {
        nativeDb.exec(sql);
      },
      transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) {
        return (...args: TArgs): TResult => {
          const isOuter = txDepth === 0;
          nativeDb.exec(isOuter ? 'BEGIN IMMEDIATE' : `SAVEPOINT sp_${txDepth}`);
          txDepth += 1;
          try {
            const result = fn(...args);
            txDepth -= 1;
            nativeDb.exec(isOuter ? 'COMMIT' : `RELEASE SAVEPOINT sp_${txDepth}`);
            return result;
          } catch (err) {
            txDepth -= 1;
            try {
              if (isOuter) {
                nativeDb.exec('ROLLBACK');
              } else {
                nativeDb.exec(`ROLLBACK TO SAVEPOINT sp_${txDepth}`);
                nativeDb.exec(`RELEASE SAVEPOINT sp_${txDepth}`);
              }
            } catch {
              // ignore rollback errors
            }
            throw err;
          }
        };
      },
      async backup(destPath: string): Promise<void> {
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        nativeDb.prepare('VACUUM INTO ?').run(destPath);
      },
      close(): void {
        nativeDb.close();
      },
    };
  } catch {
    return null;
  }
}

function normalizeSqlJsParams(params: unknown[]): Array<string | number | Uint8Array | null> {
  return params.map((val) => {
    if (val === undefined || val === null) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number' || typeof val === 'string') return val;
    if (typeof val === 'bigint') {
      return val >= BigInt(Number.MIN_SAFE_INTEGER) && val <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(val)
        : val.toString();
    }
    if (val instanceof Uint8Array || Buffer.isBuffer(val)) return val;
    return String(val);
  });
}

async function createSqlJsAdapter(dbPath: string): Promise<DbAdapter> {
  const req = createRequire(import.meta.url);
  let wasmPath = req.resolve('sql.js/dist/sql-wasm.wasm');
  const unpackedWasmPath = wasmPath.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpackedWasmPath)) {
    wasmPath = unpackedWasmPath;
  }
  const wasmBinary = fs.readFileSync(wasmPath);

  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs({
    wasmBinary: wasmBinary.buffer.slice(
      wasmBinary.byteOffset,
      wasmBinary.byteOffset + wasmBinary.byteLength
    ),
  });

  let nativeDb: InstanceType<typeof SQL.Database>;
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
    const fileBuf = fs.readFileSync(dbPath);
    // Patch legacy WAL header flags (bytes 18-19 = 2) in memory so sql.js opens older DBs cleanly
    if (fileBuf.length >= 20 && (fileBuf[18] === 2 || fileBuf[19] === 2)) {
      fileBuf[18] = 1;
      fileBuf[19] = 1;
    }
    nativeDb = new SQL.Database(fileBuf);
  } else {
    nativeDb = new SQL.Database();
  }

  nativeDb.run('PRAGMA foreign_keys = ON;');

  let txDepth = 0;
  let dirty = false;

  const persistToDisk = () => {
    const data = nativeDb.export();
    const buf = Buffer.from(data);
    const tmpPath = `${dbPath}.tmp`;
    try {
      fs.writeFileSync(tmpPath, buf);
      fs.renameSync(tmpPath, dbPath);
    } catch {
      fs.writeFileSync(dbPath, buf);
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // ignore cleanup error
      }
    }
    dirty = false;
  };

  if (!fs.existsSync(dbPath)) {
    persistToDisk();
  }

  return {
    engine: 'sql.js (WebAssembly)',
    prepare(sql: string): DbStatement {
      return {
        get(...params: unknown[]) {
          const stmt = nativeDb.prepare(sql);
          try {
            const bound = normalizeSqlJsParams(params);
            if (bound.length > 0) stmt.bind(bound);
            if (stmt.step()) {
              return stmt.getAsObject();
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]) {
          const stmt = nativeDb.prepare(sql);
          try {
            const bound = normalizeSqlJsParams(params);
            if (bound.length > 0) stmt.bind(bound);
            const rows: Array<Record<string, unknown>> = [];
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
        run(...params: unknown[]): DbRunResult {
          const stmt = nativeDb.prepare(sql);
          try {
            const bound = normalizeSqlJsParams(params);
            if (bound.length > 0) stmt.bind(bound);
            stmt.step();
          } finally {
            stmt.free();
          }
          const changes = nativeDb.getRowsModified();
          let lastInsertRowid = 0;
          const res = nativeDb.exec('SELECT last_insert_rowid()');
          if (res.length > 0 && res[0].values.length > 0) {
            lastInsertRowid = Number(res[0].values[0][0] ?? 0);
          }
          dirty = true;
          if (txDepth === 0) {
            persistToDisk();
          }
          return { changes, lastInsertRowid };
        },
      };
    },
    exec(sql: string): void {
      nativeDb.exec(sql);
      dirty = true;
      if (txDepth === 0) {
        persistToDisk();
      }
    },
    transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) {
      return (...args: TArgs): TResult => {
        const isOuter = txDepth === 0;
        nativeDb.run(isOuter ? 'BEGIN IMMEDIATE' : `SAVEPOINT sp_${txDepth}`);
        txDepth += 1;
        try {
          const result = fn(...args);
          txDepth -= 1;
          if (isOuter) {
            nativeDb.run('COMMIT');
            if (dirty) {
              persistToDisk();
            }
          } else {
            nativeDb.run(`RELEASE SAVEPOINT sp_${txDepth}`);
          }
          return result;
        } catch (err) {
          txDepth -= 1;
          try {
            if (isOuter) {
              nativeDb.run('ROLLBACK');
              dirty = false;
            } else {
              nativeDb.run(`ROLLBACK TO SAVEPOINT sp_${txDepth}`);
              nativeDb.run(`RELEASE SAVEPOINT sp_${txDepth}`);
            }
          } catch {
            // ignore rollback error
          }
          throw err;
        }
      };
    },
    async backup(destPath: string): Promise<void> {
      fs.writeFileSync(destPath, Buffer.from(nativeDb.export()));
    },
    close(): void {
      if (dirty) {
        persistToDisk();
      }
      nativeDb.close();
    },
  };
}

let activeBackend: DbAdapter | null = null;

function requireBackend(): DbAdapter {
  if (!activeBackend) {
    throw new Error("La base de données n'est pas initialisée. Appelez initDb() d'abord.");
  }
  return activeBackend;
}

export const db = {
  getEngine(): DbEngineName {
    return requireBackend().engine;
  },
  prepare(sql: string): DbStatement {
    return requireBackend().prepare(sql);
  },
  exec(sql: string): void {
    requireBackend().exec(sql);
  },
  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult {
    return requireBackend().transaction(fn);
  },
  backup(destPath: string): Promise<void> {
    return requireBackend().backup(destPath);
  },
  close(): void {
    if (activeBackend) {
      activeBackend.close();
      activeBackend = null;
    }
  },
};

export async function initDb(): Promise<void> {
  if (!activeBackend) {
    activeBackend =
      (await createNodeSqliteAdapter(DB_PATH)) ?? (await createSqlJsAdapter(DB_PATH));
  }

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
      auto_close_time TEXT NOT NULL DEFAULT '23:59',
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
      shift_start TEXT DEFAULT NULL,
      shift_end TEXT DEFAULT NULL,
      grace_minutes INTEGER DEFAULT NULL,
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
      checkin_photo_id INTEGER DEFAULT NULL,
      checkout_photo_id INTEGER DEFAULT NULL,
      is_late INTEGER NOT NULL DEFAULT 0,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      worked_minutes INTEGER NOT NULL DEFAULT 0,
      checkout_missing INTEGER NOT NULL DEFAULT 0,
      auto_closed_at TEXT DEFAULT NULL,
      is_corrected INTEGER NOT NULL DEFAULT 0,
      last_correction_reason TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(employee_id, work_date)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('checkin', 'checkout')),
      work_date TEXT NOT NULL,
      file_path TEXT NOT NULL,
      thumb_path TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(attendance_id, kind)
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

    CREATE TABLE IF NOT EXISTS correction_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      punch_type TEXT NOT NULL CHECK (punch_type IN ('checkin', 'checkout')),
      requested_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      reviewed_by_admin_id INTEGER DEFAULT NULL,
      reviewed_by_username TEXT DEFAULT NULL,
      review_note TEXT DEFAULT NULL,
      reviewed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS correction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_id INTEGER DEFAULT NULL,
      employee_id INTEGER NOT NULL,
      employee_name TEXT NOT NULL,
      work_date TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('manual_add', 'manual_edit', 'request_approved', 'request_rejected', 'auto_close')),
      actor_admin_id INTEGER DEFAULT NULL,
      actor_username TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      reason TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(work_date);
    CREATE INDEX IF NOT EXISTS idx_photos_employee_date ON photos(employee_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_logs_date ON attendance_logs(log_date);
    CREATE INDEX IF NOT EXISTS idx_correction_requests_status ON correction_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_correction_requests_emp ON correction_requests(employee_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_correction_logs_date ON correction_logs(work_date, id);
    CREATE INDEX IF NOT EXISTS idx_correction_logs_emp ON correction_logs(employee_id, id);
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
  if (!colNames.has('auto_close_time')) {
    db.exec(`ALTER TABLE settings ADD COLUMN auto_close_time TEXT NOT NULL DEFAULT '23:59'`);
  }

  // Migrate existing employees table if shift columns are missing
  const empCols = db.prepare('PRAGMA table_info(employees)').all() as Array<{ name: string }>;
  const empColNames = new Set(empCols.map((c) => c.name));
  if (!empColNames.has('shift_start')) {
    db.exec(`ALTER TABLE employees ADD COLUMN shift_start TEXT DEFAULT NULL`);
  }
  if (!empColNames.has('shift_end')) {
    db.exec(`ALTER TABLE employees ADD COLUMN shift_end TEXT DEFAULT NULL`);
  }
  if (!empColNames.has('grace_minutes')) {
    db.exec(`ALTER TABLE employees ADD COLUMN grace_minutes INTEGER DEFAULT NULL`);
  }

  // Migrate existing attendance table if photo or correction columns are missing
  const attCols = db.prepare('PRAGMA table_info(attendance)').all() as Array<{ name: string }>;
  const attColNames = new Set(attCols.map((c) => c.name));
  if (!attColNames.has('checkin_photo')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkin_photo TEXT DEFAULT NULL`);
  }
  if (!attColNames.has('checkout_photo')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkout_photo TEXT DEFAULT NULL`);
  }
  if (!attColNames.has('checkin_photo_id')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkin_photo_id INTEGER DEFAULT NULL`);
  }
  if (!attColNames.has('checkout_photo_id')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkout_photo_id INTEGER DEFAULT NULL`);
  }
  if (!attColNames.has('checkout_missing')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN checkout_missing INTEGER NOT NULL DEFAULT 0`);
  }
  if (!attColNames.has('auto_closed_at')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN auto_closed_at TEXT DEFAULT NULL`);
  }
  if (!attColNames.has('is_corrected')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN is_corrected INTEGER NOT NULL DEFAULT 0`);
  }
  if (!attColNames.has('last_correction_reason')) {
    db.exec(`ALTER TABLE attendance ADD COLUMN last_correction_reason TEXT DEFAULT NULL`);
  }

  // Backfill photos table for any legacy attendance rows that already have file paths
  const legacyPhotoRows = db
    .prepare(
      `SELECT id, employee_id, work_date, checkin_photo, checkout_photo, checkin_photo_id, checkout_photo_id, created_at
       FROM attendance
       WHERE (checkin_photo IS NOT NULL AND checkin_photo_id IS NULL)
          OR (checkout_photo IS NOT NULL AND checkout_photo_id IS NULL)`
    )
    .all() as Array<{
      id: number;
      employee_id: number;
      work_date: string;
      checkin_photo: string | null;
      checkout_photo: string | null;
      checkin_photo_id: number | null;
      checkout_photo_id: number | null;
      created_at: string;
    }>;

  if (legacyPhotoRows.length > 0) {
    const insertPhotoStmt = db.prepare(
      `INSERT OR IGNORE INTO photos (attendance_id, employee_id, kind, work_date, file_path, thumb_path, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    );
    const getPhotoIdStmt = db.prepare(
      `SELECT id FROM photos WHERE attendance_id = ? AND kind = ?`
    );
    const setInIdStmt = db.prepare(`UPDATE attendance SET checkin_photo_id = ? WHERE id = ?`);
    const setOutIdStmt = db.prepare(`UPDATE attendance SET checkout_photo_id = ? WHERE id = ?`);

    const runBackfill = db.transaction(() => {
      for (const row of legacyPhotoRows) {
        if (row.checkin_photo && !row.checkin_photo_id) {
          insertPhotoStmt.run(
            row.id,
            row.employee_id,
            'checkin',
            row.work_date,
            row.checkin_photo,
            row.created_at
          );
          const p = getPhotoIdStmt.get(row.id, 'checkin') as { id: number } | undefined;
          if (p) setInIdStmt.run(p.id, row.id);
        }
        if (row.checkout_photo && !row.checkout_photo_id) {
          insertPhotoStmt.run(
            row.id,
            row.employee_id,
            'checkout',
            row.work_date,
            row.checkout_photo,
            row.created_at
          );
          const p = getPhotoIdStmt.get(row.id, 'checkout') as { id: number } | undefined;
          if (p) setOutIdStmt.run(p.id, row.id);
        }
      }
    });
    runBackfill();
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
