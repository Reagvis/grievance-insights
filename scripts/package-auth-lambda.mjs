import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const outputDirectory = new URL('../artifacts/', import.meta.url);
const bundlePath = new URL('auth-lambda.cjs', outputDirectory);
const zipPath = new URL('auth-lambda.zip', outputDirectory);

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [new URL('../backend/auth/handler.ts', import.meta.url).pathname],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: bundlePath.pathname,
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  logLevel: 'info',
});

const bundle = new Uint8Array(await readFile(bundlePath));
const archive = zipSync(
  { 'index.js': [bundle, { mtime: new Date(1980, 0, 1, 0, 0, 0) }] },
  { level: 9 },
);
await writeFile(zipPath, archive, { mode: 0o600 });

Object.assign(process.env, {
  ALLOWED_ORIGIN: 'https://packaging.invalid',
  COGNITO_CLIENT_ID: 'packaging-client',
  COGNITO_USER_POOL_ID: 'packaging-pool',
  SESSIONS_TABLE_NAME: 'packaging-sessions',
  SESSION_TTL_SECONDS: '900',
});
const packagedModule = createRequire(import.meta.url)(bundlePath.pathname);
const health = await packagedModule.handler({
  headers: {},
  requestContext: { http: { method: 'GET', path: '/api/health' } },
});
if (health.statusCode !== 200 || health.body !== '{"status":"ok"}') {
  throw new Error('Packaged Lambda health smoke test failed');
}
console.log(`Packaged ${zipPath.pathname}`);
