import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  FileEdit,
  FileSpreadsheet,
  Inbox,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Smartphone,
  Users,
  XCircle,
} from 'lucide-react';
import {
  ApiError,
  apiRequest,
  downloadAuthenticatedFile,
  formatFrenchDate,
  formatMinutesToHours,
  getCurrentMonthLocalIso,
  getTodayLocalIso,
  logoutAdmin,
} from '../api';
import type {
  AdminAlertsSummary,
  AdminAttendanceRow,
  AdminUser,
  AttendanceLogRow,
  CorrectionLogActionType,
  CorrectionLogItem,
  EmployeeListOption,
  MonthlyEmployeeRow,
  PublicConfig,
  TodayDashboardResponse,
} from '../types';
import { AdminCorrectionsTab } from './AdminCorrectionsTab';
import { AdminPhonesTab } from './AdminPhonesTab';
import { AdminPhotoCalendarTab } from './AdminPhotoCalendarTab';
import { AdminSuperAdminsTab } from './AdminSuperAdminsTab';
import { AdminSuperEmployeesTab } from './AdminSuperEmployeesTab';
import { AdminSuperSettingsTab } from './AdminSuperSettingsTab';
import { ManualPunchModal, type ManualPunchInitialValues } from './ManualPunchModal';
import {
  PhotoAttendanceDetailModal,
  ProtectedPhotoThumbnail,
  clearProtectedPhotoCache,
  type PhotoDetailModalPayload,
} from './ProtectedPhoto';

type AdminTab =
  | 'today'
  | 'corrections'
  | 'monthly'
  | 'photos'
  | 'history'
  | 'phones'
  | 'employees'
  | 'admins'
  | 'settings';

function formatLogTimestamp(iso: string): string {
  if (!iso) return '-';
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 16);
  const [y, m, d] = datePart.split('-');
  if (y && m && d) {
    return `${d}/${m}/${y}${timePart ? ` ${timePart}` : ''}`;
  }
  return iso;
}

function getActionLabel(actionType: CorrectionLogActionType): {
  label: string;
  className: string;
} {
  switch (actionType) {
    case 'manual_add':
      return { label: 'Ajout manuel', className: 'text-blue-800 bg-blue-50 border-blue-200' };
    case 'manual_edit':
      return { label: 'Modification manuelle', className: 'text-amber-900 bg-amber-50 border-amber-200' };
    case 'request_approved':
      return { label: 'Demande approuvée', className: 'text-emerald-800 bg-emerald-50 border-emerald-200' };
    case 'request_rejected':
      return { label: 'Demande refusée', className: 'text-red-800 bg-red-50 border-red-200' };
    case 'auto_close':
      return { label: 'Clôture automatique', className: 'text-slate-800 bg-slate-100 border-slate-300' };
    default:
      return { label: actionType, className: 'text-slate-700 bg-slate-100 border-slate-200' };
  }
}

