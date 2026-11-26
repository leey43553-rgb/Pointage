import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock, Delete, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { ApiError, apiRequest } from '../api';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import type {
  AttendanceRecord,
  EmployeeProfile,
  MissingYesterdayInfo,
  PhotoRequirement,
  PublicConfig,
} from '../types';

interface EmployeeLoginResponse {
  token: string;
  employee: EmployeeProfile;
  today_attendance: AttendanceRecord | null;
  missing_yesterday?: MissingYesterdayInfo | null;
  photo_requirement?: PhotoRequirement;
  server_time: string;
  server_date: string;
}

interface EmployeePinScreenProps {
  config: PublicConfig | null;
  onLoginSuccess: (data: EmployeeLoginResponse) => void;
  onOpenAdminLogin: () => void;
}

export const EmployeePinScreen: React.FC<EmployeePinScreenProps> = ({
  config,
  onLoginSuccess,
  onOpenAdminLogin,
}) => {
  const [code, setCode] = useState('');
  const [showDigits, setShowDigits] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockSeconds]);

  const submitCode = async (pin: string) => {
    if (loading || lockSeconds > 0 || pin.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<EmployeeLoginResponse>('/api/auth/employee', {
        method: 'POST',
        body: { code: pin },
      });
      setCode('');
      onLoginSuccess(data);
    } catch (err) {
      setCode('');
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.retryAfterSeconds && err.retryAfterSeconds > 0) {
          setLockSeconds(err.retryAfterSeconds);
        }
      } else {
        setError('Une erreur est survenue. Veuillez réessayer.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (digit: string) => {
    if (loading || lockSeconds > 0) return;
    setError(null);
    setCode((prev) => {
      if (prev.length >= 6) return prev;
      const next = prev + digit;
      if (next.length === 6) {
        void submitCode(next);
      }
      return next;
    });
  };

  const handleBackspace = () => {
    if (loading) return;
    setError(null);
    setCode((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (loading) return;
    setError(null);
    setCode('');
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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

  const lockMinutesDisplay = Math.floor(lockSeconds / 60);
  const lockSecondsRemainder = lockSeconds % 60;

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 px-4 py-6 sm:px-6">
      {/* Top Company Header */}
      <header className="w-full max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {config?.logo_data_url ? (
            <img
              src={config.logo_data_url}
              alt={config.company_name}
              className="h-11 w-11 rounded-xl object-contain bg-white border border-slate-200 p-1 shrink-0"
            />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-blue-900 text-white flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
          )}
          <span className="text-xl font-bold text-slate-900 truncate">
            {config?.company_name || 'Pointage Entreprise'}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenAdminLogin}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition whitespace-nowrap shrink-0"
        >
          <ShieldCheck className="w-4 h-4 text-blue-800" />
          Espace Responsable
        </button>
      </header>

      {/* Main Centered Keypad Card */}
      <main className="w-full max-w-lg mx-auto my-6">
        <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
          {/* Clock & Date */}
          <div className="text-center mb-6">
            <div className="text-5xl sm:text-6xl font-mono font-bold tracking-tight text-slate-900 tabular-nums">
              {timeFormatted}
            </div>
            <p className="mt-1.5 text-base sm:text-lg font-medium text-slate-600 capitalize">
              {dateFormatted}
            </p>
          </div>

          {/* Prompt */}
          <div className="text-center mb-5">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Entrez votre code
            </h1>
            <p className="mt-1 text-base text-slate-600">
              Saisissez vos 6 chiffres personnels
            </p>
          </div>

          {/* 6 PIN Boxes */}
          <div className="grid grid-cols-6 gap-2 sm:gap-3 mb-3" aria-label="Code à 6 chiffres">
            {[0, 1, 2, 3, 4, 5].map((idx) => {
              const char = code[idx];
              const isFilled = Boolean(char);
              const isCurrent = idx === code.length && lockSeconds === 0;
              return (
                <div
                  key={idx}
                  className={`h-14 sm:h-16 rounded-2xl border-2 flex items-center justify-center font-mono text-2xl sm:text-3xl font-bold transition-colors ${
                    isFilled
                      ? 'border-blue-800 bg-blue-50 text-blue-950'
                      : isCurrent
                      ? 'border-blue-500 bg-white'
                      : 'border-slate-300 bg-slate-50 text-slate-400'
                  }`}
                >
                  {isFilled ? (showDigits ? char : '●') : ''}
                </div>
              );
            })}
          </div>

          {/* Toggle visibility */}
          <div className="flex justify-center mb-5">
            <button
              type="button"
              onClick={() => setShowDigits((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              {showDigits ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showDigits ? 'Masquer les chiffres' : 'Afficher les chiffres'}
            </button>
          </div>

          {/* Error or Lockout Alert */}
          {(error || lockSeconds > 0) && (
            <div
              role="alert"
              className="mb-5 rounded-2xl bg-red-50 border border-red-200 p-4 flex items-start gap-3 text-red-900"
            >
              {lockSeconds > 0 ? (
                <Lock className="w-6 h-6 text-red-700 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-6 h-6 text-red-700 shrink-0 mt-0.5" />
              )}
              <div className="text-base font-semibold leading-snug">
                <p>{error}</p>
                {lockSeconds > 0 && (
                  <p className="mt-1 font-mono text-sm text-red-800 tabular-nums">
                    Temps restant : {lockMinutesDisplay}:{String(lockSecondsRemainder).padStart(2, '0')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={loading || lockSeconds > 0}
                onClick={() => handleDigit(digit)}
                className="min-h-[68px] sm:min-h-[76px] rounded-2xl border border-slate-300 bg-white text-3xl font-bold text-slate-900 shadow-xs hover:bg-slate-100 active:bg-blue-100 active:scale-[0.97] disabled:opacity-40 transition select-none"
              >
                {digit}
              </button>
            ))}

            <button
              type="button"
              disabled={loading || code.length === 0}
              onClick={handleClear}
              className="min-h-[68px] sm:min-h-[76px] rounded-2xl border border-slate-300 bg-slate-100 text-lg font-bold text-slate-700 hover:bg-slate-200 active:scale-[0.97] disabled:opacity-40 transition select-none"
            >
              Effacer
            </button>

            <button
              type="button"
              disabled={loading || lockSeconds > 0}
              onClick={() => handleDigit('0')}
              className="min-h-[68px] sm:min-h-[76px] rounded-2xl border border-slate-300 bg-white text-3xl font-bold text-slate-900 shadow-xs hover:bg-slate-100 active:bg-blue-100 active:scale-[0.97] disabled:opacity-40 transition select-none"
            >
              0
            </button>

            <button
              type="button"
              disabled={loading || code.length === 0}
              onClick={handleBackspace}
              aria-label="Corriger le dernier chiffre"
              className="min-h-[68px] sm:min-h-[76px] rounded-2xl border border-slate-300 bg-slate-100 text-slate-800 flex items-center justify-center hover:bg-slate-200 active:scale-[0.97] disabled:opacity-40 transition select-none"
            >
              <Delete className="w-8 h-8" />
            </button>
          </div>

          {loading && (
            <p className="mt-4 text-center text-base font-semibold text-blue-800">
              Vérification du code en cours...
            </p>
          )}
        </div>
      </main>

      {/* Bottom Install Prompt */}
      <footer className="w-full max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-3 text-center">
        <PWAInstallButton />
      </footer>
    </div>
  );
};
