import { ensureProcessingQueue } from './lib/queue.js';
import { prisma } from './lib/prisma.js';

try {
  await ensureProcessingQueue();
  console.log('Supabase Queue excel_processing 已就緒');
} finally {
  await prisma.$disconnect();
}
