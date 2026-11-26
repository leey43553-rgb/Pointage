import bcrypt from 'bcryptjs';
import type {
  AdminAlertsSummary,
  CalendarCellStatus,
  PhotoCalendarCell,
  PhotoCalendarDay,
  PhotoDayCard,
  PhotoRequirement,
  PublicHolidayEntry,
  TodayEmployeeRow,
  TodayEmployeeStatus,
} from '../types';
import {
  cleanupLocalOldPhotos,
  createThumbnailBlob,
  ensureLocalDbInitialized,
  exportLocalBackupBlob,
  generateUniqueLocalEmployeeCode,
  getLocalDateString,
  getLocalDateTimeIso,
  getLocalTimeString,
  localDb,
  type LocalAdminRecord,
  type LocalAttendanceRecord,
  type LocalEmployeeRecord,
  type LocalSettingsRecord,
} from './db';
import {
  computeCheckinLateness,
  computeLocalYesterdayMissingPunch,
  computeMonthlyEmployeeSummaries,
  computeWorkedMinutes,
  formatAttendanceSnapshot,
  generateMonthlyExcelBlob,
  getEffectiveEmployeeSchedule,
  isDateExpectedWorkingDay,
  isValidHHMM,
  normalizeHHMM,
  parsePublicHolidays,
  parseTimeToMinutes,
  parseWorkingDays,
  runLocalAutoCloseMissingCheckouts,
  writeLocalCorrectionLog,
} from './excelBrowser';

export class LocalApiHttpError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'LocalApiHttpError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;
const ADMIN_LOCKOUT_MAX = 10;

interface LocalTokenPayload {
  sub: number;
  type: 'admin' | 'employee';
  role: 'super_admin' | 'admin' | 'employee';
  exp: number;
}

const TOKEN_SECRET_STORAGE_KEY = 'pointage_local_token_secret';

