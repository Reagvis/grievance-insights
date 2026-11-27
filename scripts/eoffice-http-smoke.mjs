#!/usr/bin/env node
/**
 * Explicitly invoked localhost-only eOffice smoke process.
 * Builds the TypeScript-only fixture harness into a temporary Node module;
 * nothing is written to the repository or to persistent conversation storage.
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.argv.length !== 3 || process.argv[2] !== '--test-only') {
  process.stderr.write('Refused. Use: node scripts/eoffice-http-smoke.mjs --test-only\n');
  process.exitCode = 2;
} else if (process.env.NODE_ENV === 'production' ||
           process.env.AWS_LAMBDA_FUNCTION_NAME ||
           process.env.AWS_EXECUTION_ENV ||
           process.env.LAMBDA_TASK_ROOT) {
  process.stderr.write('Refused: synthetic eOffice HTTP smoke cannot run in production/AWS Lambda.\n');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'eoffice-smoke-code-'));
  let server;
  let closing = false;
  try {
    const output = join(directory, 'local-http.mjs');
    await build({
      entryPoints: [resolve('backend/eoffice/testing/local-http.ts')],
      bundle: true, platform: 'node', format: 'esm', target: 'node22',
      outfile: output, logLevel: 'silent',
    });
    const { startLocalEofficeServer } = await import(pathToFileURL(output).href);
    server = await startLocalEofficeServer({ testOnly: true });
    process.stdout.write([
      '==========================================================',
      'TEST-ONLY — SYNTHETIC DATA — NO REAL AUTHENTICATION',
      'eOffice Phase 1 localhost smoke listener: http://127.0.0.1:8765',
      'No AWS, government data, paid model, or external downloads.',
      'Fixture headers are NOT credentials. Never deploy this listener.',
      'Press Ctrl+C to stop.',
      '==========================================================',
      '',
    ].join('\n'));
    const stop = async () => {
      if (closing) return;
      closing = true;
      try {
        server.closeIdleConnections?.();
        await new Promise((resolveClose, rejectClose) => {
          server.close(error => error ? rejectClose(error) : resolveClose());
        });
      } catch {
        process.exitCode = 1;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
  } catch {
    process.stderr.write('Failed to start isolated eOffice test listener; no routes enabled.\n');
    process.exitCode = 1;
    if (server) server.close();
    await rm(directory, { recursive: true, force: true });
  }
}
