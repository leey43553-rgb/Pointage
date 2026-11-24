import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { ApiError, apiRequest } from '../api';
import type { AdminUser, PublicConfig } from '../types';

interface AdminLoginResponse {
  token: string;
  admin: AdminUser;
}

interface AdminLoginScreenProps {
  config: PublicConfig | null;
  onLoginSuccess: (data: AdminLoginResponse) => void;
  onBack: () => void;
}

export const AdminLoginScreen: React.FC<AdminLoginScreenProps> = ({
  config,
  onLoginSuccess,
  onBack,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<AdminLoginResponse>('/api/auth/admin', {
        method: 'POST',
        body: { username, password },
      });
      onLoginSuccess(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Erreur de connexion au serveur.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col px-4 py-6 sm:px-6">
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour au clavier employé
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-12 w-12 rounded-2xl bg-blue-900 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Espace Responsable</h1>
              <p className="text-sm text-slate-600">{config?.company_name || 'Administration'}</p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-sm font-semibold text-red-900"
            >
              <AlertCircle className="w-5 h-5 text-red-700 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-username" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Nom d'utilisateur
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="ex: admin"
                className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Mot de passe
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[52px] mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-900 px-5 py-3 text-base font-bold text-white hover:bg-blue-950 disabled:opacity-50 transition"
            >
              <Lock className="w-4 h-4" />
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