function getLocalTokenSecret(): string {
  try {
    const existing = localStorage.getItem(TOKEN_SECRET_STORAGE_KEY);
    if (existing && existing.length >= 16) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID() + crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(TOKEN_SECRET_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'pointage-offline-local-session-key';
  }
}

function simpleHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

function signLocalToken(payload: LocalTokenPayload): string {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const sig = simpleHash(`${encoded}.${getLocalTokenSecret()}`);
  return `${encoded}.${sig}`;
}

function verifyLocalToken(token: string | null | undefined): LocalTokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expected = simpleHash(`${encoded}.${getLocalTokenSecret()}`);
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as LocalTokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function getSettings(): Promise<LocalSettingsRecord> {
  const settings = await localDb.settings.get(1);
  if (!settings) {
    throw new LocalApiHttpError('Paramètres introuvables.', 500);
  }
  return settings;
}

async function requireEmployeeAuth(token?: string | null): Promise<LocalEmployeeRecord> {
  const payload = verifyLocalToken(token);
  if (!payload || payload.type !== 'employee') {
    throw new LocalApiHttpError('Session employé invalide ou expirée.', 401);
  }
  const emp = await localDb.employees.get(payload.sub);
  if (!emp || emp.is_active !== 1) {
    throw new LocalApiHttpError('Compte employé introuvable ou désactivé.', 401);
  }
  return emp;
}

async function requireAdminAuth(token?: string | null): Promise<LocalAdminRecord> {
  const payload = verifyLocalToken(token);
  if (!payload || payload.type !== 'admin') {
    throw new LocalApiHttpError('Authentification requise.', 401);
  }
  const admin = await localDb.admins.get(payload.sub);
  if (!admin) {
    throw new LocalApiHttpError('Compte administrateur introuvable.', 401);
  }
  return admin;
}

async function requireSuperAdminAuth(token?: string | null): Promise<LocalAdminRecord> {
  const admin = await requireAdminAuth(token);
  if (admin.role !== 'super_admin') {
    throw new LocalApiHttpError('Accès réservé au super administrateur.', 403);
  }
  return admin;
}

async function getAttemptLockRemaining(key: string): Promise<number> {
  const row = await localDb.pin_attempts.get(key);
  if (!row) return 0;
  const now = Date.now();
  if (row.locked_until > now) {
    return Math.ceil((row.locked_until - now) / 1000);
  }
  return 0;
}

async function recordFailedAttempt(key: string, maxAttempts: number): Promise<{ locked: boolean }> {
  const now = Date.now();
  const row = await localDb.pin_attempts.get(key);
  let attempts = 1;
  if (row) {
    attempts = row.locked_until > 0 && row.locked_until <= now ? 1 : row.attempts + 1;
  }
  const locked = attempts >= maxAttempts;
  const lockedUntil = locked ? now + LOCKOUT_DURATION_MS : 0;
  await localDb.pin_attempts.put({
    key,
    attempts,
    locked_until: lockedUntil,
    updated_at: now,
  });
  return { locked };
}

async function clearAttempts(key: string): Promise<void> {
  await localDb.pin_attempts.delete(key);
}

function isValidLogoDataUrl(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (val.length > 700_000) return false;
  return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(val);
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (safe.includes(';') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function parseUrlParts(rawUrl: string): { pathname: string; searchParams: URLSearchParams } {
  const idx = rawUrl.indexOf('?');
  if (idx === -1) {
    return { pathname: rawUrl, searchParams: new URLSearchParams() };
  }
  return {
    pathname: rawUrl.slice(0, idx),
    searchParams: new URLSearchParams(rawUrl.slice(idx + 1)),
  };
}

async function computeAlertsSummary(): Promise<AdminAlertsSummary> {
  await runLocalAutoCloseMissingCheckouts();
  const settings = await getSettings();
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isWorkingToday = isDateExpectedWorkingDay(todayStr, settings);

  let todayUnreported = 0;
  if (isWorkingToday) {
    const activeEmployees = (await localDb.employees.toArray()).filter((e) => e.is_active === 1);
    const todayAtts = await localDb.attendance.where('work_date').equals(todayStr).toArray();
    const checkedInIds = new Set(
      todayAtts.filter((a) => Boolean(a.checkin_time)).map((a) => a.employee_id)
    );
    for (const emp of activeEmployees) {
      if (emp.id && checkedInIds.has(emp.id)) continue;
      const eff = getEffectiveEmployeeSchedule(emp, settings);
      const cutoffMins = parseTimeToMinutes(eff.shift_start) + eff.grace_minutes;
      if (nowMins > cutoffMins) {
        todayUnreported++;
      }
    }
  }

  const allAtts = await localDb.attendance.toArray();
  const missingCount = allAtts.filter((a) => a.checkout_missing === 1 && !a.checkout_time).length;
  const pendingCount = (await localDb.correction_requests.toArray()).filter(
    (r) => r.status === 'pending'
  ).length;

  return {
    today_unreported: todayUnreported,
    missing_checkouts_count: missingCount,
    pending_requests: pendingCount,
    total_alerts: todayUnreported + missingCount + pendingCount,
  };
}

export async function localApiRequest<T>(
  rawPath: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
  } = {}
): Promise<T> {
  await ensureLocalDbInitialized();
  const method = (options.method || 'GET').toUpperCase();
  const { pathname, searchParams } = parseUrlParts(rawPath);
  const body = (options.body && typeof options.body === 'object' ? options.body : {}) as Record<
    string,
    unknown
  >;
  const token = options.token;

  // ---------------- PUBLIC CONFIG ----------------
  if (method === 'GET' && pathname === '/api/public/config') {
    const settings = await getSettings();
    return {
      company_name: settings.company_name,
      logo_data_url: settings.logo_data_url,
      official_start_time: settings.official_start_time,
      grace_minutes: settings.grace_minutes,
      photo_requirement: settings.photo_requirement || 'both',
      server_time: getLocalTimeString(),
      server_date: getLocalDateString(),
      client_ip: '127.0.0.1',
    } as T;
  }

  // ---------------- AUTH ----------------
  if (method === 'POST' && pathname === '/api/auth/employee') {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      throw new LocalApiHttpError('Veuillez saisir un code valide à 6 chiffres.', 400);
    }

    const codeKey = `emp_code:${code}`;
    const lockRemaining = await getAttemptLockRemaining(codeKey);
    if (lockRemaining > 0) {
      throw new LocalApiHttpError(
        'Trop de tentatives incorrectes. Ce code est bloqué pendant 5 minutes.',
        429,
        lockRemaining
      );
    }

    const emp = await localDb.employees.where('code').equals(code).first();
    if (!emp || emp.is_active !== 1) {
      const res = await recordFailedAttempt(codeKey, LOCKOUT_MAX_ATTEMPTS);
      if (res.locked) {
        throw new LocalApiHttpError(
          'Trop de tentatives incorrectes. Veuillez patienter 5 minutes avant de réessayer.',
          429,
          300
        );
      }
      throw new LocalApiHttpError('Code invalide. Veuillez vérifier votre code à 6 chiffres.', 401);
    }

    await clearAttempts(codeKey);
    await runLocalAutoCloseMissingCheckouts();
    const settings = await getSettings();
    const today = getLocalDateString();
    const todayAttendance =
      (await localDb.attendance.where('[employee_id+work_date]').equals([emp.id!, today]).first()) ||
      null;
    const missingYesterday = await computeLocalYesterdayMissingPunch(emp, settings);
    const eff = getEffectiveEmployeeSchedule(emp, settings);

    const signed = signLocalToken({
      sub: emp.id!,
      type: 'employee',
      role: 'employee',
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });

    return {
      token: signed,
      employee: {
        id: emp.id!,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        shift_start: eff.shift_start,
        shift_end: eff.shift_end,
        grace_minutes: eff.grace_minutes,
      },
      today_attendance: todayAttendance,
      missing_yesterday: missingYesterday,
      photo_requirement: settings.photo_requirement || 'both',
    } as T;
  }

  if (method === 'POST' && pathname === '/api/auth/admin') {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      throw new LocalApiHttpError("Nom d'utilisateur et mot de passe requis.", 400);
    }

    const adminKey = `admin_user:${username.toLowerCase()}`;
    const lockRemaining = await getAttemptLockRemaining(adminKey);
    if (lockRemaining > 0) {
      throw new LocalApiHttpError(
        'Trop de tentatives de connexion. Veuillez patienter 5 minutes.',
        429,
        lockRemaining
      );
    }

    const admin = await localDb.admins.where('username').equals(username).first();
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      await recordFailedAttempt(adminKey, ADMIN_LOCKOUT_MAX);
      throw new LocalApiHttpError('Identifiants incorrects.', 401);
    }

    await clearAttempts(adminKey);
    const signed = signLocalToken({
      sub: admin.id!,
      type: 'admin',
      role: admin.role,
      exp: Date.now() + 8 * 60 * 60 * 1000,
    });

    return {
      token: signed,
      admin: {
        id: admin.id!,
        username: admin.username,
        role: admin.role,
        must_change_password: admin.must_change_password === 1,
      },
    } as T;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    return { ok: true } as T;
  }

  // ---------------- EMPLOYEE PORTAL ----------------
  if (method === 'GET' && pathname === '/api/employee/me') {
    const emp = await requireEmployeeAuth(token);
    await runLocalAutoCloseMissingCheckouts();
    const settings = await getSettings();
    const today = getLocalDateString();
    const todayAttendance =
      (await localDb.attendance.where('[employee_id+work_date]').equals([emp.id!, today]).first()) ||
      null;
    const missingYesterday = await computeLocalYesterdayMissingPunch(emp, settings);
    const eff = getEffectiveEmployeeSchedule(emp, settings);
    return {
      employee: {
        id: emp.id!,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        shift_start: eff.shift_start,
        shift_end: eff.shift_end,
        grace_minutes: eff.grace_minutes,
      },
      today_attendance: todayAttendance,
      missing_yesterday: missingYesterday,
      photo_requirement: settings.photo_requirement || 'both',
    } as T;
  }

  if (method === 'GET' && pathname === '/api/employee/history') {
    const emp = await requireEmployeeAuth(token);
    const rows = await localDb.attendance.where('employee_id').equals(emp.id!).toArray();
    rows.sort((a, b) => b.work_date.localeCompare(a.work_date));
    return { records: rows.slice(0, 30) } as T;
  }

  if (method === 'GET' && pathname === '/api/employee/correction-requests') {
    const emp = await requireEmployeeAuth(token);
    const rows = await localDb.correction_requests.where('employee_id').equals(emp.id!).toArray();
    rows.sort((a, b) => (b.id || 0) - (a.id || 0));
    return { requests: rows.slice(0, 30) } as T;
  }

  if (method === 'POST' && pathname === '/api/employee/correction-requests') {
    const emp = await requireEmployeeAuth(token);
    const workDate = typeof body.work_date === 'string' ? body.work_date.trim() : '';
    const punchType = body.punch_type === 'checkout' ? 'checkout' : body.punch_type === 'checkin' ? 'checkin' : '';
    const requestedTimeRaw = typeof body.requested_time === 'string' ? body.requested_time.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      throw new LocalApiHttpError('Date invalide (format AAAA-MM-JJ requis).', 400);
    }
    const todayStr = getLocalDateString();
    if (workDate > todayStr) {
      throw new LocalApiHttpError('Vous ne pouvez pas demander de correction pour une date future.', 400);
    }
    if (!punchType) {
      throw new LocalApiHttpError('Type de pointage invalide.', 400);
    }
    if (!isValidHHMM(requestedTimeRaw)) {
      throw new LocalApiHttpError('Heure invalide (format HH:MM requis).', 400);
    }
    if (reason.length < 3 || reason.length > 300) {
      throw new LocalApiHttpError('Veuillez indiquer une raison (entre 3 et 300 caractères).', 400);
    }

    const existingPending = (
      await localDb.correction_requests
        .where('[employee_id+work_date+punch_type]')
        .equals([emp.id!, workDate, punchType])
        .toArray()
    ).find((r) => r.status === 'pending');

    if (existingPending) {
      throw new LocalApiHttpError(
        'Une demande similaire est déjà en attente de validation pour cette date.',
        409
      );
    }

    const requestedTime = normalizeHHMM(requestedTimeRaw);
    const nowIso = getLocalDateTimeIso();
    const id = await localDb.correction_requests.add({
      employee_id: emp.id!,
      work_date: workDate,
      punch_type: punchType,
      requested_time: requestedTime,
      reason,
      status: 'pending',
      reviewed_by_admin_id: null,
      reviewed_by_username: null,
      review_note: null,
      reviewed_at: null,
      created_at: nowIso,
    });
    const created = await localDb.correction_requests.get(id);
    return {
      request: created,
      message: 'Votre demande de correction a été envoyée au responsable.',
    } as T;
  }

  if (method === 'POST' && pathname === '/api/employee/checkin') {
    return handleEmployeeCheckin(token, null);
  }

  if (method === 'POST' && pathname === '/api/employee/checkout') {
    return handleEmployeeCheckout(token, null);
  }

  // ---------------- ADMIN ----------------
  if (method === 'GET' && pathname === '/api/admin/me') {
    const admin = await requireAdminAuth(token);
    return {
      admin: {
        id: admin.id!,
        username: admin.username,
        role: admin.role,
        must_change_password: admin.must_change_password === 1,
      },
    } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/employees/list') {
    await requireAdminAuth(token);
    const emps = await localDb.employees.toArray();
    emps.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    return {
      employees: emps.map((e) => ({
        id: e.id!,
        first_name: e.first_name,
        last_name: e.last_name,
        job_title: e.job_title,
        is_active: e.is_active,
        shift_start: e.shift_start,
        shift_end: e.shift_end,
        grace_minutes: e.grace_minutes,
      })),
    } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/alerts') {
    await requireAdminAuth(token);
    return (await computeAlertsSummary()) as T;
  }

  if (method === 'GET' && pathname === '/api/admin/dashboard/today') {
    await requireAdminAuth(token);
    await runLocalAutoCloseMissingCheckouts();
    const settings = await getSettings();
    const rawDate = searchParams.get('date') || '';
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getLocalDateString();
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const isWorkingTargetDay = isDateExpectedWorkingDay(targetDate, settings);

    const activeEmployees = (await localDb.employees.toArray()).filter((e) => e.is_active === 1);
    activeEmployees.sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    );

    const dayAtts = await localDb.attendance.where('work_date').equals(targetDate).toArray();
    const attByEmp = new Map(dayAtts.map((a) => [a.employee_id, a]));

    let onTimeCount = 0;
    let lateCount = 0;
    let unreportedCount = 0;
    let missingCheckoutCount = 0;
    let absentCount = 0;

    const employees: TodayEmployeeRow[] = activeEmployees.map((emp) => {
      const att = attByEmp.get(emp.id!);
      const eff = getEffectiveEmployeeSchedule(emp, settings);
      const cutoffMins = parseTimeToMinutes(eff.shift_start) + eff.grace_minutes;

      let status: TodayEmployeeStatus = 'absent';
      if (att && att.checkin_time) {
        if (att.checkout_missing === 1 && !att.checkout_time) {
          status = 'missing_checkout';
          missingCheckoutCount++;
        } else if (att.is_late === 1) {
          status = 'late';
          lateCount++;
        } else {
          status = 'present';
          onTimeCount++;
        }
      } else if (targetDate === todayStr && isWorkingTargetDay && nowMins > cutoffMins) {
        status = 'unreported';
        unreportedCount++;
      } else {
        status = 'absent';
        absentCount++;
      }

      return {
        attendance_id: att?.id || null,
        employee_id: emp.id!,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        status,
        checkin_time: att?.checkin_time || null,
        checkout_time: att?.checkout_time || null,
        late_minutes: att?.late_minutes || 0,
        worked_minutes: att?.worked_minutes || 0,
        checkout_missing: att?.checkout_missing === 1,
        is_corrected: att?.is_corrected === 1,
        last_correction_reason: att?.last_correction_reason || null,
        shift_start: eff.shift_start,
        shift_end: eff.shift_end,
        grace_minutes: eff.grace_minutes,
        checkin_ip: att?.checkin_ip || null,
        checkout_ip: att?.checkout_ip || null,
        has_checkin_photo: Boolean(att?.checkin_photo_id),
        has_checkout_photo: Boolean(att?.checkout_photo_id),
        checkin_photo_id: att?.checkin_photo_id || null,
        checkout_photo_id: att?.checkout_photo_id || null,
      };
    });

    const alerts = await computeAlertsSummary();
    return {
      date: targetDate,
      summary: {
        total_active: activeEmployees.length,
        present_total: onTimeCount + lateCount + missingCheckoutCount,
        on_time: onTimeCount,
        late: lateCount,
        unreported: unreportedCount,
        missing_checkout: missingCheckoutCount,
        absent: absentCount,
        pending_requests: alerts.pending_requests,
      },
      alerts,
      employees,
    } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/dashboard/monthly') {
    await requireAdminAuth(token);
    await runLocalAutoCloseMissingCheckouts();
    const rawMonth = searchParams.get('month') || '';
    const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : getLocalDateString().slice(0, 7);
    const employeeIdParam = searchParams.get('employeeId') || '';
    const settings = await getSettings();

    let employees = await localDb.employees.toArray();
    if (/^\d+$/.test(employeeIdParam)) {
      employees = employees.filter((e) => e.id === Number(employeeIdParam));
    } else {
      employees = employees.filter((e) => e.is_active === 1);
    }
    employees.sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    );

    const prefix = `${month}-`;
    const attRows = (await localDb.attendance.toArray()).filter((a) =>
      a.work_date.startsWith(prefix)
    );
    const summaries = computeMonthlyEmployeeSummaries(month, employees, attRows, settings);
    return {
      month,
      rows: summaries.map(({ daily_rows: _drop, ...rest }) => rest),
    } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/attendance') {
    await requireAdminAuth(token);
    await runLocalAutoCloseMissingCheckouts();
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const employeeIdParam = searchParams.get('employeeId') || '';
    const status = searchParams.get('status') || 'all';

    const emps = await localDb.employees.toArray();
    const empMap = new Map(emps.map((e) => [e.id!, e]));

    let rows = await localDb.attendance.toArray();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      rows = rows.filter((r) => r.work_date >= from);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      rows = rows.filter((r) => r.work_date <= to);
    }
    if (/^\d+$/.test(employeeIdParam)) {
      const empId = Number(employeeIdParam);
      rows = rows.filter((r) => r.employee_id === empId);
    }
    if (status === 'late') {
      rows = rows.filter((r) => r.is_late === 1);
    } else if (status === 'on_time') {
      rows = rows.filter((r) => r.is_late === 0 && r.checkin_time !== null);
    } else if (status === 'missing_checkout') {
      rows = rows.filter((r) => r.checkout_missing === 1 || (Boolean(r.checkin_time) && !r.checkout_time));
    } else if (status === 'corrected') {
      rows = rows.filter((r) => r.is_corrected === 1);
    }

    rows.sort((a, b) => {
      const d = b.work_date.localeCompare(a.work_date);
      if (d !== 0) return d;
      const ea = empMap.get(a.employee_id);
      const eb = empMap.get(b.employee_id);
      return (ea?.last_name || '').localeCompare(eb?.last_name || '');
    });

    return {
      records: rows.slice(0, 500).map((r) => {
        const emp = empMap.get(r.employee_id);
        return {
          ...r,
          first_name: emp?.first_name || '',
          last_name: emp?.last_name || '',
          job_title: emp?.job_title || '',
          has_checkin_photo: r.checkin_photo_id ? 1 : 0,
          has_checkout_photo: r.checkout_photo_id ? 1 : 0,
        };
      }),
    } as T;
  }

  if (method === 'POST' && pathname === '/api/admin/attendance/manual') {
    const admin = await requireAdminAuth(token);
    const employeeId = Number(body.employee_id);
    const workDate = typeof body.work_date === 'string' ? body.work_date.trim() : '';
    const checkinRaw = typeof body.checkin_time === 'string' ? body.checkin_time.trim() : '';
    const checkoutRaw = typeof body.checkout_time === 'string' ? body.checkout_time.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new LocalApiHttpError('Veuillez sélectionner un employé.', 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      throw new LocalApiHttpError('Date invalide (format AAAA-MM-JJ requis).', 400);
    }
    if (!checkinRaw && !checkoutRaw) {
      throw new LocalApiHttpError("Veuillez saisir au moins une heure d'arrivée ou de départ.", 400);
    }
    if (checkinRaw && !isValidHHMM(checkinRaw)) {
      throw new LocalApiHttpError("Heure d'arrivée invalide (format HH:MM requis).", 400);
    }
    if (checkoutRaw && !isValidHHMM(checkoutRaw)) {
      throw new LocalApiHttpError('Heure de départ invalide (format HH:MM requis).', 400);
    }
    if (reason.length < 3 || reason.length > 300) {
      throw new LocalApiHttpError(
        'Un motif obligatoire est requis pour toute modification manuelle (3 à 300 caractères).',
        400
      );
    }

    const emp = await localDb.employees.get(employeeId);
    if (!emp) {
      throw new LocalApiHttpError('Employé introuvable.', 404);
    }

    const existing = await localDb.attendance
      .where('[employee_id+work_date]')
      .equals([employeeId, workDate])
      .first();

    const finalCheckin = checkinRaw
      ? normalizeHHMM(checkinRaw)
      : existing?.checkin_time || null;
    const finalCheckout = checkoutRaw
      ? normalizeHHMM(checkoutRaw)
      : existing?.checkout_time || null;

    if (!finalCheckin && finalCheckout) {
      throw new LocalApiHttpError(
        "Impossible d'enregistrer une heure de départ sans heure d'arrivée.",
        400
      );
    }
    if (
      finalCheckin &&
      finalCheckout &&
      parseTimeToMinutes(finalCheckout) < parseTimeToMinutes(finalCheckin)
    ) {
      throw new LocalApiHttpError(
        "L'heure de départ doit être postérieure à l'heure d'arrivée.",
        400
      );
    }

    const settings = await getSettings();
    const eff = getEffectiveEmployeeSchedule(emp, settings);
    const lateness = finalCheckin
      ? computeCheckinLateness(finalCheckin, eff.shift_start, eff.grace_minutes)
      : { isLate: 0, lateMinutes: 0 };
    const workedMinutes = computeWorkedMinutes(finalCheckin, finalCheckout);
    const checkoutMissing = finalCheckout ? 0 : existing?.checkout_missing ?? 0;

    const oldSnapshot = formatAttendanceSnapshot(existing);
    const empName = `${emp.first_name} ${emp.last_name}`.trim();
    const nowIso = getLocalDateTimeIso();

    let attendanceId: number;
    let actionType: 'manual_add' | 'manual_edit';

    if (existing?.id) {
      actionType = 'manual_edit';
      attendanceId = existing.id;
      await localDb.attendance.update(existing.id, {
        checkin_time: finalCheckin,
        checkout_time: finalCheckout,
        is_late: lateness.isLate,
        late_minutes: lateness.lateMinutes,
        worked_minutes: workedMinutes,
        checkout_missing: checkoutMissing,
        auto_closed_at: finalCheckout ? null : existing.auto_closed_at,
        is_corrected: 1,
        last_correction_reason: reason,
      });
    } else {
      actionType = 'manual_add';
      attendanceId = await localDb.attendance.add({
        employee_id: employeeId,
        work_date: workDate,
        checkin_time: finalCheckin,
        checkout_time: finalCheckout,
        checkin_ip: 'Manuel',
        checkout_ip: finalCheckout ? 'Manuel' : null,
        checkin_photo_id: null,
        checkout_photo_id: null,
        is_late: lateness.isLate,
        late_minutes: lateness.lateMinutes,
        worked_minutes: workedMinutes,
        checkout_missing: checkoutMissing,
        auto_closed_at: null,
        is_corrected: 1,
        last_correction_reason: reason,
        created_at: nowIso,
      });
    }

    const updated = await localDb.attendance.get(attendanceId);
    const newSnapshot = formatAttendanceSnapshot(updated);
    await writeLocalCorrectionLog({
      attendanceId,
      employeeId,
      employeeName: empName,
      workDate,
      actionType,
      actorAdminId: admin.id!,
      actorUsername: admin.username,
      oldValue: oldSnapshot,
      newValue: newSnapshot,
      reason,
      createdAt: nowIso,
    });

    return {
      attendance: updated,
      message: `Pointage ${actionType === 'manual_add' ? 'ajouté' : 'modifié'} avec succès.`,
    } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/correction-requests') {
    await requireAdminAuth(token);
    const status = searchParams.get('status') || 'all';
    let reqs = await localDb.correction_requests.toArray();
    if (status === 'pending' || status === 'approved' || status === 'rejected') {
      reqs = reqs.filter((r) => r.status === status);
    }
    const emps = await localDb.employees.toArray();
    const empMap = new Map(emps.map((e) => [e.id!, e]));
    const atts = await localDb.attendance.toArray();
    const attMap = new Map(atts.map((a) => [`${a.employee_id}:${a.work_date}`, a]));

    reqs.sort((a, b) => {
      const pa = a.status === 'pending' ? 0 : 1;
      const pb = b.status === 'pending' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.id || 0) - (a.id || 0);
    });

    return {
      requests: reqs.slice(0, 200).map((r) => {
        const emp = empMap.get(r.employee_id);
        const att = attMap.get(`${r.employee_id}:${r.work_date}`);
        return {
          ...r,
          first_name: emp?.first_name || '',
          last_name: emp?.last_name || '',
          job_title: emp?.job_title || '',
          attendance_id: att?.id || null,
          current_checkin_time: att?.checkin_time || null,
          current_checkout_time: att?.checkout_time || null,
          current_checkout_missing: att?.checkout_missing ?? null,
        };
      }),
    } as T;
  }

  const approveMatch = /^\/api\/admin\/correction-requests\/(\d+)\/approve$/.exec(pathname);
  if (method === 'POST' && approveMatch) {
    const admin = await requireAdminAuth(token);
    const reqId = Number(approveMatch[1]);
    const correctionReq = await localDb.correction_requests.get(reqId);
    if (!correctionReq) {
      throw new LocalApiHttpError('Demande introuvable.', 404);
    }
    if (correctionReq.status !== 'pending') {
      throw new LocalApiHttpError('Cette demande a déjà été traitée.', 409);
    }

    const emp = await localDb.employees.get(correctionReq.employee_id);
    if (!emp) {
      throw new LocalApiHttpError('Employé associé introuvable.', 404);
    }

    const overrideTimeRaw =
      typeof body.override_time === 'string' && body.override_time.trim()
        ? body.override_time.trim()
        : correctionReq.requested_time.slice(0, 5);
    if (!isValidHHMM(overrideTimeRaw)) {
      throw new LocalApiHttpError('Heure corrigée invalide (format HH:MM requis).', 400);
    }
    const finalTime = normalizeHHMM(overrideTimeRaw);
    const reviewNote = typeof body.review_note === 'string' ? body.review_note.trim().slice(0, 300) : '';

    const existingAtt = await localDb.attendance
      .where('[employee_id+work_date]')
      .equals([correctionReq.employee_id, correctionReq.work_date])
      .first();

    const finalCheckin =
      correctionReq.punch_type === 'checkin' ? finalTime : existingAtt?.checkin_time || null;
    const finalCheckout =
      correctionReq.punch_type === 'checkout' ? finalTime : existingAtt?.checkout_time || null;

    if (!finalCheckin && finalCheckout) {
      throw new LocalApiHttpError(
        "Impossible d'approuver un départ sans heure d'arrivée enregistrée.",
        400
      );
    }
    if (
      finalCheckin &&
      finalCheckout &&
      parseTimeToMinutes(finalCheckout) < parseTimeToMinutes(finalCheckin)
    ) {
      throw new LocalApiHttpError(
        "L'heure de départ ne peut pas être antérieure à l'heure d'arrivée.",
        400
      );
    }

    const settings = await getSettings();
    const eff = getEffectiveEmployeeSchedule(emp, settings);
    const lateness = finalCheckin
      ? computeCheckinLateness(finalCheckin, eff.shift_start, eff.grace_minutes)
      : { isLate: 0, lateMinutes: 0 };
    const workedMinutes = computeWorkedMinutes(finalCheckin, finalCheckout);
    const nowIso = getLocalDateTimeIso();
    const reasonText = reviewNote ? `${correctionReq.reason} (${reviewNote})` : correctionReq.reason;
    const oldSnapshot = formatAttendanceSnapshot(existingAtt);

    let attendanceId: number;
    if (existingAtt?.id) {
      attendanceId = existingAtt.id;
      await localDb.attendance.update(existingAtt.id, {
        checkin_time: finalCheckin,
        checkout_time: finalCheckout,
        is_late: lateness.isLate,
        late_minutes: lateness.lateMinutes,
        worked_minutes: workedMinutes,
        checkout_missing: finalCheckout ? 0 : existingAtt.checkout_missing,
        auto_closed_at: finalCheckout ? null : existingAtt.auto_closed_at,
        is_corrected: 1,
        last_correction_reason: reasonText,
      });
    } else {
      attendanceId = await localDb.attendance.add({
        employee_id: correctionReq.employee_id,
        work_date: correctionReq.work_date,
        checkin_time: finalCheckin,
        checkout_time: finalCheckout,
        checkin_ip: 'Corrigé',
        checkout_ip: finalCheckout ? 'Corrigé' : null,
        checkin_photo_id: null,
        checkout_photo_id: null,
        is_late: lateness.isLate,
        late_minutes: lateness.lateMinutes,
        worked_minutes: workedMinutes,
        checkout_missing: 0,
        auto_closed_at: null,
        is_corrected: 1,
        last_correction_reason: reasonText,
        created_at: nowIso,
      });
    }

    await localDb.correction_requests.update(reqId, {
      status: 'approved',
      reviewed_by_admin_id: admin.id!,
      reviewed_by_username: admin.username,
      review_note: reviewNote || null,
      reviewed_at: nowIso,
    });

    const updatedAtt = await localDb.attendance.get(attendanceId);
    const newSnapshot = formatAttendanceSnapshot(updatedAtt);
    await writeLocalCorrectionLog({
      attendanceId,
      employeeId: correctionReq.employee_id,
      employeeName: `${emp.first_name} ${emp.last_name}`.trim(),
      workDate: correctionReq.work_date,
      actionType: 'request_approved',
      actorAdminId: admin.id!,
      actorUsername: admin.username,
      oldValue: oldSnapshot,
      newValue: newSnapshot,
      reason: reasonText,
      createdAt: nowIso,
    });

    return {
      ok: true,
      message: 'Demande approuvée et pointage mis à jour.',
    } as T;
  }

  const rejectMatch = /^\/api\/admin\/correction-requests\/(\d+)\/reject$/.exec(pathname);
  if (method === 'POST' && rejectMatch) {
    const admin = await requireAdminAuth(token);
    const reqId = Number(rejectMatch[1]);
    const correctionReq = await localDb.correction_requests.get(reqId);
    if (!correctionReq) {
      throw new LocalApiHttpError('Demande introuvable.', 404);
    }
    if (correctionReq.status !== 'pending') {
      throw new LocalApiHttpError('Cette demande a déjà été traitée.', 409);
    }

    const reviewNote = typeof body.review_note === 'string' ? body.review_note.trim() : '';
    if (reviewNote.length < 3 || reviewNote.length > 300) {
      throw new LocalApiHttpError('Veuillez indiquer un motif de refus (3 à 300 caractères).', 400);
    }

    const emp = await localDb.employees.get(correctionReq.employee_id);
    const empName = emp ? `${emp.first_name} ${emp.last_name}`.trim() : `Employé #${correctionReq.employee_id}`;
    const existingAtt = await localDb.attendance
      .where('[employee_id+work_date]')
      .equals([correctionReq.employee_id, correctionReq.work_date])
      .first();
    const nowIso = getLocalDateTimeIso();

    await localDb.correction_requests.update(reqId, {
      status: 'rejected',
      reviewed_by_admin_id: admin.id!,
      reviewed_by_username: admin.username,
      review_note: reviewNote,
      reviewed_at: nowIso,
    });

    await writeLocalCorrectionLog({
      attendanceId: existingAtt?.id || null,
      employeeId: correctionReq.employee_id,
      employeeName: empName,
      workDate: correctionReq.work_date,
      actionType: 'request_rejected',
      actorAdminId: admin.id!,
      actorUsername: admin.username,
      oldValue: `Demande ${correctionReq.punch_type === 'checkin' ? 'arrivée' : 'départ'} ${correctionReq.requested_time.slice(0, 5)}`,
      newValue: 'Demande refusée',
      reason: reviewNote,
      createdAt: nowIso,
    });

    return { ok: true, message: 'Demande refusée.' } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/correction-logs') {
    await requireAdminAuth(token);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const empId = searchParams.get('employeeId') || '';
    const actionType = searchParams.get('actionType') || '';

    let logs = await localDb.correction_logs.toArray();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) logs = logs.filter((l) => l.work_date >= from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) logs = logs.filter((l) => l.work_date <= to);
    if (/^\d+$/.test(empId)) logs = logs.filter((l) => l.employee_id === Number(empId));
    if (actionType && actionType !== 'all') {
      logs = logs.filter((l) => l.action_type === actionType);
    }
    logs.sort((a, b) => (b.id || 0) - (a.id || 0));
    return { logs: logs.slice(0, 500) } as T;
  }

  // ---------------- PHOTO CALENDAR & DAY ----------------
  if (method === 'GET' && pathname === '/api/admin/photos/calendar') {
    await requireAdminAuth(token);
    const rawMonth = searchParams.get('month') || '';
    const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : getLocalDateString().slice(0, 7);
    const employeeIdParam = searchParams.get('employeeId') || '';
    const settings = await getSettings();

    const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
    const holidays = parsePublicHolidays(settings.public_holidays);
    const holidayMap = new Map(holidays.map((h) => [h.date, h]));

    const [yearNum, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const todayStr = getLocalDateString();
    const weekdayLetters = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

    const days: PhotoCalendarDay[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dow = new Date(yearNum, monthNum - 1, day).getDay();
      const hol = holidayMap.get(dateStr);
      days.push({
        day,
        date: dateStr,
        weekdayIndex: dow,
        weekdayLetter: weekdayLetters[dow] || '',
        isWeekend: !workingDaysSet.has(dow),
        holidayType: hol ? hol.type : null,
        holidayLabel: hol ? hol.label : '',
        isFuture: dateStr > todayStr,
      });
    }

    let employees = await localDb.employees.toArray();
    if (/^\d+$/.test(employeeIdParam)) {
      employees = employees.filter((e) => e.id === Number(employeeIdParam));
    } else {
      employees = employees.filter((e) => e.is_active === 1);
    }
    employees.sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    );

    const monthPrefix = `${month}-`;
    const attRows = (await localDb.attendance.toArray()).filter((a) =>
      a.work_date.startsWith(monthPrefix)
    );
    const attMap = new Map(attRows.map((a) => [`${a.employee_id}:${a.work_date}`, a]));

    const employeeRows = employees.map((emp) => {
      const cells: Record<string, PhotoCalendarCell> = {};
      for (const d of days) {
        const att = attMap.get(`${emp.id}:${d.date}`);
        let status: CalendarCellStatus;
        if (att && att.checkin_time) {
          status = att.is_late === 1 ? 'late' : 'present';
        } else if (d.holidayType === 'holiday') {
          status = 'holiday';
        } else if (d.holidayType === 'leave') {
          status = 'leave';
        } else if (d.isWeekend) {
          status = 'weekend';
        } else if (d.isFuture) {
          status = 'future';
        } else {
          status = 'absent';
        }
        cells[d.date] = {
          attendance_id: att?.id || null,
          status,
          checkin_time: att?.checkin_time || null,
          checkout_time: att?.checkout_time || null,
          is_late: att?.is_late === 1,
          late_minutes: att?.late_minutes || 0,
          worked_minutes: att?.worked_minutes || 0,
          checkin_ip: att?.checkin_ip || null,
          checkout_ip: att?.checkout_ip || null,
          checkin_photo_id: att?.checkin_photo_id || null,
          checkout_photo_id: att?.checkout_photo_id || null,
          holiday_label: d.holidayLabel,
        };
      }
      return {
        employee_id: emp.id!,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        is_active: emp.is_active === 1,
        cells,
      };
    });

    return { month, days, employees: employeeRows } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/photos/day') {
    await requireAdminAuth(token);
    const rawDate = searchParams.get('date') || '';
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getLocalDateString();
    const employeeIdParam = searchParams.get('employeeId') || '';
    const settings = await getSettings();

    const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
    const holidays = parsePublicHolidays(settings.public_holidays);
    const hol = holidays.find((h) => h.date === targetDate);
    const [y, m, d] = targetDate.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const isWeekend = !workingDaysSet.has(dow);
    const isFuture = targetDate > getLocalDateString();

    let employees = await localDb.employees.toArray();
    if (/^\d+$/.test(employeeIdParam)) {
      employees = employees.filter((e) => e.id === Number(employeeIdParam));
    } else {
      employees = employees.filter((e) => e.is_active === 1);
    }
    employees.sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    );

    const dayAtts = await localDb.attendance.where('work_date').equals(targetDate).toArray();
    const attByEmp = new Map(dayAtts.map((a) => [a.employee_id, a]));

    const cards: PhotoDayCard[] = employees.map((emp) => {
      const att = attByEmp.get(emp.id!);
      let status: CalendarCellStatus;
      if (att && att.checkin_time) {
        status = att.is_late === 1 ? 'late' : 'present';
      } else if (hol?.type === 'holiday') {
        status = 'holiday';
      } else if (hol?.type === 'leave') {
        status = 'leave';
      } else if (isWeekend) {
        status = 'weekend';
      } else if (isFuture) {
        status = 'future';
      } else {
        status = 'absent';
      }
      return {
        employee_id: emp.id!,
        first_name: emp.first_name,
        last_name: emp.last_name,
        job_title: emp.job_title,
        attendance_id: att?.id || null,
        status,
        checkin_time: att?.checkin_time || null,
        checkout_time: att?.checkout_time || null,
        is_late: att?.is_late === 1,
        late_minutes: att?.late_minutes || 0,
        worked_minutes: att?.worked_minutes || 0,
        checkin_ip: att?.checkin_ip || null,
        checkout_ip: att?.checkout_ip || null,
        checkin_photo_id: att?.checkin_photo_id || null,
        checkout_photo_id: att?.checkout_photo_id || null,
        holiday_label: hol?.label || '',
      };
    });

    return { date: targetDate, cards } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/logs') {
    await requireAdminAuth(token);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const empId = searchParams.get('employeeId') || '';

    let logs = await localDb.attendance_logs.toArray();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) logs = logs.filter((l) => l.log_date >= from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) logs = logs.filter((l) => l.log_date <= to);
    if (/^\d+$/.test(empId)) logs = logs.filter((l) => l.employee_id === Number(empId));

    logs.sort((a, b) => (b.id || 0) - (a.id || 0));
    return { logs: logs.slice(0, 500) } as T;
  }

  if (method === 'GET' && pathname === '/api/admin/network-info') {
    await requireAdminAuth(token);
    const settings = await getSettings();
    const dataPath = await getElectronOrLocalDataPath();
    return {
      company_name: settings.company_name,
      allowed_network_prefix: settings.allowed_network_prefix || '',
      port: 0,
      lan_ips: [],
      primary_ip: 'localhost',
      local_url: 'Mode hors ligne (application Windows)',
      phone_urls: [],
      primary_phone_url: 'Mode bureau hors ligne',
      client_ip: '127.0.0.1',
      data_dir: dataPath,
      is_electron: Boolean(window.electronAPI?.isElectron),
    } as T;
  }

  // ---------------- SUPER ADMIN: EMPLOYEES ----------------
  if (method === 'GET' && pathname === '/api/super/employees') {
    await requireSuperAdminAuth(token);
    const emps = await localDb.employees.toArray();
    emps.sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    );
    return { employees: emps } as T;
  }

  if (method === 'POST' && pathname === '/api/super/employees') {
    await requireSuperAdminAuth(token);
    const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : '';
    const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : '';
    const jobTitle = typeof body.job_title === 'string' ? body.job_title.trim() : '';
    const shiftStart =
      typeof body.shift_start === 'string' && body.shift_start.trim() ? body.shift_start.trim() : null;
    const shiftEnd =
      typeof body.shift_end === 'string' && body.shift_end.trim() ? body.shift_end.trim() : null;
    const graceRaw = body.grace_minutes;
    const customGrace =
      graceRaw === null || graceRaw === undefined || graceRaw === '' ? null : Number(graceRaw);

    if (!firstName || !lastName) {
      throw new LocalApiHttpError('Le prénom et le nom sont obligatoires.', 400);
    }
    if (shiftStart && !isValidHHMM(shiftStart)) {
      throw new LocalApiHttpError("Heure d'arrivée prévue invalide (format HH:MM).", 400);
    }
    if (shiftEnd && !isValidHHMM(shiftEnd)) {
      throw new LocalApiHttpError('Heure de départ prévue invalide (format HH:MM).', 400);
    }
    if (customGrace !== null && (!Number.isInteger(customGrace) || customGrace < 0 || customGrace > 240)) {
      throw new LocalApiHttpError('Tolérance personnalisée invalide (0 à 240 min).', 400);
    }

    const code = await generateUniqueLocalEmployeeCode();
    const now = getLocalDateTimeIso();
    const id = await localDb.employees.add({
      first_name: firstName,
      last_name: lastName,
      job_title: jobTitle,
      code,
      is_active: 1,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      grace_minutes: customGrace,
      created_at: now,
    });
    const created = await localDb.employees.get(id);
    return { employee: created } as T;
  }

  const empPutMatch = /^\/api\/super\/employees\/(\d+)$/.exec(pathname);
  if (method === 'PUT' && empPutMatch) {
    await requireSuperAdminAuth(token);
    const id = Number(empPutMatch[1]);
    const existing = await localDb.employees.get(id);
    if (!existing) throw new LocalApiHttpError('Employé introuvable.', 404);

    const firstName =
      typeof body.first_name === 'string' ? body.first_name.trim() : existing.first_name;
    const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : existing.last_name;
    const jobTitle = typeof body.job_title === 'string' ? body.job_title.trim() : existing.job_title;
    const isActive =
      typeof body.is_active === 'boolean'
        ? body.is_active
          ? 1
          : 0
        : typeof body.is_active === 'number'
        ? body.is_active
          ? 1
          : 0
        : existing.is_active;

    const shiftStart =
      body.shift_start === undefined
        ? existing.shift_start
        : typeof body.shift_start === 'string' && body.shift_start.trim()
        ? body.shift_start.trim()
        : null;
    const shiftEnd =
      body.shift_end === undefined
        ? existing.shift_end
        : typeof body.shift_end === 'string' && body.shift_end.trim()
        ? body.shift_end.trim()
        : null;
    let customGrace: number | null = existing.grace_minutes;
    if (body.grace_minutes !== undefined) {
      customGrace =
        body.grace_minutes === null || body.grace_minutes === ''
          ? null
          : Number(body.grace_minutes);
    }

    if (!firstName || !lastName) {
      throw new LocalApiHttpError('Le prénom et le nom sont obligatoires.', 400);
    }
    if (shiftStart && !isValidHHMM(shiftStart)) {
      throw new LocalApiHttpError("Heure d'arrivée prévue invalide (format HH:MM).", 400);
    }
    if (shiftEnd && !isValidHHMM(shiftEnd)) {
      throw new LocalApiHttpError('Heure de départ prévue invalide (format HH:MM).', 400);
    }
    if (customGrace !== null && (!Number.isInteger(customGrace) || customGrace < 0 || customGrace > 240)) {
      throw new LocalApiHttpError('Tolérance personnalisée invalide (0 à 240 min).', 400);
    }

    await localDb.employees.update(id, {
      first_name: firstName,
      last_name: lastName,
      job_title: jobTitle,
      is_active: isActive,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      grace_minutes: customGrace,
    });
    const updated = await localDb.employees.get(id);
    return { employee: updated } as T;
  }

  const empRegenMatch = /^\/api\/super\/employees\/(\d+)\/regenerate-code$/.exec(pathname);
  if (method === 'POST' && empRegenMatch) {
    await requireSuperAdminAuth(token);
    const id = Number(empRegenMatch[1]);
    const existing = await localDb.employees.get(id);
    if (!existing) throw new LocalApiHttpError('Employé introuvable.', 404);
    const newCode = await generateUniqueLocalEmployeeCode();
    await localDb.employees.update(id, { code: newCode });
    const updated = await localDb.employees.get(id);
    return { employee: updated } as T;
  }

  const empDelMatch = /^\/api\/super\/employees\/(\d+)$/.exec(pathname);
  if (method === 'DELETE' && empDelMatch) {
    await requireSuperAdminAuth(token);
    const id = Number(empDelMatch[1]);
    const existing = await localDb.employees.get(id);
    if (!existing) throw new LocalApiHttpError('Employé introuvable.', 404);
    await localDb.employees.delete(id);
    await localDb.attendance.where('employee_id').equals(id).delete();
    await localDb.photos.where('employee_id').equals(id).delete();
    await localDb.correction_requests.where('employee_id').equals(id).delete();
    return { ok: true } as T;
  }

  // ---------------- SUPER ADMIN: ADMINS ----------------
  if (method === 'GET' && pathname === '/api/super/admins') {
    await requireSuperAdminAuth(token);
    const admins = await localDb.admins.toArray();
    admins.sort((a, b) => (a.id || 0) - (b.id || 0));
    return {
      admins: admins.map((a) => ({
        id: a.id!,
        username: a.username,
        role: a.role,
        must_change_password: a.must_change_password,
        created_at: a.created_at,
      })),
    } as T;
  }

  if (method === 'POST' && pathname === '/api/super/admins') {
    await requireSuperAdminAuth(token);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || username.length < 3) {
      throw new LocalApiHttpError("Le nom d'utilisateur doit contenir au moins 3 caractères.", 400);
    }
    if (!password || password.length < 6) {
      throw new LocalApiHttpError('Le mot de passe doit contenir au moins 6 caractères.', 400);
    }
    const existing = await localDb.admins.where('username').equals(username).first();
    if (existing) {
      throw new LocalApiHttpError("Ce nom d'utilisateur existe déjà.", 409);
    }
    const hash = bcrypt.hashSync(password, 10);
    const id = await localDb.admins.add({
      username,
      password_hash: hash,
      role: 'admin',
      must_change_password: 0,
      created_at: getLocalDateTimeIso(),
    });
    const created = await localDb.admins.get(id);
    return {
      admin: {
        id: created!.id!,
        username: created!.username,
        role: created!.role,
        created_at: created!.created_at,
      },
    } as T;
  }

  const adminPwMatch = /^\/api\/super\/admins\/(\d+)\/password$/.exec(pathname);
  if (method === 'PUT' && adminPwMatch) {
    await requireSuperAdminAuth(token);
    const id = Number(adminPwMatch[1]);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length < 6) {
      throw new LocalApiHttpError('Le mot de passe doit contenir au moins 6 caractères.', 400);
    }
    const target = await localDb.admins.get(id);
    if (!target) throw new LocalApiHttpError('Administrateur introuvable.', 404);
    await localDb.admins.update(id, {
      password_hash: bcrypt.hashSync(password, 10),
      must_change_password: 0,
    });
    return { ok: true } as T;
  }

  const adminDelMatch = /^\/api\/super\/admins\/(\d+)$/.exec(pathname);
  if (method === 'DELETE' && adminDelMatch) {
    const currentAdmin = await requireSuperAdminAuth(token);
    const id = Number(adminDelMatch[1]);
    if (id === currentAdmin.id) {
      throw new LocalApiHttpError('Vous ne pouvez pas supprimer votre propre compte.', 400);
    }
    const target = await localDb.admins.get(id);
    if (!target) throw new LocalApiHttpError('Administrateur introuvable.', 404);
    if (target.role === 'super_admin') {
      throw new LocalApiHttpError('Impossible de supprimer le compte super administrateur.', 400);
    }
    await localDb.admins.delete(id);
    return { ok: true } as T;
  }

  if (method === 'POST' && pathname === '/api/super/change-password') {
    const admin = await requireSuperAdminAuth(token);
    const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
    const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      throw new LocalApiHttpError('Le nouveau mot de passe doit contenir au moins 6 caractères.', 400);
    }
    if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
      throw new LocalApiHttpError('Mot de passe actuel incorrect.', 400);
    }
    await localDb.admins.update(admin.id!, {
      password_hash: bcrypt.hashSync(newPassword, 10),
      must_change_password: 0,
    });
    return { ok: true } as T;
  }

  // ---------------- SUPER ADMIN: SETTINGS & DESKTOP ----------------
  if (method === 'GET' && pathname === '/api/super/settings') {
    await requireSuperAdminAuth(token);
    const settings = await getSettings();
    return {
      settings: {
        ...settings,
        working_days: parseWorkingDays(settings.working_days),
        public_holidays: parsePublicHolidays(settings.public_holidays),
        photo_requirement: settings.photo_requirement || 'both',
        photo_retention_days: settings.photo_retention_days ?? 90,
        auto_close_time: settings.auto_close_time || '23:59',
      },
      lan_ips: [],
      client_ip: '127.0.0.1',
    } as T;
  }

  if (method === 'PUT' && pathname === '/api/super/settings') {
    await requireSuperAdminAuth(token);
    const current = await getSettings();
    const companyName =
      typeof body.company_name === 'string' && body.company_name.trim()
        ? body.company_name.trim()
        : current.company_name;
    const officialStartTime =
      typeof body.official_start_time === 'string' &&
      /^([01]\d|2[0-3]):([0-5]\d)$/.test(body.official_start_time.trim())
        ? body.official_start_time.trim()
        : current.official_start_time;
    const graceMinutes =
      typeof body.grace_minutes === 'number' &&
      Number.isInteger(body.grace_minutes) &&
      body.grace_minutes >= 0 &&
      body.grace_minutes <= 180
        ? body.grace_minutes
        : current.grace_minutes;
    const allowedNetworkPrefix =
      typeof body.allowed_network_prefix === 'string'
        ? body.allowed_network_prefix.trim()
        : current.allowed_network_prefix;

    let workingDaysJson = current.working_days || '[0,1,2,3,4]';
    if (Array.isArray(body.working_days)) {
      const validDays = body.working_days
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      if (validDays.length === 0) {
        throw new LocalApiHttpError('Veuillez sélectionner au moins un jour travaillé par semaine.', 400);
      }
      workingDaysJson = JSON.stringify(Array.from(new Set(validDays)).sort());
    }

    let publicHolidaysJson = current.public_holidays || '[]';
    if (Array.isArray(body.public_holidays)) {
      const cleaned: PublicHolidayEntry[] = [];
      const seenDates = new Set<string>();
      for (const item of body.public_holidays) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as PublicHolidayEntry).date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test((item as PublicHolidayEntry).date)
        ) {
          const entry = item as PublicHolidayEntry;
          if (!seenDates.has(entry.date)) {
            seenDates.add(entry.date);
            cleaned.push({
              date: entry.date,
              type: entry.type === 'leave' ? 'leave' : 'holiday',
              label: typeof entry.label === 'string' ? entry.label.trim().slice(0, 80) : '',
            });
          }
        }
      }
      cleaned.sort((a, b) => a.date.localeCompare(b.date));
      publicHolidaysJson = JSON.stringify(cleaned);
    }

    let photoRequirement: PhotoRequirement = current.photo_requirement || 'both';
    if (
      body.photo_requirement === 'none' ||
      body.photo_requirement === 'checkin_only' ||
      body.photo_requirement === 'both'
    ) {
      photoRequirement = body.photo_requirement;
    }

    let photoRetentionDays = current.photo_retention_days ?? 90;
    if (body.photo_retention_days !== undefined) {
      const parsed = Number(body.photo_retention_days);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
        throw new LocalApiHttpError(
          'La durée de conservation des photos doit être comprise entre 1 et 3650 jours.',
          400
        );
      }
      photoRetentionDays = parsed;
    }

    let autoCloseTime = current.auto_close_time || '23:59';
    if (body.auto_close_time !== undefined) {
      if (!isValidHHMM(body.auto_close_time)) {
        throw new LocalApiHttpError(
          "L'heure de clôture automatique doit être au format HH:MM (ex: 23:59).",
          400
        );
      }
      autoCloseTime = String(body.auto_close_time).trim();
    }

    let logoDataUrl = current.logo_data_url;
    if (body.logo_data_url === null || body.logo_data_url === '') {
      logoDataUrl = null;
    } else if (body.logo_data_url !== undefined) {
      if (!isValidLogoDataUrl(body.logo_data_url)) {
        throw new LocalApiHttpError(
          'Format de logo invalide (PNG, JPG ou WebP max 500 Ko).',
          400
        );
      }
      logoDataUrl = body.logo_data_url;
    }

    await localDb.settings.update(1, {
      company_name: companyName,
      logo_data_url: logoDataUrl,
      official_start_time: officialStartTime,
      grace_minutes: graceMinutes,
      allowed_network_prefix: allowedNetworkPrefix,
      working_days: workingDaysJson,
      public_holidays: publicHolidaysJson,
      photo_requirement: photoRequirement,
      photo_retention_days: photoRetentionDays,
      auto_close_time: autoCloseTime,
      updated_at: getLocalDateTimeIso(),
    });

    await cleanupLocalOldPhotos(photoRetentionDays);
    const updated = await getSettings();
    return {
      settings: {
        ...updated,
        working_days: parseWorkingDays(updated.working_days),
        public_holidays: parsePublicHolidays(updated.public_holidays),
      },
    } as T;
  }

  if (method === 'GET' && pathname === '/api/super/desktop') {
    await requireSuperAdminAuth(token);
    const dataPath = await getElectronOrLocalDataPath();
    return {
      is_electron: Boolean(window.electronAPI?.isElectron),
      data_dir: dataPath,
      db_path: `${dataPath} (IndexedDB local)`,
      photos_dir: `${dataPath} (IndexedDB local)`,
      config_path: dataPath,
      open_at_login: false,
      start_minimized: false,
    } as T;
  }

  if (method === 'PUT' && pathname === '/api/super/desktop') {
    await requireSuperAdminAuth(token);
    return {
      open_at_login: Boolean(body.open_at_login),
      start_minimized: Boolean(body.start_minimized),
    } as T;
  }

  if (method === 'POST' && pathname === '/api/super/open-data-folder') {
    await requireSuperAdminAuth(token);
    const dataPath = await getElectronOrLocalDataPath();
    const ok = window.electronAPI?.openDataFolder
      ? await window.electronAPI.openDataFolder()
      : false;
    return {
      ok,
      data_dir: dataPath,
      message: ok ? 'Dossier des données ouvert.' : `Dossier des données : ${dataPath}`,
    } as T;
  }

  throw new LocalApiHttpError(`Route locale introuvable : ${method} ${pathname}`, 404);
}