interface AdminDashboardProps {
  token: string;
  admin: AdminUser;
  config: PublicConfig | null;
  onRefreshConfig: () => void;
  onLogout: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  token,
  admin: initialAdmin,
  config,
  onRefreshConfig,
  onLogout,
}) => {
  const [admin, setAdmin] = useState<AdminUser>(initialAdmin);
  const [activeTab, setActiveTab] = useState<AdminTab>('today');

  // Shared employee options for filters
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeListOption[]>([]);

  // Live alerts state
  const [alerts, setAlerts] = useState<AdminAlertsSummary>({
    today_unreported: 0,
    missing_checkouts_count: 0,
    pending_requests: 0,
    total_alerts: 0,
  });

  // Today tab state
  const [todayDate, setTodayDate] = useState(getTodayLocalIso());
  const [todayStatusFilter, setTodayStatusFilter] = useState<
    'all' | 'present' | 'late' | 'unreported' | 'missing_checkout' | 'absent'
  >('all');
  const [todayData, setTodayData] = useState<TodayDashboardResponse | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);

  // Monthly tab state
  const [monthFilter, setMonthFilter] = useState(getCurrentMonthLocalIso());
  const [monthlyEmpFilter, setMonthlyEmpFilter] = useState('');
  const [monthlyRows, setMonthlyRows] = useState<MonthlyEmployeeRow[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // History & Logs tab state
  const [historyMode, setHistoryMode] = useState<'daily' | 'logs' | 'corrections'>('daily');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [toDate, setToDate] = useState(getTodayLocalIso());
  const [historyEmpFilter, setHistoryEmpFilter] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [correctionActionFilter, setCorrectionActionFilter] = useState('all');
  const [historyRows, setHistoryRows] = useState<AdminAttendanceRow[]>([]);
  const [rawLogs, setRawLogs] = useState<AttendanceLogRow[]>([]);
  const [correctionLogs, setCorrectionLogs] = useState<CorrectionLogItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoDetailModalPayload | null>(null);

  // Manual punch modal state
  const [manualModalInitial, setManualModalInitial] = useState<ManualPunchInitialValues | null>(null);

  const isSuperAdmin = admin.role === 'super_admin';
  const todayIso = getTodayLocalIso();

  const handleLogoutClick = useCallback(() => {
    clearProtectedPhotoCache();
    void logoutAdmin();
    onLogout();
  }, [onLogout]);

  const loadEmployeeOptions = useCallback(async () => {
    try {
      const data = await apiRequest<{ employees: EmployeeListOption[] }>('/api/admin/employees/list', {
        token,
      });
      setEmployeeOptions(data.employees);
    } catch {
      // ignore non-fatal filter list error
    }
  }, [token]);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await apiRequest<AdminAlertsSummary>('/api/admin/alerts', { token });
      setAlerts(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
      }
    }
  }, [token, onLogout]);

  const loadToday = useCallback(async () => {
    setTodayLoading(true);
    setError(null);
    try {
      const data = await apiRequest<TodayDashboardResponse>(
        `/api/admin/dashboard/today?date=${encodeURIComponent(todayDate)}`,
        { token }
      );
      setTodayData(data);
      if (data.alerts) setAlerts(data.alerts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Erreur lors du chargement du jour.');
    } finally {
      setTodayLoading(false);
    }
  }, [token, todayDate, onLogout]);

  const loadMonthly = useCallback(async () => {
    setMonthlyLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month: monthFilter });
      if (monthlyEmpFilter) params.set('employeeId', monthlyEmpFilter);
      const data = await apiRequest<{ rows: MonthlyEmployeeRow[] }>(
        `/api/admin/dashboard/monthly?${params.toString()}`,
        { token }
      );
      setMonthlyRows(data.rows);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Erreur lors du chargement du bilan mensuel.');
    } finally {
      setMonthlyLoading(false);
    }
  }, [token, monthFilter, monthlyEmpFilter, onLogout]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (historyEmpFilter) params.set('employeeId', historyEmpFilter);

      if (historyMode === 'daily') {
        params.set('status', historyStatusFilter);
        const data = await apiRequest<{ records: AdminAttendanceRow[] }>(
          `/api/admin/attendance?${params.toString()}`,
          { token }
        );
        setHistoryRows(data.records);
      } else if (historyMode === 'logs') {
        const data = await apiRequest<{ logs: AttendanceLogRow[] }>(
          `/api/admin/logs?${params.toString()}`,
          { token }
        );
        setRawLogs(data.logs);
      } else {
        params.set('actionType', correctionActionFilter);
        const data = await apiRequest<{ logs: CorrectionLogItem[] }>(
          `/api/admin/correction-logs?${params.toString()}`,
          { token }
        );
        setCorrectionLogs(data.logs);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Erreur lors du chargement de l'historique.");
    } finally {
      setHistoryLoading(false);
    }
  }, [
    token,
    fromDate,
    toDate,
    historyEmpFilter,
    historyStatusFilter,
    correctionActionFilter,
    historyMode,
    onLogout,
  ]);

  useEffect(() => {
    void loadEmployeeOptions();
    void loadAlerts();
    const timer = setInterval(() => {
      void loadAlerts();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadEmployeeOptions, loadAlerts]);

  useEffect(() => {
    if (activeTab === 'today') void loadToday();
    if (activeTab === 'monthly') void loadMonthly();
    if (activeTab === 'history') void loadHistory();
  }, [activeTab, loadToday, loadMonthly, loadHistory]);

  const handleManualSaved = (message: string) => {
    setManualModalInitial(null);
    setSuccessMsg(message);
    void loadAlerts();
    if (activeTab === 'today') void loadToday();
    if (activeTab === 'history') void loadHistory();
    if (activeTab === 'monthly') void loadMonthly();
  };

  const handleExportMonthlyExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month: monthFilter });
      if (monthlyEmpFilter) params.set('employeeId', monthlyEmpFilter);
      await downloadAuthenticatedFile(
        `/api/admin/export/excel?${params.toString()}`,
        token,
        `Rapport-pointage-${monthFilter}.xlsx`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'export Excel.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportHistoryExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const targetMonth = /^\d{4}-\d{2}/.test(fromDate)
        ? fromDate.slice(0, 7)
        : getCurrentMonthLocalIso();
      const params = new URLSearchParams({ month: targetMonth });
      if (historyEmpFilter) params.set('employeeId', historyEmpFilter);
      await downloadAuthenticatedFile(
        `/api/admin/export/excel?${params.toString()}`,
        token,
        `Rapport-pointage-${targetMonth}.xlsx`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'export Excel.");
    } finally {
      setExporting(false);
    }
  };

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeColor?: 'amber' | 'red';
    superOnly?: boolean;
  }> = [
    {
      id: 'today',
      label: "Aujourd'hui",
      icon: <Clock className="w-4 h-4" />,
      badge: alerts.today_unreported,
      badgeColor: 'amber',
    },
    {
      id: 'corrections',
      label: "Demandes d'oubli",
      icon: <Inbox className="w-4 h-4" />,
      badge: alerts.pending_requests,
      badgeColor: 'red',
    },
    { id: 'monthly', label: 'Bilan mensuel', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: 'photos', label: 'Calendrier photos', icon: <Camera className="w-4 h-4" /> },
    { id: 'history', label: 'Historique & Logs', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'phones', label: 'Connexion des téléphones', icon: <Smartphone className="w-4 h-4" /> },
    { id: 'employees', label: 'Employés', icon: <Users className="w-4 h-4" />, superOnly: true },
    { id: 'admins', label: 'Administrateurs', icon: <Shield className="w-4 h-4" />, superOnly: true },
    { id: 'settings', label: 'Paramètres', icon: <Settings className="w-4 h-4" />, superOnly: true },
  ];

  const visibleNavItems = navItems.filter((item) => !item.superOnly || isSuperAdmin);

  const filteredTodayEmployees =
    todayData?.employees.filter((emp) => {
      if (todayStatusFilter === 'all') return true;
      return emp.status === todayStatusFilter;
    }) || [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="no-print bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {config?.logo_data_url ? (
              <img
                src={config.logo_data_url}
                alt={config.company_name}
                className="h-9 w-9 rounded-lg object-contain border border-slate-200 bg-white p-0.5 shrink-0"
              />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-blue-900 text-white flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <span className="text-lg font-bold text-slate-900 truncate block">
                {config?.company_name || 'Pointage Entreprise'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {alerts.total_alerts > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (alerts.pending_requests > 0) setActiveTab('corrections');
                  else if (alerts.today_unreported > 0) {
                    setActiveTab('today');
                    setTodayStatusFilter('unreported');
                  } else {
                    setActiveTab('history');
                    setHistoryMode('daily');
                    setHistoryStatusFilter('missing_checkout');
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
              >
                <Bell className="w-3.5 h-3.5 text-amber-700" />
                <span className="font-mono tabular-nums">{alerts.total_alerts}</span>{' '}
                alerte{alerts.total_alerts > 1 ? 's' : ''}
              </button>
            )}

            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-slate-900">{admin.username}</p>
              <p className="text-xs text-slate-500">
                {isSuperAdmin ? 'Super Administrateur' : 'Administrateur'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogoutClick}
              className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
            >
              <LogOut className="w-4 h-4" />
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-6">
        {/* Default Password Reminder for Super Admin */}
        {isSuperAdmin && admin.must_change_password && (
          <div className="no-print mb-5 rounded-2xl bg-amber-50 border border-amber-300 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-amber-950">
                Sécurité : vous utilisez encore le mot de passe par défaut. Pensez à le modifier dans Paramètres.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="rounded-xl bg-amber-800 px-4 py-2 text-xs font-bold text-white hover:bg-amber-900 whitespace-nowrap shrink-0"
            >
              Changer le mot de passe
            </button>
          </div>
        )}

        {/* Live Alerts Banner */}
        {alerts.total_alerts > 0 && (
          <div className="no-print mb-5 rounded-2xl bg-amber-50 border border-amber-300 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-amber-950">
              <Bell className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="font-bold">Alertes en direct :</span>
              {alerts.today_unreported > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('today');
                    setTodayDate(todayIso);
                    setTodayStatusFilter('unreported');
                  }}
                  className="rounded-lg bg-white border border-amber-300 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                >
                  {alerts.today_unreported} non signalé{alerts.today_unreported > 1 ? 's' : ''} aujourd'hui
                </button>
              )}
              {alerts.missing_checkouts_count > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('history');
                    setHistoryMode('daily');
                    setHistoryStatusFilter('missing_checkout');
                  }}
                  className="rounded-lg bg-white border border-red-200 px-2.5 py-1 text-xs font-bold text-red-800 hover:bg-red-50 whitespace-nowrap"
                >
                  {alerts.missing_checkouts_count} départ{alerts.missing_checkouts_count > 1 ? 's' : ''} manquant{alerts.missing_checkouts_count > 1 ? 's' : ''}
                </button>
              )}
              {alerts.pending_requests > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('corrections')}
                  className="rounded-lg bg-white border border-blue-200 px-2.5 py-1 text-xs font-bold text-blue-900 hover:bg-blue-50 whitespace-nowrap"
                >
                  {alerts.pending_requests} demande{alerts.pending_requests > 1 ? 's' : ''} d'oubli en attente
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <nav
          aria-label="Navigation administration"
          className="no-print mb-6 flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200"
        >
          {visibleNavItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccessMsg(null);
                  setActiveTab(item.id);
                  if (item.id !== 'employees') void loadEmployeeOptions();
                }}
                className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl border-b-2 transition whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-blue-900 text-blue-900 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold font-mono tabular-nums ${
                      item.badgeColor === 'red'
                        ? 'bg-red-100 text-red-800 border border-red-200'
                        : 'bg-amber-100 text-amber-900 border border-amber-200'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {error && (
          <div className="no-print mb-6 rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-sm font-semibold text-red-900">
            <AlertCircle className="w-5 h-5 text-red-700 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="no-print mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3 text-sm font-semibold text-emerald-900">
            <Check className="w-5 h-5 text-emerald-700 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* TAB 1: TODAY */}
        {activeTab === 'today' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900">Présences du jour</h1>
                <input
                  type="date"
                  value={todayDate}
                  onChange={(e) => setTodayDate(e.target.value)}
                  className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-900"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setManualModalInitial({
                      workDate: todayDate <= todayIso ? todayDate : todayIso,
                    })
                  }
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-blue-900 px-4 py-2 text-sm font-bold text-white hover:bg-blue-950 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter un pointage
                </button>
                <button
                  type="button"
                  onClick={() => void loadToday()}
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <RefreshCw className="w-4 h-4" />
                  Actualiser
                </button>
              </div>
            </div>

            {/* 5 KPI Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
                <p className="text-xs font-semibold text-slate-500">Effectif actif</p>
                <p className="mt-1 text-3xl font-extrabold font-mono text-slate-900 tabular-nums">
                  {todayData?.summary.total_active ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
                <p className="text-xs font-semibold text-emerald-700">Présents (à l'heure)</p>
                <p className="mt-1 text-3xl font-extrabold font-mono text-emerald-700 tabular-nums">
                  {todayData?.summary.on_time ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
                <p className="text-xs font-semibold text-amber-700">En retard</p>
                <p className="mt-1 text-3xl font-extrabold font-mono text-amber-700 tabular-nums">
                  {todayData?.summary.late ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
                <p className="text-xs font-semibold text-orange-700">Non signalés</p>
                <p className="mt-1 text-3xl font-extrabold font-mono text-orange-700 tabular-nums">
                  {todayData?.summary.unreported ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
                <p className="text-xs font-semibold text-red-700">Absents / Dép. manquant</p>
                <p className="mt-1 text-3xl font-extrabold font-mono text-red-700 tabular-nums">
                  {(todayData?.summary.absent ?? 0) + (todayData?.summary.missing_checkout ?? 0)}
                </p>
              </div>
            </div>

            {/* Segmented Filter */}
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
              {(
                [
                  ['all', 'Tous'],
                  ['present', 'À l’heure'],
                  ['late', 'En retard'],
                  ['unreported', `Non signalés (${todayData?.summary.unreported ?? 0})`],
                  [
                    'missing_checkout',
                    `Départ manquant (${todayData?.summary.missing_checkout ?? 0})`,
                  ],
                  ['absent', 'Absents'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTodayStatusFilter(key)}
                  className={`min-h-[36px] px-3.5 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                    todayStatusFilter === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              {todayLoading ? (
                <div className="p-8 text-center text-sm text-slate-600">Chargement...</div>
              ) : filteredTodayEmployees.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-600">
                  {todayData?.summary.total_active === 0
                    ? "Aucun employé actif. Ajoutez des employés dans l'onglet Employés."
                    : 'Aucun employé dans cette catégorie.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Employé</th>
                        <th className="py-3 px-4">Poste / Horaire</th>
                        <th className="py-3 px-4">Statut</th>
                        <th className="py-3 px-4 text-right">Arrivée</th>
                        <th className="py-3 px-4 text-right">Départ</th>
                        <th className="py-3 px-4 text-right">Durée</th>
                        <th className="py-3 px-4">Photos</th>
                        <th className="py-3 px-4 text-right">IP</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {filteredTodayEmployees.map((emp) => {
                        const empName = `${emp.first_name} ${emp.last_name}`;
                        return (
                          <tr key={emp.employee_id} className="hover:bg-slate-50">
                            <td className="py-3.5 px-4 font-bold text-slate-900">
                              <div className="flex flex-wrap items-center gap-2">
                                <span>{empName}</span>
                                {emp.is_corrected && (
                                  <span
                                    title={emp.last_correction_reason || 'Pointage corrigé'}
                                    className="text-[11px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5"
                                  >
                                    Corrigé
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-600">
                              <div>{emp.job_title || '-'}</div>
                              {emp.shift_start && (
                                <div className="text-[11px] font-mono text-slate-400">
                                  {emp.shift_start}
                                  {emp.shift_end ? `–${emp.shift_end}` : ''} (+{emp.grace_minutes ?? 0}m)
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4">
                              {emp.status === 'present' && (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                                  <CheckCircle2 className="w-4 h-4" />
                                  Présent
                                </span>
                              )}
                              {emp.status === 'late' && (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                                  <AlertTriangle className="w-4 h-4" />
                                  En retard ({emp.late_minutes} min)
                                </span>
                              )}
                              {emp.status === 'unreported' && (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-orange-700">
                                  <AlertTriangle className="w-4 h-4" />
                                  Non signalé
                                </span>
                              )}
                              {emp.status === 'missing_checkout' && (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                                  <AlertTriangle className="w-4 h-4" />
                                  Départ manquant
                                  {emp.late_minutes > 0 ? ` · Retard ${emp.late_minutes}m` : ''}
                                </span>
                              )}
                              {emp.status === 'absent' && (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                                  <XCircle className="w-4 h-4" />
                                  Absent
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                              {emp.checkin_time ? emp.checkin_time.slice(0, 5) : '-'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                              {emp.checkout_time ? emp.checkout_time.slice(0, 5) : '-'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                              {emp.worked_minutes > 0 ? formatMinutesToHours(emp.worked_minutes) : '-'}
                            </td>
                            <td className="py-2.5 px-4">
                              {emp.attendance_id && (emp.has_checkin_photo || emp.has_checkout_photo) ? (
                                <div className="flex items-center gap-1.5">
                                  {emp.has_checkin_photo && (
                                    <ProtectedPhotoThumbnail
                                      token={token}
                                      photoId={emp.checkin_photo_id}
                                      attendanceId={emp.attendance_id}
                                      kind="checkin"
                                      employeeName={empName}
                                      onOpen={() =>
                                        setSelectedPhoto({
                                          employeeName: empName,
                                          jobTitle: emp.job_title,
                                          dateIso: todayDate,
                                          dateLabel: formatFrenchDate(todayDate),
                                          attendanceId: emp.attendance_id,
                                          status: emp.status,
                                          checkinTime: emp.checkin_time,
                                          checkoutTime: emp.checkout_time,
                                          lateMinutes: emp.late_minutes,
                                          workedMinutes: emp.worked_minutes,
                                          checkinIp: emp.checkin_ip,
                                          checkoutIp: emp.checkout_ip,
                                          checkinPhotoId: emp.checkin_photo_id,
                                          checkoutPhotoId: emp.checkout_photo_id,
                                          hasCheckinPhoto: emp.has_checkin_photo,
                                          hasCheckoutPhoto: emp.has_checkout_photo,
                                        })
                                      }
                                    />
                                  )}
                                  {emp.has_checkout_photo && (
                                    <ProtectedPhotoThumbnail
                                      token={token}
                                      photoId={emp.checkout_photo_id}
                                      attendanceId={emp.attendance_id}
                                      kind="checkout"
                                      employeeName={empName}
                                      onOpen={() =>
                                        setSelectedPhoto({
                                          employeeName: empName,
                                          jobTitle: emp.job_title,
                                          dateIso: todayDate,
                                          dateLabel: formatFrenchDate(todayDate),
                                          attendanceId: emp.attendance_id,
                                          status: emp.status,
                                          checkinTime: emp.checkin_time,
                                          checkoutTime: emp.checkout_time,
                                          lateMinutes: emp.late_minutes,
                                          workedMinutes: emp.worked_minutes,
                                          checkinIp: emp.checkin_ip,
                                          checkoutIp: emp.checkout_ip,
                                          checkinPhotoId: emp.checkin_photo_id,
                                          checkoutPhotoId: emp.checkout_photo_id,
                                          hasCheckinPhoto: emp.has_checkin_photo,
                                          hasCheckoutPhoto: emp.has_checkout_photo,
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">-</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-500">
                              {emp.checkin_ip || '-'}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {todayDate <= todayIso && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualModalInitial({
                                      employeeId: emp.employee_id,
                                      workDate: todayDate,
                                      checkinTime: emp.checkin_time,
                                      checkoutTime: emp.checkout_time,
                                      lockEmployeeAndDate: true,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  {emp.checkin_time ? 'Corriger' : 'Ajouter'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: DEMANDES D'OUBLI */}
        {activeTab === 'corrections' && (
          <AdminCorrectionsTab
            token={token}
            employeeOptions={employeeOptions}
            onUnauthorized={handleLogoutClick}
            onChanged={() => {
              void loadAlerts();
            }}
          />
        )}

        {/* TAB 2: MONTHLY */}
        {activeTab === 'monthly' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Mois</label>
                  <input
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Employé</label>
                  <select
                    value={monthlyEmpFilter}
                    onChange={(e) => setMonthlyEmpFilter(e.target.value)}
                    className="min-h-[40px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">Tous les employés</option>
                    {employeeOptions.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.first_name} {emp.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportMonthlyExcel}
                disabled={exporting}
                className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {exporting ? 'Génération Excel...' : 'Exporter le rapport Excel'}
              </button>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              {monthlyLoading ? (
                <div className="p-8 text-center text-sm text-slate-600">Chargement...</div>
              ) : monthlyRows.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-600">Aucune donnée pour ce mois.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Employé</th>
                        <th className="py-3 px-4">Poste</th>
                        <th className="py-3 px-4 text-right">Jours attendus</th>
                        <th className="py-3 px-4 text-right">Présents</th>
                        <th className="py-3 px-4 text-right">Absences</th>
                        <th className="py-3 px-4 text-right">Retards</th>
                        <th className="py-3 px-4 text-right">Retard cumulé</th>
                        <th className="py-3 px-4 text-right">Manquants</th>
                        <th className="py-3 px-4 text-right">Corrigés</th>
                        <th className="py-3 px-4 text-right">Heures travaillées</th>
                        <th className="py-3 px-4 text-right">Taux</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {monthlyRows.map((row) => (
                        <tr key={row.employee_id} className="hover:bg-slate-50">
                          <td className="py-3.5 px-4 font-bold text-slate-900">
                            {row.first_name} {row.last_name}
                            {!row.is_active && (
                              <span className="ml-2 text-xs font-normal text-slate-500">(Inactif)</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600">{row.job_title || '-'}</td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {row.expected_working_days}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold tabular-nums text-emerald-800">
                            {row.days_present}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold tabular-nums text-red-700">
                            {row.days_absent}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-amber-800">
                            {row.days_late}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {formatMinutesToHours(row.total_late_minutes)}
                          </td>
                          <td
                            className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums ${
                              row.missing_punches > 0 ? 'text-red-700' : 'text-slate-400'
                            }`}
                          >
                            {row.missing_punches}
                          </td>
                          <td
                            className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums ${
                              row.corrected_punches > 0 ? 'text-blue-800' : 'text-slate-400'
                            }`}
                          >
                            {row.corrected_punches}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold tabular-nums text-blue-900">
                            {formatMinutesToHours(row.total_worked_minutes)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                            {row.attendance_rate}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: CALENDRIER PHOTOS */}
        {activeTab === 'photos' && (
          <AdminPhotoCalendarTab
            token={token}
            employeeOptions={employeeOptions}
            onUnauthorized={handleLogoutClick}
          />
        )}

        {/* TAB 3: HISTORY & LOGS */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
                <button
                  type="button"
                  onClick={() => setHistoryMode('daily')}
                  className={`min-h-[36px] px-3.5 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                    historyMode === 'daily' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Présences journalières
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryMode('logs')}
                  className={`min-h-[36px] px-3.5 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                    historyMode === 'logs' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Journal des pointages (IP)
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryMode('corrections')}
                  className={`min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                    historyMode === 'corrections'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  <FileEdit className="w-3.5 h-3.5" />
                  Journal des corrections
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setManualModalInitial({ workDate: todayIso })}
                  className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-blue-900 px-4 py-2 text-sm font-bold text-white hover:bg-blue-950 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter un pointage
                </button>
                {historyMode === 'daily' && (
                  <button
                    type="button"
                    onClick={handleExportHistoryExcel}
                    disabled={exporting}
                    className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    {exporting ? 'Génération Excel...' : 'Exporter le rapport Excel'}
                  </button>
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Du</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Au</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Employé</label>
                <select
                  value={historyEmpFilter}
                  onChange={(e) => setHistoryEmpFilter(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm bg-white"
                >
                  <option value="">Tous les employés</option>
                  {employeeOptions.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </option>
                  ))}
                </select>
              </div>
              {historyMode === 'daily' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Statut</label>
                  <select
                    value={historyStatusFilter}
                    onChange={(e) => setHistoryStatusFilter(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm bg-white"
                  >
                    <option value="all">Tous</option>
                    <option value="on_time">À l'heure</option>
                    <option value="late">En retard</option>
                    <option value="missing_checkout">Départ manquant</option>
                    <option value="corrected">Corrigés</option>
                  </select>
                </div>
              )}
              {historyMode === 'corrections' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Type d'action
                  </label>
                  <select
                    value={correctionActionFilter}
                    onChange={(e) => setCorrectionActionFilter(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm bg-white"
                  >
                    <option value="all">Toutes les actions</option>
                    <option value="manual_add">Ajout manuel</option>
                    <option value="manual_edit">Modification manuelle</option>
                    <option value="request_approved">Demande approuvée</option>
                    <option value="request_rejected">Demande refusée</option>
                    <option value="auto_close">Clôture automatique</option>
                  </select>
                </div>
              )}
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              {historyLoading ? (
                <div className="p-8 text-center text-sm text-slate-600">Chargement...</div>
              ) : historyMode === 'daily' ? (
                historyRows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-600">
                    Aucun pointage trouvé pour cette période.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Employé</th>
                          <th className="py-3 px-4">Statut</th>
                          <th className="py-3 px-4 text-right">Arrivée</th>
                          <th className="py-3 px-4 text-right">Départ</th>
                          <th className="py-3 px-4 text-right">Durée</th>
                          <th className="py-3 px-4">Photos</th>
                          <th className="py-3 px-4 text-right">IP</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {historyRows.map((r) => {
                          const empName = `${r.first_name} ${r.last_name}`;
                          const hasIn = Boolean(r.has_checkin_photo);
                          const hasOut = Boolean(r.has_checkout_photo);
                          const isMissingOut = Boolean(
                            r.checkin_time &&
                              !r.checkout_time &&
                              (r.checkout_missing === 1 || r.work_date < todayIso)
                          );
                          const modalStatus = isMissingOut
                            ? 'missing_checkout'
                            : r.is_late === 1
                            ? 'late'
                            : 'present';
                          return (
                            <tr key={r.id} className="hover:bg-slate-50">
                              <td className="py-3.5 px-4 font-medium text-slate-900 capitalize">
                                {formatFrenchDate(r.work_date)}
                              </td>
                              <td className="py-3.5 px-4 font-bold text-slate-900">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>{empName}</span>
                                  {r.is_corrected === 1 && (
                                    <span
                                      title={r.last_correction_reason || 'Corrigé'}
                                      className="text-[11px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5"
                                    >
                                      Corrigé
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                {isMissingOut ? (
                                  <span className="font-semibold text-red-700">
                                    Départ manquant
                                    {r.is_late === 1 ? ` · Retard ${r.late_minutes}m` : ''}
                                  </span>
                                ) : r.is_late === 1 ? (
                                  <span className="font-semibold text-amber-700">
                                    En retard ({r.late_minutes} min)
                                  </span>
                                ) : (
                                  <span className="font-semibold text-emerald-700">À l'heure</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                                {r.checkin_time ? r.checkin_time.slice(0, 5) : '-'}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                                {r.checkout_time ? r.checkout_time.slice(0, 5) : '-'}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                                {r.worked_minutes > 0 ? formatMinutesToHours(r.worked_minutes) : '-'}
                              </td>
                              <td className="py-2.5 px-4">
                                {hasIn || hasOut ? (
                                  <div className="flex items-center gap-1.5">
                                    {hasIn && (
                                      <ProtectedPhotoThumbnail
                                        token={token}
                                        photoId={r.checkin_photo_id}
                                        attendanceId={r.id}
                                        kind="checkin"
                                        employeeName={empName}
                                        onOpen={() =>
                                          setSelectedPhoto({
                                            employeeName: empName,
                                            jobTitle: r.job_title,
                                            dateIso: r.work_date,
                                            dateLabel: formatFrenchDate(r.work_date),
                                            attendanceId: r.id,
                                            status: modalStatus,
                                            checkinTime: r.checkin_time,
                                            checkoutTime: r.checkout_time,
                                            lateMinutes: r.late_minutes,
                                            workedMinutes: r.worked_minutes,
                                            checkinIp: r.checkin_ip,
                                            checkoutIp: r.checkout_ip,
                                            checkinPhotoId: r.checkin_photo_id,
                                            checkoutPhotoId: r.checkout_photo_id,
                                            hasCheckinPhoto: hasIn,
                                            hasCheckoutPhoto: hasOut,
                                          })
                                        }
                                      />
                                    )}
                                    {hasOut && (
                                      <ProtectedPhotoThumbnail
                                        token={token}
                                        photoId={r.checkout_photo_id}
                                        attendanceId={r.id}
                                        kind="checkout"
                                        employeeName={empName}
                                        onOpen={() =>
                                          setSelectedPhoto({
                                            employeeName: empName,
                                            jobTitle: r.job_title,
                                            dateIso: r.work_date,
                                            dateLabel: formatFrenchDate(r.work_date),
                                            attendanceId: r.id,
                                            status: modalStatus,
                                            checkinTime: r.checkin_time,
                                            checkoutTime: r.checkout_time,
                                            lateMinutes: r.late_minutes,
                                            workedMinutes: r.worked_minutes,
                                            checkinIp: r.checkin_ip,
                                            checkoutIp: r.checkout_ip,
                                            checkinPhotoId: r.checkin_photo_id,
                                            checkoutPhotoId: r.checkout_photo_id,
                                            hasCheckinPhoto: hasIn,
                                            hasCheckoutPhoto: hasOut,
                                          })
                                        }
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">-</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono text-xs text-slate-500">
                                {r.checkin_ip || '-'}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setManualModalInitial({
                                      employeeId: r.employee_id,
                                      workDate: r.work_date,
                                      checkinTime: r.checkin_time,
                                      checkoutTime: r.checkout_time,
                                      lockEmployeeAndDate: true,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  Modifier
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              ) : historyMode === 'logs' ? (
                rawLogs.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-600">
                    Aucun événement enregistré pour cette période.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Heure</th>
                          <th className="py-3 px-4">Employé</th>
                          <th className="py-3 px-4">Action</th>
                          <th className="py-3 px-4 text-right">Adresse IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {rawLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-mono tabular-nums">{log.log_date}</td>
                            <td className="py-3 px-4 font-mono tabular-nums">{log.log_time}</td>
                            <td className="py-3 px-4 font-bold text-slate-900">{log.employee_name}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`font-semibold ${
                                  log.action === 'checkin' ? 'text-emerald-700' : 'text-red-700'
                                }`}
                              >
                                {log.action === 'checkin' ? 'Arrivée' : 'Départ'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-xs text-slate-600">
                              {log.ip_address}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : correctionLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-600">
                  Aucune correction ou clôture enregistrée pour cette période.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Quand</th>
                        <th className="py-3 px-4">Qui</th>
                        <th className="py-3 px-4">Employé &amp; Date</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Ancienne valeur</th>
                        <th className="py-3 px-4">Nouvelle valeur</th>
                        <th className="py-3 px-4">Motif</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {correctionLogs.map((cl) => {
                        const badge = getActionLabel(cl.action_type);
                        return (
                          <tr key={cl.id} className="hover:bg-slate-50 align-top">
                            <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                              {formatLogTimestamp(cl.created_at)}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                              {cl.actor_username}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-900">{cl.employee_name}</div>
                              <div className="text-xs text-slate-500 capitalize">
                                {formatFrenchDate(cl.work_date)}
                              </div>
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-block rounded-md border px-2 py-0.5 text-xs font-bold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-600">
                              {cl.old_value}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">
                              {cl.new_value}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700 max-w-xs">
                              {cl.reason}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: CONNEXION DES TELEPHONES */}
        {activeTab === 'phones' && (
          <AdminPhonesTab
            token={token}
            config={config}
            onUnauthorized={handleLogoutClick}
          />
        )}

        {/* TAB 4: EMPLOYEES (SUPER ADMIN) */}
        {activeTab === 'employees' && isSuperAdmin && (
          <AdminSuperEmployeesTab
            token={token}
            companyName={config?.company_name || 'Mon Entreprise'}
          />
        )}

        {/* TAB 5: ADMINS (SUPER ADMIN) */}
        {activeTab === 'admins' && isSuperAdmin && (
          <AdminSuperAdminsTab token={token} currentAdminId={admin.id} />
        )}

        {/* TAB 6: SETTINGS & BACKUP (SUPER ADMIN) */}
        {activeTab === 'settings' && isSuperAdmin && (
          <AdminSuperSettingsTab
            token={token}
            onSettingsUpdated={onRefreshConfig}
            onPasswordChanged={() => setAdmin((prev) => ({ ...prev, must_change_password: false }))}
          />
        )}
      </div>

      {selectedPhoto && (
        <PhotoAttendanceDetailModal
          token={token}
          detail={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
        />
      )}

      {manualModalInitial && (
        <ManualPunchModal
          token={token}
          employeeOptions={employeeOptions}
          initialValues={manualModalInitial}
          onClose={() => setManualModalInitial(null)}
          onSaved={handleManualSaved}
        />
      )}
    </div>
  );
};
