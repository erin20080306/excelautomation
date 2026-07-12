import { buildApp } from './apps/api/dist/app.js';

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
