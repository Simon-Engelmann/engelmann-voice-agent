import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT || '8080';
const DEBUG_URL = `http://127.0.0.1:${PORT}/debug-log`;

const processes = [
  { name: 'web', command: 'node', args: ['server.js'] },
  { name: 'agent', command: 'node', args: ['agent.mjs', 'start'] },
];

const children = new Map();
let shuttingDown = false;
let queue = [];
let flushing = false;

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
}

function safeLine(line) {
  return String(line || '')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[api-key-redacted]')
    .slice(0, 4000);
}

async function sendDebug(entry) {
  await fetch(DEBUG_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  });
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const entry = queue[0];
      try {
        await sendDebug(entry);
        queue.shift();
      } catch {
        await delay(500);
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

function enqueueDebug(entry) {
  queue.push(entry);
  if (queue.length > 300) queue = queue.slice(-300);
  void flushQueue();
}

function pipeLines(stream, spec, level) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const text = String(chunk);
    if (level === 'error') process.stderr.write(text);
    else process.stdout.write(text);

    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const cleaned = safeLine(line.trim());
      if (!cleaned) continue;
      enqueueDebug({ source: spec.name, level, message: cleaned });
    }
  });
  stream.on('end', () => {
    const cleaned = safeLine(buffer.trim());
    if (cleaned) enqueueDebug({ source: spec.name, level, message: cleaned });
  });
}

function startProcess(spec) {
  const child = spawn(spec.command, spec.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  children.set(spec.name, child);
  pipeLines(child.stdout, spec, 'info');
  pipeLines(child.stderr, spec, 'error');

  enqueueDebug({ source: 'supervisor', level: 'info', message: `${spec.name} started`, data: { command: spec.command, args: spec.args } });

  child.on('exit', (code, signal) => {
    children.delete(spec.name);
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    enqueueDebug({ source: 'supervisor', level: code === 0 ? 'info' : 'error', message: `${spec.name} exited with ${reason}` });
    if (shuttingDown) return;

    console.error(`${spec.name} exited with ${reason}; shutting down.`);
    stopAll();
    process.exit(typeof code === 'number' && code !== 0 ? code : 1);
  });

  child.on('error', (error) => {
    enqueueDebug({ source: 'supervisor', level: 'error', message: `${spec.name} failed to start`, data: { message: error?.message || String(error) } });
    console.error(`${spec.name} failed to start:`, error);
    stopAll();
    process.exit(1);
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
process.on('uncaughtException', (error) => {
  enqueueDebug({ source: 'supervisor', level: 'error', message: 'uncaughtException', data: { message: error?.message || String(error), stack: error?.stack || null } });
  console.error(error);
  stopAll();
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  enqueueDebug({ source: 'supervisor', level: 'error', message: 'unhandledRejection', data: { message: error?.message || String(error), stack: error?.stack || null } });
  console.error(error);
  stopAll();
  process.exit(1);
});

for (const spec of processes) startProcess(spec);
setInterval(() => void flushQueue(), 1000).unref();
