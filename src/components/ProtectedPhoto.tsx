import React, { useEffect, useRef, useState } from 'react';
import { Camera, Download, X } from 'lucide-react';
import { downloadAuthenticatedFile, formatMinutesToHours } from '../api';

export interface PhotoDetailModalPayload {
  employeeName: string;
  jobTitle?: string;
  dateIso: string;
  dateLabel: string;
  attendanceId: number | null;
  status:
    | 'present'
    | 'late'
    | 'absent'
    | 'unreported'
    | 'missing_checkout'
    | 'weekend'
    | 'holiday'
    | 'leave'
    | 'future';
  checkinTime: string | null;
  checkoutTime: string | null;
  lateMinutes: number;
  workedMinutes: number;
  checkinIp: string | null;
  checkoutIp: string | null;
  checkinPhotoId: number | null;
  checkoutPhotoId: number | null;
  hasCheckinPhoto?: boolean;
  hasCheckoutPhoto?: boolean;
  holidayLabel?: string;
}

export function buildProtectedPhotoUrl(params: {
  photoId?: number | null;
  attendanceId?: number | null;
  kind: 'checkin' | 'checkout';
  thumb?: boolean;
  download?: boolean;
}): string | null {
  const qs = new URLSearchParams();
  if (params.thumb) qs.set('thumb', '1');
  if (params.download) qs.set('download', '1');
  const queryStr = qs.toString() ? `?${qs.toString()}` : '';

  if (params.photoId && Number.isFinite(params.photoId)) {
    return `/api/photos/${params.photoId}${queryStr}`;
  }
  if (params.attendanceId && Number.isFinite(params.attendanceId)) {
    return `/api/admin/attendance/${params.attendanceId}/photo/${params.kind}${queryStr}`;
  }
  return null;
}

// Simple bounded in-memory object URL cache so scrolling/switching tabs is instant
const photoUrlCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 400;

function getCacheKey(token: string, url: string): string {
  return `${token.slice(-12)}:${url}`;
}

export function clearProtectedPhotoCache(): void {
  for (const objUrl of photoUrlCache.values()) {
    URL.revokeObjectURL(objUrl);
  }
  photoUrlCache.clear();
}

