import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, KeyRound, Plus, Shield, Trash2 } from 'lucide-react';
import { ApiError, apiRequest } from '../api';
import type { AdminUser } from '../types';

interface AdminSuperAdminsTabProps {
  token: string;
  currentAdminId: number;
}

export const AdminSuperAdminsTab: React.FC<AdminSuperAdminsTabProps> = ({
  token,
  currentAdminId,
}) => {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'super_admin'>('admin');
  const [creating, setCreating] = useState(false);

  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ admins: AdminUser[] }>('/api/super/admins', { token });
      setAdmins(data.admins);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest('/api/super/admins', {
        method: 'POST',
        token,
        body: { username, password, role },
      });
      setUsername('');
      setPassword('');
      setRole('admin');
      setSuccessMsg('Compte administrateur créé avec succès.');
      await loadAdmins();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer l'administrateur.");
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetId) return;
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest(`/api/super/admins/${resetTargetId}/password`, {
        method: 'PUT',
        token,
        body: { password: resetPassword },
      });
      setResetTargetId(null);
      setResetPassword('');
      setSuccessMsg('Mot de passe réinitialisé.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de réinitialiser le mot de passe.');
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest(`/api/super/admins/${id}`, { method: 'DELETE', token });
      setConfirmDeleteId(null);
      setSuccessMsg('Compte administrateur supprimé.');
      await loadAdmins();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de supprimer ce compte.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Créer un compte responsable</h2>
        <p className="text-sm text-slate-600 mb-4">
          Un « Admin » peut consulter les présences et exporter en CSV, mais ne peut ni modifier les paramètres ni gérer les comptes.
        </p>

        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Nom d'utilisateur *</label>
            <input
              type="text"
              required
              minLength={3}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex: responsable1"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Mot de passe *</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6 caractères min."
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Rôle</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'super_admin')}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-white"
            >
              <option value="admin">Admin (Consultation & Export)</option>
              <option value="super_admin">Super Admin (Accès complet)</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-950 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {creating ? 'Création...' : 'Créer'}
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

      {/* Reset password modal */}
      {resetTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleResetPassword}
            className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4"
          >
            <h3 className="text-lg font-bold text-slate-900">Réinitialiser le mot de passe</h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Nouveau mot de passe (min. 6 caractères)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setResetTargetId(null);
                  setResetPassword('');
                }}
                className="min-h-[44px] rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-blue-900 px-5 py-2 text-sm font-bold text-white"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Comptes responsables ({admins.length})</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Chargement...</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {admins.map((adm) => (
              <div
                key={adm.id}
                className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      {adm.username}
                      {adm.id === currentAdminId && (
                        <span className="ml-2 text-xs font-medium text-blue-800">(Vous)</span>
                      )}
                    </p>
                    <p className="text-xs font-medium text-slate-600">
                      {adm.role === 'super_admin' ? 'Super Administrateur' : 'Administrateur'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setResetTargetId(adm.id)}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Changer mot de passe
                  </button>

                  {adm.id !== currentAdminId && (
                    confirmDeleteId === adm.id ? (
                      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
                        <span className="text-xs font-semibold text-red-900">Supprimer ?</span>
                        <button
                          type="button"
                          onClick={() => void handleDelete(adm.id)}
                          className="rounded-lg bg-red-700 px-2.5 py-1 text-xs font-bold text-white"
                        >
                          Oui
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700"
                        >
                          Non
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(adm.id)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Supprimer
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
