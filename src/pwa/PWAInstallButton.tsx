import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-800 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-900 active:scale-[0.98] transition whitespace-nowrap shrink-0"
      >
        <Download className="w-5 h-5" />
        Installer sur le téléphone
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 hover:bg-slate-100 active:scale-[0.98] transition whitespace-nowrap shrink-0"
        >
          <Download className="w-5 h-5 text-blue-800" />
          Installer sur iPhone
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-bold text-slate-900">
                  Installer sur iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                  aria-label="Fermer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <ol className="mt-4 space-y-3 text-base text-slate-700">
                <li className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-900">1</span>
                  <span>
                    Appuyez sur le bouton <strong className="inline-flex items-center gap-1"><Share className="w-4 h-4 inline" /> Partager</strong> en bas de Safari.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-900">2</span>
                  <span>
                    Faites défiler et appuyez sur <strong>« Sur l'écran d'accueil »</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-900">3</span>
                  <span>
                    Appuyez sur <strong>« Ajouter »</strong> en haut à droite.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full rounded-xl bg-blue-800 py-3.5 text-base font-bold text-white hover:bg-blue-900"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