async function getElectronOrLocalDataPath(): Promise<string> {
  if (window.electronAPI?.getDataPath) {
    try {
      return await window.electronAPI.getDataPath();
    } catch {
      // fallback
    }
  }
  return 'Stockage local du navigateur (IndexedDB)';
}

async function handleEmployeeCheckin<T>(
  token: string | null | undefined,
  photoFile: File | Blob | null
): Promise<T> {
  const emp = await requireEmployeeAuth(token);
  const settings = await getSettings();
  const photoReq = settings.photo_requirement || 'both';
  if ((photoReq === 'checkin_only' || photoReq === 'both') && !photoFile) {
    throw new LocalApiHttpError(
      "La photo d'arrivée est obligatoire. Veuillez prendre une photo avant d'envoyer.",
      400
    );
  }

  const now = new Date();
  const today = getLocalDateString(now);
  const nowTime = getLocalTimeString(now);
  const nowIso = getLocalDateTimeIso(now);

  const existing = await localDb.attendance
    .where('[employee_id+work_date]')
    .equals([emp.id!, today])
    .first();
  if (existing && existing.checkin_time) {
    throw new LocalApiHttpError("Vous avez déjà pointé votre arrivée aujourd'hui.", 409);
  }

  const eff = getEffectiveEmployeeSchedule(emp, settings);
  const { isLate, lateMinutes } = computeCheckinLateness(nowTime, eff.shift_start, eff.grace_minutes);

  let attendanceId: number;
  if (existing?.id) {
    attendanceId = existing.id;
    await localDb.attendance.update(existing.id, {
      checkin_time: nowTime,
      checkin_ip: 'Local',
      is_late: isLate,
      late_minutes: lateMinutes,
    });
  } else {
    attendanceId = await localDb.attendance.add({
      employee_id: emp.id!,
      work_date: today,
      checkin_time: nowTime,
      checkout_time: null,
      checkin_ip: 'Local',
      checkout_ip: null,
      checkin_photo_id: null,
      checkout_photo_id: null,
      is_late: isLate,
      late_minutes: lateMinutes,
      worked_minutes: 0,
      checkout_missing: 0,
      auto_closed_at: null,
      is_corrected: 0,
      last_correction_reason: null,
      created_at: nowIso,
    });
  }

  if (photoFile) {
    const thumbBlob = await createThumbnailBlob(photoFile);
    const photoId = await localDb.photos.add({
      attendance_id: attendanceId,
      employee_id: emp.id!,
      kind: 'checkin',
      work_date: today,
      blob: photoFile,
      thumb_blob: thumbBlob,
      created_at: nowIso,
    });
    await localDb.attendance.update(attendanceId, { checkin_photo_id: photoId });
  }

  await localDb.attendance_logs.add({
    employee_id: emp.id!,
    employee_name: `${emp.first_name} ${emp.last_name}`.trim(),
    action: 'checkin',
    log_date: today,
    log_time: nowTime,
    ip_address: 'Local',
    created_at: nowIso,
  });

  const updated = await localDb.attendance.get(attendanceId);
  return {
    attendance: updated,
    message: isLate
      ? `Arrivée enregistrée avec ${lateMinutes} min de retard.`
      : 'Arrivée enregistrée à l’heure.',
  } as T;
}

