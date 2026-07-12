import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createTaskProcessor, type TaskProcessor } from '@excelmaster/processor';
import type { AppConfig } from '../config.js';
import { prisma } from './prisma.js';
import type { StorageAdapter } from './storage.js';

export function createInlineProcessor(storage: StorageAdapter, config: AppConfig, options: { unlimited?: boolean } = {}): TaskProcessor {
  return createTaskProcessor({
    prisma,
    parserUrl: config.PARSER_URL,
    parserSecret: config.PARSER_SHARED_SECRET,
    requestTimeoutMs: 4 * 60 * 1000,
    maxOutputBytes: options.unlimited ? undefined : config.TRIAL_MAX_OUTPUT_MB * 1024 * 1024,
    storage: {
      async download(key, target) {
        await pipeline(await storage.getStream(key), fs.createWriteStream(target));
      },
      async upload(key, source, contentType) {
        await storage.put(key, source, contentType);
      }
    }
  });
}
