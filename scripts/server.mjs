import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
process.env.CDEK_RUNTIME = 'node';
if (command === 'migrate') {
  const { migrate } = await import('../server/storage.mjs');
  migrate();
} else if (command === 'build' || command === 'start') {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url)), command,
    ...process.argv.slice(3)], { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} else throw new Error('Expected build, start or migrate');
