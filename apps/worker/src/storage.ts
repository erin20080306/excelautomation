import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { pipeline } from 'node:stream/promises';

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

export function createWorkerStorage(): WorkerStorage {
  if (process.env.STORAGE_DRIVER === 's3') {
    if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET 未設定');
    return new S3WorkerStorage(process.env.S3_BUCKET);
  }
  return new LocalWorkerStorage(process.env.STORAGE_LOCAL_PATH ?? './storage');
}
