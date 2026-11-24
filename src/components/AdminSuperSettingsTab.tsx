import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Database,
  Download,
  KeyRound,
  Save,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react';
import { ApiError, apiRequest, downloadAuthenticatedFile } from '../api';
import type { AppSettings } from '../types';

interface AdminSuperSettingsTabProps {
  token: string;
  onSettingsUpdated: () => void;
  onPasswordChanged: () => void;
}

export const AdminSuperSettingsTab: React.FC<AdminSuperSettingsTabProps> = ({
  token,
  onSettingsUpdated,
  onPasswordChanged,
}) => {
  const [companyName, setCompanyName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [officialStartTime, setOfficialStartTime] = useState('09:00');
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [allowedNetworkPrefix, setAllowedNetworkPrefix] = useState('');
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [clientIp, setClientIp] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Change own password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        settings: AppSettings;
        lan_ips: string[];
        client_ip: string;
      }>('/api/super/settings', { token });
      setCompanyName(data.settings.company_name);
      setLogoDataUrl(data.settings.logo_data_url);
      setOfficialStartTime(data.settings.official_start_time);
      setGraceMinutes(data.settings.grace_minutes);
      setAllowedNetworkPrefix(data.settings.allowed_network_prefix || '');
      setLanIps(data.lan_ips || []);
      setClientIp(data.client_ip || '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement des paramètres.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Veuillez choisir une image PNG, JPG ou WebP.');
      return;
    }
    if (file.size > 450_000) {
      setError('Le logo est trop volumineux (maximum 450 Ko).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiRequest('/api/super/settings', {
        method: 'PUT',
        token,
        body: {
          company_name: companyName,
          logo_data_url: logoDataUrl ?? '',
          official_start_time: officialStartTime,
          grace_minutes: Number(graceMinutes),
          allowed_network_prefix: allowedNetworkPrefix,
        },
      });
      setSuccessMsg('Paramètres enregistrés avec succès.');
      onSettingsUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changingPw) return;
    setError(null);
    setSuccessMsg(null);

    if (newPassword !== confirmPassword) {
      setError('Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }

    setChangingPw(true);
    try {
      await apiRequest('/api/super/change-password', {
        method: 'POST',
        token,
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccessMsg('Votre mot de passe a été modifié.');
      onPasswordChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du changement de mot de passe.');
    } finally {
      setChangingPw(false);
    }
  };

  const handleBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    setError(null);
    try {
      await downloadAuthenticatedFile('/api/super/backup', token, 'pointage-backup.db');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setBackingUp(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-600">
        Chargement des paramètres...
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {/* General & Network Settings */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-5"
      >
        <h2 className="text-lg font-bold text-slate-900">Paramètres de l'entreprise</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Nom de l'entreprise
            </label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Logo de l'entreprise (optionnel)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {logoDataUrl && (
                <img
                  src={logoDataUrl}
                  alt="Aperçu du logo"
                  className="h-11 w-11 rounded-xl object-contain border border-slate-200 bg-slate-50 p-1"
                />
              )}
              <label className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer">
                <Upload className="w-4 h-4" />
                Choisir une image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>
              {logoDataUrl && (
                <button
                  type="button"
                  onClick={() => setLogoDataUrl(null)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Retirer
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Heure officielle d'arrivée
            </label>
            <input
              type="time"
              required
              value={officialStartTime}
              onChange={(e) => setOfficialStartTime(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900"
            />
            <p className="mt-1 text-xs text-slate-500">
              Sert à calculer automatiquement les retards.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Tolérance de retard (minutes)
            </label>
            <input
              type="number"
              min={0}
              max={180}
              required
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900"
            />
            <p className="mt-1 text-xs text-slate-500">
              Exemple : 10 min avec début à 09:00 = retard compté à partir de 09:11.
            </p>
          </div>
        </div>

        {/* Network Restriction */}
        <div className="pt-4 border-t border-slate-200">
          <div className="flex items-start gap-3 mb-3">
            <Wifi className="w-5 h-5 text-blue-800 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Réseau autorisé (Restriction Wi-Fi optionnelle)
              </h3>
              <p className="text-sm text-slate-600">
                Si renseigné, seuls les téléphones dont l'adresse IP commence par ce préfixe peuvent pointer (ex : <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">192.168.1.</code>). Laissez vide pour autoriser tout réseau.
              </p>
            </div>
          </div>

          <input
            type="text"
            value={allowedNetworkPrefix}
            onChange={(e) => setAllowedNetworkPrefix(e.target.value)}
            placeholder="ex: 192.168.1. (laisser vide pour désactiver)"
            className="w-full max-w-md min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono text-slate-900"
          />

          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1">
            <p>
              <strong>Votre IP actuelle :</strong>{' '}
              <span className="font-mono">{clientIp}</span>
            </p>
            {lanIps.length > 0 && (
              <p>
                <strong>Adresse(s) pour les téléphones sur le Wi-Fi :</strong>{' '}
                {lanIps.map((ip, idx) => (
                  <span key={ip} className="font-mono font-bold text-blue-900">
                    {idx > 0 ? ', ' : ''}
                    http://{ip}:3000
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-blue-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-950 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
          </button>
        </div>
      </form>

      {/* Change Super Admin Password */}
      <form
        onSubmit={handleChangePassword}
        className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-center gap-2.5">
          <KeyRound className="w-5 h-5 text-blue-800" />
          <h2 className="text-lg font-bold text-slate-900">Changer mon mot de passe</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Mot de passe actuel
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Nouveau mot de passe
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Confirmer le nouveau
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={changingPw}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2 text-sm font-bold text-slate-800 hover:bg-slate-100"
          >
            {changingPw ? 'Modification...' : 'Mettre à jour le mot de passe'}
          </button>
        </div>
      </form>

      {/* Database Backup */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Database className="w-6 h-6 text-blue-800 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Sauvegarde de la base de données</h2>
            <p className="text-sm text-slate-600">
              Téléchargez une copie complète du fichier SQLite (<code className="font-mono">pointage.db</code>) sur votre ordinateur ou clé USB.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleBackup}
          disabled={backingUp}
          className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          {backingUp ? 'Sauvegarde...' : 'Sauvegarder (pointage.db)'}
        </button>
      </section>
    </div>
  );
};
