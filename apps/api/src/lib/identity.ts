import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import { prisma } from './prisma.js';
import { sha256 } from './security.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(value: Buffer): string {
  let bits = '';
  for (const byte of value) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let offset = 0; offset < bits.length; offset += 5) result += BASE32[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  return result;
}

function decodeBase32(value: string): Buffer {
  let bits = '';
  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('MFA 金鑰格式錯誤');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totpAt(secret: string, timestamp: number): string {
  const counter = Math.floor(timestamp / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, '0');
}

export function createTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => crypto.timingSafeEqual(Buffer.from(totpAt(secret, now + window * 30_000)), Buffer.from(code)));
}

export function buildOtpAuthUri(email: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(`ExcelMaster:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('ExcelMaster')}&algorithm=SHA1&digits=6&period=30`;
}

export async function verifyCaptcha(config: AppConfig, token: string | undefined, remoteIp: string): Promise<boolean> {
  if (config.NODE_ENV !== 'production' && token === 'development-bypass') return true;
  if (!config.TURNSTILE_SECRET_KEY || !token) return false;
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: config.TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp, idempotency_key: crypto.randomUUID() })
  });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}

export function identityServicesReady(config: AppConfig): boolean {
  return config.NODE_ENV !== 'production' || Boolean(config.TURNSTILE_SECRET_KEY && config.RESEND_API_KEY && config.MAIL_FROM);
}

export async function sendEmail(config: AppConfig, input: { to: string; subject: string; html: string }): Promise<void> {
  if (config.NODE_ENV !== 'production' && !config.RESEND_API_KEY) return;
  if (!config.RESEND_API_KEY || !config.MAIL_FROM) throw new Error('Email 服務尚未設定');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.MAIL_FROM, to: [input.to], subject: input.subject, html: input.html })
  });
  if (!response.ok) throw new Error(`Email 寄送失敗 (${response.status})`);
}

export async function createAuthToken(userId: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD', lifetimeMinutes: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } });
  await prisma.authToken.create({ data: { userId, type, tokenHash: sha256(Buffer.from(token)), expiresAt: new Date(Date.now() + lifetimeMinutes * 60_000) } });
  return token;
}

export async function consumeAuthToken(token: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD'): Promise<string | null> {
  const tokenHash = sha256(Buffer.from(token));
  const item = await prisma.authToken.findUnique({ where: { tokenHash } });
  if (!item || item.type !== type || item.usedAt || item.expiresAt <= new Date()) return null;
  const claimed = await prisma.authToken.updateMany({ where: { id: item.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  return claimed.count ? item.userId : null;
}
