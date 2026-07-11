import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../config.js';

export interface StorageAdapter {
  put(key: string, source: string | Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  localPath?(key: string): string;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, key);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('不安全的儲存路徑');
    return target;
  }

  async put(key: string, source: string | Buffer): Promise<void> {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (typeof source === 'string') await fsp.copyFile(source, target);
    else await fsp.writeFile(target, source);
  }

  async getStream(key: string): Promise<Readable> {
    await fsp.access(this.resolve(key));
    return fs.createReadStream(this.resolve(key));
  }

  localPath(key: string): string { return this.resolve(key); }
}

export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, config: AppConfig) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE ?? Boolean(config.S3_ENDPOINT),
      credentials: config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined
    });
  }
  async put(key: string, source: string | Buffer, contentType: string): Promise<void> {
    const body = typeof source === 'string' ? fs.createReadStream(source) : source;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async getStream(key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('找不到儲存檔案');
    return result.Body as Readable;
  }
}

export function createStorage(config: AppConfig): StorageAdapter {
  if (config.STORAGE_DRIVER === 's3') {
    if (!config.S3_BUCKET) throw new Error('S3 儲存需要 S3_BUCKET');
    return new S3StorageAdapter(config.S3_BUCKET, config);
  }
  return new LocalStorageAdapter(config.STORAGE_LOCAL_PATH);
}
