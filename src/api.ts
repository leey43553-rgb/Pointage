import {
  LocalApiHttpError,
  localApiFetchBlob,
  localApiFormDataRequest,
  localApiRequest,
} from './localDb/localApi';

export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let useLocalStoragePromise: Promise<boolean> | null = null;

export async function shouldUseLocalIndexedDb(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.electronAPI?.isElectron || window.location.protocol === 'file:') {
    return true;
  }
  if (!useLocalStoragePromise) {
    useLocalStoragePromise = (async () => {
      try {
        const res = await fetch('/api/public/config', {
          method: 'GET',
          credentials: 'same-origin',
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (res.ok && ct.includes('application/json')) {
          return false; // Express backend is active
        }
      } catch {
        // Express backend unreachable
      }
      return true;
    })();
  }
  return useLocalStoragePromise;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
  } = {}
): Promise<T> {
  if (await shouldUseLocalIndexedDb()) {
    try {
      return await localApiRequest<T>(path, options);
    } catch (err) {
      if (err instanceof LocalApiHttpError) {
        throw new ApiError(err.message, err.status, err.retryAfterSeconds);
      }
      throw new ApiError(
        err instanceof Error ? err.message : 'Erreur locale IndexedDB.',
        500
      );
    }
  }

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur local. Vérifiez le Wi-Fi.', 0);
  }

  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const errMsg =
      typeof data.error === 'string' && data.error
        ? data.error
        : `Erreur serveur (${response.status})`;
    const retry = typeof data.retry_after_seconds === 'number' ? data.retry_after_seconds : undefined;
    throw new ApiError(errMsg, response.status, retry);
  }

  return data as T;
}

export async function apiFormDataRequest<T>(
  path: string,
  options: {
    method?: string;
    formData: FormData;
    token?: string | null;
  }
): Promise<T> {
  if (await shouldUseLocalIndexedDb()) {
    try {
      return await localApiFormDataRequest<T>(path, options);
    } catch (err) {
      if (err instanceof LocalApiHttpError) {
        throw new ApiError(err.message, err.status, err.retryAfterSeconds);
      }
      throw new ApiError(
        err instanceof Error ? err.message : 'Erreur locale IndexedDB.',
        500
      );
    }
  }

  const headers: Record<string, string> = {};
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || 'POST',
      headers,
      credentials: 'same-origin',
      body: options.formData,
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur local. Vérifiez le Wi-Fi.', 0);
  }

  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const errMsg =
      typeof data.error === 'string' && data.error
        ? data.error
        : `Erreur serveur (${response.status})`;
    const retry = typeof data.retry_after_seconds === 'number' ? data.retry_after_seconds : undefined;
    throw new ApiError(errMsg, response.status, retry);
  }

  return data as T;
}

export async function logoutAdmin(): Promise<void> {
  if (await shouldUseLocalIndexedDb()) {
    return;
  }
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // ignore network failure on logout
  }
}

export async function fetchProtectedBlob(path: string, token: string): Promise<Blob> {
  if (await shouldUseLocalIndexedDb()) {
    try {
      const { blob } = await localApiFetchBlob(path, token);
      return blob;
    } catch (err) {
      if (err instanceof LocalApiHttpError) {
        throw new ApiError(err.message, err.status, err.retryAfterSeconds);
      }
      throw new ApiError('Photo introuvable.', 404);
    }
  }

  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }
  return await res.blob();
}

export async function downloadAuthenticatedFile(
  path: string,
  token: string,
  fallbackFilename: string
): Promise<void> {
  let blob: Blob;
  let filename = fallbackFilename;

  if (await shouldUseLocalIndexedDb()) {
    try {
      const result = await localApiFetchBlob(path, token);
      blob = result.blob;
      if (result.filename) {
        filename = result.filename;
      }
    } catch (err) {
      if (err instanceof LocalApiHttpError) {
        throw new ApiError(err.message, err.status, err.retryAfterSeconds);
      }
      throw new ApiError('Erreur lors du téléchargement.', 500);
    }
  } else {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      let errMsg = 'Erreur lors du téléchargement.';
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) errMsg = data.error;
      } catch {
        // ignore
      }
      throw new ApiError(errMsg, response.status);
    }

    blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(disposition);
    filename = match?.[1] || fallbackFilename;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildStandalonePrintHtml(bodyHtml: string, title = 'Pointage'): string {
  const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((el) => {
      if (el.tagName.toLowerCase() === 'style') {
        return `<style>${el.textContent || ''}</style>`;
      }
      return '';
    })
    .join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  ${styleTags}
  <style>
    @media print { .no-print { display: none !important; } }
    body { background: #ffffff; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export function formatMinutesToHours(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function formatFrenchDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function getTodayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getCurrentMonthLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
