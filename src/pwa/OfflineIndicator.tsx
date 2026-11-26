import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isOfflineDesktop =
    typeof window !== 'undefined' &&
    (Boolean(window.electronAPI?.isElectron) || window.location.protocol === 'file:');

  if (isOnline || isOfflineDesktop) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 flex items-center gap-3 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white shadow-lg">
      <WifiOff className="w-5 h-5 shrink-0" />
      <span>Hors ligne — Connectez-vous au Wi-Fi de l'entreprise pour pointer.</span>
    </div>
  );
};
