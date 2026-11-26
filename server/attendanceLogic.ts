import {
  db,
  getLocalDateString,
  getLocalDateTimeIso,
  getLocalTimeString,
  type AttendanceRow,
  type CorrectionLogActionType,
  type CorrectionRequestRow,
  type EmployeeRow,
  type SettingsRow,
} from './db.ts';
import { parsePublicHolidays, parseWorkingDays } from './excelReport.ts';

export interface EffectiveSchedule {
  shift_start: string;
  shift_end: string | null;
  grace_minutes: number;
  is_custom: boolean;
}

export function parseTimeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0] || 0);
  const m = Number(parts[1] || 0);
  return h * 60 + m;
}

export function normalizeHHMM(val: string): string {
  const trimmed = val.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  return trimmed;
}

export function isValidHHMM(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.test(val.trim());
  return match;
}

export function getEffectiveEmployeeSchedule(
  emp: Pick<EmployeeRow, 'shift_start' | 'shift_end' | 'grace_minutes'>,
  settings: Pick<SettingsRow, 'official_start_time' | 'grace_minutes'>
): EffectiveSchedule {
  const customStart = isValidHHMM(emp.shift_start) ? emp.shift_start.trim() : null;
  const customEnd = isValidHHMM(emp.shift_end) ? emp.shift_end.trim() : null;
  const hasCustomGrace =
    emp.grace_minutes !== null &&
    emp.grace_minutes !== undefined &&
    Number.isFinite(Number(emp.grace_minutes));

  return {
    shift_start: customStart || settings.official_start_time || '09:00',
    shift_end: customEnd,
    grace_minutes: hasCustomGrace ? Number(emp.grace_minutes) : Number(settings.grace_minutes || 0),
    is_custom: Boolean(customStart || customEnd || hasCustomGrace),
  };
}

export function computeCheckinLateness(
  checkinTime: string,
  shiftStart: string,
  graceMinutes: number
): { isLate: number; lateMinutes: number } {
  const officialStartMins = parseTimeToMinutes(shiftStart);
  const cutoffMins = officialStartMins + Math.max(0, graceMinutes || 0);
  const arrivalMins = parseTimeToMinutes(checkinTime);
  const isLate = arrivalMins > cutoffMins ? 1 : 0;
  const lateMinutes = isLate ? Math.max(1, arrivalMins - officialStartMins) : 0;
  return { isLate, lateMinutes };
}

export function computeWorkedMinutes(
  checkinTime: string | null,
  checkoutTime: string | null
): number {
  if (!checkinTime || !checkoutTime) return 0;
  return Math.max(0, parseTimeToMinutes(checkoutTime) - parseTimeToMinutes(checkinTime));
}

export function formatAttendanceSnapshot(
  att:
    | Pick<AttendanceRow, 'checkin_time' | 'checkout_time' | 'checkout_missing'>
    | null
    | undefined
): string {
  if (!att || (!att.checkin_time && !att.checkout_time)) {
    return 'Aucun pointage';
  }
  const inPart = att.checkin_time
    ? `Arrivée ${att.checkin_time.slice(0, 5)}`
    : 'Arrivée non pointée';
  const outPart = att.checkout_time
    ? `Départ ${att.checkout_time.slice(0, 5)}`
    : att.checkout_missing === 1
    ? 'Départ manquant'
    : 'Départ non pointé';
  return `${inPart} · ${outPart}`;
}