async function handleEmployeeCheckout<T>(
  token: string | null | undefined,
  photoFile: File | Blob | null
): Promise<T> {
  const emp = await requireEmployeeAuth(token);
  const settings = await getSettings();
  const photoReq = settings.photo_requirement || 'both';
  if (photoReq === 'both' && !photoFile) {
    throw new LocalApiHttpError(
      "La photo de départ est obligatoire. Veuillez prendre une photo avant d'envoyer.",
      400
    );
  }

  const now = new Date();
  const today = getLocalDateString(now);
  const nowTime = getLocalTimeString(now);
  const nowIso = getLocalDateTimeIso(now);

  const existing = await localDb.attendance
    .where('[employee_id+work_date]')
    .equals([emp.id!, today])
    .first();
  if (!existing || !existing.checkin_time || !existing.id) {
    throw new LocalApiHttpError("Vous devez d'abord pointer votre arrivée avant de pointer votre départ.", 400);
  }
  if (existing.checkout_time) {
    throw new LocalApiHttpError("Vous avez déjà pointé votre départ aujourd'hui.", 409);
  }

  const workedMinutes = computeWorkedMinutes(existing.checkin_time, nowTime);
  await localDb.attendance.update(existing.id, {
    checkout_time: nowTime,
    checkout_ip: 'Local',
    worked_minutes: workedMinutes,
    checkout_missing: 0,
    auto_closed_at: null,
  });

  if (photoFile) {
    const thumbBlob = await createThumbnailBlob(photoFile);
    const photoId = await localDb.photos.add({
      attendance_id: existing.id,
      employee_id: emp.id!,
      kind: 'checkout',
      work_date: today,
      blob: photoFile,
      thumb_blob: thumbBlob,
      created_at: nowIso,
    });
    await localDb.attendance.update(existing.id, { checkout_photo_id: photoId });
  }

  await localDb.attendance_logs.add({
    employee_id: emp.id!,
    employee_name: `${emp.first_name} ${emp.last_name}`.trim(),
    action: 'checkout',
    log_date: today,
    log_time: nowTime,
    ip_address: 'Local',
    created_at: nowIso,
  });

  const updated = await localDb.attendance.get(existing.id);
  return {
    attendance: updated,
    message: 'Départ enregistré avec succès.',
  } as T;
}

