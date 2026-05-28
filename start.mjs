import { spawn } from 'node:child_process';

const processes = [
  { name: 'web', command: 'node', args: ['server.js'] },
  { name: 'agent', command: 'node', args: ['agent.mjs', 'start'] },
];

const children = new Map();
let shuttingDown = false;

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
}

function startProcess(spec) {
  const child = spawn(spec.command, spec.args, {
    stdio: 'inherit',
    env: process.env,
  });

  children.set(spec.name, child);

  child.on('exit', (code, signal) => {
    children.delete(spec.name);
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`${spec.name} exited with ${reason}; shutting down.`);
    stopAll();
    process.exit(typeof code === 'number' && code !== 0 ? code : 1);
  });

  child.on('error', (error) => {
    console.error(`${spec.name} failed to start:`, error);
    stopAll();
    process.exit(1);
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error(error);
  stopAll();
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  stopAll();
  process.exit(1);
});

for (const spec of processes) startProcess(spec);
