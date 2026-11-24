import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  RefreshCw,
} from 'lucide-react';
import {
  ApiError,
  apiRequest,
  downloadAuthenticatedFile,
  formatFrenchDate,
  formatMinutesToHours,
  getCurrentMonthLocalIso,
  getTodayLocalIso,
} from '../api';
import type {
  EmployeeListOption,
  PhotoCalendarCell,
  PhotoCalendarEmployeeRow,
  PhotoCalendarResponse,
  PhotoDayCard,
  PhotoDayResponse,
} from '../types';
import {
  PhotoAttendanceDetailModal,
  ProtectedPhotoImg,
  buildProtectedPhotoUrl,
  type PhotoDetailModalPayload,
} from './ProtectedPhoto';

interface AdminPhotoCalendarTabProps {
  token: string;
  employeeOptions: EmployeeListOption[];
  onUnauthorized: () => void;
}

function shiftMonthIso(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftDateIso(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function formatMonthLabel(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
}

export const AdminPhotoCalendarTab: React.FC<AdminPhotoCalendarTabProps> = ({
  token,
  employeeOptions,
  onUnauthorized,
}) => {
  const [viewMode, setViewMode] = useState<'month' | 'day'>('month');
  const [monthFilter, setMonthFilter] = useState(getCurrentMonthLocalIso());
  const [dayFilter, setDayFilter] = useState(getTodayLocalIso());
  const [employeeFilter, setEmployeeFilter] = useState('');

  const [calendarData, setCalendarData] = useState<PhotoCalendarResponse | null>(null);
  const [dayData, setDayData] = useState<PhotoDayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PhotoDetailModalPayload | null>(null);

  const loadMonthCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month: monthFilter });
      if (employeeFilter) params.set('employeeId', employeeFilter);
      const data = await apiRequest<PhotoCalendarResponse>(
        `/api/admin/photos/calendar?${params.toString()}`,
        { token }
      );
      setCalendarData(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Impossible de charger le calendrier photos.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, monthFilter, employeeFilter, onUnauthorized]);

  const loadDayView = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: dayFilter });
      if (employeeFilter) params.set('employeeId', employeeFilter);
      const data = await apiRequest<PhotoDayResponse>(
        `/api/admin/photos/day?${params.toString()}`,
        { token }
      );
      setDayData(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Impossible de charger les photos du jour.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, dayFilter, employeeFilter, onUnauthorized]);

  useEffect(() => {
    if (viewMode === 'month') {
      void loadMonthCalendar();
    } else {
      void loadDayView();
    }
  }, [viewMode, loadMonthCalendar, loadDayView]);

  const openModalFromCell = (
    emp: PhotoCalendarEmployeeRow,
    dateIso: string,
    cell: PhotoCalendarCell
  ) => {
    setSelectedDetail({
      employeeName: `${emp.first_name} ${emp.last_name}`,
      jobTitle: emp.job_title,
      dateIso,
      dateLabel: formatFrenchDate(dateIso),
      attendanceId: cell.attendance_id,
      status: cell.status,
      checkinTime: cell.checkin_time,
      checkoutTime: cell.checkout_time,
      lateMinutes: cell.late_minutes,
      workedMinutes: cell.worked_minutes,
      checkinIp: cell.checkin_ip,
      checkoutIp: cell.checkout_ip,
      checkinPhotoId: cell.checkin_photo_id,
      checkoutPhotoId: cell.checkout_photo_id,
      holidayLabel: cell.holiday_label,
    });
  };

  const openModalFromCard = (card: PhotoDayCard, dateIso: string) => {
    setSelectedDetail({
      employeeName: `${card.first_name} ${card.last_name}`,
      jobTitle: card.job_title,
      dateIso,
      dateLabel: formatFrenchDate(dateIso),
      attendanceId: card.attendance_id,
      status: card.status,
      checkinTime: card.checkin_time,
      checkoutTime: card.checkout_time,
      lateMinutes: card.late_minutes,
      workedMinutes: card.worked_minutes,
      checkinIp: card.checkin_ip,
      checkoutIp: card.checkout_ip,
      checkinPhotoId: card.checkin_photo_id,
      checkoutPhotoId: card.checkout_photo_id,
      holidayLabel: card.holiday_label,
    });
  };

  const handleDirectDownload = async (
    e: React.MouseEvent,
    photoId: number | null,
    attendanceId: number | null,
    kind: 'checkin' | 'checkout',
    empName: string,
    dateIso: string
  ) => {
    e.stopPropagation();
    const url = buildProtectedPhotoUrl({
      photoId,
      attendanceId,
      kind,
      thumb: false,
      download: true,
    });
    if (!url) return;
    try {
      const safeName = empName.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
      const label = kind === 'checkin' ? 'arrivee' : 'depart';
      await downloadAuthenticatedFile(url, token, `photo-${label}-${safeName}-${dateIso}.jpg`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du téléchargement.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
        {/* View toggle + Month/Day selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                viewMode === 'month' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Planning du mois
            </button>
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                viewMode === 'day' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Vue par jour
            </button>
          </div>

          {viewMode === 'month' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMonthFilter((prev) => shiftMonthIso(prev, -1))}
                aria-label="Mois précédent"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="month"
                value={monthFilter}
                onChange={(e) => e.target.value && setMonthFilter(e.target.value)}
                className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900"
              />
              <button
                type="button"
                onClick={() => setMonthFilter((prev) => shiftMonthIso(prev, 1))}
                aria-label="Mois suivant"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="hidden md:inline-block ml-1 text-sm font-bold text-slate-700 capitalize">
                {formatMonthLabel(monthFilter)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDayFilter((prev) => shiftDateIso(prev, -1))}
                aria-label="Jour précédent"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={dayFilter}
                onChange={(e) => e.target.value && setDayFilter(e.target.value)}
                className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono font-semibold text-slate-900"
              />
              <button
                type="button"
                onClick={() => setDayFilter((prev) => shiftDateIso(prev, 1))}
                aria-label="Jour suivant"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Employee filter + Refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            aria-label="Filtrer par employé"
            className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          >
            <option value="">Tous les employés</option>
            {employeeOptions.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => (viewMode === 'month' ? void loadMonthCalendar() : void loadDayView())}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 px-1 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded border border-slate-300 bg-white inline-block" />
          Présent à l'heure
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded border-2 border-amber-500 bg-amber-50 inline-block" />
          En retard
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded border border-red-200 bg-red-50 inline-block" />
          Absent (Abs)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded border border-slate-300 bg-slate-100 inline-block" />
          Week-end
        </span>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-sm font-semibold text-red-900">
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* PLANNING DU MOIS */}
      {viewMode === 'month' ? (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-600">
              Chargement du planning photos...
            </div>
          ) : !calendarData || calendarData.employees.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-600">
              Aucun employé trouvé pour cette sélection.
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="border-collapse text-left w-max min-w-full">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-30 min-w-[180px] max-w-[200px] bg-slate-50 border-b border-r border-slate-200 px-3.5 py-2.5 text-xs font-bold text-slate-700">
                      Employé
                    </th>
                    {calendarData.days.map((d) => (
                      <th
                        key={d.date}
                        className={`sticky top-0 z-20 min-w-[82px] border-b border-r border-slate-200 px-1 py-2 text-center ${
                          d.isWeekend ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="text-xs font-extrabold font-mono tabular-nums">{d.day}</div>
                        <div className="text-[10px] font-semibold uppercase text-slate-500">
                          {d.weekdayLetter}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {calendarData.employees.map((emp) => {
                    const empName = `${emp.first_name} ${emp.last_name}`;
                    return (
                      <tr key={emp.employee_id} className="group">
                        {/* Sticky Left Employee Name */}
                        <td className="sticky left-0 z-10 min-w-[180px] max-w-[200px] bg-white group-hover:bg-slate-50 border-r border-slate-200 px-3.5 py-2.5 align-middle">
                          <div className="text-sm font-bold text-slate-900 truncate" title={empName}>
                            {empName}
                          </div>
                          {emp.job_title && (
                            <div className="text-xs text-slate-500 truncate">{emp.job_title}</div>
                          )}
                        </td>

                        {/* Day Cells */}
                        {calendarData.days.map((d) => {
                          const cell = emp.cells[d.date];
                          if (!cell) {
                            return (
                              <td
                                key={d.date}
                                className="border-r border-slate-200 p-1.5 text-center text-xs text-slate-400"
                              >
                                —
                              </td>
                            );
                          }

                          const isAbsent = cell.status === 'absent';
                          const isWeekend = cell.status === 'weekend';
                          const isLate = cell.is_late;
                          const isHolidayOrLeave =
                            cell.status === 'holiday' || cell.status === 'leave';
                          const hasAttendance = Boolean(cell.checkin_time);

                          const cellBg = isAbsent
                            ? 'bg-red-50 hover:bg-red-100/70'
                            : isWeekend
                            ? 'bg-slate-100 hover:bg-slate-200/70'
                            : isHolidayOrLeave
                            ? 'bg-blue-50/50 hover:bg-blue-50'
                            : isLate
                            ? 'bg-amber-50/40 hover:bg-amber-50'
                            : 'bg-white hover:bg-slate-50';

                          const inShort = cell.checkin_time ? cell.checkin_time.slice(0, 5) : '';
                          const outShort = cell.checkout_time
                            ? cell.checkout_time.slice(0, 5)
                            : '';

                          return (
                            <td
                              key={d.date}
                              onClick={() => openModalFromCell(emp, d.date, cell)}
                              title={`${empName} · ${d.date}`}
                              className={`border-r border-slate-200 p-1 text-center align-middle cursor-pointer transition ${cellBg} ${
                                isLate ? 'ring-2 ring-inset ring-amber-500' : ''
                              }`}
                            >
                              {hasAttendance ? (
                                <div className="flex flex-col items-center gap-1">
                                  <div className="flex items-center justify-center gap-1">
                                    {cell.checkin_photo_id ? (
                                      <div className="h-8 w-8 rounded overflow-hidden border border-slate-300 bg-white">
                                        <ProtectedPhotoImg
                                          token={token}
                                          photoId={cell.checkin_photo_id}
                                          attendanceId={cell.attendance_id}
                                          kind="checkin"
                                          thumb
                                          alt={`Arrivée ${empName}`}
                                        />
                                      </div>
                                    ) : (
                                      <span className="inline-flex h-8 w-6 items-center justify-center text-[11px] text-slate-400">
                                        —
                                      </span>
                                    )}

                                    {cell.checkout_photo_id ? (
                                      <div className="h-8 w-8 rounded overflow-hidden border border-slate-300 bg-white">
                                        <ProtectedPhotoImg
                                          token={token}
                                          photoId={cell.checkout_photo_id}
                                          attendanceId={cell.attendance_id}
                                          kind="checkout"
                                          thumb
                                          alt={`Départ ${empName}`}
                                        />
                                      </div>
                                    ) : (
                                      <span className="inline-flex h-8 w-6 items-center justify-center text-[11px] text-slate-400">
                                        —
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] font-mono font-semibold tabular-nums text-slate-800 leading-none whitespace-nowrap">
                                    {inShort || '--:--'} / {outShort || '--:--'}
                                  </div>
                                </div>
                              ) : isAbsent ? (
                                <span className="text-xs font-bold text-red-700">Abs</span>
                              ) : isHolidayOrLeave ? (
                                <span
                                  title={cell.holiday_label || undefined}
                                  className="text-[11px] font-semibold text-blue-800"
                                >
                                  {cell.status === 'holiday' ? 'Férié' : 'Congé'}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* VUE PAR JOUR */
        <div>
          <div className="mb-3 text-sm font-bold text-slate-700 capitalize">
            {formatFrenchDate(dayFilter)}
          </div>
          {loading ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-sm text-slate-600">
              Chargement des photos du jour...
            </div>
          ) : !dayData || dayData.cards.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-sm text-slate-600">
              Aucun employé trouvé pour cette sélection.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {dayData.cards.map((card) => {
                const empName = `${card.first_name} ${card.last_name}`;
                const cardBorder = card.is_late
                  ? 'border-2 border-amber-500'
                  : card.status === 'absent'
                  ? 'border border-red-200 bg-red-50/40'
                  : card.status === 'weekend'
                  ? 'border border-slate-200 bg-slate-50'
                  : 'border border-slate-200 bg-white';

                return (
                  <div
                    key={card.employee_id}
                    onClick={() => openModalFromCard(card, dayData.date)}
                    className={`rounded-2xl p-4 cursor-pointer hover:border-blue-600 transition flex flex-col gap-3 ${cardBorder}`}
                  >
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-900 truncate">{empName}</h3>
                        <p className="text-xs text-slate-500 truncate">
                          {card.job_title || 'Employé'}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-bold whitespace-nowrap ${
                          card.status === 'late'
                            ? 'text-amber-700'
                            : card.status === 'present'
                            ? 'text-emerald-700'
                            : card.status === 'absent'
                            ? 'text-red-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {card.status === 'late'
                          ? `En retard (${card.late_minutes} min)`
                          : card.status === 'present'
                          ? 'Présent'
                          : card.status === 'absent'
                          ? 'Absent'
                          : card.status === 'holiday'
                          ? 'Férié'
                          : card.status === 'leave'
                          ? 'Congé'
                          : card.status === 'weekend'
                          ? 'Week-end'
                          : 'À venir'}
                      </span>
                    </div>

                    {/* Side-by-side photos */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Arrival */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                        <div className="h-32 bg-slate-100 flex items-center justify-center overflow-hidden">
                          {card.checkin_photo_id ? (
                            <ProtectedPhotoImg
                              token={token}
                              photoId={card.checkin_photo_id}
                              attendanceId={card.attendance_id}
                              kind="checkin"
                              thumb
                              alt={`Arrivée ${empName}`}
                            />
                          ) : (
                            <span className="text-slate-400 text-xs flex flex-col items-center gap-1">
                              <Camera className="w-5 h-5 opacity-60" />
                              —
                            </span>
                          )}
                        </div>
                        <div className="px-2.5 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between gap-1">
                          <div>
                            <div className="text-[10px] font-semibold text-slate-500">Arrivée</div>
                            <div className="text-xs font-mono font-bold tabular-nums text-slate-900">
                              {card.checkin_time ? card.checkin_time.slice(0, 5) : '--:--'}
                            </div>
                          </div>
                          {card.checkin_photo_id && (
                            <button
                              type="button"
                              onClick={(e) =>
                                void handleDirectDownload(
                                  e,
                                  card.checkin_photo_id,
                                  card.attendance_id,
                                  'checkin',
                                  empName,
                                  dayData.date
                                )
                              }
                              title="Télécharger la photo d'arrivée"
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-blue-900"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Departure */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                        <div className="h-32 bg-slate-100 flex items-center justify-center overflow-hidden">
                          {card.checkout_photo_id ? (
                            <ProtectedPhotoImg
                              token={token}
                              photoId={card.checkout_photo_id}
                              attendanceId={card.attendance_id}
                              kind="checkout"
                              thumb
                              alt={`Départ ${empName}`}
                            />
                          ) : (
                            <span className="text-slate-400 text-xs flex flex-col items-center gap-1">
                              <Camera className="w-5 h-5 opacity-60" />
                              —
                            </span>
                          )}
                        </div>
                        <div className="px-2.5 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between gap-1">
                          <div>
                            <div className="text-[10px] font-semibold text-slate-500">Départ</div>
                            <div className="text-xs font-mono font-bold tabular-nums text-slate-900">
                              {card.checkout_time ? card.checkout_time.slice(0, 5) : '--:--'}
                            </div>
                          </div>
                          {card.checkout_photo_id && (
                            <button
                              type="button"
                              onClick={(e) =>
                                void handleDirectDownload(
                                  e,
                                  card.checkout_photo_id,
                                  card.attendance_id,
                                  'checkout',
                                  empName,
                                  dayData.date
                                )
                              }
                              title="Télécharger la photo de départ"
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-blue-900"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer info */}
                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                      <span className="font-mono tabular-nums">
                        Durée :{' '}
                        <strong className="text-slate-800">
                          {card.worked_minutes > 0
                            ? formatMinutesToHours(card.worked_minutes)
                            : '—'}
                        </strong>
                      </span>
                      <span className="font-mono truncate max-w-[140px]">
                        {card.checkin_ip || '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedDetail && (
        <PhotoAttendanceDetailModal
          token={token}
          detail={selectedDetail}
          onClose={() => setSelectedDetail(null)}
        />
      )}
    </div>
  );
};