export async function localApiFormDataRequest<T>(
  rawPath: string,
  options: {
    formData: FormData;
    token?: string | null;
  }
): Promise<T> {
  await ensureLocalDbInitialized();
  const { pathname } = parseUrlParts(rawPath);
  const entry = options.formData.get('photo');
  const photoFile = entry instanceof Blob ? entry : null;

  if (pathname === '/api/employee/checkin') {
    return handleEmployeeCheckin(options.token, photoFile);
  }
  if (pathname === '/api/employee/checkout') {
    return handleEmployeeCheckout(options.token, photoFile);
  }

  throw new LocalApiHttpError(`Route FormData locale introuvable : ${pathname}`, 404);
}

export async function localApiFetchBlob(
  rawPath: string,
  token?: string | null
): Promise<{ blob: Blob; filename?: string }> {
  await ensureLocalDbInitialized();
  const { pathname, searchParams } = parseUrlParts(rawPath);

  if (pathname === '/api/admin/export/excel') {
    await requireAdminAuth(token);
    await runLocalAutoCloseMissingCheckouts();
    const rawMonth = searchParams.get('month') || '';
    const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : getLocalDateString().slice(0, 7);
    const employeeIdParam = searchParams.get('employeeId') || '';
    const settings = await getSettings();

    let employees = await localDb.employees.toArray();
    let includeSummarySheet = true;
    if (/^\d+$/.test(employeeIdParam)) {
      employees = employees.filter((e) => e.id === Number(employeeIdParam));
      includeSummarySheet = false;
    } else {
      employees = employees.filter((e) => e.is_active === 1);
    }
    employees.sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    );

    const monthPrefix = `${month}-`;
    const attRows = (await localDb.attendance.toArray()).filter((a) =>
      a.work_date.startsWith(monthPrefix)
    );
    const summaries = computeMonthlyEmployeeSummaries(month, employees, attRows, settings);
    const blob = await generateMonthlyExcelBlob({
      month,
      summaries,
      includeSummarySheet,
      companyName: settings.company_name,
    });
    return {
      blob,
      filename: `rapport-pointage-${month}.xlsx`,
    };
  }

  if (pathname === '/api/admin/export/csv') {
    await requireAdminAuth(token);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const employeeIdParam = searchParams.get('employeeId') || '';
    const status = searchParams.get('status') || 'all';

    const emps = await localDb.employees.toArray();
    const empMap = new Map(emps.map((e) => [e.id!, e]));
    let rows = await localDb.attendance.toArray();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) rows = rows.filter((r) => r.work_date >= from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) rows = rows.filter((r) => r.work_date <= to);
    if (/^\d+$/.test(employeeIdParam)) {
      rows = rows.filter((r) => r.employee_id === Number(employeeIdParam));
    }
    if (status === 'late') rows = rows.filter((r) => r.is_late === 1);
    if (status === 'on_time') rows = rows.filter((r) => r.is_late === 0 && r.checkin_time !== null);
    if (status === 'missing_checkout') {
      rows = rows.filter((r) => r.checkout_missing === 1 || (Boolean(r.checkin_time) && !r.checkout_time));
    }
    if (status === 'corrected') rows = rows.filter((r) => r.is_corrected === 1);
    rows.sort((a, b) => b.work_date.localeCompare(a.work_date));

    const header = [
      'Date',
      'Nom',
      'Prénom',
      'Poste',
      "Heure d'arrivée",
      'Heure de départ',
      'Statut',
      'Retard (min)',
      'Heures travaillées',
      'Corrigé',
      'Motif correction',
    ].join(';');

    const lines = rows.map((r) => {
      const emp = empMap.get(r.employee_id);
      const statut =
        r.checkout_missing === 1 && !r.checkout_time
          ? 'Départ manquant'
          : r.is_late === 1
          ? 'En retard'
          : "À l'heure";
      const h = Math.floor((r.worked_minutes || 0) / 60);
      const m = (r.worked_minutes || 0) % 60;
      const workedStr = r.checkout_time ? `${h}h${String(m).padStart(2, '0')}` : '-';
      return [
        escapeCsvCell(r.work_date),
        escapeCsvCell(emp?.last_name || ''),
        escapeCsvCell(emp?.first_name || ''),
        escapeCsvCell(emp?.job_title || ''),
        escapeCsvCell(r.checkin_time ? r.checkin_time.slice(0, 5) : '-'),
        escapeCsvCell(r.checkout_time ? r.checkout_time.slice(0, 5) : '-'),
        escapeCsvCell(statut),
        escapeCsvCell(r.late_minutes || 0),
        escapeCsvCell(workedStr),
        escapeCsvCell(r.is_corrected === 1 ? 'Oui' : 'Non'),
        escapeCsvCell(r.last_correction_reason || ''),
      ].join(';');
    });

    const csvContent = '\uFEFF' + [header, ...lines].join('\r\n');
    return {
      blob: new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
      filename: `pointages-${from || 'debut'}-${to || 'fin'}.csv`,
    };
  }

  if (pathname === '/api/super/backup') {
    await requireSuperAdminAuth(token);
    const blob = await exportLocalBackupBlob();
    return {
      blob,
      filename: `pointage-backup-${getLocalDateString()}.json`,
    };
  }

  const photoIdMatch = /^\/api\/photos\/(\d+)$/.exec(pathname);
  if (photoIdMatch) {
    await requireAdminAuth(token);
    const photoId = Number(photoIdMatch[1]);
    const photo = await localDb.photos.get(photoId);
    if (!photo) {
      throw new LocalApiHttpError('Photo introuvable.', 404);
    }
    const wantThumb = searchParams.get('thumb') === '1';
    const blob = wantThumb && photo.thumb_blob ? photo.thumb_blob : photo.blob;
    return {
      blob,
      filename: `photo-${photo.kind}-${photo.work_date}.jpg`,
    };
  }

  const attPhotoMatch = /^\/api\/admin\/attendance\/(\d+)\/photo\/(checkin|checkout)$/.exec(pathname);
  if (attPhotoMatch) {
    await requireAdminAuth(token);
    const attendanceId = Number(attPhotoMatch[1]);
    const kind = attPhotoMatch[2] as 'checkin' | 'checkout';
    const photo = await localDb.photos
      .where('[attendance_id+kind]')
      .equals([attendanceId, kind])
      .first();
    if (!photo) {
      throw new LocalApiHttpError('Photo introuvable.', 404);
    }
    const wantThumb = searchParams.get('thumb') === '1';
    const blob = wantThumb && photo.thumb_blob ? photo.thumb_blob : photo.blob;
    return {
      blob,
      filename: `photo-${kind}-${photo.work_date}.jpg`,
    };
  }

  throw new LocalApiHttpError(`Téléchargement local introuvable : ${pathname}`, 404);
}
