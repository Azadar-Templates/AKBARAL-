import { spawn } from 'node:child_process';

const children = [];
function launch(name, command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
  child.name = name;
  children.push(child);
  return child;
}
function shutdown(signal = 'SIGTERM') {
  for (const child of children) {
    if (!child.killed) { try { child.kill(signal); } catch {} }
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const api = launch('api', 'npx', ['tsx', 'src/index.ts'], { PORT: '4000', NODE_ENV: 'development' });
const web = launch('web', 'node_modules/.bin/next', ['dev', '-H', '0.0.0.0', '-p', '3000'], { NODE_ENV: 'development' });

api.on('exit', (code) => { shutdown(); process.exit(code ?? 0); });
web.on('exit', (code) => { shutdown(); process.exit(code ?? 0); });
