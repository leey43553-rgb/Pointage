import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import {
  clearAdminSessionCookie,
  requireAdmin,
  requireEmployee,
  requireSuperAdmin,
  setAdminSessionCookie,
  signToken,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  APP_CONFIG,
  CONFIG_PATH,
  DATA_DIR,
  DB_PATH,
  PHOTOS_DIR,
  db,
  generateUniqueEmployeeCode,
  getLocalDateString,
  getLocalDateTimeIso,
  getLocalTimeString,
  updateAppFileConfig,
  type AdminRow,
  type AttendanceRow,
  type EmployeeRow,
  type PhotoRequirement,
  type PhotoRow,
  type PublicHolidayEntry,
  type SettingsRow,
} from './db.ts';
import {
  computeMonthlyEmployeeSummaries,
  generateMonthlyExcelBuffer,
  parsePublicHolidays,
  parseWorkingDays,
} from './excelReport.ts';
import {
  cleanupOldPhotos,
  photoUploadMiddleware,
  resolveOrCreateThumbnailPath,
  resolveSafePhotoPath,
  saveAttendancePhoto,
} from './photos.ts';

function handlePhotoUpload(req: Request, res: Response, next: NextFunction): void {
  photoUploadMiddleware.single('photo')(req, res, (err: unknown) => {
    if (err) {
      const msg =
        err instanceof Error && err.message.includes('File too large')
          ? 'La photo dépasse la taille maximale autorisée (1 Mo).'
          : err instanceof Error
          ? err.message
          : 'Erreur lors de la réception de la photo.';
      res.status(400).json({ error: msg });
      return;
    }
    next();
  });
}

const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const ADMIN_LOCKOUT_MAX = 10;

export function getClientIp(req: Request): string {
  const raw = req.socket?.remoteAddress || req.ip || '127.0.0.1';
  if (raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

export function getServerLanIps(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const iface of netList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

export function getPrimaryLanIp(): string {
  const ips = getServerLanIps();
  const preferred =
    ips.find((ip) => ip.startsWith('192.168.')) ||
    ips.find((ip) => ip.startsWith('10.')) ||
    ips.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ||
    ips[0];
  return preferred || 'localhost';
}

export interface DesktopHooks {
  isElectron: boolean;
  getDesktopSettings: () => { openAtLogin: boolean; startMinimized: boolean };
  setDesktopSettings: (opts: {
    openAtLogin?: boolean;
    startMinimized?: boolean;
  }) => { openAtLogin: boolean; startMinimized: boolean };
  openDataFolder: () => Promise<boolean>;
}

function getSettings(): SettingsRow {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
}

function isNetworkAllowed(clientIp: string, settings: SettingsRow): boolean {
  const prefix = (settings.allowed_network_prefix || '').trim();
  if (!prefix) return true;
  return clientIp.startsWith(prefix);
}

function parseTimeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0] || 0);
  const m = Number(parts[1] || 0);
  return h * 60 + m;
}

function getAttemptLockRemaining(key: string): number {
  const row = db
    .prepare('SELECT attempts, locked_until FROM pin_attempts WHERE key = ?')
    .get(key) as { attempts: number; locked_until: number } | undefined;
  if (!row) return 0;
  const now = Date.now();
  if (row.locked_until > now) {
    return Math.ceil((row.locked_until - now) / 1000);
  }
  return 0;
}

function recordFailedAttempt(key: string, maxAttempts: number): { locked: boolean; remainingAttempts: number } {
  const now = Date.now();
  const row = db
    .prepare('SELECT attempts, locked_until FROM pin_attempts WHERE key = ?')
    .get(key) as { attempts: number; locked_until: number } | undefined;

  let attempts = 1;
  if (row) {
    // If previous lockout expired, reset counter before counting this attempt
    attempts = row.locked_until > 0 && row.locked_until <= now ? 1 : row.attempts + 1;
  }

  const locked = attempts >= maxAttempts;
  const lockedUntil = locked ? now + LOCKOUT_DURATION_MS : 0;

  db.prepare(
    `INSERT INTO pin_attempts (key, attempts, locked_until, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until, updated_at = excluded.updated_at`
  ).run(key, attempts, lockedUntil, now);

  return {
    locked,
    remainingAttempts: Math.max(0, maxAttempts - attempts),
  };
}

