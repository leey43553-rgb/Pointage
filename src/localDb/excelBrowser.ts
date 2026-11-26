import type ExcelJSType from 'exceljs';
import type {
  CorrectionLogActionType,
  MissingYesterdayInfo,
  PublicHolidayEntry,
} from '../types';
import {
  getLocalDateString,
  getLocalDateTimeIso,
  getLocalTimeString,
  localDb,
  type LocalAttendanceRecord,
  type LocalEmployeeRecord,
  type LocalSettingsRecord,
} from './db';

const FRENCH_MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

const FRENCH_WEEKDAYS = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
];

export type DailyStatus =
  | 'Présent'
  | 'En retard'
  | 'Départ manquant'
  | 'Absent'
  | 'Week-end'
  | 'Férié'
  | 'Congé'
  | 'À venir';

export interface DailyReportRow {
  dateStr: string;
  displayDate: string;
  weekdayName: string;
  checkinHours: number | null;
  checkinMinutes: number | null;
  checkoutHours: number | null;
  checkoutMinutes: number | null;
  missingCheckout: boolean;
  workedMinutes: number | null;
  lateMinutes: number | null;
  status: DailyStatus;
  hasCheckinPhoto: boolean;
  hasCheckoutPhoto: boolean;
  isCorrected: boolean;
  observation: string;
}

export interface MonthlyEmployeeSummary {
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  is_active: boolean;
  expected_working_days: number;
  days_present: number;
  days_absent: number;
  days_late: number;
  missing_checkouts: number;
  missing_punches: number;
  corrected_punches: number;
  total_late_minutes: number;
  total_worked_minutes: number;
  attendance_rate: number;
  daily_rows: DailyReportRow[];
}

export function parseWorkingDays(raw: string | undefined): number[] {
  if (!raw) return [0, 1, 2, 3, 4];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const valid = parsed
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if (valid.length > 0) return Array.from(new Set(valid)).sort();
    }
  } catch {
    // fallback
  }
  return [0, 1, 2, 3, 4];
}

export function parsePublicHolidays(raw: string | undefined): PublicHolidayEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: PublicHolidayEntry[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as PublicHolidayEntry).date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test((item as PublicHolidayEntry).date)
      ) {
        const entry = item as PublicHolidayEntry;
        result.push({
          date: entry.date,
          type: entry.type === 'leave' ? 'leave' : 'holiday',
          label: typeof entry.label === 'string' ? entry.label.trim() : '',
        });
      }
    }
    return result;
  } catch {
    return [];
  }
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
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(val.trim());
}

