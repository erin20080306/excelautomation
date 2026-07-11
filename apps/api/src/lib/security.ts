import crypto from 'node:crypto';
import path from 'node:path';
import jwt from 'jsonwebtoken';

export function safeFileName(name: string): string {
  const base = path.basename(name).normalize('NFKC');
  const withoutControlCharacters = [...base].map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  return withoutControlCharacters.replace(/[<>:"/\\|?*]/g, '_').slice(0, 180) || 'unnamed';
}

export function assertSafeArchivePath(entryPath: string): void {
  const normalized = path.posix.normalize(entryPath.replaceAll('\\', '/'));
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) {
    throw new Error('ZIP 內含不安全的路徑');
  }
}

export function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function encryptSecret(value: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function signDownload(payload: { exportFileId: string; workspaceId: string }, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '10m', audience: 'excelmaster-download' });
}

export function verifyDownload(token: string, secret: string): { exportFileId: string; workspaceId: string } {
  return jwt.verify(token, secret, { audience: 'excelmaster-download' }) as { exportFileId: string; workspaceId: string };
}

export function maskSensitive(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[^@\s]+@[^@\s]+$/.test(value)) {
    const [name, domain] = value.split('@');
    return `${name?.slice(0, 2)}***@${domain}`;
  }
  if (/^\+?\d[\d -]{7,}$/.test(value)) return `${value.slice(0, 3)}****${value.slice(-2)}`;
  return value;
}
