import { spawn, spawnSync } from 'node:child_process';

function runRequired(command, args, label) {
  console.log(JSON.stringify({ event: 'bootstrap.start', label }));
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${label} 執行失敗，結束碼 ${result.status ?? 'unknown'}`);
  console.log(JSON.stringify({ event: 'bootstrap.completed', label }));
}

runRequired('./node_modules/.bin/prisma', ['db', 'push', '--schema', 'apps/api/prisma/schema.prisma'], 'database-schema');

if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
  runRequired('./node_modules/.bin/tsx', ['apps/api/prisma/seed.ts'], 'test-owner-seed');
} else {
  console.log(JSON.stringify({ event: 'bootstrap.skipped', label: 'test-owner-seed', reason: 'seed credentials not configured' }));
}

const children = [
  spawn('node', ['apps/api/dist/server.js'], { stdio: 'inherit', env: process.env }),
  spawn('node', ['apps/worker/dist/index.js'], { stdio: 'inherit', env: process.env }),
  spawn('/opt/parser-venv/bin/uvicorn', ['app.main:app', '--app-dir', 'apps/parser', '--host', '127.0.0.1', '--port', '8000'], { stdio: 'inherit', env: process.env })
];

let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill(signal);
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}

for (const [index, child] of children.entries()) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      const service = ['api', 'worker', 'parser'][index] ?? 'unknown';
      console.error(JSON.stringify({ event: 'service.exited', service, code, signal }));
      shutdown('SIGTERM', code ?? 1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