export function useLazyProtectedPhotoUrl(
  token: string,
  photoUrl: string | null,
  enabled: boolean
): { objectUrl: string | null; loading: boolean; failed: boolean } {
  const cacheKey = photoUrl ? getCacheKey(token, photoUrl) : null;
  const cached = cacheKey ? photoUrlCache.get(cacheKey) || null : null;

  const [objectUrl, setObjectUrl] = useState<string | null>(cached);
  const [loading, setLoading] = useState(Boolean(enabled && photoUrl && !cached));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!photoUrl || !cacheKey) {
      setObjectUrl(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    const existing = photoUrlCache.get(cacheKey);
    if (existing) {
      setObjectUrl(existing);
      setLoading(false);
      setFailed(false);
      return;
    }

    if (!enabled) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetch(photoUrl, {
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const createdUrl = URL.createObjectURL(blob);
        if (photoUrlCache.size >= MAX_CACHE_ENTRIES) {
          const oldestKey = photoUrlCache.keys().next().value;
          if (oldestKey) {
            const oldestVal = photoUrlCache.get(oldestKey);
            if (oldestVal) URL.revokeObjectURL(oldestVal);
            photoUrlCache.delete(oldestKey);
          }
        }
        photoUrlCache.set(cacheKey, createdUrl);
        setObjectUrl(createdUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, photoUrl, cacheKey, enabled]);

  return { objectUrl, loading, failed };
}

interface ProtectedPhotoImgProps {
  token: string;
  photoId?: number | null;
  attendanceId?: number | null;
  kind: 'checkin' | 'checkout';
  thumb?: boolean;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  eager?: boolean;
}

export const ProtectedPhotoImg: React.FC<ProtectedPhotoImgProps> = ({
  token,
  photoId,
  attendanceId,
  kind,
  thumb = true,
  alt,
  className = 'w-full h-full object-cover',
  placeholderClassName = 'w-full h-full rounded bg-slate-200 animate-pulse',
  eager = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(eager);

  const photoUrl = buildProtectedPhotoUrl({ photoId, attendanceId, kind, thumb });

  useEffect(() => {
    if (eager || inView) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '180px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, inView]);

  const { objectUrl, failed } = useLazyProtectedPhotoUrl(token, photoUrl, inView);

  if (!photoUrl) {
    return null;
  }

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      {failed ? (
        <span
          title="Photo indisponible"
          className="w-full h-full inline-flex items-center justify-center rounded bg-slate-100 text-slate-400"
        >
          <Camera className="w-4 h-4" />
        </span>
      ) : !objectUrl ? (
        <span className={placeholderClassName} />
      ) : (
        <img src={objectUrl} alt={alt} loading="lazy" className={className} />
      )}
    </div>
  );
};

interface ProtectedPhotoThumbnailProps {
  token: string;
  photoId?: number | null;
  attendanceId: number;
  kind: 'checkin' | 'checkout';
  employeeName: string;
  onOpen: () => void;
}

export const ProtectedPhotoThumbnail: React.FC<ProtectedPhotoThumbnailProps> = ({
  token,
  photoId,
  attendanceId,
  kind,
  employeeName,
  onOpen,
}) => {
  const label = kind === 'checkin' ? 'Arrivée' : 'Départ';

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Voir la photo ${label.toLowerCase()} de ${employeeName}`}
      className="group relative inline-flex flex-col items-center rounded-lg border border-slate-300 bg-white overflow-hidden hover:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 transition shrink-0"
    >
      <div className="h-10 w-10 bg-slate-100 overflow-hidden">
        <ProtectedPhotoImg
          token={token}
          photoId={photoId}
          attendanceId={attendanceId}
          kind={kind}
          thumb
          alt={`Photo ${label.toLowerCase()} - ${employeeName}`}
        />
      </div>
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

interface PhotoAttendanceDetailModalProps {
  token: string;
  detail: PhotoDetailModalPayload;
  onClose: () => void;
}

export const PhotoAttendanceDetailModal: React.FC<PhotoAttendanceDetailModalProps> = ({
  token,
  detail,
  onClose,
}) => {
  const [downloadingKind, setDownloadingKind] = useState<'checkin' | 'checkout' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const canShowCheckin = Boolean(detail.checkinPhotoId || (detail.hasCheckinPhoto && detail.attendanceId));
  const canShowCheckout = Boolean(
    detail.checkoutPhotoId || (detail.hasCheckoutPhoto && detail.attendanceId)
  );

  const handleDownload = async (kind: 'checkin' | 'checkout') => {
    const url = buildProtectedPhotoUrl({
      photoId: kind === 'checkin' ? detail.checkinPhotoId : detail.checkoutPhotoId,
      attendanceId: detail.attendanceId,
      kind,
      thumb: false,
      download: true,
    });
    if (!url || downloadingKind) return;
    setDownloadingKind(kind);
    setDownloadError(null);
    try {
      const safeName = detail.employeeName.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
      const label = kind === 'checkin' ? 'arrivee' : 'depart';
      await downloadAuthenticatedFile(url, token, `photo-${label}-${safeName}-${detail.dateIso}.jpg`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Erreur lors du téléchargement.');
    } finally {
      setDownloadingKind(null);
    }
  };

  const statusLabel =
    detail.status === 'missing_checkout'
      ? 'Départ manquant'
      : detail.status === 'unreported'
      ? 'Non signalé'
      : detail.status === 'late'
      ? `En retard (${detail.lateMinutes} min)`
      : detail.status === 'present'
      ? "À l'heure"
      : detail.status === 'absent'
      ? 'Absent'
      : detail.status === 'holiday'
      ? `Jour férié${detail.holidayLabel ? ` (${detail.holidayLabel})` : ''}`
      : detail.status === 'leave'
      ? `Congé${detail.holidayLabel ? ` (${detail.holidayLabel})` : ''}`
      : detail.status === 'weekend'
      ? 'Week-end'
      : 'À venir';

  const statusColor =
    detail.status === 'missing_checkout' || detail.status === 'absent'
      ? 'text-red-700'
      : detail.status === 'unreported' || detail.status === 'late'
      ? 'text-amber-700'
      : detail.status === 'present'
      ? 'text-emerald-700'
      : 'text-slate-600';

  const ipDisplay = [
    detail.checkinIp ? `Arrivée : ${detail.checkinIp}` : null,
    detail.checkoutIp && detail.checkoutIp !== detail.checkinIp
      ? `Départ : ${detail.checkoutIp}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Détails du pointage - ${detail.employeeName}`}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-white">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {detail.employeeName}
              {detail.jobTitle && (
                <span className="ml-2 text-sm font-normal text-slate-500">· {detail.jobTitle}</span>
              )}
            </h3>
            <p className="text-sm text-slate-600 capitalize mt-0.5">{detail.dateLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary strip */}
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div>
            <span className="block text-xs font-medium text-slate-500">Statut</span>
            <span className={`font-bold ${statusColor}`}>{statusLabel}</span>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-500">Arrivée</span>
            <span className="font-mono font-bold tabular-nums text-slate-900">
              {detail.checkinTime ? detail.checkinTime.slice(0, 5) : '--:--'}
            </span>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-500">Départ</span>
            <span className="font-mono font-bold tabular-nums text-slate-900">
              {detail.checkoutTime ? detail.checkoutTime.slice(0, 5) : '--:--'}
            </span>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-500">Heures travaillées</span>
            <span className="font-mono font-bold tabular-nums text-blue-900">
              {detail.workedMinutes > 0
                ? formatMinutesToHours(detail.workedMinutes)
                : detail.checkinTime && !detail.checkoutTime
                ? 'Départ non pointé'
                : '—'}
            </span>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-500">Adresse IP</span>
            <span className="font-mono text-xs text-slate-700 break-all">
              {ipDisplay || detail.checkinIp || '—'}
            </span>
          </div>
        </div>

        {downloadError && (
          <div className="mx-5 mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm font-semibold text-red-900">
            {downloadError}
          </div>
        )}

        {/* Photos Grid */}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5 bg-slate-100">
          {/* Arrival Photo Card */}
          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900">Photo d'arrivée</p>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {detail.checkinTime ? `Pointée à ${detail.checkinTime.slice(0, 5)}` : 'Non pointée'}
                </p>
              </div>
              {canShowCheckin && (
                <button
                  type="button"
                  onClick={() => void handleDownload('checkin')}
                  disabled={downloadingKind === 'checkin'}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloadingKind === 'checkin' ? 'En cours...' : 'Télécharger'}
                </button>
              )}
            </div>
            <div className="p-3 bg-slate-50 flex items-center justify-center min-h-[240px] max-h-[420px]">
              {canShowCheckin ? (
                <ProtectedPhotoImg
                  token={token}
                  photoId={detail.checkinPhotoId}
                  attendanceId={detail.attendanceId}
                  kind="checkin"
                  thumb={false}
                  eager
                  alt={`Photo d'arrivée de ${detail.employeeName}`}
                  className="max-h-[380px] w-auto rounded-lg object-contain bg-white border border-slate-200"
                />
              ) : (
                <div className="text-center text-slate-400">
                  <Camera className="w-8 h-8 mx-auto mb-1 opacity-60" />
                  <p className="text-xs font-medium">Aucune photo d'arrivée</p>
                </div>
              )}
            </div>
          </div>

          {/* Departure Photo Card */}
          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900">Photo de départ</p>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {detail.checkoutTime ? `Pointée à ${detail.checkoutTime.slice(0, 5)}` : 'Non pointée'}
                </p>
              </div>
              {canShowCheckout && (
                <button
                  type="button"
                  onClick={() => void handleDownload('checkout')}
                  disabled={downloadingKind === 'checkout'}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloadingKind === 'checkout' ? 'En cours...' : 'Télécharger'}
                </button>
              )}
            </div>
            <div className="p-3 bg-slate-50 flex items-center justify-center min-h-[240px] max-h-[420px]">
              {canShowCheckout ? (
                <ProtectedPhotoImg
                  token={token}
                  photoId={detail.checkoutPhotoId}
                  attendanceId={detail.attendanceId}
                  kind="checkout"
                  thumb={false}
                  eager
                  alt={`Photo de départ de ${detail.employeeName}`}
                  className="max-h-[380px] w-auto rounded-lg object-contain bg-white border border-slate-200"
                />
              ) : (
                <div className="text-center text-slate-400">
                  <Camera className="w-8 h-8 mx-auto mb-1 opacity-60" />
                  <p className="text-xs font-medium">Aucune photo de départ</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
