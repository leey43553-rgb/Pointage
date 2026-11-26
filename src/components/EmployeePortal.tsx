import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  FileEdit,
  LogIn,
  LogOut,
  RotateCcw,
  Send,
  Timer,
} from 'lucide-react';
import {
  ApiError,
  apiFormDataRequest,
  apiRequest,
  formatFrenchDate,
  formatMinutesToHours,
  getTodayLocalIso,
} from '../api';
import { compressAttendancePhoto } from '../imageCompress';
import type {
  AttendanceRecord,
  CorrectionRequestItem,
  EmployeeProfile,
  MissingYesterdayInfo,
  PhotoRequirement,
  PublicConfig,
} from '../types';

const INACTIVITY_TIMEOUT_SECONDS = 30;
const CORRECTION_FORM_TIMEOUT_SECONDS = 90;

interface EmployeePortalProps {
  token: string;
  employee: EmployeeProfile;
  initialAttendance: AttendanceRecord | null;
  initialMissingYesterday?: MissingYesterdayInfo | null;
  photoRequirement: PhotoRequirement;
  config: PublicConfig | null;
  onLogout: () => void;
}

interface PendingPhotoState {
  action: 'checkin' | 'checkout';
  blob: Blob | null;
  previewUrl: string | null;
  compressing: boolean;
}

function getYesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const EmployeePortal: React.FC<EmployeePortalProps> = ({
  token,
  employee,
  initialAttendance,
  initialMissingYesterday = null,
  photoRequirement,
  config,
  onLogout,
}) => {
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(initialAttendance);
  const [missingYesterday, setMissingYesterday] = useState<MissingYesterdayInfo | null>(
    initialMissingYesterday
  );
  const [view, setView] = useState<'main' | 'history' | 'correction'>('main');
  const [historyRecords, setHistoryRecords] = useState<AttendanceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'checkin' | 'checkout' | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(INACTIVITY_TIMEOUT_SECONDS);
  const [now, setNow] = useState(() => new Date());
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhotoState | null>(null);
  const [cameraOpenPause, setCameraOpenPause] = useState(false);

  // Correction request ("J'ai oublié de pointer") state
  const [reqDate, setReqDate] = useState(getYesterdayIso());
  const [reqType, setReqType] = useState<'checkin' | 'checkout'>('checkout');
  const [reqTime, setReqTime] = useState(employee.shift_end || '17:00');
  const [reqReason, setReqReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqSuccess, setReqSuccess] = useState<string | null>(null);
  const [requestsList, setRequestsList] = useState<CorrectionRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke preview object URL on change/unmount
  useEffect(() => {
    const url = pendingPhoto?.previewUrl;
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [pendingPhoto?.previewUrl]);

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-logout after inactivity (paused while native camera app is open)
  const resetInactivity = useCallback(
    (overrideView?: 'main' | 'history' | 'correction') => {
      const activeView = overrideView ?? view;
      setSecondsLeft(
        activeView === 'correction'
          ? CORRECTION_FORM_TIMEOUT_SECONDS
          : INACTIVITY_TIMEOUT_SECONDS
      );
    },
    [view]
  );

  useEffect(() => {
    const handleActivity = () => resetInactivity();
    const handleFocusOrVisible = () => {
      setCameraOpenPause(false);
      resetInactivity();
    };
    const events = ['pointerdown', 'touchstart', 'keydown', 'input', 'scroll', 'mousemove'];
    events.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    const interval = setInterval(() => {
      if (cameraOpenPause) return;
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handleActivity));
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      clearInterval(interval);
    };
  }, [onLogout, resetInactivity, cameraOpenPause]);

  const submitAttendance = async (action: 'checkin' | 'checkout', photoBlob: Blob | null) => {
    if (actionLoading) return;
    setActionLoading(action);
    setError(null);
    setConfirmation(null);
    resetInactivity();

    try {
      const endpoint = action === 'checkin' ? '/api/attendance/checkin' : '/api/attendance/checkout';
      let data: { attendance: AttendanceRecord; message: string };

      if (photoBlob) {
        const formData = new FormData();
        const photoFile =
          photoBlob instanceof File
            ? photoBlob
            : new File([photoBlob], `${action}.jpg`, { type: 'image/jpeg' });
        formData.append('photo', photoFile, `${action}.jpg`);
        data = await apiFormDataRequest<{ attendance: AttendanceRecord; message: string }>(endpoint, {
          method: 'POST',
          formData,
          token,
        });
      } else {
        data = await apiRequest<{ attendance: AttendanceRecord; message: string }>(endpoint, {
          method: 'POST',
          token,
        });
      }

      setTodayAttendance(data.attendance);
      setConfirmation(data.message);
      setPendingPhoto(null);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onLogout();
          return;
        }
        setError(err.message);
      } else {
        setError(
          action === 'checkin'
            ? "Impossible d'enregistrer votre arrivée."
            : "Impossible d'enregistrer votre départ."
        );
      }
    } finally {
      setActionLoading(null);
      setCameraOpenPause(false);
    }
  };

  const handlePressCheckin = () => {
    if (actionLoading || todayAttendance?.checkin_time) return;
    resetInactivity();
    setError(null);
    setConfirmation(null);

    if (photoRequirement === 'checkin_only' || photoRequirement === 'both') {
      setPendingPhoto({
        action: 'checkin',
        blob: null,
        previewUrl: null,
        compressing: false,
      });
      return;
    }

    void submitAttendance('checkin', null);
  };

  const handlePressCheckout = () => {
    if (actionLoading || !todayAttendance?.checkin_time || todayAttendance?.checkout_time) return;
    resetInactivity();
    setError(null);
    setConfirmation(null);

    if (photoRequirement === 'both') {
      setPendingPhoto({
        action: 'checkout',
        blob: null,
        previewUrl: null,
        compressing: false,
      });
      return;
    }

    void submitAttendance('checkout', null);
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setCameraOpenPause(false);
    resetInactivity();

    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !pendingPhoto) return;

    setError(null);
    setPendingPhoto((prev) => (prev ? { ...prev, compressing: true } : prev));

    try {
      const { blob, previewUrl } = await compressAttendancePhoto(file);
      setPendingPhoto((prev) =>
        prev
          ? {
              ...prev,
              blob,
              previewUrl,
              compressing: false,
            }
          : prev
      );
      resetInactivity();
    } catch (err) {
      setPendingPhoto((prev) => (prev ? { ...prev, compressing: false } : prev));
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de préparer la photo. Veuillez réessayer.'
      );
    }
  };

  const openHistory = async () => {
    resetInactivity('history');
    setPendingPhoto(null);
    setView('history');
    setHistoryLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ records: AttendanceRecord[] }>('/api/employee/history', {
        token,
      });
      setHistoryRecords(data.records);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError('Impossible de charger votre historique.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadCorrectionRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const data = await apiRequest<{ requests: CorrectionRequestItem[] }>(
        '/api/employee/correction-requests',
        { token }
      );
      setRequestsList(data.requests);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
      }
    } finally {
      setRequestsLoading(false);
    }
  }, [token, onLogout]);

  const openCorrectionView = (prefill?: {
    workDate?: string;
    punchType?: 'checkin' | 'checkout';
  }) => {
    resetInactivity('correction');
    setPendingPhoto(null);
    setError(null);
    setReqSuccess(null);

    const targetType = prefill?.punchType ?? missingYesterday?.punch_type ?? 'checkout';
    const targetDate = prefill?.workDate ?? missingYesterday?.work_date ?? getYesterdayIso();
    setReqDate(targetDate);
    setReqType(targetType);
    setReqTime(
      targetType === 'checkin'
        ? employee.shift_start || config?.official_start_time || '09:00'
        : employee.shift_end || '17:00'
    );
    setReqReason('');
    setView('correction');
    void loadCorrectionRequests();
  };

  const handleSubmitCorrectionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reqSubmitting) return;
    setReqSubmitting(true);
    setError(null);
    setReqSuccess(null);
    resetInactivity('correction');

    try {
      const data = await apiRequest<{ request: CorrectionRequestItem; message: string }>(
        '/api/employee/correction-requests',
        {
          method: 'POST',
          token,
          body: {
            work_date: reqDate,
            punch_type: reqType,
            requested_time: reqTime,
            reason: reqReason,
          },
        }
      );

      setReqSuccess(data.message);
      setReqReason('');
      if (
        missingYesterday &&
        missingYesterday.work_date === reqDate &&
        missingYesterday.punch_type === reqType
      ) {
        setMissingYesterday({
          ...missingYesterday,
          request_status: 'pending',
        });
      }
      await loadCorrectionRequests();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onLogout();
          return;
        }
        setError(err.message);
      } else {
        setError("Impossible d'envoyer votre demande de correction.");
      }
    } finally {
      setReqSubmitting(false);
    }
  };

  const timeFormatted = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateFormatted = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const todayIso = getTodayLocalIso();
  const hasCheckedIn = Boolean(todayAttendance?.checkin_time);
  const hasCheckedOut = Boolean(todayAttendance?.checkout_time);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col px-4 py-5 sm:px-6">
      {/* Top Bar */}
      <header className="w-full max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          {config?.logo_data_url ? (
            <img
              src={config.logo_data_url}
              alt={config.company_name}
              className="h-10 w-10 rounded-xl object-contain bg-white border border-slate-200 p-1 shrink-0"
            />
          ) : (
            <div className="h-10 w-10 rounded-xl bg-blue-900 text-white flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
          )}
          <span className="text-lg font-bold text-slate-900 truncate">
            {config?.company_name || 'Pointage'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 font-mono tabular-nums">
            <Timer className="w-4 h-4 text-slate-500" />
            {secondsLeft} s
          </span>
          <button
            type="button"
            onClick={onLogout}
            className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-base font-bold text-slate-800 hover:bg-slate-100 active:scale-[0.98] transition whitespace-nowrap"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main className="w-full max-w-3xl mx-auto flex-1">
        {view === 'main' && (
          <div className="space-y-5">
            {/* Yesterday Missing Punch Banner */}
            {missingYesterday && (
              <div
                role="alert"
                className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-amber-950"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-7 h-7 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-lg font-extrabold text-amber-950">
                      Pointage manquant hier ({formatFrenchDate(missingYesterday.work_date)})
                    </p>
                    <p className="mt-0.5 text-sm sm:text-base font-medium text-amber-900">
                      {missingYesterday.punch_type === 'checkout'
                        ? `Votre arrivée a été enregistrée à ${missingYesterday.checkin_time?.slice(0, 5) || '--:--'}, mais aucun départ n'a été pointé.`
                        : "Aucun pointage n'a été enregistré pour votre journée d'hier."}
                    </p>
                    {missingYesterday.request_status === 'pending' && (
                      <p className="mt-1 text-sm font-bold text-amber-800">
                        Demande de correction déjà envoyée (en attente de validation).
                      </p>
                    )}
                    {missingYesterday.request_status === 'rejected' && (
                      <p className="mt-1 text-sm font-bold text-red-800">
                        Votre demande précédente a été refusée. Vous pouvez en soumettre une nouvelle.
                      </p>
                    )}
                  </div>
                </div>

                {missingYesterday.request_status !== 'pending' && (
                  <button
                    type="button"
                    onClick={() =>
                      openCorrectionView({
                        workDate: missingYesterday.work_date,
                        punchType: missingYesterday.punch_type,
                      })
                    }
                    className="min-h-[48px] rounded-xl bg-amber-800 hover:bg-amber-900 px-5 py-2.5 text-base font-bold text-white transition whitespace-nowrap shrink-0"
                  >
                    Corriger maintenant
                  </button>
                )}
              </div>
            )}

            {/* Greeting & Clock Card */}
            <section className="rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-sm text-center">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                Bonjour {employee.first_name}
              </h1>
              {(employee.job_title || employee.shift_start) && (
                <p className="mt-1 text-base font-medium text-slate-600">
                  {employee.job_title}
                  {employee.job_title && employee.shift_start ? ' · ' : ''}
                  {employee.shift_start
                    ? `Horaire : ${employee.shift_start}${employee.shift_end ? ` – ${employee.shift_end}` : ''}`
                    : ''}
                </p>
              )}

              <div className="mt-5 pt-5 border-t border-slate-100">
                <div className="text-5xl sm:text-6xl font-mono font-bold text-slate-900 tabular-nums">
                  {timeFormatted}
                </div>
                <p className="mt-1 text-lg font-medium text-slate-600 capitalize">
                  {dateFormatted}
                </p>
              </div>

              {/* Today's Status */}
              <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-4 sm:p-5">
                {!hasCheckedIn && (
                  <p className="text-xl font-semibold text-slate-700">
                    Vous n'avez pas encore pointé aujourd'hui.
                  </p>
                )}
                {hasCheckedIn && !hasCheckedOut && (
                  <div className="space-y-1">
                    <p className="text-xl sm:text-2xl font-bold text-emerald-800">
                      Présence enregistrée à {todayAttendance!.checkin_time!.slice(0, 5)}
                    </p>
                    <p className="text-base font-medium text-slate-600">
                      {todayAttendance!.is_late === 1
                        ? `Retard signalé (${todayAttendance!.late_minutes} min)`
                        : "Arrivée à l'heure"}
                      {todayAttendance!.checkout_missing === 1 && ' · Départ manquant'}
                    </p>
                  </div>
                )}
                {hasCheckedIn && hasCheckedOut && (
                  <div className="space-y-1">
                    <p className="text-xl sm:text-2xl font-bold text-slate-900">
                      Journée enregistrée
                    </p>
                    <p className="text-lg font-semibold text-slate-700 font-mono tabular-nums">
                      Arrivée à {todayAttendance!.checkin_time!.slice(0, 5)} · Départ à{' '}
                      {todayAttendance!.checkout_time!.slice(0, 5)}
                    </p>
                    <p className="text-base font-medium text-slate-600">
                      Durée totale : {formatMinutesToHours(todayAttendance!.worked_minutes)}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Confirmation Banner */}
            {confirmation && (
              <div
                role="status"
                className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-5 flex items-start gap-3 text-emerald-950"
              >
                <CheckCircle2 className="w-7 h-7 text-emerald-700 shrink-0 mt-0.5" />
                <p className="text-xl font-bold leading-snug">{confirmation}</p>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div
                role="alert"
                className="rounded-2xl bg-red-50 border-2 border-red-300 p-5 flex items-start gap-3 text-red-950"
              >
                <AlertCircle className="w-7 h-7 text-red-700 shrink-0 mt-0.5" />
                <p className="text-xl font-bold leading-snug">{error}</p>
              </div>
            )}

            {/* Photo Proof Capture Card */}
            {pendingPhoto ? (
              <section className="rounded-3xl bg-white border-2 border-blue-200 p-6 sm:p-8 shadow-sm space-y-5 text-center">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                    {pendingPhoto.action === 'checkin'
                      ? 'Photo pour confirmer votre arrivée'
                      : 'Photo pour confirmer votre départ'}
                  </h2>
                  <p className="mt-1.5 text-lg text-slate-600">
                    {pendingPhoto.previewUrl
                      ? 'Vérifiez votre photo puis appuyez sur Envoyer.'
                      : 'Appuyez sur le bouton ci-dessous pour ouvrir la caméra.'}
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handlePhotoSelected}
                  className="hidden"
                />

                {pendingPhoto.compressing ? (
                  <div className="py-10 text-xl font-bold text-blue-900">
                    Préparation de la photo en cours...
                  </div>
                ) : !pendingPhoto.previewUrl ? (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => {
                        setCameraOpenPause(true);
                        resetInactivity();
                        fileInputRef.current?.click();
                      }}
                      className="w-full min-h-[128px] rounded-3xl bg-blue-900 hover:bg-blue-950 text-white px-6 py-6 flex flex-col items-center justify-center gap-3 shadow-sm active:scale-[0.98] transition"
                    >
                      <Camera className="w-12 h-12" />
                      <span className="text-2xl sm:text-3xl font-extrabold">
                        Prendre une photo
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        resetInactivity();
                        setPendingPhoto(null);
                      }}
                      className="w-full min-h-[56px] rounded-2xl border-2 border-slate-300 bg-white px-6 py-3 text-xl font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex justify-center">
                      <img
                        src={pendingPhoto.previewUrl}
                        alt="Aperçu de votre photo"
                        className="max-h-[340px] w-auto rounded-2xl border-2 border-slate-200 object-contain bg-slate-100"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button
                        type="button"
                        disabled={actionLoading !== null || !pendingPhoto.blob}
                        onClick={() => {
                          if (pendingPhoto.blob) {
                            void submitAttendance(pendingPhoto.action, pendingPhoto.blob);
                          }
                        }}
                        className="min-h-[96px] rounded-3xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-5 flex items-center justify-center gap-3 text-2xl sm:text-3xl font-extrabold shadow-sm active:scale-[0.98] disabled:opacity-50 transition"
                      >
                        <Send className="w-8 h-8" />
                        {actionLoading ? 'Envoi...' : 'Envoyer'}
                      </button>

                      <button
                        type="button"
                        disabled={actionLoading !== null}
                        onClick={() => {
                          setCameraOpenPause(true);
                          resetInactivity();
                          fileInputRef.current?.click();
                        }}
                        className="min-h-[96px] rounded-3xl bg-slate-200 hover:bg-slate-300 text-slate-900 px-6 py-5 flex items-center justify-center gap-3 text-2xl sm:text-3xl font-extrabold shadow-sm active:scale-[0.98] disabled:opacity-50 transition"
                      >
                        <RotateCcw className="w-8 h-8" />
                        Reprendre
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={actionLoading !== null}
                      onClick={() => {
                        resetInactivity();
                        setPendingPhoto(null);
                      }}
                      className="w-full min-h-[52px] rounded-2xl border border-slate-300 bg-white px-5 py-3 text-lg font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </section>
            ) : (
              /* Two Big Action Buttons */
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={handlePressCheckin}
                  disabled={hasCheckedIn || actionLoading !== null}
                  className={`min-h-[120px] sm:min-h-[144px] rounded-3xl px-6 py-6 flex flex-col items-center justify-center gap-3 text-white shadow-sm transition active:scale-[0.98] ${
                    hasCheckedIn
                      ? 'bg-emerald-700/40 cursor-not-allowed text-emerald-950 border-2 border-emerald-300'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <LogIn className="w-10 h-10" />
                  <span className="text-2xl sm:text-3xl font-extrabold">
                    {actionLoading === 'checkin'
                      ? 'Enregistrement...'
                      : hasCheckedIn
                      ? 'Arrivée déjà pointée'
                      : 'Je suis arrivé'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handlePressCheckout}
                  disabled={!hasCheckedIn || hasCheckedOut || actionLoading !== null}
                  className={`min-h-[120px] sm:min-h-[144px] rounded-3xl px-6 py-6 flex flex-col items-center justify-center gap-3 shadow-sm transition active:scale-[0.98] ${
                    !hasCheckedIn || hasCheckedOut
                      ? 'bg-slate-200 text-slate-600 cursor-not-allowed border-2 border-slate-300'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                >
                  <LogOut className="w-10 h-10" />
                  <span className="text-2xl sm:text-3xl font-extrabold">
                    {actionLoading === 'checkout'
                      ? 'Enregistrement...'
                      : hasCheckedOut
                      ? 'Départ déjà pointé'
                      : 'Je pars'}
                  </span>
                </button>
              </section>
            )}

            {/* Secondary Actions: Correction Request & 30-day History */}
            {!pendingPhoto && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => openCorrectionView()}
                  className="w-full min-h-[64px] rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-center gap-3 text-lg sm:text-xl font-bold text-amber-950 hover:bg-amber-100 active:scale-[0.99] transition"
                >
                  <FileEdit className="w-6 h-6 text-amber-800 shrink-0" />
                  J'ai oublié de pointer
                </button>

                <button
                  type="button"
                  onClick={openHistory}
                  className="w-full min-h-[64px] rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 flex items-center justify-center gap-3 text-lg sm:text-xl font-bold text-slate-900 hover:bg-slate-100 active:scale-[0.99] transition"
                >
                  <CalendarDays className="w-6 h-6 text-blue-800 shrink-0" />
                  Mon historique (30 jours)
                </button>
              </div>
            )}
          </div>
        )}

        {/* CORRECTION REQUEST SCREEN ("J'ai oublié de pointer") */}
        {view === 'correction' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setReqSuccess(null);
                  setView('main');
                  resetInactivity('main');
                }}
                className="min-h-[52px] inline-flex items-center gap-2 rounded-2xl bg-blue-900 px-5 py-3 text-lg font-bold text-white hover:bg-blue-950 active:scale-[0.98] transition"
              >
                <ArrowLeft className="w-5 h-5" />
                Retour au pointage
              </button>
              <h2 className="text-2xl font-bold text-slate-900">
                J'ai oublié de pointer
              </h2>
            </div>

            {error && (
              <div className="rounded-2xl bg-red-50 border-2 border-red-300 p-4 flex items-center gap-3 text-base font-bold text-red-950">
                <AlertCircle className="w-6 h-6 text-red-700 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {reqSuccess && (
              <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-4 flex items-center gap-3 text-base font-bold text-emerald-950">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
                <span>{reqSuccess}</span>
              </div>
            )}

            <form
              onSubmit={handleSubmitCorrectionRequest}
              className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 sm:p-7 space-y-5"
            >
              <p className="text-base text-slate-600">
                Indiquez la date, l'heure réelle et le motif de votre oubli. Un responsable validera votre demande.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1.5">
                    Date concernée *
                  </label>
                  <input
                    type="date"
                    required
                    max={todayIso}
                    value={reqDate}
                    onChange={(e) => setReqDate(e.target.value)}
                    className="w-full min-h-[52px] rounded-xl border-2 border-slate-300 px-4 py-2.5 text-lg font-mono text-slate-900 focus:border-blue-800 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-slate-800 mb-1.5">
                    Heure réelle *
                  </label>
                  <input
                    type="time"
                    required
                    value={reqTime}
                    onChange={(e) => setReqTime(e.target.value)}
                    className="w-full min-h-[52px] rounded-xl border-2 border-slate-300 px-4 py-2.5 text-lg font-mono text-slate-900 focus:border-blue-800 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-base font-bold text-slate-800 mb-2">
                  Pointage oublié *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setReqType('checkin');
                      setReqTime(employee.shift_start || config?.official_start_time || '09:00');
                    }}
                    className={`min-h-[56px] rounded-2xl border-2 px-4 py-3 text-base sm:text-lg font-bold transition ${
                      reqType === 'checkin'
                        ? 'border-blue-900 bg-blue-900 text-white'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    Arrivée oubliée
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReqType('checkout');
                      setReqTime(employee.shift_end || '17:00');
                    }}
                    className={`min-h-[56px] rounded-2xl border-2 px-4 py-3 text-base sm:text-lg font-bold transition ${
                      reqType === 'checkout'
                        ? 'border-blue-900 bg-blue-900 text-white'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    Départ oublié
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-base font-bold text-slate-800 mb-1.5">
                  Motif de l'oubli *
                </label>
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  placeholder="Ex : Oubli en partant le soir, téléphone déchargé..."
                  className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base text-slate-900 focus:border-blue-800 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={reqSubmitting}
                className="w-full min-h-[60px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 flex items-center justify-center gap-3 text-xl font-extrabold shadow-sm active:scale-[0.99] disabled:opacity-50 transition"
              >
                <Send className="w-6 h-6" />
                {reqSubmitting ? 'Envoi en cours...' : 'Envoyer la demande'}
              </button>
            </form>

            {/* Recent Correction Requests by this Employee */}
            <section className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h3 className="text-lg font-bold text-slate-900">Mes demandes récentes</h3>
              </div>

              {requestsLoading ? (
                <div className="p-6 text-center text-base text-slate-600">Chargement...</div>
              ) : requestsList.length === 0 ? (
                <div className="p-6 text-center text-base text-slate-600">
                  Aucune demande de correction envoyée.
                </div>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {requestsList.map((r) => (
                    <li key={r.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="text-base font-bold text-slate-900 capitalize">
                          {formatFrenchDate(r.work_date)} ·{' '}
                          <span className="normal-case">
                            {r.punch_type === 'checkin' ? 'Arrivée' : 'Départ'} à{' '}
                            <span className="font-mono">{r.requested_time.slice(0, 5)}</span>
                          </span>
                        </p>
                        <p className="text-sm text-slate-600 mt-0.5">Motif : {r.reason}</p>
                        {r.review_note && (
                          <p className="text-xs font-medium text-slate-500 mt-0.5">
                            Note responsable : {r.review_note}
                          </p>
                        )}
                      </div>
                      <span
                        className={`text-sm font-bold whitespace-nowrap ${
                          r.status === 'approved'
                            ? 'text-emerald-700'
                            : r.status === 'rejected'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {r.status === 'approved'
                          ? 'Approuvée'
                          : r.status === 'rejected'
                          ? 'Refusée'
                          : 'En attente'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* 30-DAY HISTORY SCREEN */}
        {view === 'history' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  resetInactivity('main');
                  setView('main');
                }}
                className="min-h-[52px] inline-flex items-center gap-2 rounded-2xl bg-blue-900 px-5 py-3 text-lg font-bold text-white hover:bg-blue-950 active:scale-[0.98] transition"
              >
                <ArrowLeft className="w-5 h-5" />
                Retour au pointage
              </button>
              <h2 className="text-2xl font-bold text-slate-900">
                Mon historique (30 jours)
              </h2>
            </div>

            {error && (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-lg font-semibold text-red-900">
                {error}
              </div>
            )}

            <div className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              {historyLoading ? (
                <div className="p-8 text-center text-lg font-medium text-slate-600">
                  Chargement de vos présences...
                </div>
              ) : historyRecords.length === 0 ? (
                <div className="p-8 text-center text-lg font-medium text-slate-600">
                  Aucun pointage enregistré sur les 30 derniers jours.
                </div>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {historyRecords.map((rec) => {
                    const isMissingCheckout = Boolean(
                      rec.checkin_time &&
                        !rec.checkout_time &&
                        (rec.checkout_missing === 1 || rec.work_date < todayIso)
                    );
                    return (
                      <li
                        key={rec.id}
                        className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-bold text-slate-900 capitalize">
                              {formatFrenchDate(rec.work_date)}
                            </p>
                            {rec.is_corrected === 1 && (
                              <span className="text-xs font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5">
                                Corrigé
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-base font-medium text-slate-700 font-mono tabular-nums">
                            Arrivée : {rec.checkin_time ? rec.checkin_time.slice(0, 5) : '--:--'}
                            {' · '}
                            Départ :{' '}
                            {rec.checkout_time
                              ? rec.checkout_time.slice(0, 5)
                              : isMissingCheckout
                              ? 'Manquant'
                              : '--:--'}
                          </p>
                        </div>
                        <div className="flex sm:flex-col sm:items-end justify-between gap-1.5">
                          {isMissingCheckout ? (
                            <span className="text-base font-bold text-red-700">
                              Départ manquant
                              {rec.is_late === 1 ? ` · Retard ${rec.late_minutes} min` : ''}
                            </span>
                          ) : (
                            <span
                              className={`text-base font-bold ${
                                rec.is_late === 1 ? 'text-amber-700' : 'text-emerald-700'
                              }`}
                            >
                              {rec.is_late === 1
                                ? `En retard (${rec.late_minutes} min)`
                                : "À l'heure"}
                            </span>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-slate-600 font-mono tabular-nums">
                              {rec.worked_minutes > 0 ? formatMinutesToHours(rec.worked_minutes) : '-'}
                            </span>
                            {isMissingCheckout && (
                              <button
                                type="button"
                                onClick={() =>
                                  openCorrectionView({
                                    workDate: rec.work_date,
                                    punchType: 'checkout',
                                  })
                                }
                                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100"
                              >
                                Corriger
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