function clearAttempts(key: string): void {
  db.prepare('DELETE FROM pin_attempts WHERE key = ?').run(key);
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (safe.includes(';') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function isValidLogoDataUrl(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (val.length > 700_000) return false;
  return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(val);
}

export function createApiRouter(desktopHooks?: DesktopHooks): Router {
  const router = Router();

  // ---------------- PUBLIC CONFIG ----------------
  router.get('/public/config', (req: Request, res: Response) => {
    const settings = getSettings();
    res.json({
      company_name: settings.company_name,
      logo_data_url: settings.logo_data_url,
      official_start_time: settings.official_start_time,
      grace_minutes: settings.grace_minutes,
      photo_requirement: settings.photo_requirement || 'both',
      server_time: getLocalTimeString(),
      server_date: getLocalDateString(),
      client_ip: getClientIp(req),
    });
  });

  // ---------------- EMPLOYEE AUTH ----------------
  router.post('/auth/employee', (req: Request, res: Response) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Veuillez saisir un code valide à 6 chiffres.' });
      return;
    }

    const clientIp = getClientIp(req);
    const ipKey = `emp_ip:${clientIp}`;
    const codeKey = `emp_code:${code}`;

    const ipLockSeconds = getAttemptLockRemaining(ipKey);
    const codeLockSeconds = getAttemptLockRemaining(codeKey);
    const lockRemaining = Math.max(ipLockSeconds, codeLockSeconds);

    if (lockRemaining > 0) {
      res.status(429).json({
        error: 'Trop de tentatives incorrectes. Ce code est bloqué pendant 5 minutes.',
        retry_after_seconds: lockRemaining,
      });
      return;
    }

    const employee = db
      .prepare('SELECT * FROM employees WHERE code = ? AND is_active = 1')
      .get(code) as EmployeeRow | undefined;

    if (!employee) {
      const resIp = recordFailedAttempt(ipKey, LOCKOUT_MAX_ATTEMPTS);
      const resCode = recordFailedAttempt(codeKey, LOCKOUT_MAX_ATTEMPTS);
      if (resIp.locked || resCode.locked) {
        res.status(429).json({
          error: 'Trop de tentatives incorrectes. Veuillez patienter 5 minutes avant de réessayer.',
          retry_after_seconds: 300,
        });
        return;
      }
      const remaining = Math.min(resIp.remainingAttempts, resCode.remainingAttempts);
      res.status(401).json({
        error: `Code incorrect. Il vous reste ${remaining} essai${remaining > 1 ? 's' : ''}.`,
        remaining_attempts: remaining,
      });
      return;
    }

    clearAttempts(ipKey);
    clearAttempts(codeKey);

    const today = getLocalDateString();
    const todayAttendance = db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
      .get(employee.id, today) as AttendanceRow | undefined;

    const token = signToken({
      sub: employee.id,
      type: 'employee',
      role: 'employee',
      first_name: employee.first_name,
      last_name: employee.last_name,
      exp: Date.now() + 5 * 60 * 1000,
    });

    const settings = getSettings();
    res.json({
      token,
      employee: {
        id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        job_title: employee.job_title,
      },
      today_attendance: todayAttendance || null,
      photo_requirement: settings.photo_requirement || 'both',
      server_time: getLocalTimeString(),
      server_date: today,
    });
  });

  // ---------------- ADMIN AUTH ----------------
  router.post('/auth/admin', (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: "Veuillez saisir votre nom d'utilisateur et votre mot de passe." });
      return;
    }

    const clientIp = getClientIp(req);
    const adminIpKey = `adm_ip:${clientIp}`;
    const lockRemaining = getAttemptLockRemaining(adminIpKey);
    if (lockRemaining > 0) {
      res.status(429).json({
        error: 'Trop de tentatives échouées. Veuillez patienter 5 minutes.',
        retry_after_seconds: lockRemaining,
      });
      return;
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username) as AdminRow | undefined;
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      recordFailedAttempt(adminIpKey, ADMIN_LOCKOUT_MAX);
      res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
      return;
    }

    clearAttempts(adminIpKey);

    const token = signToken({
      sub: admin.id,
      type: 'admin',
      role: admin.role,
      username: admin.username,
      exp: Date.now() + 8 * 60 * 60 * 1000,
    });

    setAdminSessionCookie(res, token);

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        must_change_password: admin.must_change_password === 1,
      },
    });
  });

  router.post('/auth/logout', (_req: Request, res: Response) => {
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  });

  // ---------------- EMPLOYEE ROUTES ----------------
  router.get('/employee/me', requireEmployee, (req: AuthenticatedRequest, res: Response) => {
    const emp = req.employeeUser!;
    const today = getLocalDateString();
    const todayAttendance = db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
      .get(emp.id, today) as AttendanceRow | undefined;

    const settings = getSettings();
    res.json({
      employee: {
        id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
      },
      today_attendance: todayAttendance || null,
      photo_requirement: settings.photo_requirement || 'both',
      server_time: getLocalTimeString(),
      server_date: today,
    });
  });

  router.get('/employee/history', requireEmployee, (req: AuthenticatedRequest, res: Response) => {
    const emp = req.employeeUser!;
    const start = new Date();
    start.setDate(start.getDate() - 29);
    const fromDate = getLocalDateString(start);

    const rows = db
      .prepare(
        `SELECT * FROM attendance
         WHERE employee_id = ? AND work_date >= ?
         ORDER BY work_date DESC`
      )
      .all(emp.id, fromDate) as AttendanceRow[];

    res.json({ records: rows, from_date: fromDate, to_date: getLocalDateString() });
  });

  router.post(
    '/attendance/checkin',
    requireEmployee,
    handlePhotoUpload,
    async (req: AuthenticatedRequest, res: Response) => {
      const emp = req.employeeUser!;
      const settings = getSettings();
      const clientIp = getClientIp(req);

      if (!isNetworkAllowed(clientIp, settings)) {
        res.status(403).json({
          error: "Vous devez être connecté au wifi de l'entreprise.",
        });
        return;
      }

      const now = new Date();
      const today = getLocalDateString(now);
      const timeStr = getLocalTimeString(now);
      const nowIso = getLocalDateTimeIso(now);

      const existing = db
        .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
        .get(emp.id, today) as AttendanceRow | undefined;

      if (existing && existing.checkin_time) {
        res.status(409).json({
          error: `Votre arrivée a déjà été enregistrée aujourd'hui à ${existing.checkin_time.slice(0, 5)}.`,
        });
        return;
      }

      const photoReq = settings.photo_requirement || 'both';
      const needsPhoto = photoReq === 'checkin_only' || photoReq === 'both';
      if (needsPhoto && !req.file) {
        res.status(400).json({
          error: 'Une photo est obligatoire pour enregistrer votre arrivée.',
        });
        return;
      }

      let savedPhoto: { filePath: string; thumbPath: string | null } | null = null;
      if (req.file) {
        try {
          savedPhoto = await saveAttendancePhoto({
            buffer: req.file.buffer,
            workDate: today,
            employeeId: emp.id,
            action: 'checkin',
          });
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Photo invalide.',
          });
          return;
        }
      }

      const officialStartMins = parseTimeToMinutes(settings.official_start_time);
      const cutoffMins = officialStartMins + (settings.grace_minutes || 0);
      const arrivalMins = now.getHours() * 60 + now.getMinutes();

      const isLate = arrivalMins > cutoffMins ? 1 : 0;
      const lateMinutes = isLate ? Math.max(1, arrivalMins - officialStartMins) : 0;

      const fullName = `${emp.first_name} ${emp.last_name}`.trim();

      const runTx = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO attendance (employee_id, work_date, checkin_time, checkin_ip, checkin_photo, is_late, late_minutes, worked_minutes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
          )
          .run(
            emp.id,
            today,
            timeStr,
            clientIp,
            savedPhoto ? savedPhoto.filePath : null,
            isLate,
            lateMinutes,
            nowIso
          );

        const attId = Number(info.lastInsertRowid);
        if (savedPhoto) {
          const pInfo = db
            .prepare(
              `INSERT INTO photos (attendance_id, employee_id, kind, work_date, file_path, thumb_path, created_at)
               VALUES (?, ?, 'checkin', ?, ?, ?, ?)`
            )
            .run(attId, emp.id, today, savedPhoto.filePath, savedPhoto.thumbPath, nowIso);
          db.prepare('UPDATE attendance SET checkin_photo_id = ? WHERE id = ?').run(
            Number(pInfo.lastInsertRowid),
            attId
          );
        }

        db.prepare(
          `INSERT INTO attendance_logs (employee_id, employee_name, action, log_date, log_time, ip_address, created_at)
           VALUES (?, ?, 'checkin', ?, ?, ?, ?)`
        ).run(emp.id, fullName, today, timeStr, clientIp, nowIso);
      });

      runTx();

      const record = db
        .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
        .get(emp.id, today) as AttendanceRow;

      res.json({
        attendance: record,
        message: `Bonjour ${emp.first_name}, votre arrivée a bien été enregistrée à ${timeStr.slice(0, 5)}.`,
      });
    }
  );

  router.post(
    '/attendance/checkout',
    requireEmployee,
    handlePhotoUpload,
    async (req: AuthenticatedRequest, res: Response) => {
      const emp = req.employeeUser!;
      const settings = getSettings();
      const clientIp = getClientIp(req);

      if (!isNetworkAllowed(clientIp, settings)) {
        res.status(403).json({
          error: "Vous devez être connecté au wifi de l'entreprise.",
        });
        return;
      }

      const now = new Date();
      const today = getLocalDateString(now);
      const timeStr = getLocalTimeString(now);
      const nowIso = getLocalDateTimeIso(now);

      const existing = db
        .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
        .get(emp.id, today) as AttendanceRow | undefined;

      if (!existing || !existing.checkin_time) {
        res.status(400).json({
          error: "Vous devez d'abord pointer votre arrivée avec le bouton vert.",
        });
        return;
      }

      if (existing.checkout_time) {
        res.status(409).json({
          error: `Votre départ a déjà été enregistré aujourd'hui à ${existing.checkout_time.slice(0, 5)}.`,
        });
        return;
      }

      const photoReq = settings.photo_requirement || 'both';
      const needsPhoto = photoReq === 'both';
      if (needsPhoto && !req.file) {
        res.status(400).json({
          error: 'Une photo est obligatoire pour enregistrer votre départ.',
        });
        return;
      }

      let savedPhoto: { filePath: string; thumbPath: string | null } | null = null;
      if (req.file) {
        try {
          savedPhoto = await saveAttendancePhoto({
            buffer: req.file.buffer,
            workDate: today,
            employeeId: emp.id,
            action: 'checkout',
          });
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Photo invalide.',
          });
          return;
        }
      }

      const checkinMins = parseTimeToMinutes(existing.checkin_time);
      const checkoutMins = now.getHours() * 60 + now.getMinutes();
      const workedMinutes = Math.max(0, checkoutMins - checkinMins);
      const fullName = `${emp.first_name} ${emp.last_name}`.trim();

      const runTx = db.transaction(() => {
        let photoId: number | null = null;
        if (savedPhoto) {
          const pInfo = db
            .prepare(
              `INSERT OR REPLACE INTO photos (attendance_id, employee_id, kind, work_date, file_path, thumb_path, created_at)
               VALUES (?, ?, 'checkout', ?, ?, ?, ?)`
            )
            .run(existing.id, emp.id, today, savedPhoto.filePath, savedPhoto.thumbPath, nowIso);
          photoId = Number(pInfo.lastInsertRowid);
        }

        db.prepare(
          `UPDATE attendance
           SET checkout_time = ?, checkout_ip = ?, checkout_photo = ?, checkout_photo_id = ?, worked_minutes = ?
           WHERE id = ?`
        ).run(
          timeStr,
          clientIp,
          savedPhoto ? savedPhoto.filePath : null,
          photoId,
          workedMinutes,
          existing.id
        );

        db.prepare(
          `INSERT INTO attendance_logs (employee_id, employee_name, action, log_date, log_time, ip_address, created_at)
           VALUES (?, ?, 'checkout', ?, ?, ?, ?)`
        ).run(emp.id, fullName, today, timeStr, clientIp, nowIso);
      });

      runTx();

      const record = db
        .prepare('SELECT * FROM attendance WHERE id = ?')
        .get(existing.id) as AttendanceRow;

      res.json({
        attendance: record,
        message: `Au revoir ${emp.first_name}, votre départ a bien été enregistré à ${timeStr.slice(0, 5)}.`,
      });
    }
  );

  // ---------------- ADMIN & SUPER ADMIN ROUTES ----------------
  router.get('/admin/me', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const admin = req.adminUser!;
    res.json({
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        must_change_password: admin.must_change_password === 1,
      },
    });
  });

  router.get('/admin/employees/list', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT id, first_name, last_name, job_title, is_active FROM employees ORDER BY last_name ASC, first_name ASC')
      .all();
    res.json({ employees: rows });
  });

  router.get('/admin/dashboard/today', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const dateParam = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : getLocalDateString();

    const employees = db
      .prepare('SELECT id, first_name, last_name, job_title, is_active FROM employees WHERE is_active = 1 ORDER BY last_name ASC, first_name ASC')
      .all() as Array<Omit<EmployeeRow, 'code' | 'created_at'>>;

    const records = db
      .prepare('SELECT * FROM attendance WHERE work_date = ?')
      .all(dateParam) as AttendanceRow[];

    const recordByEmp = new Map<number, AttendanceRow>();
    for (const r of records) {
      recordByEmp.set(r.employee_id, r);
    }

    let presentOnTimeCount = 0;
    let lateCount = 0;
    let absentCount = 0;

    const list = employees.map((emp) => {
      const att = recordByEmp.get(emp.id) || null;
      let status: 'present' | 'late' | 'absent' = 'absent';
      if (att && att.checkin_time) {
        if (att.is_late === 1) {
          status = 'late';
          lateCount++;
        } else {
          status = 'present';
          presentOnTimeCount++;
        }
      } else {
        absentCount++;
      }
      return {
        attendance_id: att?.id || null,
        employee_id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        status,
        checkin_time: att?.checkin_time || null,
        checkout_time: att?.checkout_time || null,
        late_minutes: att?.late_minutes || 0,
        worked_minutes: att?.worked_minutes || 0,
        checkin_ip: att?.checkin_ip || null,
        checkout_ip: att?.checkout_ip || null,
        has_checkin_photo: Boolean(att?.checkin_photo || att?.checkin_photo_id),
        has_checkout_photo: Boolean(att?.checkout_photo || att?.checkout_photo_id),
        checkin_photo_id: att?.checkin_photo_id || null,
        checkout_photo_id: att?.checkout_photo_id || null,
      };
    });

    res.json({
      date: dateParam,
      summary: {
        total_active: employees.length,
        present_total: presentOnTimeCount + lateCount,
        on_time: presentOnTimeCount,
        late: lateCount,
        absent: absentCount,
      },
      employees: list,
    });
  });

  router.get('/admin/dashboard/monthly', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : defaultMonth;

    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

    let empSql = 'SELECT id, first_name, last_name, job_title, is_active FROM employees';
    const empParams: Array<number> = [];
    if (employeeId && Number.isFinite(employeeId)) {
      empSql += ' WHERE id = ?';
      empParams.push(employeeId);
    }
    empSql += ' ORDER BY last_name ASC, first_name ASC';

    const employees = db.prepare(empSql).all(...empParams) as Array<Omit<EmployeeRow, 'code' | 'created_at'>>;
    const attendanceRecords = db
      .prepare('SELECT * FROM attendance WHERE work_date LIKE ?')
      .all(`${month}-%`) as AttendanceRow[];
    const settings = getSettings();

    const summaries = computeMonthlyEmployeeSummaries(month, employees, attendanceRecords, settings);
    const rows = summaries.map(({ daily_rows: _daily, ...rest }) => rest);

    res.json({ month, rows });
  });

  router.get('/admin/export/excel', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : defaultMonth;

    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const isSingleEmployee = Boolean(employeeId && Number.isFinite(employeeId));

    let empSql = 'SELECT id, first_name, last_name, job_title, is_active FROM employees';
    const empParams: Array<number> = [];
    if (isSingleEmployee && employeeId !== null) {
      empSql += ' WHERE id = ?';
      empParams.push(employeeId);
    }
    empSql += ' ORDER BY last_name ASC, first_name ASC';

    const employees = db.prepare(empSql).all(...empParams) as Array<Omit<EmployeeRow, 'code' | 'created_at'>>;
    if (isSingleEmployee && employees.length === 0) {
      res.status(404).json({ error: 'Employé introuvable.' });
      return;
    }

    const attendanceRecords = db
      .prepare('SELECT * FROM attendance WHERE work_date LIKE ?')
      .all(`${month}-%`) as AttendanceRow[];
    const settings = getSettings();

    const summaries = computeMonthlyEmployeeSummaries(month, employees, attendanceRecords, settings);

    try {
      const buffer = await generateMonthlyExcelBuffer({
        month,
        summaries,
        includeSummarySheet: !isSingleEmployee,
        companyName: settings.company_name,
      });

      const filename = `Rapport-pointage-${month}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'Erreur lors de la génération du fichier Excel.' });
    }
  });

  router.get('/admin/attendance', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const today = getLocalDateString();
    const startObj = new Date();
    startObj.setDate(1);
    const defaultFrom = getLocalDateString(startObj);

    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : defaultFrom;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : today;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    let sql = `
      SELECT
        a.id,
        a.employee_id,
        e.first_name,
        e.last_name,
        e.job_title,
        a.work_date,
        a.checkin_time,
        a.checkout_time,
        a.checkin_ip,
        a.checkout_ip,
        CASE WHEN a.checkin_photo IS NOT NULL OR a.checkin_photo_id IS NOT NULL THEN 1 ELSE 0 END as has_checkin_photo,
        CASE WHEN a.checkout_photo IS NOT NULL OR a.checkout_photo_id IS NOT NULL THEN 1 ELSE 0 END as has_checkout_photo,
        a.checkin_photo_id,
        a.checkout_photo_id,
        a.is_late,
        a.late_minutes,
        a.worked_minutes
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.work_date >= ? AND a.work_date <= ?
    `;
    const params: Array<string | number> = [from, to];

    if (employeeId && Number.isFinite(employeeId)) {
      sql += ' AND a.employee_id = ?';
      params.push(employeeId);
    }
    if (status === 'late') {
      sql += ' AND a.is_late = 1';
    } else if (status === 'on_time') {
      sql += ' AND a.is_late = 0';
    }

    sql += ' ORDER BY a.work_date DESC, a.checkin_time DESC';

    const records = db.prepare(sql).all(...params);
    res.json({ from, to, records });
  });

  // Protected admin-only photo route by photo ID (/api/photos/:id?thumb=1&download=1)
  router.get('/photos/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const photoId = Number(req.params.id);
    if (!Number.isFinite(photoId)) {
      res.status(400).json({ error: 'Identifiant photo invalide.' });
      return;
    }

    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId) as PhotoRow | undefined;
    if (!photo) {
      res.status(404).json({ error: 'Photo introuvable.' });
      return;
    }

    const wantsThumb = req.query.thumb === '1' || req.query.thumb === 'true';
    const wantsDownload = req.query.download === '1' || req.query.download === 'true';

    const targetPath = wantsThumb
      ? await resolveOrCreateThumbnailPath(photo)
      : resolveSafePhotoPath(photo.file_path);

    if (!targetPath) {
      res.status(404).json({ error: 'Fichier photo introuvable.' });
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (wantsDownload) {
      const ext = path.extname(targetPath) || '.jpg';
      const label = photo.kind === 'checkin' ? 'arrivee' : 'depart';
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="photo-${label}-${photo.work_date}-emp${photo.employee_id}${ext}"`
      );
    }
    res.sendFile(targetPath);
  });

  // Protected admin-only photo endpoint by attendance ID + kind (kept for compatibility)
  router.get(
    '/admin/attendance/:id/photo/:kind',
    requireAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      const kind =
        req.params.kind === 'checkout' ? 'checkout' : req.params.kind === 'checkin' ? 'checkin' : null;
      if (!Number.isFinite(id) || !kind) {
        res.status(400).json({ error: 'Requête photo invalide.' });
        return;
      }

      const photo = db
        .prepare('SELECT * FROM photos WHERE attendance_id = ? AND kind = ?')
        .get(id, kind) as PhotoRow | undefined;

      const wantsThumb = req.query.thumb === '1' || req.query.thumb === 'true';
      const wantsDownload = req.query.download === '1' || req.query.download === 'true';

      let safePath: string | null = null;
      if (photo) {
        safePath = wantsThumb
          ? await resolveOrCreateThumbnailPath(photo)
          : resolveSafePhotoPath(photo.file_path);
      } else {
        const row = db
          .prepare('SELECT checkin_photo, checkout_photo FROM attendance WHERE id = ?')
          .get(id) as { checkin_photo: string | null; checkout_photo: string | null } | undefined;
        if (row) {
          const relPath = kind === 'checkin' ? row.checkin_photo : row.checkout_photo;
          safePath = resolveSafePhotoPath(relPath);
        }
      }

      if (!safePath) {
        res.status(404).json({ error: 'Photo introuvable.' });
        return;
      }

      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (wantsDownload) {
        const ext = path.extname(safePath) || '.jpg';
        res.setHeader('Content-Disposition', `attachment; filename="photo-${kind}-${id}${ext}"`);
      }
      res.sendFile(safePath);
    }
  );

  // Calendar photos endpoint (planning matrix + day view)
  router.get('/admin/photos/calendar', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month =
      typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : defaultMonth;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

    const [yearNum, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const todayStr = getLocalDateString();
    const settings = getSettings();
    const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
    const holidays = parsePublicHolidays(settings.public_holidays);
    const holidayMap = new Map<string, PublicHolidayEntry>(holidays.map((h) => [h.date, h]));

    const officialStartMins = parseTimeToMinutes(settings.official_start_time || '09:00');
    const cutoffMins = officialStartMins + (settings.grace_minutes || 0);
    const WEEKDAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

    let empSql = 'SELECT id, first_name, last_name, job_title, is_active FROM employees';
    const empParams: Array<number> = [];
    if (employeeId && Number.isFinite(employeeId)) {
      empSql += ' WHERE id = ?';
      empParams.push(employeeId);
    } else {
      empSql += ' WHERE is_active = 1';
    }
    empSql += ' ORDER BY last_name ASC, first_name ASC';
    const employees = db
      .prepare(empSql)
      .all(...empParams) as Array<Omit<EmployeeRow, 'code' | 'created_at'>>;

    const attRows = db
      .prepare('SELECT * FROM attendance WHERE work_date LIKE ?')
      .all(`${month}-%`) as AttendanceRow[];

    const attMap = new Map<string, AttendanceRow>();
    for (const r of attRows) {
      attMap.set(`${r.employee_id}:${r.work_date}`, r);
    }

    const days: Array<{
      day: number;
      date: string;
      weekdayIndex: number;
      weekdayLetter: string;
      isWeekend: boolean;
      holidayType: 'holiday' | 'leave' | null;
      holidayLabel: string;
      isFuture: boolean;
    }> = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dow = new Date(yearNum, monthNum - 1, day).getDay();
      const hol = holidayMap.get(dateStr);
      days.push({
        day,
        date: dateStr,
        weekdayIndex: dow,
        weekdayLetter: WEEKDAY_LETTERS[dow] || '',
        isWeekend: !workingDaysSet.has(dow),
        holidayType: hol ? hol.type : null,
        holidayLabel: hol?.label || '',
        isFuture: dateStr > todayStr,
      });
    }

    const employeeRows = employees.map((emp) => {
      const cells: Record<
        string,
        {
          attendance_id: number | null;
          status: 'present' | 'late' | 'absent' | 'weekend' | 'holiday' | 'leave' | 'future';
          checkin_time: string | null;
          checkout_time: string | null;
          is_late: boolean;
          late_minutes: number;
          worked_minutes: number;
          checkin_ip: string | null;
          checkout_ip: string | null;
          checkin_photo_id: number | null;
          checkout_photo_id: number | null;
          holiday_label: string;
        }
      > = {};

      for (const d of days) {
        const att = attMap.get(`${emp.id}:${d.date}`);
        if (att && att.checkin_time) {
          const ciMins = parseTimeToMinutes(att.checkin_time);
          const isLate = ciMins > cutoffMins;
          const lateMins = isLate ? Math.max(1, ciMins - officialStartMins) : 0;
          const workedMins = att.checkout_time
            ? Math.max(0, parseTimeToMinutes(att.checkout_time) - ciMins)
            : 0;

          cells[d.date] = {
            attendance_id: att.id,
            status: isLate ? 'late' : 'present',
            checkin_time: att.checkin_time,
            checkout_time: att.checkout_time,
            is_late: isLate,
            late_minutes: lateMins,
            worked_minutes: workedMins,
            checkin_ip: att.checkin_ip,
            checkout_ip: att.checkout_ip,
            checkin_photo_id: att.checkin_photo_id || null,
            checkout_photo_id: att.checkout_photo_id || null,
            holiday_label: d.holidayLabel,
          };
        } else if (d.holidayType) {
          cells[d.date] = {
            attendance_id: null,
            status: d.holidayType,
            checkin_time: null,
            checkout_time: null,
            is_late: false,
            late_minutes: 0,
            worked_minutes: 0,
            checkin_ip: null,
            checkout_ip: null,
            checkin_photo_id: null,
            checkout_photo_id: null,
            holiday_label: d.holidayLabel,
          };
        } else if (d.isWeekend) {
          cells[d.date] = {
            attendance_id: null,
            status: 'weekend',
            checkin_time: null,
            checkout_time: null,
            is_late: false,
            late_minutes: 0,
            worked_minutes: 0,
            checkin_ip: null,
            checkout_ip: null,
            checkin_photo_id: null,
            checkout_photo_id: null,
            holiday_label: '',
          };
        } else if (d.isFuture) {
          cells[d.date] = {
            attendance_id: null,
            status: 'future',
            checkin_time: null,
            checkout_time: null,
            is_late: false,
            late_minutes: 0,
            worked_minutes: 0,
            checkin_ip: null,
            checkout_ip: null,
            checkin_photo_id: null,
            checkout_photo_id: null,
            holiday_label: '',
          };
        } else {
          cells[d.date] = {
            attendance_id: null,
            status: 'absent',
            checkin_time: null,
            checkout_time: null,
            is_late: false,
            late_minutes: 0,
            worked_minutes: 0,
            checkin_ip: null,
            checkout_ip: null,
            checkin_photo_id: null,
            checkout_photo_id: null,
            holiday_label: '',
          };
        }
      }

      return {
        employee_id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        is_active: emp.is_active === 1,
        cells,
      };
    });

    res.json({
      month,
      days,
      employees: employeeRows,
    });
  });

  // Single-day cards endpoint for "Vue par jour"
  router.get('/admin/photos/day', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const todayStr = getLocalDateString();
    const dateParam =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayStr;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

    const settings = getSettings();
    const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
    const holidays = parsePublicHolidays(settings.public_holidays);
    const holiday = holidays.find((h) => h.date === dateParam) || null;
    const [y, m, d] = dateParam.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const isWeekend = !workingDaysSet.has(dow);
    const isFuture = dateParam > todayStr;

    const officialStartMins = parseTimeToMinutes(settings.official_start_time || '09:00');
    const cutoffMins = officialStartMins + (settings.grace_minutes || 0);

    let empSql = 'SELECT id, first_name, last_name, job_title, is_active FROM employees';
    const empParams: Array<number> = [];
    if (employeeId && Number.isFinite(employeeId)) {
      empSql += ' WHERE id = ?';
      empParams.push(employeeId);
    } else {
      empSql += ' WHERE is_active = 1';
    }
    empSql += ' ORDER BY last_name ASC, first_name ASC';
    const employees = db
      .prepare(empSql)
      .all(...empParams) as Array<Omit<EmployeeRow, 'code' | 'created_at'>>;

    const records = db
      .prepare('SELECT * FROM attendance WHERE work_date = ?')
      .all(dateParam) as AttendanceRow[];
    const attByEmp = new Map<number, AttendanceRow>(records.map((r) => [r.employee_id, r]));

    const cards = employees.map((emp) => {
      const att = attByEmp.get(emp.id);
      if (att && att.checkin_time) {
        const ciMins = parseTimeToMinutes(att.checkin_time);
        const isLate = ciMins > cutoffMins;
        const lateMins = isLate ? Math.max(1, ciMins - officialStartMins) : 0;
        const workedMins = att.checkout_time
          ? Math.max(0, parseTimeToMinutes(att.checkout_time) - ciMins)
          : 0;
        return {
          employee_id: emp.id,
          first_name: emp.first_name,
          last_name: emp.last_name,
          job_title: emp.job_title,
          attendance_id: att.id,
          status: isLate ? ('late' as const) : ('present' as const),
          checkin_time: att.checkin_time,
          checkout_time: att.checkout_time,
          is_late: isLate,
          late_minutes: lateMins,
          worked_minutes: workedMins,
          checkin_ip: att.checkin_ip,
          checkout_ip: att.checkout_ip,
          checkin_photo_id: att.checkin_photo_id || null,
          checkout_photo_id: att.checkout_photo_id || null,
          holiday_label: holiday?.label || '',
        };
      }

      const fallbackStatus = holiday
        ? holiday.type
        : isWeekend
        ? ('weekend' as const)
        : isFuture
        ? ('future' as const)
        : ('absent' as const);

      return {
        employee_id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        attendance_id: null,
        status: fallbackStatus,
        checkin_time: null,
        checkout_time: null,
        is_late: false,
        late_minutes: 0,
        worked_minutes: 0,
        checkin_ip: null,
        checkout_ip: null,
        checkin_photo_id: null,
        checkout_photo_id: null,
        holiday_label: holiday?.label || '',
      };
    });

    res.json({ date: dateParam, cards });
  });

  router.get('/admin/logs', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : null;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : null;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

    let sql = 'SELECT * FROM attendance_logs WHERE 1=1';
    const params: Array<string | number> = [];

    if (from) {
      sql += ' AND log_date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND log_date <= ?';
      params.push(to);
    }
    if (employeeId && Number.isFinite(employeeId)) {
      sql += ' AND employee_id = ?';
      params.push(employeeId);
    }

    sql += ' ORDER BY id DESC LIMIT 300';
    const logs = db.prepare(sql).all(...params);
    res.json({ logs });
  });

  router.get('/admin/export/csv', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const exportType = req.query.type === 'monthly' ? 'monthly' : 'attendance';

    if (exportType === 'monthly') {
      const now = new Date();
      const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : defaultMonth;
      const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

      let empSql = 'SELECT id, first_name, last_name, job_title, is_active FROM employees';
      const empParams: Array<number> = [];
      if (employeeId && Number.isFinite(employeeId)) {
        empSql += ' WHERE id = ?';
        empParams.push(employeeId);
      }
      empSql += ' ORDER BY last_name ASC, first_name ASC';
      const employees = db.prepare(empSql).all(...empParams) as Array<Omit<EmployeeRow, 'code' | 'created_at'>>;

      const aggRows = db
        .prepare(
          `SELECT
             employee_id,
             COUNT(*) as days_present,
             SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as days_late,
             COALESCE(SUM(late_minutes), 0) as total_late_minutes,
             COALESCE(SUM(worked_minutes), 0) as total_worked_minutes
           FROM attendance
           WHERE work_date LIKE ?
           GROUP BY employee_id`
        )
        .all(`${month}-%`) as Array<{
          employee_id: number;
          days_present: number;
          days_late: number;
          total_late_minutes: number;
          total_worked_minutes: number;
        }>;
      const aggMap = new Map(aggRows.map((r) => [r.employee_id, r]));

      const lines = [
        ['Mois', 'Employé', 'Poste', 'Jours présents', 'Retards (jours)', 'Retard total (min)', 'Heures travaillées'].join(';'),
      ];
      for (const emp of employees) {
        const agg = aggMap.get(emp.id);
        const mins = agg?.total_worked_minutes || 0;
        const formattedHours = `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
        lines.push(
          [
            escapeCsvCell(month),
            escapeCsvCell(`${emp.first_name} ${emp.last_name}`),
            escapeCsvCell(emp.job_title),
            escapeCsvCell(agg?.days_present || 0),
            escapeCsvCell(agg?.days_late || 0),
            escapeCsvCell(agg?.total_late_minutes || 0),
            escapeCsvCell(formattedHours),
          ].join(';')
        );
      }

      const csv = '\uFEFF' + lines.join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pointage-mensuel-${month}.csv"`);
      res.send(csv);
      return;
    }

    const today = getLocalDateString();
    const startObj = new Date();
    startObj.setDate(1);
    const defaultFrom = getLocalDateString(startObj);

    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : defaultFrom;
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : today;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    let sql = `
      SELECT
        a.work_date,
        e.first_name,
        e.last_name,
        e.job_title,
        a.checkin_time,
        a.checkout_time,
        a.is_late,
        a.late_minutes,
        a.worked_minutes,
        a.checkin_ip,
        a.checkout_ip
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.work_date >= ? AND a.work_date <= ?
    `;
    const params: Array<string | number> = [from, to];
    if (employeeId && Number.isFinite(employeeId)) {
      sql += ' AND a.employee_id = ?';
      params.push(employeeId);
    }
    if (status === 'late') {
      sql += ' AND a.is_late = 1';
    } else if (status === 'on_time') {
      sql += ' AND a.is_late = 0';
    }
    sql += ' ORDER BY a.work_date DESC, a.checkin_time DESC';

    const rows = db.prepare(sql).all(...params) as Array<{
      work_date: string;
      first_name: string;
      last_name: string;
      job_title: string;
      checkin_time: string | null;
      checkout_time: string | null;
      is_late: number;
      late_minutes: number;
      worked_minutes: number;
      checkin_ip: string | null;
      checkout_ip: string | null;
    }>;

    const lines = [
      ['Date', 'Employé', 'Poste', 'Arrivée', 'Départ', 'Statut', 'Retard (min)', 'Durée travaillée', 'IP Arrivée', 'IP Départ'].join(';'),
    ];
    for (const r of rows) {
      const hours = r.worked_minutes > 0 ? `${Math.floor(r.worked_minutes / 60)}h${String(r.worked_minutes % 60).padStart(2, '0')}` : '-';
      lines.push(
        [
          escapeCsvCell(r.work_date),
          escapeCsvCell(`${r.first_name} ${r.last_name}`),
          escapeCsvCell(r.job_title),
          escapeCsvCell(r.checkin_time ? r.checkin_time.slice(0, 5) : '-'),
          escapeCsvCell(r.checkout_time ? r.checkout_time.slice(0, 5) : '-'),
          escapeCsvCell(r.is_late === 1 ? 'En retard' : "À l'heure"),
          escapeCsvCell(r.late_minutes),
          escapeCsvCell(hours),
          escapeCsvCell(r.checkin_ip || '-'),
          escapeCsvCell(r.checkout_ip || '-'),
        ].join(';')
      );
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pointage-${from}-au-${to}.csv"`);
    res.send(csv);
  });

  // ---------------- SUPER ADMIN ONLY ROUTES ----------------
  router.get('/super/employees', requireSuperAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const employees = db
      .prepare('SELECT * FROM employees ORDER BY is_active DESC, last_name ASC, first_name ASC')
      .all() as EmployeeRow[];
    res.json({ employees });
  });

  router.post('/super/employees', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const firstName = typeof req.body?.first_name === 'string' ? req.body.first_name.trim() : '';
    const lastName = typeof req.body?.last_name === 'string' ? req.body.last_name.trim() : '';
    const jobTitle = typeof req.body?.job_title === 'string' ? req.body.job_title.trim() : '';

    if (!firstName || !lastName) {
      res.status(400).json({ error: 'Le prénom et le nom sont obligatoires.' });
      return;
    }

    const code = generateUniqueEmployeeCode();
    const now = getLocalDateTimeIso();

    const info = db
      .prepare(
        `INSERT INTO employees (first_name, last_name, job_title, code, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      )
      .run(firstName, lastName, jobTitle, code, now);

    const created = db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid) as EmployeeRow;
    res.status(201).json({ employee: created });
  });

  router.put('/super/employees/:id', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Identifiant invalide.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employé introuvable.' });
      return;
    }

    const firstName = typeof req.body?.first_name === 'string' ? req.body.first_name.trim() : existing.first_name;
    const lastName = typeof req.body?.last_name === 'string' ? req.body.last_name.trim() : existing.last_name;
    const jobTitle = typeof req.body?.job_title === 'string' ? req.body.job_title.trim() : existing.job_title;
    const isActive = typeof req.body?.is_active === 'boolean' ? (req.body.is_active ? 1 : 0) : existing.is_active;

    if (!firstName || !lastName) {
      res.status(400).json({ error: 'Le prénom et le nom sont obligatoires.' });
      return;
    }

    db.prepare(
      `UPDATE employees SET first_name = ?, last_name = ?, job_title = ?, is_active = ? WHERE id = ?`
    ).run(firstName, lastName, jobTitle, isActive, id);

    const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow;
    res.json({ employee: updated });
  });

  router.post('/super/employees/:id/regenerate-code', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Identifiant invalide.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employé introuvable.' });
      return;
    }

    const newCode = generateUniqueEmployeeCode();
    db.prepare('UPDATE employees SET code = ? WHERE id = ?').run(newCode, id);
    clearAttempts(`emp_code:${existing.code}`);
    clearAttempts(`emp_code:${newCode}`);

    const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow;
    res.json({ employee: updated });
  });

  router.delete('/super/employees/:id', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Identifiant invalide.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as EmployeeRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employé introuvable.' });
      return;
    }

    db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------------- SUPER ADMIN: ADMINS MANAGEMENT ----------------
  router.get('/super/admins', requireSuperAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const admins = db
      .prepare('SELECT id, username, role, must_change_password, created_at FROM admins ORDER BY role DESC, username ASC')
      .all();
    res.json({ admins });
  });

  router.post('/super/admins', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role === 'super_admin' ? 'super_admin' : 'admin';

    if (!username || username.length < 3) {
      res.status(400).json({ error: "Le nom d'utilisateur doit contenir au moins 3 caractères." });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const now = getLocalDateTimeIso();
    const info = db
      .prepare(
        `INSERT INTO admins (username, password_hash, role, must_change_password, created_at)
         VALUES (?, ?, ?, 0, ?)`
      )
      .run(username, hash, role, now);

    const created = db
      .prepare('SELECT id, username, role, must_change_password, created_at FROM admins WHERE id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json({ admin: created });
  });

  router.put('/super/admins/:id/password', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const newPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Identifiant invalide.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
      return;
    }

    const target = db.prepare('SELECT id FROM admins WHERE id = ?').get(id);
    if (!target) {
      res.status(404).json({ error: 'Administrateur introuvable.' });
      return;
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, id);
    res.json({ ok: true });
  });

  router.delete('/super/admins/:id', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Identifiant invalide.' });
      return;
    }
    if (req.adminUser && req.adminUser.id === id) {
      res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
      return;
    }

    const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(id) as AdminRow | undefined;
    if (!target) {
      res.status(404).json({ error: 'Administrateur introuvable.' });
      return;
    }

    if (target.role === 'super_admin') {
      const count = db
        .prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super_admin'")
        .get() as { c: number };
      if (count.c <= 1) {
        res.status(400).json({ error: 'Impossible de supprimer le dernier super administrateur.' });
        return;
      }
    }

    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/super/change-password', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const admin = req.adminUser!;
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';

    if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
      res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
      return;
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, admin.id);
    res.json({ ok: true });
  });

  // ---------------- SUPER ADMIN: SETTINGS & BACKUP ----------------
  router.get('/super/settings', requireSuperAdmin, (req: Request, res: Response) => {
    const settings = getSettings();
    res.json({
      settings: {
        ...settings,
        working_days: parseWorkingDays(settings.working_days),
        public_holidays: parsePublicHolidays(settings.public_holidays),
      },
      lan_ips: getServerLanIps(),
      client_ip: getClientIp(req),
    });
  });

  router.put('/super/settings', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const current = getSettings();

    const companyName = typeof req.body?.company_name === 'string'
      ? req.body.company_name.trim()
      : current.company_name;
    const officialStartTime = typeof req.body?.official_start_time === 'string'
      ? req.body.official_start_time.trim()
      : current.official_start_time;
    const graceMinutesRaw = req.body?.grace_minutes !== undefined
      ? Number(req.body.grace_minutes)
      : current.grace_minutes;
    const allowedNetworkPrefix = typeof req.body?.allowed_network_prefix === 'string'
      ? req.body.allowed_network_prefix.trim()
      : current.allowed_network_prefix;

    let photoRequirement: PhotoRequirement = current.photo_requirement || 'both';
    if (
      req.body?.photo_requirement === 'none' ||
      req.body?.photo_requirement === 'checkin_only' ||
      req.body?.photo_requirement === 'both'
    ) {
      photoRequirement = req.body.photo_requirement;
    }

    const retentionRaw =
      req.body?.photo_retention_days !== undefined
        ? Number(req.body.photo_retention_days)
        : current.photo_retention_days;
    if (!Number.isFinite(retentionRaw) || retentionRaw < 1 || retentionRaw > 3650) {
      res.status(400).json({
        error: 'La durée de conservation des photos doit être comprise entre 1 et 3650 jours.',
      });
      return;
    }

    let workingDaysList = parseWorkingDays(current.working_days);
    if (Array.isArray(req.body?.working_days)) {
      const cleaned = (req.body.working_days as unknown[])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if (cleaned.length === 0) {
        res.status(400).json({ error: 'Veuillez sélectionner au moins un jour travaillé.' });
        return;
      }
      workingDaysList = Array.from(new Set(cleaned)).sort();
    }

    let publicHolidaysList = parsePublicHolidays(current.public_holidays);
    if (Array.isArray(req.body?.public_holidays)) {
      const cleanedHolidays: PublicHolidayEntry[] = [];
      const seenDates = new Set<string>();
      for (const item of req.body.public_holidays as unknown[]) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as PublicHolidayEntry).date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test((item as PublicHolidayEntry).date)
        ) {
          const entry = item as PublicHolidayEntry;
          if (!seenDates.has(entry.date)) {
            seenDates.add(entry.date);
            cleanedHolidays.push({
              date: entry.date,
              type: entry.type === 'leave' ? 'leave' : 'holiday',
              label: typeof entry.label === 'string' ? entry.label.trim().slice(0, 80) : '',
            });
          }
        }
      }
      cleanedHolidays.sort((a, b) => a.date.localeCompare(b.date));
      publicHolidaysList = cleanedHolidays;
    }

    let logoDataUrl = current.logo_data_url;
    if (req.body?.logo_data_url === null || req.body?.logo_data_url === '') {
      logoDataUrl = null;
    } else if (typeof req.body?.logo_data_url === 'string') {
      if (!isValidLogoDataUrl(req.body.logo_data_url)) {
        res.status(400).json({ error: 'Format de logo invalide (PNG, JPG ou WebP, max 500 Ko).' });
        return;
      }
      logoDataUrl = req.body.logo_data_url;
    }

    if (!companyName) {
      res.status(400).json({ error: "Le nom de l'entreprise est obligatoire." });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(officialStartTime)) {
      res.status(400).json({ error: "L'heure officielle doit être au format HH:MM (ex: 09:00)." });
      return;
    }
    if (!Number.isFinite(graceMinutesRaw) || graceMinutesRaw < 0 || graceMinutesRaw > 180) {
      res.status(400).json({ error: 'La tolérance doit être comprise entre 0 et 180 minutes.' });
      return;
    }

    const now = getLocalDateTimeIso();
    const retentionDays = Math.round(retentionRaw);
    db.prepare(
      `UPDATE settings
       SET company_name = ?, logo_data_url = ?, official_start_time = ?, grace_minutes = ?, allowed_network_prefix = ?, working_days = ?, public_holidays = ?, photo_requirement = ?, photo_retention_days = ?, updated_at = ?
       WHERE id = 1`
    ).run(
      companyName,
      logoDataUrl,
      officialStartTime,
      Math.round(graceMinutesRaw),
      allowedNetworkPrefix,
      JSON.stringify(workingDaysList),
      JSON.stringify(publicHolidaysList),
      photoRequirement,
      retentionDays,
      now
    );

    cleanupOldPhotos(retentionDays);

    const updated = getSettings();
    res.json({
      settings: {
        ...updated,
        working_days: parseWorkingDays(updated.working_days),
        public_holidays: parsePublicHolidays(updated.public_holidays),
      },
    });
  });

  // ---------------- ADMIN: NETWORK & PHONE CONNECTION INFO ----------------
  router.get('/admin/network-info', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const settings = getSettings();
    const port = Number(process.env.PORT) || APP_CONFIG.port || 3000;
    const lanIps = getServerLanIps();
    const primaryIp = getPrimaryLanIp();
    const phoneUrls = lanIps.map((ip) => `http://${ip}:${port}`);
    const primaryPhoneUrl = `http://${primaryIp}:${port}`;

    res.json({
      company_name: settings.company_name,
      allowed_network_prefix: settings.allowed_network_prefix || '',
      port,
      lan_ips: lanIps,
      primary_ip: primaryIp,
      local_url: `http://localhost:${port}`,
      phone_urls: phoneUrls,
      primary_phone_url: primaryPhoneUrl,
      client_ip: getClientIp(req),
      data_dir: DATA_DIR,
      is_electron: Boolean(desktopHooks?.isElectron),
    });
  });

  // ---------------- SUPER ADMIN: DESKTOP & DATA FOLDER ----------------
  router.get('/super/desktop', requireSuperAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const desktopSettings = desktopHooks?.getDesktopSettings
      ? desktopHooks.getDesktopSettings()
      : {
          openAtLogin: APP_CONFIG.openAtLogin,
          startMinimized: APP_CONFIG.startMinimized,
        };

    res.json({
      is_electron: Boolean(desktopHooks?.isElectron),
      data_dir: DATA_DIR,
      db_path: DB_PATH,
      photos_dir: PHOTOS_DIR,
      config_path: CONFIG_PATH,
      open_at_login: desktopSettings.openAtLogin,
      start_minimized: desktopSettings.startMinimized,
    });
  });

  router.put('/super/desktop', requireSuperAdmin, (req: AuthenticatedRequest, res: Response) => {
    const openAtLogin =
      typeof req.body?.open_at_login === 'boolean' ? req.body.open_at_login : undefined;
    const startMinimized =
      typeof req.body?.start_minimized === 'boolean' ? req.body.start_minimized : undefined;

    if (openAtLogin === undefined && startMinimized === undefined) {
      res.status(400).json({ error: 'Paramètre invalide.' });
      return;
    }

    const updatedConfig = updateAppFileConfig({
      ...(openAtLogin !== undefined ? { openAtLogin } : {}),
      ...(startMinimized !== undefined ? { startMinimized } : {}),
    });

    const result = desktopHooks?.setDesktopSettings
      ? desktopHooks.setDesktopSettings({ openAtLogin, startMinimized })
      : {
          openAtLogin: updatedConfig.openAtLogin,
          startMinimized: updatedConfig.startMinimized,
        };

    res.json({
      is_electron: Boolean(desktopHooks?.isElectron),
      open_at_login: result.openAtLogin,
      start_minimized: result.startMinimized,
    });
  });

  router.post(
    '/super/open-data-folder',
    requireSuperAdmin,
    async (_req: AuthenticatedRequest, res: Response) => {
      if (desktopHooks?.isElectron && desktopHooks.openDataFolder) {
        const opened = await desktopHooks.openDataFolder();
        res.json({
          ok: opened,
          data_dir: DATA_DIR,
          message: opened
            ? 'Dossier des données ouvert dans l’Explorateur Windows.'
            : "Impossible d'ouvrir le dossier des données automatiquement.",
        });
        return;
      }

      res.json({
        ok: false,
        data_dir: DATA_DIR,
        message:
          "L'ouverture directe du dossier n'est disponible que depuis l'application bureau Windows.",
      });
    }
  );

  router.get('/super/backup', requireSuperAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    const today = getLocalDateString();
    const tmpName = `pointage-backup-${today}-${crypto.randomBytes(4).toString('hex')}.db`;
    const tmpPath = path.join(os.tmpdir(), tmpName);

    try {
      await db.backup(tmpPath);
      res.download(tmpPath, `pointage-backup-${today}.db`, (err) => {
        fs.unlink(tmpPath, () => {});
        if (err && !res.headersSent) {
          res.status(500).json({ error: 'Erreur lors du téléchargement de la sauvegarde.' });
        }
      });
    } catch {
      fs.unlink(tmpPath, () => {});
      res.status(500).json({ error: 'Impossible de créer la sauvegarde de la base de données.' });
    }
  });

  return router;
}
