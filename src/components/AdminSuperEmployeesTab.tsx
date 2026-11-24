import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { ApiError, apiRequest } from '../api';
import type { EmployeeFull } from '../types';
import { PrintableCodesView } from './PrintableCodesView';

interface AdminSuperEmployeesTabProps {
  token: string;
  companyName: string;
}

export const AdminSuperEmployeesTab: React.FC<AdminSuperEmployeesTabProps> = ({
  token,
  companyName,
}) => {
  const [employees, setEmployees] = useState<EmployeeFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [revealedIds, setRevealedIds] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showPrint, setShowPrint] = useState(false);

  // Add form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingEmp, setEditingEmp] = useState<EmployeeFull | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editJob, setEditJob] = useState('');

  // Confirmations
  const [confirmRegenId, setConfirmRegenId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ employees: EmployeeFull[] }>('/api/super/employees', { token });
      setEmployees(data.employees);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du chargement des employés.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const data = await apiRequest<{ employee: EmployeeFull }>('/api/super/employees', {
        method: 'POST',
        token,
        body: {
          first_name: firstName,
          last_name: lastName,
          job_title: jobTitle,
        },
      });
      setFirstName('');
      setLastName('');
      setJobTitle('');
      setRevealedIds((prev) => ({ ...prev, [data.employee.id]: true }));
      setSuccessMsg(
        `Employé ajouté : ${data.employee.first_name} ${data.employee.last_name} — Code attribué : ${data.employee.code}`
      );
      await loadEmployees();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ajouter l'employé.");
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest(`/api/super/employees/${editingEmp.id}`, {
        method: 'PUT',
        token,
        body: {
          first_name: editFirst,
          last_name: editLast,
          job_title: editJob,
        },
      });
      setEditingEmp(null);
      setSuccessMsg('Employé modifié avec succès.');
      await loadEmployees();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la modification.');
    }
  };

  const handleToggleActive = async (emp: EmployeeFull) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest(`/api/super/employees/${emp.id}`, {
        method: 'PUT',
        token,
        body: { is_active: emp.is_active !== 1 },
      });
      setSuccessMsg(
        emp.is_active === 1
          ? `${emp.first_name} ${emp.last_name} a été désactivé.`
          : `${emp.first_name} ${emp.last_name} a été réactivé.`
      );
      await loadEmployees();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la mise à jour.');
    }
  };

  const handleRegenerate = async (emp: EmployeeFull) => {
    setError(null);
    setSuccessMsg(null);
    try {
      const data = await apiRequest<{ employee: EmployeeFull }>(
        `/api/super/employees/${emp.id}/regenerate-code`,
        { method: 'POST', token }
      );
      setConfirmRegenId(null);
      setRevealedIds((prev) => ({ ...prev, [emp.id]: true }));
      setSuccessMsg(
        `Nouveau code pour ${emp.first_name} ${emp.last_name} : ${data.employee.code}`
      );
      await loadEmployees();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de régénérer le code.');
    }
  };

  const handleDelete = async (emp: EmployeeFull) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest(`/api/super/employees/${emp.id}`, {
        method: 'DELETE',
        token,
      });
      setConfirmDeleteId(null);
      setSuccessMsg(`Employé ${emp.first_name} ${emp.last_name} supprimé.`);
      await loadEmployees();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de supprimer cet employé.');
    }
  };

  const handleCopyCode = async (emp: EmployeeFull) => {
    try {
      await navigator.clipboard.writeText(emp.code);
      setCopiedId(emp.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard might be unavailable on HTTP non-localhost; reveal code instead
      setRevealedIds((prev) => ({ ...prev, [emp.id]: true }));
    }
  };

  if (showPrint) {
    return (
      <PrintableCodesView
        companyName={companyName}
        employees={employees}
        onClose={() => setShowPrint(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Add Employee Card */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Ajouter un employé</h2>
            <p className="text-sm text-slate-600">
              Un code personnel unique à 6 chiffres est généré automatiquement.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPrint(true)}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition whitespace-nowrap"
          >
            <Printer className="w-4 h-4 text-blue-800" />
            Imprimer la liste des codes
          </button>
        </div>

        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Prénom *</label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="ex: Jean"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Nom *</label>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="ex: Dupont"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Poste (optionnel)</label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="ex: Technicien"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-950 disabled:opacity-50 transition whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {creating ? 'Création...' : 'Ajouter'}
          </button>
        </form>
      </section>

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

      {/* Edit Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4"
          >
            <h3 className="text-lg font-bold text-slate-900">Modifier l'employé</h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Prénom *</label>
              <input
                type="text"
                required
                value={editFirst}
                onChange={(e) => setEditFirst(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nom *</label>
              <input
                type="text"
                required
                value={editLast}
                onChange={(e) => setEditLast(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Poste</label>
              <input
                type="text"
                value={editJob}
                onChange={(e) => setEditJob(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingEmp(null)}
                className="min-h-[44px] rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-blue-900 px-5 py-2 text-sm font-bold text-white hover:bg-blue-950"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Employees List */}
      <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">
            Liste des employés ({employees.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Chargement...</div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            Aucun employé enregistré. Ajoutez votre premier employé ci-dessus.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {employees.map((emp) => {
              const isRevealed = Boolean(revealedIds[emp.id]);
              return (
                <div
                  key={emp.id}
                  className={`p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                    emp.is_active === 0 ? 'bg-slate-50 opacity-75' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-900">
                        {emp.first_name} {emp.last_name}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-sm text-slate-600">
                        {emp.job_title || 'Sans poste'}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span
                        className={`text-xs font-bold ${
                          emp.is_active === 1 ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {emp.is_active === 1 ? 'Actif' : 'Désactivé'}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Code :</span>
                      <span className="font-mono text-lg font-bold tracking-widest text-slate-900 tabular-nums">
                        {isRevealed ? emp.code : '••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedIds((prev) => ({ ...prev, [emp.id]: !prev[emp.id] }))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {isRevealed ? 'Masquer' : 'Afficher'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyCode(emp)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {copiedId === emp.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            Copié
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copier
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {confirmRegenId === emp.id ? (
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
                        <span className="text-xs font-semibold text-amber-900">Nouveau code ?</span>
                        <button
                          type="button"
                          onClick={() => void handleRegenerate(emp)}
                          className="rounded-lg bg-amber-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-800"
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRegenId(null)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                        >
                          Non
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRegenId(emp.id)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Régénérer code
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setEditingEmp(emp);
                        setEditFirst(emp.first_name);
                        setEditLast(emp.last_name);
                        setEditJob(emp.job_title);
                      }}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Modifier
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleActive(emp)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {emp.is_active === 1 ? (
                        <>
                          <UserX className="w-3.5 h-3.5 text-amber-700" />
                          Désactiver
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
                          Réactiver
                        </>
                      )}
                    </button>

                    {confirmDeleteId === emp.id ? (
                      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
                        <span className="text-xs font-semibold text-red-900">Supprimer ?</span>
                        <button
                          type="button"
                          onClick={() => void handleDelete(emp)}
                          className="rounded-lg bg-red-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-800"
                        >
                          Oui
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                        >
                          Non
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(emp.id)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
