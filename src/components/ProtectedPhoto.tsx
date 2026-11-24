import React, { useEffect, useState } from 'react';
import { Camera, X } from 'lucide-react';

export interface PhotoModalPayload {
  attendanceId: number;
  kind: 'checkin' | 'checkout';
  employeeName: string;
  dateLabel: string;
  timeLabel: string;
}

interface ProtectedPhotoThumbnailProps {
  token: string;
  attendanceId: number;
  kind: 'checkin' | 'checkout';
  employeeName: string;
  onOpen: () => void;
}

function useAuthenticatedPhotoUrl(token: string, attendanceId: number, kind: 'checkin' | 'checkout') {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);
    setUrl(null);

    fetch(`/api/admin/attendance/${attendanceId}/photo/${kind}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Photo inaccessible');
        return res.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [token, attendanceId, kind]);

  return { url, failed };
}

export const ProtectedPhotoThumbnail: React.FC<ProtectedPhotoThumbnailProps> = ({
  token,
  attendanceId,
  kind,
  employeeName,
  onOpen,
}) => {
  const { url, failed } = useAuthenticatedPhotoUrl(token, attendanceId, kind);
  const label = kind === 'checkin' ? 'Arrivée' : 'Départ';

  if (failed) {
    return (
      <span
        title={`Photo ${label.toLowerCase()} indisponible`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400"
      >
        <Camera className="w-4 h-4" />
      </span>
    );
  }

  if (!url) {
    return <span className="inline-block h-10 w-10 rounded-lg bg-slate-200 animate-pulse" />;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Voir la photo ${label.toLowerCase()} de ${employeeName}`}
      className="group relative inline-flex flex-col items-center rounded-lg border border-slate-300 bg-white overflow-hidden hover:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 transition"
    >
      <img
        src={url}
        alt={`Photo ${label.toLowerCase()} - ${employeeName}`}
        className="h-10 w-10 object-cover"
      />
      <span
        className={`w-full text-[9px] font-bold leading-tight py-0.5 text-center text-white ${
          kind === 'checkin' ? 'bg-emerald-700' : 'bg-red-700'
        }`}
      >
        {kind === 'checkin' ? 'Arr.' : 'Dép.'}
      </span>
    </button>
  );
};

interface ProtectedPhotoModalProps {
  token: string;
  photo: PhotoModalPayload;
  onClose: () => void;
}

export const ProtectedPhotoModal: React.FC<ProtectedPhotoModalProps> = ({
  token,
  photo,
  onClose,
}) => {
  const { url, failed } = useAuthenticatedPhotoUrl(token, photo.attendanceId, photo.kind);
  const kindLabel = photo.kind === 'checkin' ? "Photo d'arrivée" : 'Photo de départ';

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${kindLabel} - ${photo.employeeName}`}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{photo.employeeName}</h3>
            <p className="text-sm text-slate-600">
              {kindLabel} · <span className="capitalize">{photo.dateLabel}</span>
              {photo.timeLabel ? ` à ${photo.timeLabel}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 bg-slate-100 flex items-center justify-center min-h-[260px]">
          {failed ? (
            <p className="text-sm font-semibold text-red-700">
              Photo introuvable ou supprimée.
            </p>
          ) : !url ? (
            <p className="text-sm font-medium text-slate-600">Chargement de la photo...</p>
          ) : (
            <img
              src={url}
              alt={`${kindLabel} de ${photo.employeeName}`}
              className="max-h-[75vh] w-auto rounded-xl object-contain bg-white border border-slate-200"
            />
          )}
        </div>
      </div>
    </div>
  );
};
