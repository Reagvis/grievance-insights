import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

/** Dependency-free real Chromium DOM smoke regression for the dashboard. */
function browserPath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const binary of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [binary], { encoding: 'utf8' });
    if (found.status === 0) return found.stdout.trim();
  }
  throw new Error('Chromium/Chrome is required for the dashboard interaction test');
}
async function freePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
const chrome = browserPath();
const port = await freePort();
const url = 'http://127.0.0.1:' + port + '/tests/dashboard-interactive.html';
const userDataDir = await mkdtemp(join(tmpdir(), 'grievance-dashboard-browser-'));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
  '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
server.stderr.on('data', chunk => { stderr += String(chunk).slice(-5000); });
try {
  let started = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Vite server exited: ' + stderr.slice(-1500));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { started = true; break; }
    } catch { /* Vite is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!started) throw new Error('Vite server failed to start: ' + stderr.slice(-1000));
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--disable-background-networking', '--hide-scrollbars',
    '--user-data-dir=' + userDataDir, '--virtual-time-budget=12000', '--dump-dom', url,
  ], { encoding: 'utf8', timeout: 50000, maxBuffer: 8 * 1024 * 1024 });
  const dom = result.stdout ?? '';
  if (result.status !== 0 || !dom.includes('id="dashboard-browser-result" data-status="passed"')) {
    const testResult = dom.match(/<pre id="dashboard-browser-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    throw new Error('Dashboard browser interactions failed: ' + (testResult || result.stderr || dom.slice(-2500)).slice(0,4000));
  }
  const passed = dom.match(/PASS \d+ real-browser interactive assertions/)?.[0] ?? 'Browser interactions passed';
  console.log(passed);
} finally {
  server.kill('SIGTERM');
  await rm(userDataDir, { recursive: true, force: true });
}
