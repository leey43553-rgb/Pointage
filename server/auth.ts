import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, db, type AdminRow, type EmployeeRow } from './db.ts';

const TOKEN_SECRET = process.env.SESSION_SECRET || APP_CONFIG.sessionSecret;
export const ADMIN_COOKIE_NAME = 'pointage_admin_session';

export interface AdminTokenPayload {
  sub: number;
  type: 'admin';
  role: 'super_admin' | 'admin';
  username: string;
  exp: number;
}

export interface EmployeeTokenPayload {
  sub: number;
  type: 'employee';
  role: 'employee';
  first_name: string;
  last_name: string;
  exp: number;
}

export type TokenPayload = AdminTokenPayload | EmployeeTokenPayload;

export interface AuthenticatedRequest extends Request {
  auth?: TokenPayload;
  adminUser?: AdminRow;
  employeeUser?: EmployeeRow;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signToken(payload: TokenPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as TokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function setAdminSessionCookie(res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api',
  });
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

function extractAdminToken(req: Request): string | null {
  const bearer = extractBearerToken(req);
  if (bearer) return bearer;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[ADMIN_COOKIE_NAME] || null;
}

export function requireEmployee(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Session expirée. Veuillez saisir votre code.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'employee') {
    res.status(401).json({ error: 'Session employé invalide ou expirée.' });
    return;
  }
  const employee = db
    .prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1')
    .get(payload.sub) as EmployeeRow | undefined;
  if (!employee) {
    res.status(401).json({ error: 'Compte employé introuvable ou désactivé.' });
    return;
  }
  req.auth = payload;
  req.employeeUser = employee;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractAdminToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentification requise.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload || payload.type !== 'admin') {
    res.status(401).json({ error: 'Session administrateur invalide ou expirée.' });
    return;
  }
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(payload.sub) as AdminRow | undefined;
  if (!admin) {
    res.status(401).json({ error: 'Compte administrateur introuvable.' });
    return;
  }
  req.auth = payload;
  req.adminUser = admin;
  next();
}

export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  requireAdmin(req, res, () => {
    if (!req.adminUser || req.adminUser.role !== 'super_admin') {
      res.status(403).json({ error: 'Accès réservé au super administrateur.' });
      return;
    }
    next();
  });
}
