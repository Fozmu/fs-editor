// Starts Vite and launches Electron against the dev server: `npm run dev:desktop`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const server = await createServer({ server: { port: 5173 } });
await server.listen();
const url = server.resolvedUrls.local[0];
const child = spawn(require('electron'), ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
