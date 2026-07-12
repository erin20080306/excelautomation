import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { pipeline } from 'node:stream/promises';
import type { PrismaClient } from '@prisma/client';

export interface WorkerStorage {
  download(key: string, target: string): Promise<void>;
  upload(key: string, source: string, contentType: string): Promise<void>;
}

class LocalWorkerStorage implements WorkerStorage {
  constructor(private readonly root: string) {}
  private resolve(key: string): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, key);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('不安全的儲存路徑');
    return target;
  }
  async download(key: string, target: string): Promise<void> { await fsp.copyFile(this.resolve(key), target); }
  async upload(key: string, source: string): Promise<void> { const target = this.resolve(key); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.copyFile(source, target); }
}

class S3WorkerStorage implements WorkerStorage {
  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === undefined
      ? Boolean(process.env.S3_ENDPOINT)
      : process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined
  });
  constructor(private readonly bucket: string) {}
  async download(key: string, target: string): Promise<void> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('找不到來源檔案');
    await pipeline(result.Body as NodeJS.ReadableStream, fs.createWriteStream(target));
  }
  async upload(key: string, source: string, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: fs.createReadStream(source), ContentType: contentType }));
  }
}

function parseDatabaseKey(key: string): { workspaceId: string; key: string } {
  const [workspaceId] = key.split('/');
  if (!workspaceId || workspaceId.length > 100) throw new Error('資料庫儲存鍵缺少工作區');
  return { workspaceId, key };
}

class DatabaseWorkerStorage implements WorkerStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async download(key: string, target: string): Promise<void> {
    const object = await this.prisma.storedObject.findUnique({ where: { workspaceId_key: parseDatabaseKey(key) } });
    if (!object) throw new Error('找不到資料庫儲存物件');
    await fsp.writeFile(target, Buffer.from(object.data));
  }

  async upload(key: string, source: string, contentType: string): Promise<void> {
    const identity = parseDatabaseKey(key);
    const data = await fsp.readFile(source);
    await this.prisma.storedObject.upsert({
      where: { workspaceId_key: identity },
      create: { ...identity, data, contentType, size: data.length },
      update: { data, contentType, size: data.length }
    });
  }
}

export function createWorkerStorage(prisma: PrismaClient): WorkerStorage {
  if (process.env.STORAGE_DRIVER === 'database') return new DatabaseWorkerStorage(prisma);
  if (process.env.STORAGE_DRIVER === 's3') {
    if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET 未設定');
    return new S3WorkerStorage(process.env.S3_BUCKET);
  }
  return new LocalWorkerStorage(process.env.STORAGE_LOCAL_PATH ?? './storage');
}
