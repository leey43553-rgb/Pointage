import React, { useEffect, useState } from 'react';
import { AlertCircle, Save, X } from 'lucide-react';
import { ApiError, apiRequest, getTodayLocalIso } from '../api';
import type { EmployeeListOption } from '../types';

export interface ManualPunchInitialValues {
  employeeId?: number;
  workDate?: string;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  lockEmployeeAndDate?: boolean;
}

interface ManualPunchModalProps {
  token: string;
  employeeOptions: EmployeeListOption[];
  initialValues?: ManualPunchInitialValues;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const ManualPunchModal: React.FC<ManualPunchModalProps> = ({
  token,
  employeeOptions,
  initialValues,
  onClose,
  onSaved,
}) => {
  const todayIso = getTodayLocalIso();
  const [employeeId, setEmployeeId] = useState<string>(
    initialValues?.employeeId
      ? String(initialValues.employeeId)
      : employeeOptions[0]?.id
      ? String(employeeOptions[0].id)
      : ''
  );
  const [workDate, setWorkDate] = useState(initialValues?.workDate || todayIso);
  const [checkinTime, setCheckinTime] = useState(
    initialValues?.checkinTime ? initialValues.checkinTime.slice(0, 5) : '09:00'
  );
  const [checkoutTime, setCheckoutTime] = useState(
    initialValues?.checkoutTime ? initialValues.checkoutTime.slice(0, 5) : ''
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (!employeeId) {
      setError('Veuillez sélectionner un employé.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Veuillez indiquer un motif obligatoire (minimum 3 caractères).');
      return;
    }

    setSaving(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/attendance/manual', {
        method: 'POST',
        token,
        body: {
          employee_id: Number(employeeId),
          work_date: workDate,
          checkin_time: checkinTime,
          checkout_time: checkoutTime.trim() || null,
          reason: reason.trim(),
        },
      });
      onSaved(res.message);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer ce pointage."
      );
    } finally {
      setSaving(false);
    }
  };

  const isEdit = Boolean(initialValues?.checkinTime || initialValues?.lockEmployeeAndDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Corriger un pointage' : 'Ajouter un pointage manuel'}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-auto"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {isEdit ? 'Modifier / corriger le pointage' : 'Ajouter un pointage manuel'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Toute modification est enregistrée dans Historique &amp; Logs.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-center gap-2.5 text-sm font-semibold text-red-900">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Employé *</label>
              <select
                required
                disabled={Boolean(initialValues?.lockEmployeeAndDate)}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
              >
                <option value="">Sélectionner...</option>
                {employeeOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.first_name} {emp.last_name}
                    {emp.is_active === 0 ? ' (Inactif)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date *</label>
              <input
                type="date"
                required
                max={todayIso}
                disabled={Boolean(initialValues?.lockEmployeeAndDate)}
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Heure d'arrivée *
              </label>
              <input
                type="time"
                required
                value={checkinTime}
                onChange={(e) => setCheckinTime(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Heure de départ (optionnel)
              </label>
              <input
                type="time"
                value={checkoutTime}
                onChange={(e) => setCheckoutTime(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Motif obligatoire *
            </label>
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex : Oubli de badgeage confirmé par le chef d'équipe..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2 text-sm font-bold text-white hover:bg-blue-950 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
};
