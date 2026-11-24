import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
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
} from '../api';
import { compressAttendancePhoto } from '../imageCompress';
import type {
  AttendanceRecord,
  EmployeeProfile,
  PhotoRequirement,
  PublicConfig,
} from '../types';

const INACTIVITY_TIMEOUT_SECONDS = 30;

interface EmployeePortalProps {
  token: string;
  employee: EmployeeProfile;
  initialAttendance: AttendanceRecord | null;
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

export const EmployeePortal: React.FC<EmployeePortalProps> = ({
  token,
  employee,
  initialAttendance,
  photoRequirement,
  config,
  onLogout,
}) => {
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(initialAttendance);
  const [view, setView] = useState<'main' | 'history'>('main');
  const [historyRecords, setHistoryRecords] = useState<AttendanceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'checkin' | 'checkout' | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(INACTIVITY_TIMEOUT_SECONDS);
  const [now, setNow] = useState(() => new Date());
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhotoState | null>(null);
  const [cameraOpenPause, setCameraOpenPause] = useState(false);

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

  // Auto-logout after 30s inactivity (paused while native camera app is open)
  const resetInactivity = useCallback(() => {
    setSecondsLeft(INACTIVITY_TIMEOUT_SECONDS);
  }, []);

  useEffect(() => {
    const handleFocusOrVisible = () => {
      setCameraOpenPause(false);
      resetInactivity();
    };
    const events = ['pointerdown', 'touchstart', 'keydown', 'scroll', 'mousemove'];
    events.forEach((ev) => window.addEventListener(ev, resetInactivity, { passive: true }));
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
      events.forEach((ev) => window.removeEventListener(ev, resetInactivity));
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
        formData.append('photo', photoBlob, `${action}.jpg`);
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
    // Reset input value so picking/retaking works every time
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
    resetInactivity();
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
        {view === 'main' ? (
          <div className="space-y-5">
            {/* Greeting & Clock Card */}
            <section className="rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-sm text-center">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                Bonjour {employee.first_name}
              </h1>
              {employee.job_title && (
                <p className="mt-1 text-base font-medium text-slate-600">{employee.job_title}</p>
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

            {/* Photo Proof Capture Card (shown when photo is required for checkin/checkout) */}
            {pendingPhoto ? (
              <section className="rounded-3xl bg-white border-2 border-blue-200 p-6 sm:p-8 shadow-sm space-y-5 text-center">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                    {pendingPhoto.action === 'checkin'
                      ? "Photo pour confirmer votre arrivée"
                      : 'Photo pour confirmer votre départ'}
                  </h2>
                  <p className="mt-1.5 text-lg text-slate-600">
                    {pendingPhoto.previewUrl
                      ? 'Vérifiez votre photo puis appuyez sur Envoyer.'
                      : 'Appuyez sur le bouton ci-dessous pour ouvrir la caméra.'}
                  </p>
                </div>

                {/* Hidden camera input using native front camera over plain HTTP */}
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

            {/* History Button */}
            {!pendingPhoto && (
              <div>
                <button
                  type="button"
                  onClick={openHistory}
                  className="w-full min-h-[64px] rounded-2xl border-2 border-slate-300 bg-white px-6 py-4 flex items-center justify-center gap-3 text-xl font-bold text-slate-900 hover:bg-slate-100 active:scale-[0.99] transition"
                >
                  <CalendarDays className="w-6 h-6 text-blue-800" />
                  Mon historique (30 derniers jours)
                </button>
              </div>
            )}
          </div>
        ) : (
          /* 30-Day History Screen */
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  resetInactivity();
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
                  {historyRecords.map((rec) => (
                    <li
                      key={rec.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-lg font-bold text-slate-900 capitalize">
                          {formatFrenchDate(rec.work_date)}
                        </p>
                        <p className="mt-0.5 text-base font-medium text-slate-700 font-mono tabular-nums">
                          Arrivée : {rec.checkin_time ? rec.checkin_time.slice(0, 5) : '--:--'}
                          {' · '}
                          Départ : {rec.checkout_time ? rec.checkout_time.slice(0, 5) : '--:--'}
                        </p>
                      </div>
                      <div className="flex sm:flex-col sm:items-end justify-between gap-1">
                        <span
                          className={`text-base font-bold ${
                            rec.is_late === 1 ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {rec.is_late === 1 ? `En retard (${rec.late_minutes} min)` : "À l'heure"}
                        </span>
                        <span className="text-base font-semibold text-slate-600 font-mono tabular-nums">
                          {rec.worked_minutes > 0 ? formatMinutesToHours(rec.worked_minutes) : '-'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
