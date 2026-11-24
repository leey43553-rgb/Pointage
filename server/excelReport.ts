import ExcelJS from 'exceljs';
import {
  getLocalDateString,
  type AttendanceRow,
  type EmployeeRow,
  type PublicHolidayEntry,
  type SettingsRow,
} from './db.ts';

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
  | 'Absent'
  | 'Week-end'
  | 'Jour férié'
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

export function computeMonthlyEmployeeSummaries(
  month: string,
  employees: Array<Pick<EmployeeRow, 'id' | 'first_name' | 'last_name' | 'job_title' | 'is_active'>>,
  attendanceRecords: AttendanceRow[],
  settings: SettingsRow
): MonthlyEmployeeSummary[] {
  const [yearNum, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const todayStr = getLocalDateString();

  const workingDaysSet = new Set(parseWorkingDays(settings.working_days));
  const holidays = parsePublicHolidays(settings.public_holidays);
  const holidayMap = new Map<string, PublicHolidayEntry>(holidays.map((h) => [h.date, h]));

  const officialStart = parseTimeParts(settings.official_start_time || '09:00');
  const officialStartMins = officialStart.hours * 60 + officialStart.minutes;
  const graceMinutes = Number(settings.grace_minutes || 0);
  const cutoffMins = officialStartMins + graceMinutes;

  const attendanceByEmpAndDate = new Map<string, AttendanceRow>();
  for (const rec of attendanceRecords) {
    attendanceByEmpAndDate.set(`${rec.employee_id}:${rec.work_date}`, rec);
  }

  return employees.map((emp) => {
    let expectedWorkingDays = 0;
    let daysPresent = 0;
    let daysAbsent = 0;
    let daysLate = 0;
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

        let coHours: number | null = null;
        let coMinutes: number | null = null;
        let missingCheckout = false;
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
        }

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
          status: isLate ? 'En retard' : 'Présent',
          hasCheckinPhoto: Boolean(att.checkin_photo),
          hasCheckoutPhoto: Boolean(att.checkout_photo),
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
          status: holiday.type === 'leave' ? 'Congé' : 'Jour férié',
          hasCheckinPhoto: false,
          hasCheckoutPhoto: false,
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
        });
      }
    }

    const rate =
      expectedWorkingDays > 0
        ? Math.round((daysPresent / expectedWorkingDays) * 1000) / 10
        : 0;

    return {
      employee_id: emp.id,
      first_name: emp.first_name,
      last_name: emp.last_name,
      job_title: emp.job_title,
      is_active: emp.is_active === 1,
      expected_working_days: expectedWorkingDays,
      days_present: daysPresent,
      days_absent: daysAbsent,
      days_late: daysLate,
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

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A8A' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};

function applyAutoColumnWidths(sheet: ExcelJS.Worksheet, minWidths: number[]): void {
  sheet.columns.forEach((col, index) => {
    let maxLength = minWidths[index] || 12;
    col.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      // Ignore title banner rows (rows 1-2) when computing table column widths
      if (rowNumber <= 2) return;
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
    col.width = Math.min(42, maxLength + 4);
  });
}

export async function generateMonthlyExcelBuffer(options: {
  month: string;
  summaries: MonthlyEmployeeSummary[];
  includeSummarySheet: boolean;
  companyName: string;
}): Promise<Buffer> {
  const { month, summaries, includeSummarySheet, companyName } = options;
  const monthLabel = formatFrenchMonthTitle(month);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyName || 'Pointage Entreprise';
  workbook.created = new Date();

  const usedSheetNames = new Set<string>();

  // ---------------- 1. SUMMARY SHEET ----------------
  if (includeSummarySheet) {
    usedSheetNames.add('résumé');
    const summarySheet = workbook.addWorksheet('Résumé', {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    const titleCell = summarySheet.getCell('A1');
    titleCell.value = safeExcelText(companyName || 'Mon Entreprise');
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF1E3A8A' } };

    const subtitleCell = summarySheet.getCell('A2');
    subtitleCell.value = `Résumé mensuel de présence — ${monthLabel}`;
    subtitleCell.font = { bold: true, size: 12, color: { argb: 'FF334155' } };

    const headers = [
      'Nom',
      'Poste',
      'Jours travaillés attendus',
      'Jours présents',
      "Jours d'absence",
      'Nombre de retards',
      'Retard cumulé (h:min)',
      'Heures travaillées (h:min)',
      'Taux de présence (%)',
    ];

    const headerRow = summarySheet.getRow(4);
    headerRow.height = 28;
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: i <= 1 ? 'left' : 'center',
        wrapText: true,
      };
    });

    summaries.forEach((emp, idx) => {
      const rowNum = 5 + idx;
      const row = summarySheet.getRow(rowNum);
      row.height = 22;

      const values: Array<string | number> = [
        safeExcelText(`${emp.first_name} ${emp.last_name}`),
        safeExcelText(emp.job_title || '-'),
        emp.expected_working_days,
        emp.days_present,
        emp.days_absent,
        emp.days_late,
        emp.total_late_minutes / 1440,
        emp.total_worked_minutes / 1440,
        emp.expected_working_days > 0 ? emp.days_present / emp.expected_working_days : 0,
      ];

      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        cell.border = THIN_BORDER;
        cell.font = { size: 10, color: { argb: 'FF0F172A' }, bold: colIdx === 0 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colIdx <= 1 ? 'left' : 'center',
        };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
        if (colIdx === 6 || colIdx === 7) {
          cell.numFmt = '[h]:mm';
        }
        if (colIdx === 8) {
          cell.numFmt = '0.0%';
        }
      });
    });

    applyAutoColumnWidths(summarySheet, [22, 18, 22, 16, 16, 18, 20, 22, 20]);
  }

  // ---------------- 2. PER-EMPLOYEE SHEETS ----------------
  for (const emp of summaries) {
    const sheetTitle = sanitizeSheetName(`${emp.first_name} ${emp.last_name}`, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetTitle, {
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    const empTitle = sheet.getCell('A1');
    empTitle.value = safeExcelText(`${emp.first_name} ${emp.last_name}`);
    empTitle.font = { bold: true, size: 16, color: { argb: 'FF1E3A8A' } };

    const empMeta = sheet.getCell('A2');
    empMeta.value = safeExcelText(
      `Poste : ${emp.job_title || 'Non renseigné'}  |  Mois : ${monthLabel}  |  Entreprise : ${companyName}`
    );
    empMeta.font = { bold: true, size: 11, color: { argb: 'FF334155' } };

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
    ];

    const headerRow = sheet.getRow(4);
    headerRow.height = 26;
    dayHeaders.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: i <= 1 ? 'left' : 'center',
      };
    });

    emp.daily_rows.forEach((d, idx) => {
      const rowNum = 5 + idx;
      const row = sheet.getRow(rowNum);
      row.height = 20;

      // Determine row fill & status color
      let rowFillArgb: string | null = null;
      let statusFontColor = 'FF0F172A';
      if (d.status === 'Absent') {
        rowFillArgb = 'FFFEE2E2'; // light red
        statusFontColor = 'FF991B1B';
      } else if (d.status === 'En retard') {
        rowFillArgb = 'FFFFEDD5'; // light orange
        statusFontColor = 'FF9A3412';
      } else if (d.status === 'Week-end' || d.status === 'Jour férié' || d.status === 'Congé') {
        rowFillArgb = 'FFF1F5F9'; // light grey
        statusFontColor = 'FF475569';
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
        cOut.value = 'Départ non pointé';
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
      if (d.lateMinutes !== null) {
        cLate.value = d.lateMinutes;
      } else {
        cLate.value = '-';
      }

      const cStatus = row.getCell(7);
      cStatus.value = d.status;

      const cPhotoIn = row.getCell(8);
      cPhotoIn.value = d.hasCheckinPhoto ? 'Oui' : 'Non';

      const cPhotoOut = row.getCell(9);
      cPhotoOut.value = d.hasCheckoutPhoto ? 'Oui' : 'Non';

      for (let colIdx = 1; colIdx <= 9; colIdx++) {
        const cell = row.getCell(colIdx);
        cell.border = THIN_BORDER;
        cell.alignment = {
          vertical: 'middle',
          horizontal: colIdx <= 2 ? 'left' : 'center',
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
                : rowFillArgb === 'FFF1F5F9'
                ? 'FF475569'
                : 'FF0F172A',
          },
          bold: colIdx === 7 || (colIdx === 4 && d.missingCheckout),
        };
      }
    });

    // Totals row at bottom
    const totalRowNum = 5 + emp.daily_rows.length;
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 26;

    const checkinPhotoCount = emp.daily_rows.filter((r) => r.hasCheckinPhoto).length;
    const checkoutPhotoCount = emp.daily_rows.filter((r) => r.hasCheckoutPhoto).length;

    const totalValues: Array<string | number> = [
      'TOTAUX DU MOIS',
      `Présents : ${emp.days_present} j`,
      `Absences : ${emp.days_absent} j`,
      `Retards : ${emp.days_late}`,
      emp.total_worked_minutes / 1440,
      emp.total_late_minutes / 1440,
      `Présence : ${emp.attendance_rate}%`,
      `${checkinPhotoCount} photo(s)`,
      `${checkoutPhotoCount} photo(s)`,
    ];

    totalValues.forEach((val, i) => {
      const cell = totalRow.getCell(i + 1);
      cell.value = val;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF475569' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'medium', color: { argb: 'FF475569' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i === 0 ? 'left' : 'center',
      };
      if (i === 4 || i === 5) {
        cell.numFmt = '[h]:mm';
      }
    });

    applyAutoColumnWidths(sheet, [16, 15, 18, 22, 20, 16, 18, 15, 15]);
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