export function writeCorrectionLog(params: {
  attendanceId: number | null;
  employeeId: number;
  employeeName: string;
  workDate: string;
  actionType: CorrectionLogActionType;
  actorAdminId: number | null;
  actorUsername: string;
  oldValue: string;
  newValue: string;
  reason: string;
  createdAt?: string;
}): void {
  const createdAt = params.createdAt || getLocalDateTimeIso();
  db.prepare(
    `INSERT INTO correction_logs (
       attendance_id, employee_id, employee_name, work_date, action_type,
       actor_admin_id, actor_username, old_value, new_value, reason, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.attendanceId,
    params.employeeId,
    params.employeeName,
    params.workDate,
    params.actionType,
    params.actorAdminId,
    params.actorUsername,
    params.oldValue,
    params.newValue,
    params.reason,
    createdAt
  );
}

export function runAutoCloseMissingCheckouts(): number {
  const settings = db.prepare('SELECT auto_close_time FROM settings WHERE id = 1').get() as
    | Pick<SettingsRow, 'auto_close_time'>
    | undefined;
  const autoCloseTime = isValidHHMM(settings?.auto_close_time)
    ? settings!.auto_close_time.trim()
    : '23:59';

  const now = new Date();
  const todayStr = getLocalDateString(now);
  const nowHHMM = getLocalTimeString(now).slice(0, 5);
  const nowIso = getLocalDateTimeIso(now);

  const openRows = db
    .prepare(
      `SELECT a.id, a.employee_id, a.work_date, a.checkin_time, e.first_name, e.last_name
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.checkin_time IS NOT NULL
         AND a.checkout_time IS NULL
         AND a.checkout_missing = 0
         AND (a.work_date < ? OR (a.work_date = ? AND ? >= ?))`
    )
    .all(todayStr, todayStr, nowHHMM, autoCloseTime) as Array<{
    id: number;
    employee_id: number;
    work_date: string;
    checkin_time: string;
    first_name: string;
    last_name: string;
  }>;

  if (openRows.length === 0) return 0;

  const closeTx = db.transaction(() => {
    const updateStmt = db.prepare(
      `UPDATE attendance
       SET checkout_missing = 1, auto_closed_at = ?, worked_minutes = 0
       WHERE id = ?`
    );

    for (const row of openRows) {
      updateStmt.run(nowIso, row.id);
      const empName = `${row.first_name} ${row.last_name}`.trim();
      const arrival = row.checkin_time.slice(0, 5);
      writeCorrectionLog({
        attendanceId: row.id,
        employeeId: row.employee_id,
        employeeName: empName,
        workDate: row.work_date,
        actionType: 'auto_close',
        actorAdminId: null,
        actorUsername: 'Système',
        oldValue: `Arrivée ${arrival} · Départ non pointé`,
        newValue: `Arrivée ${arrival} · Statut : Départ manquant`,
        reason: `Clôture automatique à ${autoCloseTime}`,
        createdAt: nowIso,
      });
    }
  });

  closeTx();
  return openRows.length;
}

export function isDateExpectedWorkingDay(
  dateStr: string,
  settings: Pick<SettingsRow, 'working_days' | 'public_holidays'>
): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return false;
  const dow = new Date(y, m - 1, d).getDay();
  const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
  if (!workingDaysSet.has(dow)) return false;

  const holidays = parsePublicHolidays(settings.public_holidays);
  if (holidays.some((h) => h.date === dateStr)) return false;

  return true;
}

export interface MissingYesterdayBannerInfo {
  work_date: string;
  punch_type: 'checkin' | 'checkout';
  checkin_time: string | null;
  request_status: 'pending' | 'approved' | 'rejected' | null;
}

export function computeYesterdayMissingPunch(
  employee: Pick<EmployeeRow, 'id' | 'created_at'>,
  settings: SettingsRow
): MissingYesterdayBannerInfo | null {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const att = db
    .prepare('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?')
    .get(employee.id, yesterdayStr) as AttendanceRow | undefined;

  let missingType: 'checkin' | 'checkout' | null = null;
  if (att && att.checkin_time && !att.checkout_time) {
    missingType = 'checkout';
  } else if (!att || (!att.checkin_time && !att.checkout_time)) {
    const createdDate = (employee.created_at || '').slice(0, 10);
    if (createdDate && createdDate > yesterdayStr) {
      return null;
    }
    if (isDateExpectedWorkingDay(yesterdayStr, settings)) {
      missingType = 'checkin';
    }
  }

  if (!missingType) return null;

  const existingReq = db
    .prepare(
      `SELECT * FROM correction_requests
       WHERE employee_id = ? AND work_date = ? AND punch_type = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(employee.id, yesterdayStr, missingType) as CorrectionRequestRow | undefined;

  return {
    work_date: yesterdayStr,
    punch_type: missingType,
    checkin_time: att?.checkin_time || null,
    request_status: existingReq?.status || null,
  };
}

export interface LiveAlertsSummary {
  today_unreported: number;
  missing_checkouts_count: number;
  pending_requests: number;
  total_alerts: number;
}

export function computeLiveAlertsSummary(): LiveAlertsSummary {
  runAutoCloseMissingCheckouts();

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
  const now = new Date();
  const todayStr = getLocalDateString(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isWorkingToday = isDateExpectedWorkingDay(todayStr, settings);

  let todayUnreported = 0;
  if (isWorkingToday) {
    const activeEmployees = db
      .prepare('SELECT id, shift_start, shift_end, grace_minutes FROM employees WHERE is_active = 1')
      .all() as Array<Pick<EmployeeRow, 'id' | 'shift_start' | 'shift_end' | 'grace_minutes'>>;

    const todayAttRows = db
      .prepare('SELECT employee_id, checkin_time FROM attendance WHERE work_date = ?')
      .all(todayStr) as Array<{ employee_id: number; checkin_time: string | null }>;
    const checkedInIds = new Set(
      todayAttRows.filter((r) => Boolean(r.checkin_time)).map((r) => r.employee_id)
    );

    for (const emp of activeEmployees) {
      if (checkedInIds.has(emp.id)) continue;
      const eff = getEffectiveEmployeeSchedule(emp, settings);
      const cutoffMins = parseTimeToMinutes(eff.shift_start) + eff.grace_minutes;
      if (nowMins > cutoffMins) {
        todayUnreported++;
      }
    }
  }

  const missingRow = db
    .prepare(
      'SELECT COUNT(*) as c FROM attendance WHERE checkout_missing = 1 AND checkout_time IS NULL'
    )
    .get() as { c: number };

  const pendingRow = db
    .prepare("SELECT COUNT(*) as c FROM correction_requests WHERE status = 'pending'")
    .get() as { c: number };

  const missingCount = Number(missingRow?.c || 0);
  const pendingCount = Number(pendingRow?.c || 0);

  return {
    today_unreported: todayUnreported,
    missing_checkouts_count: missingCount,
    pending_requests: pendingCount,
    total_alerts: todayUnreported + missingCount + pendingCount,
  };
}
