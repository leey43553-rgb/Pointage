import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import {
  requireAdmin,
  requireEmployee,
  requireSuperAdmin,
  signToken,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  db,
  generateUniqueEmployeeCode,
  getLocalDateString,
  getLocalDateTimeIso,
  getLocalTimeString,
  type AdminRow,
  type AttendanceRow,
  type EmployeeRow,
  type SettingsRow,
} from './db.ts';

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

export function createApiRouter(): Router {
  const router = Router();

  // ---------------- PUBLIC CONFIG ----------------
  router.get('/public/config', (req: Request, res: Response) => {
    const settings = getSettings();
    res.json({
      company_name: settings.company_name,
      logo_data_url: settings.logo_data_url,
      official_start_time: settings.official_start_time,
      grace_minutes: settings.grace_minutes,
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

    res.json({
      token,
      employee: {
        id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        job_title: employee.job_title,
      },
      today_attendance: todayAttendance || null,
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

  // ---------------- EMPLOYEE ROUTES ----------------
  router.get('/employee/me', requireEmployee, (req: AuthenticatedRequest, res: Response) => {
    const emp = req.employeeUser!;
    const today = getLocalDateString();
    const todayAttendance = db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
      .get(emp.id, today) as AttendanceRow | undefined;

    res.json({
      employee: {
        id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
      },
      today_attendance: todayAttendance || null,
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

  router.post('/attendance/checkin', requireEmployee, (req: AuthenticatedRequest, res: Response) => {
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

    const officialStartMins = parseTimeToMinutes(settings.official_start_time);
    const cutoffMins = officialStartMins + (settings.grace_minutes || 0);
    const arrivalMins = now.getHours() * 60 + now.getMinutes();

    const isLate = arrivalMins > cutoffMins ? 1 : 0;
    const lateMinutes = isLate ? Math.max(1, arrivalMins - officialStartMins) : 0;

    const fullName = `${emp.first_name} ${emp.last_name}`.trim();

    const runTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO attendance (employee_id, work_date, checkin_time, checkin_ip, is_late, late_minutes, worked_minutes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(emp.id, today, timeStr, clientIp, isLate, lateMinutes, nowIso);

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
  });

  router.post('/attendance/checkout', requireEmployee, (req: AuthenticatedRequest, res: Response) => {
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

    const checkinMins = parseTimeToMinutes(existing.checkin_time);
    const checkoutMins = now.getHours() * 60 + now.getMinutes();
    const workedMinutes = Math.max(0, checkoutMins - checkinMins);
    const fullName = `${emp.first_name} ${emp.last_name}`.trim();

    const runTx = db.transaction(() => {
      db.prepare(
        `UPDATE attendance
         SET checkout_time = ?, checkout_ip = ?, worked_minutes = ?
         WHERE id = ?`
      ).run(timeStr, clientIp, workedMinutes, existing.id);

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
  });

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

    const rows = employees.map((emp) => {
      const agg = aggMap.get(emp.id);
      return {
        employee_id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        is_active: emp.is_active === 1,
        days_present: agg?.days_present || 0,
        days_late: agg?.days_late || 0,
        total_late_minutes: agg?.total_late_minutes || 0,
        total_worked_minutes: agg?.total_worked_minutes || 0,
      };
    });

    res.json({ month, rows });
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
      settings,
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
    db.prepare(
      `UPDATE settings
       SET company_name = ?, logo_data_url = ?, official_start_time = ?, grace_minutes = ?, allowed_network_prefix = ?, updated_at = ?
       WHERE id = 1`
    ).run(companyName, logoDataUrl, officialStartTime, Math.round(graceMinutesRaw), allowedNetworkPrefix, now);

    const updated = getSettings();
    res.json({ settings: updated });
  });

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
