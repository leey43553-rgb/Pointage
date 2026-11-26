import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { ApiError, apiRequest, formatFrenchDate } from '../api';
import type { CorrectionRequestItem, EmployeeListOption } from '../types';

interface AdminCorrectionsTabProps {
  token: string;
  employeeOptions: EmployeeListOption[];
  onUnauthorized: () => void;
  onChanged: () => void;
}

export const AdminCorrectionsTab: React.FC<AdminCorrectionsTabProps> = ({
  token,
  employeeOptions,
  onUnauthorized,
  onChanged,
}) => {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>(
    'pending'
  );
  const [empFilter, setEmpFilter] = useState('');
  const [requests, setRequests] = useState<CorrectionRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [overrideTimes, setOverrideTimes] = useState<Record<number, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [processingId, setProcessingId] = useState<number | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (empFilter) params.set('employeeId', empFilter);
      const data = await apiRequest<{ requests: CorrectionRequestItem[] }>(
        `/api/admin/correction-requests?${params.toString()}`,
        { token }
      );
      setRequests(data.requests);
      setOverrideTimes((prev) => {
        const next = { ...prev };
        for (const r of data.requests) {
          if (!next[r.id]) next[r.id] = r.requested_time.slice(0, 5);
        }
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        err instanceof ApiError ? err.message : 'Erreur lors du chargement des demandes.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, empFilter, onUnauthorized]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleApprove = async (reqItem: CorrectionRequestItem) => {
    if (processingId !== null) return;
    setProcessingId(reqItem.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/correction-requests/${reqItem.id}/approve`,
        {
          method: 'POST',
          token,
          body: {
            override_time: overrideTimes[reqItem.id] || reqItem.requested_time.slice(0, 5),
            review_note: reviewNotes[reqItem.id] || '',
          },
        }
      );
      setSuccessMsg(res.message);
      await loadRequests();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Impossible d'approuver cette demande.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (reqItem: CorrectionRequestItem) => {
    if (processingId !== null) return;
    setProcessingId(reqItem.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiRequest<{ message: string }>(
        `/api/admin/correction-requests/${reqItem.id}/reject`,
        {
          method: 'POST',
          token,
          body: {
            review_note: reviewNotes[reqItem.id] || '',
          },
        }
      );
      setSuccessMsg(res.message);
      await loadRequests();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Impossible de refuser cette demande.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Demandes de correction d'oubli</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Validez ou refusez les demandes soumises par les employés depuis « J'ai oublié de pointer ».
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRequests()}
          className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
        >
          <RefreshCw className="w-4 h-4" />
          Actualiser
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
          {(
            [
              ['pending', 'En attente'],
              ['approved', 'Approuvées'],
              ['rejected', 'Refusées'],
              ['all', 'Toutes'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`min-h-[36px] px-3.5 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                statusFilter === key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={empFilter}
          onChange={(e) => setEmpFilter(e.target.value)}
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

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-sm font-semibold text-red-900">
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3 text-sm font-semibold text-emerald-900">
          <Check className="w-5 h-5 text-emerald-700 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-600">
            Chargement des demandes...
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-600">
            Aucune demande dans cette catégorie.
          </div>
        ) : (
          requests.map((r) => {
            const empName = `${r.first_name || ''} ${r.last_name || ''}`.trim();
            const isPending = r.status === 'pending';
            return (
              <div
                key={r.id}
                className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-slate-900">{empName}</span>
                    {r.job_title && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-sm text-slate-600">{r.job_title}</span>
                      </>
                    )}
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-sm font-semibold text-slate-800 capitalize">
                      {formatFrenchDate(r.work_date)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-bold text-blue-900">
                      {r.punch_type === 'checkin' ? 'Arrivée oubliée' : 'Départ oublié'} à{' '}
                      <span className="font-mono">{r.requested_time.slice(0, 5)}</span>
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      Pointage actuel :{' '}
                      {r.current_checkin_time
                        ? `Arr. ${r.current_checkin_time.slice(0, 5)}`
                        : 'Arr. —'}{' '}
                      /{' '}
                      {r.current_checkout_time
                        ? `Dép. ${r.current_checkout_time.slice(0, 5)}`
                        : r.current_checkout_missing === 1
                        ? 'Dép. manquant'
                        : 'Dép. —'}
                    </span>
                  </div>

                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-500">Motif :</span> {r.reason}
                  </p>

                  {!isPending && (
                    <p className="text-xs text-slate-500">
                      Traité par <strong>{r.reviewed_by_username || 'Responsable'}</strong>
                      {r.reviewed_at ? ` le ${r.reviewed_at.replace('T', ' ').slice(0, 16)}` : ''}
                      {r.review_note ? ` · Note : ${r.review_note}` : ''}
                    </p>
                  )}
                </div>

                {isPending ? (
                  <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 shrink-0">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Heure validée
                      </label>
                      <input
                        type="time"
                        value={overrideTimes[r.id] || r.requested_time.slice(0, 5)}
                        onChange={(e) =>
                          setOverrideTimes((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        className="min-h-[40px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Note (optionnel)
                      </label>
                      <input
                        type="text"
                        value={reviewNotes[r.id] || ''}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        placeholder="Commentaire..."
                        className="min-h-[40px] w-full sm:w-44 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={processingId === r.id}
                        onClick={() => void handleApprove(r)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Approuver
                      </button>
                      <button
                        type="button"
                        disabled={processingId === r.id}
                        onClick={() => void handleReject(r)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-bold text-red-800 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        <XCircle className="w-4 h-4" />
                        Refuser
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="shrink-0">
                    {r.status === 'approved' ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        Approuvée
                      </span>
                    ) : r.status === 'rejected' ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-red-700">
                        <XCircle className="w-4 h-4" />
                        Refusée
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-700">
                        <Clock className="w-4 h-4" />
                        En attente
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