export function getEffectiveEmployeeSchedule(
  emp: Pick<LocalEmployeeRecord, 'shift_start' | 'shift_end' | 'grace_minutes'>,
  settings: Pick<LocalSettingsRecord, 'official_start_time' | 'grace_minutes'>
): {
  shift_start: string;
  shift_end: string | null;
  grace_minutes: number;
  is_custom: boolean;
} {
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
    | Pick<LocalAttendanceRecord, 'checkin_time' | 'checkout_time' | 'checkout_missing'>
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

export async function writeLocalCorrectionLog(params: {
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
}): Promise<void> {
  await localDb.correction_logs.add({
    attendance_id: params.attendanceId,
    employee_id: params.employeeId,
    employee_name: params.employeeName,
    work_date: params.workDate,
    action_type: params.actionType,
    actor_admin_id: params.actorAdminId,
    actor_username: params.actorUsername,
    old_value: params.oldValue,
    new_value: params.newValue,
    reason: params.reason,
    created_at: params.createdAt || getLocalDateTimeIso(),
  });
}

export function isDateExpectedWorkingDay(
  dateStr: string,
  settings: Pick<LocalSettingsRecord, 'working_days' | 'public_holidays'>
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

export async function runLocalAutoCloseMissingCheckouts(): Promise<number> {
  const settings = await localDb.settings.get(1);
  const autoCloseTime = isValidHHMM(settings?.auto_close_time)
    ? settings!.auto_close_time.trim()
    : '23:59';

  const now = new Date();
  const todayStr = getLocalDateString(now);
  const nowHHMM = getLocalTimeString(now).slice(0, 5);
  const nowIso = getLocalDateTimeIso(now);

  const allAtts = await localDb.attendance.toArray();
  const openRows = allAtts.filter(
    (a) =>
      Boolean(a.checkin_time) &&
      !a.checkout_time &&
      a.checkout_missing === 0 &&
      (a.work_date < todayStr || (a.work_date === todayStr && nowHHMM >= autoCloseTime))
  );

  if (openRows.length === 0) return 0;

  const allEmployees = await localDb.employees.toArray();
  const empMap = new Map(allEmployees.map((e) => [e.id!, e]));

  for (const row of openRows) {
    if (!row.id) continue;
    await localDb.attendance.update(row.id, {
      checkout_missing: 1,
      auto_closed_at: nowIso,
      worked_minutes: 0,
    });
    const emp = empMap.get(row.employee_id);
    const empName = emp ? `${emp.first_name} ${emp.last_name}`.trim() : `Employé #${row.employee_id}`;
    const arrival = (row.checkin_time || '').slice(0, 5);
    await writeLocalCorrectionLog({
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

  return openRows.length;
}

export async function computeLocalYesterdayMissingPunch(
  employee: LocalEmployeeRecord,
  settings: LocalSettingsRecord
): Promise<MissingYesterdayInfo | null> {
  if (!employee.id) return null;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday);

  const att = await localDb.attendance
    .where('[employee_id+work_date]')
    .equals([employee.id, yesterdayStr])
    .first();

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

  const reqs = await localDb.correction_requests
    .where('[employee_id+work_date+punch_type]')
    .equals([employee.id, yesterdayStr, missingType])
    .toArray();
  reqs.sort((a, b) => (b.id || 0) - (a.id || 0));
  const latestReq = reqs[0];

  return {
    work_date: yesterdayStr,
    punch_type: missingType,
    checkin_time: att?.checkin_time || null,
    request_status: latestReq?.status || null,
  };
}

function parseTimeParts(timeStr: string): { hours: number; minutes: number } {
  const parts = timeStr.split(':');
  const hours = Math.max(0, Math.min(23, Number(parts[0] || 0)));
  const minutes = Math.max(0, Math.min(59, Number(parts[1] || 0)));
  return { hours, minutes };
}

function safeExcelText(val: string): string {
  if (/^[=+\-@\t\r]/.test(val) && val !== '-') {
    return `'${val}`;
  }
  return val;
}

function formatFrenchMonthTitle(month: string): string {
  const [yStr, mStr] = month.split('-');
  const mIdx = Number(mStr) - 1;
  const monthName = FRENCH_MONTHS[mIdx] || mStr;
  return `${monthName} ${yStr}`;
}

function formatMinutesReadable(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function computeMonthlyEmployeeSummaries(
  month: string,
  employees: LocalEmployeeRecord[],
  attendanceRecords: LocalAttendanceRecord[],
  settings: LocalSettingsRecord
): MonthlyEmployeeSummary[] {
  const [yearNum, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const todayStr = getLocalDateString();

  const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
  const holidays = parsePublicHolidays(settings.public_holidays);
  const holidayMap = new Map<string, PublicHolidayEntry>(holidays.map((h) => [h.date, h]));

  const defaultOfficialStart = parseTimeParts(settings.official_start_time || '09:00');
  const defaultOfficialStartMins = defaultOfficialStart.hours * 60 + defaultOfficialStart.minutes;
  const defaultGraceMinutes = Number(settings.grace_minutes || 0);

  const attendanceByEmpAndDate = new Map<string, LocalAttendanceRecord>();
  for (const rec of attendanceRecords) {
    attendanceByEmpAndDate.set(`${rec.employee_id}:${rec.work_date}`, rec);
  }

  return employees.map((emp) => {
    const empStart =
      emp.shift_start && /^\d{2}:\d{2}$/.test(emp.shift_start)
        ? parseTimeParts(emp.shift_start)
        : null;
    const officialStartMins = empStart
      ? empStart.hours * 60 + empStart.minutes
      : defaultOfficialStartMins;
    const graceMinutes =
      emp.grace_minutes !== null && emp.grace_minutes !== undefined
        ? Number(emp.grace_minutes)
        : defaultGraceMinutes;
    const cutoffMins = officialStartMins + graceMinutes;

    let expectedWorkingDays = 0;
    let daysPresent = 0;
    let daysAbsent = 0;
    let daysLate = 0;
    let missingCheckouts = 0;
    let correctedPunches = 0;
    let totalLateMinutes = 0;
    let totalWorkedMinutes = 0;
    const dailyRows: DailyReportRow[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(monthNum).padStart(2, '0');
      const dateStr = `${yearNum}-${monthStr}-${dayStr}`;
      const displayDate = `${dayStr}/${monthStr}/${yearNum}`;
      const dateObj = new Date(yearNum, monthNum - 1, day);
      const dayOfWeek = dateObj.getDay();
      const weekdayName = FRENCH_WEEKDAYS[dayOfWeek] || '';

      const isWorkingDay = workingDaysSet.has(dayOfWeek);
      const holiday = holidayMap.get(dateStr);
      const isFutureDay = dateStr > todayStr;

      if (isWorkingDay && !holiday && !isFutureDay) {
        expectedWorkingDays++;
      }

      const att = attendanceByEmpAndDate.get(`${emp.id}:${dateStr}`);

      if (att && att.checkin_time) {
        const ci = parseTimeParts(att.checkin_time);
        const ciTotalMins = ci.hours * 60 + ci.minutes;
        const isLate = ciTotalMins > cutoffMins;
        const lateMins = isLate ? Math.max(1, ciTotalMins - officialStartMins) : 0;

        daysPresent++;
        if (isLate) {
          daysLate++;
          totalLateMinutes += lateMins;
        }
        if (att.is_corrected === 1) {
          correctedPunches++;
        }

        let coHours: number | null = null;
        let coMinutes: number | null = null;
        let missingCheckout = false;
        let isClosedMissingCheckout = false;
        let workedMins: number | null = null;

        if (att.checkout_time) {
          const co = parseTimeParts(att.checkout_time);
          coHours = co.hours;
          coMinutes = co.minutes;
          const coTotalMins = co.hours * 60 + co.minutes;
          workedMins = Math.max(0, coTotalMins - ciTotalMins);
          totalWorkedMinutes += workedMins;
        } else {
          missingCheckout = true;
          isClosedMissingCheckout = att.checkout_missing === 1 || dateStr < todayStr;
          if (isClosedMissingCheckout) {
            missingCheckouts++;
          }
        }

        const obsParts: string[] = [];
        if (holiday?.label) obsParts.push(holiday.label);
        if (isLate) obsParts.push(`Retard de ${lateMins} min`);
        if (isClosedMissingCheckout) {
          obsParts.push('Départ manquant (heures non comptées)');
        } else if (missingCheckout) {
          obsParts.push('Départ non pointé');
        }
        if (att.is_corrected === 1) {
          obsParts.push(
            att.last_correction_reason
              ? `Corrigé : ${att.last_correction_reason}`
              : 'Pointage corrigé'
          );
        }

        const rowStatus: DailyStatus = isClosedMissingCheckout
          ? 'Départ manquant'
          : isLate
          ? 'En retard'
          : 'Présent';

        dailyRows.push({
          dateStr,
          displayDate,
          weekdayName,
          checkinHours: ci.hours,
          checkinMinutes: ci.minutes,
          checkoutHours: coHours,
          checkoutMinutes: coMinutes,
          missingCheckout,
          workedMinutes: workedMins,
          lateMinutes: lateMins,
          status: rowStatus,
          hasCheckinPhoto: Boolean(att.checkin_photo_id),
          hasCheckoutPhoto: Boolean(att.checkout_photo_id),
          isCorrected: att.is_corrected === 1,
          observation: obsParts.join(' · '),
        });
      } else if (holiday) {
        dailyRows.push({
          dateStr,
          displayDate,
          weekdayName,
          checkinHours: null,
          checkinMinutes: null,
          checkoutHours: null,
          checkoutMinutes: null,
          missingCheckout: false,
          workedMinutes: null,
          lateMinutes: null,
          status: holiday.type === 'leave' ? 'Congé' : 'Férié',
          hasCheckinPhoto: false,
          hasCheckoutPhoto: false,
          isCorrected: false,
          observation: holiday.label || (holiday.type === 'leave' ? 'Jour de congé' : 'Jour férié'),
        });
      } else if (!isWorkingDay) {
        dailyRows.push({
          dateStr,
          displayDate,
          weekdayName,
          checkinHours: null,
          checkinMinutes: null,
          checkoutHours: null,
          checkoutMinutes: null,
          missingCheckout: false,
          workedMinutes: null,
          lateMinutes: null,
          status: 'Week-end',
          hasCheckinPhoto: false,
          hasCheckoutPhoto: false,
          isCorrected: false,
          observation: '',
        });
      } else if (isFutureDay) {
        dailyRows.push({
          dateStr,
          displayDate,
          weekdayName,
          checkinHours: null,
          checkinMinutes: null,
          checkoutHours: null,
          checkoutMinutes: null,
          missingCheckout: false,
          workedMinutes: null,
          lateMinutes: null,
          status: 'À venir',
          hasCheckinPhoto: false,
          hasCheckoutPhoto: false,
          isCorrected: false,
          observation: '',
        });
      } else {
        daysAbsent++;
        dailyRows.push({
          dateStr,
          displayDate,
          weekdayName,
          checkinHours: null,
          checkinMinutes: null,
          checkoutHours: null,
          checkoutMinutes: null,
          missingCheckout: false,
          workedMinutes: null,
          lateMinutes: null,
          status: 'Absent',
          hasCheckinPhoto: false,
          hasCheckoutPhoto: false,
          isCorrected: false,
          observation: 'Aucun pointage enregistré',
        });
      }
    }

    const rate =
      expectedWorkingDays > 0
        ? Math.round((daysPresent / expectedWorkingDays) * 1000) / 10
        : 0;

    return {
      employee_id: emp.id!,
      first_name: emp.first_name,
      last_name: emp.last_name,
      job_title: emp.job_title,
      is_active: emp.is_active === 1,
      expected_working_days: expectedWorkingDays,
      days_present: daysPresent,
      days_absent: daysAbsent,
      days_late: daysLate,
      missing_checkouts: missingCheckouts,
      missing_punches: daysAbsent + missingCheckouts,
      corrected_punches: correctedPunches,
      total_late_minutes: totalLateMinutes,
      total_worked_minutes: totalWorkedMinutes,
      attendance_rate: rate,
      daily_rows: dailyRows,
    };
  });
}

function toExcelTimeDate(hours: number, minutes: number): Date {
  return new Date(Date.UTC(1899, 11, 30, hours, minutes, 0));
}

function sanitizeSheetName(rawName: string, usedNames: Set<string>): string {
  const cleaned = rawName.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Employé';
  let candidate = cleaned.slice(0, 31);
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

const THIN_BORDER: Partial<ExcelJSType.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const TOTALS_BORDER: Partial<ExcelJSType.Borders> = {
  top: { style: 'medium', color: { argb: 'FF1E3A8A' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};

const HEADER_FILL: ExcelJSType.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A8A' },
};

const HEADER_FONT: Partial<ExcelJSType.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
};

function applyAutoColumnWidths(
  sheet: ExcelJSType.Worksheet,
  minWidths: number[],
  headerRowNumber: number
): void {
  sheet.columns.forEach((col, index) => {
    let maxLength = minWidths[index] || 12;
    col.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber < headerRowNumber) return;
      let text = '';
      if (cell.value instanceof Date) {
        text = '00:00';
      } else if (typeof cell.value === 'number') {
        text = '123:45';
      } else if (cell.value !== null && cell.value !== undefined) {
        text = String(cell.value);
      }
      if (text.length > maxLength) {
        maxLength = text.length;
      }
    });
    col.width = Math.min(44, maxLength + 4);
  });
}

export async function generateMonthlyExcelBlob(options: {
  month: string;
  summaries: MonthlyEmployeeSummary[];
  includeSummarySheet: boolean;
  companyName: string;
}): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const { month, summaries, includeSummarySheet, companyName } = options;
  const monthLabel = formatFrenchMonthTitle(month);
  const now = new Date();
  const [gy, gm, gd] = getLocalDateString(now).split('-');
  const generatedLabel = `${gd}/${gm}/${gy} à ${getLocalTimeString(now).slice(0, 5)}`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyName || 'Pointage Entreprise';
  workbook.created = now;

  const usedSheetNames = new Set<string>();

  if (includeSummarySheet) {
    const summarySheetName = 'Résumé du mois';
    usedSheetNames.add(summarySheetName.toLowerCase());
    const summaryHeaderRowNum = 5;

    const summarySheet = workbook.addWorksheet(summarySheetName, {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: `${summaryHeaderRowNum}:${summaryHeaderRowNum}`,
      },
      views: [{ state: 'frozen', ySplit: summaryHeaderRowNum }],
    });

    summarySheet.mergeCells('A1:L1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = safeExcelText(`${companyName || 'Mon Entreprise'} — Rapport mensuel de présence`);
    titleCell.font = { bold: true, size: 15, color: { argb: 'FF1E3A8A' } };
    summarySheet.getRow(1).height = 24;

    summarySheet.mergeCells('A2:L2');
    const metaCell = summarySheet.getCell('A2');
    metaCell.value = `Période : ${monthLabel}   |   Généré le : ${generatedLabel}`;
    metaCell.font = { bold: true, size: 11, color: { argb: 'FF334155' } };
    summarySheet.getRow(2).height = 20;

    summarySheet.mergeCells('A3:L3');
    const subCell = summarySheet.getCell('A3');
    subCell.value = `Effectif inclus : ${summaries.length} employé${summaries.length > 1 ? 's' : ''}`;
    subCell.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };

    const headers = [
      'Nom',
      'Prénom',
      'Poste',
      'Jours ouvrables',
      'Jours présents',
      "Jours d'absence",
      'Nombre de retards',
      'Retard cumulé (h:min)',
      'Heures travaillées (h:min)',
      'Pointages manquants',
      'Pointages corrigés',
      'Taux de présence (%)',
    ];

    const headerRow = summarySheet.getRow(summaryHeaderRowNum);
    headerRow.height = 30;
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: i <= 2 ? 'left' : 'center',
        wrapText: true,
      };
    });

    let sumExpected = 0;
    let sumPresent = 0;
    let sumAbsent = 0;
    let sumLateCount = 0;
    let sumLateMins = 0;
    let sumWorkedMins = 0;
    let sumMissing = 0;
    let sumCorrected = 0;

    summaries.forEach((emp, idx) => {
      const rowNum = summaryHeaderRowNum + 1 + idx;
      const row = summarySheet.getRow(rowNum);
      row.height = 22;

      sumExpected += emp.expected_working_days;
      sumPresent += emp.days_present;
      sumAbsent += emp.days_absent;
      sumLateCount += emp.days_late;
      sumLateMins += emp.total_late_minutes;
      sumWorkedMins += emp.total_worked_minutes;
      sumMissing += emp.missing_punches;
      sumCorrected += emp.corrected_punches;

      const values: Array<string | number> = [
        safeExcelText(emp.last_name),
        safeExcelText(emp.first_name),
        safeExcelText(emp.job_title || '-'),
        emp.expected_working_days,
        emp.days_present,
        emp.days_absent,
        emp.days_late,
        emp.total_late_minutes / 1440,
        emp.total_worked_minutes / 1440,
        emp.missing_punches,
        emp.corrected_punches,
        emp.expected_working_days > 0 ? emp.days_present / emp.expected_working_days : 0,
      ];

      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        cell.border = THIN_BORDER;
        cell.font = {
          size: 10,
          color: {
            argb:
              colIdx === 5 && emp.days_absent > 0
                ? 'FF991B1B'
                : colIdx === 6 && emp.days_late > 0
                ? 'FF9A3412'
                : colIdx === 9 && emp.missing_punches > 0
                ? 'FFB45309'
                : colIdx === 10 && emp.corrected_punches > 0
                ? 'FF1E40AF'
                : 'FF0F172A',
          },
          bold:
            colIdx <= 1 ||
            (colIdx === 5 && emp.days_absent > 0) ||
            (colIdx === 9 && emp.missing_punches > 0),
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colIdx <= 2 ? 'left' : 'center',
        };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
        if (colIdx === 7 || colIdx === 8) {
          cell.numFmt = '[h]:mm';
        }
        if (colIdx === 11) {
          cell.numFmt = '0.0%';
        }
      });
    });

    const totalRowNum = summaryHeaderRowNum + 1 + summaries.length;
    const totalRow = summarySheet.getRow(totalRowNum);
    totalRow.height = 26;

    const overallRate = sumExpected > 0 ? sumPresent / sumExpected : 0;
    const summaryTotals: Array<string | number> = [
      'TOTAUX',
      `${summaries.length} employé(s)`,
      '-',
      sumExpected,
      sumPresent,
      sumAbsent,
      sumLateCount,
      sumLateMins / 1440,
      sumWorkedMins / 1440,
      sumMissing,
      sumCorrected,
      overallRate,
    ];

    summaryTotals.forEach((val, colIdx) => {
      const cell = totalRow.getCell(colIdx + 1);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
      cell.border = TOTALS_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: colIdx <= 2 ? 'left' : 'center',
      };
      if (colIdx === 7 || colIdx === 8) {
        cell.numFmt = '[h]:mm';
      }
      if (colIdx === 11) {
        cell.numFmt = '0.0%';
      }
    });

    applyAutoColumnWidths(
      summarySheet,
      [18, 16, 18, 16, 15, 16, 17, 20, 22, 18, 18, 18],
      summaryHeaderRowNum
    );
  }

  for (const emp of summaries) {
    const sheetTitle = sanitizeSheetName(`${emp.first_name} ${emp.last_name}`, usedSheetNames);
    const empHeaderRowNum = 6;

    const sheet = workbook.addWorksheet(sheetTitle, {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: `${empHeaderRowNum}:${empHeaderRowNum}`,
      },
      views: [{ state: 'frozen', ySplit: empHeaderRowNum }],
    });

    sheet.mergeCells('A1:K1');
    const empTitle = sheet.getCell('A1');
    empTitle.value = safeExcelText(`${emp.last_name.toUpperCase()} ${emp.first_name} — Fiche mensuelle de pointage`);
    empTitle.font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } };
    sheet.getRow(1).height = 22;

    sheet.mergeCells('A2:K2');
    const empMeta = sheet.getCell('A2');
    empMeta.value = safeExcelText(
      `Entreprise : ${companyName || 'Mon Entreprise'}   |   Poste : ${emp.job_title || 'Non renseigné'}   |   Mois : ${monthLabel}   |   Généré le : ${generatedLabel}`
    );
    empMeta.font = { bold: true, size: 10, color: { argb: 'FF334155' } };
    sheet.getRow(2).height = 18;

    sheet.mergeCells('A3:K3');
    const summaryLine = sheet.getCell('A3');
    summaryLine.value =
      `Résumé : Présents : ${emp.days_present} / ${emp.expected_working_days}   ·   ` +
      `Absences : ${emp.days_absent}   ·   ` +
      `Retards : ${emp.days_late} (${formatMinutesReadable(emp.total_late_minutes)})   ·   ` +
      `Pointages manquants : ${emp.missing_punches}   ·   ` +
      `Corrigés : ${emp.corrected_punches}   ·   ` +
      `Total heures : ${formatMinutesReadable(emp.total_worked_minutes)}   ·   ` +
      `Taux : ${emp.attendance_rate}%`;
    summaryLine.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
    summaryLine.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    summaryLine.border = THIN_BORDER;
    summaryLine.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(3).height = 22;

    sheet.getRow(4).height = 8;

    const dayHeaders = [
      'Date',
      'Jour',
      "Heure d'arrivée",
      'Heure de départ',
      'Heures travaillées',
      'Retard (min)',
      'Statut',
      'Photo arrivée',
      'Photo départ',
      'Corrigé',
      'Observation',
    ];

    const headerRow = sheet.getRow(empHeaderRowNum);
    headerRow.height = 28;
    dayHeaders.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: i <= 1 || i === 10 ? 'left' : 'center',
        wrapText: true,
      };
    });

    emp.daily_rows.forEach((d, idx) => {
      const rowNum = empHeaderRowNum + 1 + idx;
      const row = sheet.getRow(rowNum);
      row.height = 20;

      let rowFillArgb: string | null = idx % 2 === 1 ? 'FFF8FAFC' : null;
      let statusFontColor = 'FF0F172A';
      if (d.status === 'Absent') {
        rowFillArgb = 'FFFEE2E2';
        statusFontColor = 'FF991B1B';
      } else if (d.status === 'Départ manquant') {
        rowFillArgb = 'FFFEF3C7';
        statusFontColor = 'FFB45309';
      } else if (d.status === 'En retard') {
        rowFillArgb = 'FFFFEDD5';
        statusFontColor = 'FF9A3412';
      } else if (d.status === 'Week-end') {
        rowFillArgb = 'FFE2E8F0';
        statusFontColor = 'FF475569';
      } else if (d.status === 'Férié' || d.status === 'Congé') {
        rowFillArgb = 'FFEDF2F7';
        statusFontColor = 'FF1E3A8A';
      } else if (d.status === 'Présent') {
        statusFontColor = 'FF166534';
      }

      const cDate = row.getCell(1);
      cDate.value = d.displayDate;

      const cDay = row.getCell(2);
      cDay.value = d.weekdayName;

      const cIn = row.getCell(3);
      if (d.checkinHours !== null && d.checkinMinutes !== null) {
        cIn.value = toExcelTimeDate(d.checkinHours, d.checkinMinutes);
        cIn.numFmt = 'hh:mm';
      } else {
        cIn.value = '-';
      }

      const cOut = row.getCell(4);
      if (d.missingCheckout) {
        cOut.value = d.status === 'Départ manquant' ? 'Départ manquant' : 'Départ non pointé';
      } else if (d.checkoutHours !== null && d.checkoutMinutes !== null) {
        cOut.value = toExcelTimeDate(d.checkoutHours, d.checkoutMinutes);
        cOut.numFmt = 'hh:mm';
      } else {
        cOut.value = '-';
      }

      const cWorked = row.getCell(5);
      if (d.workedMinutes !== null) {
        const wh = Math.floor(d.workedMinutes / 60);
        const wm = d.workedMinutes % 60;
        cWorked.value = toExcelTimeDate(wh, wm);
        cWorked.numFmt = 'hh:mm';
      } else {
        cWorked.value = '-';
      }

      const cLate = row.getCell(6);
      cLate.value = d.lateMinutes !== null ? d.lateMinutes : '-';

      const cStatus = row.getCell(7);
      cStatus.value = d.status;

      const cPhotoIn = row.getCell(8);
      cPhotoIn.value = d.hasCheckinPhoto ? 'Oui' : 'Non';

      const cPhotoOut = row.getCell(9);
      cPhotoOut.value = d.hasCheckoutPhoto ? 'Oui' : 'Non';

      const cCorrected = row.getCell(10);
      cCorrected.value = d.isCorrected ? 'Oui' : 'Non';

      const cObs = row.getCell(11);
      cObs.value = d.observation ? safeExcelText(d.observation) : '-';

      for (let colIdx = 1; colIdx <= 11; colIdx++) {
        const cell = row.getCell(colIdx);
        cell.border = THIN_BORDER;
        cell.alignment = {
          vertical: 'middle',
          horizontal: colIdx <= 2 || colIdx === 11 ? 'left' : 'center',
        };
        if (rowFillArgb) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFillArgb } };
        }
        cell.font = {
          size: 10,
          color: {
            argb:
              colIdx === 7
                ? statusFontColor
                : colIdx === 4 && d.missingCheckout
                ? 'FFB45309'
                : colIdx === 10 && d.isCorrected
                ? 'FF1E40AF'
                : d.status === 'Week-end'
                ? 'FF475569'
                : 'FF0F172A',
          },
          bold:
            colIdx === 7 ||
            (colIdx === 4 && d.missingCheckout) ||
            (colIdx === 10 && d.isCorrected),
        };
      }
    });

    const totalRowNum = empHeaderRowNum + 1 + emp.daily_rows.length;
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 26;

    const checkinPhotoCount = emp.daily_rows.filter((r) => r.hasCheckinPhoto).length;
    const checkoutPhotoCount = emp.daily_rows.filter((r) => r.hasCheckoutPhoto).length;

    const totalValues: Array<string | number> = [
      'TOTAUX DU MOIS',
      `${emp.expected_working_days} j ouvrables`,
      `Présents : ${emp.days_present} j`,
      `Manquants : ${emp.missing_punches}`,
      emp.total_worked_minutes / 1440,
      emp.total_late_minutes / 1440,
      `Retards : ${emp.days_late} (${emp.attendance_rate}%)`,
      `${checkinPhotoCount} Oui`,
      `${checkoutPhotoCount} Oui`,
      `${emp.corrected_punches} corrigé(s)`,
      `Absences : ${emp.days_absent} · Départs manquants : ${emp.missing_checkouts}`,
    ];

    totalValues.forEach((val, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
      cell.border = TOTALS_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: i === 0 || i === 10 ? 'left' : 'center',
      };
      if (i === 4 || i === 5) {
        cell.numFmt = '[h]:mm';
      }
    });

    const sigTitleRowNum = totalRowNum + 2;
    const sigBoxRowNum = totalRowNum + 3;
    const sigDateRowNum = totalRowNum + 4;

    sheet.mergeCells(`A${sigTitleRowNum}:D${sigTitleRowNum}`);
    const sigEmpTitle = sheet.getCell(`A${sigTitleRowNum}`);
    sigEmpTitle.value = "Signature de l'employé";
    sigEmpTitle.font = { bold: true, size: 10, color: { argb: 'FF1E3A8A' } };
    sigEmpTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    sigEmpTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

    sheet.mergeCells(`F${sigTitleRowNum}:K${sigTitleRowNum}`);
    const sigAdminTitle = sheet.getCell(`F${sigTitleRowNum}`);
    sigAdminTitle.value = 'Signature du responsable';
    sigAdminTitle.font = { bold: true, size: 10, color: { argb: 'FF1E3A8A' } };
    sigAdminTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    sigAdminTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

    sheet.mergeCells(`A${sigBoxRowNum}:D${sigBoxRowNum}`);
    sheet.mergeCells(`F${sigBoxRowNum}:K${sigBoxRowNum}`);
    sheet.getRow(sigBoxRowNum).height = 42;

    sheet.mergeCells(`A${sigDateRowNum}:D${sigDateRowNum}`);
    const sigEmpDate = sheet.getCell(`A${sigDateRowNum}`);
    sigEmpDate.value = 'Date : ____ / ____ / ________';
    sigEmpDate.font = { size: 9, color: { argb: 'FF475569' } };
    sigEmpDate.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells(`F${sigDateRowNum}:K${sigDateRowNum}`);
    const sigAdminDate = sheet.getCell(`F${sigDateRowNum}`);
    sigAdminDate.value = 'Date : ____ / ____ / ________';
    sigAdminDate.font = { size: 9, color: { argb: 'FF475569' } };
    sigAdminDate.alignment = { horizontal: 'center', vertical: 'middle' };

    for (const r of [sigTitleRowNum, sigBoxRowNum, sigDateRowNum]) {
      for (const c of [1, 2, 3, 4, 6, 7, 8, 9, 10, 11]) {
        sheet.getRow(r).getCell(c).border = THIN_BORDER;
      }
    }

    applyAutoColumnWidths(
      sheet,
      [14, 14, 16, 20, 18, 14, 18, 14, 14, 12, 30],
      empHeaderRowNum
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
