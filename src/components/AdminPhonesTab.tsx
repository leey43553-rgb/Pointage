import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Printer,
  RefreshCw,
  Smartphone,
  Wifi,
} from 'lucide-react';
import QRCode from 'qrcode';
import { ApiError, apiRequest } from '../api';
import type { NetworkInfoResponse, PublicConfig } from '../types';

interface AdminPhonesTabProps {
  token: string;
  config: PublicConfig | null;
  onUnauthorized: () => void;
}

export const AdminPhonesTab: React.FC<AdminPhonesTabProps> = ({
  token,
  config,
  onUnauthorized,
}) => {
  const [info, setInfo] = useState<NetworkInfoResponse | null>(null);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<NetworkInfoResponse>('/api/admin/network-info', { token });
      setInfo(data);
      setSelectedUrl((prev) => {
        if (prev && data.phone_urls.includes(prev)) return prev;
        return data.primary_phone_url || data.local_url;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de récupérer les adresses réseau.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, onUnauthorized]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    if (!selectedUrl) {
      setQrDataUrl(null);
      return;
    }
    let active = true;
    QRCode.toDataURL(selectedUrl, {
      width: 340,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });

    return () => {
      active = false;
    };
  }, [selectedUrl]);

  const handleCopy = async () => {
    if (!selectedUrl) return;
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const companyName = info?.company_name || config?.company_name || 'Pointage Entreprise';

  return (
    <div className="space-y-6">
      {/* Toolbar (hidden on print) */}
      <div className="no-print rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Connexion des téléphones</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Affichez et imprimez ce QR code à l'entrée pour permettre aux employés d'ouvrir Pointage sur leur téléphone en Wi-Fi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadInfo()}
            className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>

          <button
            type="button"
            onClick={handlePrint}
            disabled={!qrDataUrl}
            className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-blue-900 px-5 py-2 text-sm font-bold text-white hover:bg-blue-950 disabled:opacity-50 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            Imprimer l'affiche
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-sm font-semibold text-red-900">
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-sm text-slate-600">
          Détection des adresses réseau locales...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left column: Network Details (hidden on print) */}
          <div className="no-print lg:col-span-5 space-y-4">
            <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <Wifi className="w-5 h-5 text-blue-800 shrink-0" />
                <h2 className="text-base font-bold text-slate-900">Adresses du serveur local</h2>
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <span className="block text-xs font-semibold text-slate-500">
                    Adresse IP locale principale du PC
                  </span>
                  <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {info?.primary_ip || 'localhost'}
                  </span>
                </div>

                <div>
                  <span className="block text-xs font-semibold text-slate-500">
                    Adresse sur ce PC
                  </span>
                  <span className="font-mono font-semibold text-slate-800">
                    {info?.local_url || 'http://localhost:3000'}
                  </span>
                </div>

                <div>
                  <label
                    htmlFor="phone-url-select"
                    className="block text-xs font-semibold text-slate-500 mb-1"
                  >
                    Adresse pour les téléphones (Wi-Fi)
                  </label>
                  {info && info.phone_urls.length > 1 ? (
                    <select
                      id="phone-url-select"
                      value={selectedUrl}
                      onChange={(e) => setSelectedUrl(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono font-bold text-blue-900"
                    >
                      {info.phone_urls.map((url) => (
                        <option key={url} value={url}>
                          {url}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-base font-bold text-blue-900 break-all">
                      {selectedUrl}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleCopy}
                  className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-100"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-700" />
                      Adresse copiée !
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copier l'adresse des téléphones
                    </>
                  )}
                </button>
              </div>
            </section>

            <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-2.5 text-sm text-slate-700">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <Smartphone className="w-4 h-4 text-blue-800" />
                <span>Conseils pour l'installation</span>
              </div>
              <p>
                Les téléphones doivent être connectés au <strong>même réseau Wi-Fi</strong> que ce PC serveur (port <span className="font-mono font-semibold">3000</span>).
              </p>
              {info?.allowed_network_prefix ? (
                <p>
                  Restriction Wi-Fi active : seules les IP commençant par{' '}
                  <span className="font-mono font-bold text-slate-900">
                    {info.allowed_network_prefix}
                  </span>{' '}
                  peuvent pointer.
                </p>
              ) : (
                <p>Aucune restriction de préfixe IP n'est configurée dans Paramètres.</p>
              )}
              <p>
                Sur Android ou iPhone, les employés peuvent aussi choisir <em>« Ajouter à l'écran d'accueil »</em> pour créer une icône d'application.
              </p>
            </section>
          </div>

          {/* Right column: Printable Entrance Poster */}
          <div className="lg:col-span-7">
            <article className="rounded-2xl bg-white border border-slate-300 p-8 sm:p-10 text-center space-y-6 print:border-0 print:p-6">
              {/* Brand / Logo */}
              <div className="flex flex-col items-center gap-3">
                {config?.logo_data_url && (
                  <img
                    src={config.logo_data_url}
                    alt={companyName}
                    className="h-16 w-16 rounded-2xl object-contain border border-slate-200 bg-white p-1"
                  />
                )}
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider">
                  {companyName}
                </p>
                <h2 className="text-3xl font-extrabold text-slate-900">
                  Pointage sur téléphone
                </h2>
                <p className="text-base text-slate-600 max-w-md mx-auto">
                  Scannez ce code avec votre téléphone pour enregistrer votre arrivée et votre départ.
                </p>
              </div>

              {/* QR Code */}
              <div className="inline-flex flex-col items-center justify-center rounded-2xl border-2 border-slate-900 bg-white p-5">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR code de connexion : ${selectedUrl}`}
                    className="w-64 h-64 sm:w-72 sm:h-72 object-contain"
                  />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center text-sm text-slate-500">
                    Génération du QR code...
                  </div>
                )}
                <p className="mt-3 text-xl sm:text-2xl font-mono font-extrabold text-blue-900 tracking-tight break-all">
                  {selectedUrl}
                </p>
              </div>

              {/* Simple 3-step instructions for employees */}
              <div className="max-w-lg mx-auto text-left border-t border-slate-200 pt-6 space-y-3 text-base text-slate-800">
                <p>
                  <strong className="font-mono text-blue-900 mr-2">1.</strong>
                  Connectez votre téléphone au <strong>Wi-Fi de l'entreprise</strong>.
                </p>
                <p>
                  <strong className="font-mono text-blue-900 mr-2">2.</strong>
                  Ouvrez l'appareil photo et visez le <strong>QR code</strong> ci-dessus (ou tapez l'adresse dans le navigateur).
                </p>
                <p>
                  <strong className="font-mono text-blue-900 mr-2">3.</strong>
                  Entrez votre <strong>code personnel à 6 chiffres</strong> puis appuyez sur{' '}
                  <strong className="text-emerald-700">Je suis arrivé</strong> ou{' '}
                  <strong className="text-red-700">Je pars</strong>.
                </p>
              </div>
            </article>
          </div>
        </div>
      )}
    </div>
  );
};
