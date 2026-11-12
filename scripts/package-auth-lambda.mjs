import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const outputDirectory = new URL('../artifacts/', import.meta.url);
const bundlePath = new URL('auth-lambda.cjs', outputDirectory);
const zipPath = new URL('auth-lambda.zip', outputDirectory);

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../backend/auth/handler.ts', import.meta.url))],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: fileURLToPath(bundlePath),
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
const packagedModule = createRequire(import.meta.url)(fileURLToPath(bundlePath));
const health = await packagedModule.handler({
  headers: {},
  requestContext: { http: { method: 'GET', path: '/api/health' } },
});
if (health.statusCode !== 200 || health.body !== '{"status":"ok"}') {
  throw new Error('Packaged Lambda health smoke test failed');
}
console.log(`Packaged ${fileURLToPath(zipPath)}`);

const datasetBundlePath = new URL('datasets-lambda.cjs', outputDirectory);
const datasetZipPath = new URL('datasets-lambda.zip', outputDirectory);
await build({
  entryPoints: [fileURLToPath(new URL('../backend/datasets/handler.ts', import.meta.url))],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: fileURLToPath(datasetBundlePath),
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  logLevel: 'info',
});
const datasetBundle = new Uint8Array(await readFile(datasetBundlePath));
await writeFile(datasetZipPath, zipSync(
  { 'index.js': [datasetBundle, { mtime: new Date(1980, 0, 1, 0, 0, 0) }] },
  { level: 9 },
), { mode: 0o600 });
Object.assign(process.env, {
  DATASETS_BUCKET_NAME: 'packaging-datasets',
  DATASETS_TABLE_NAME: 'packaging-dataset-metadata',
  AWS_REGION: 'ap-south-1',
});
const datasetModule = createRequire(import.meta.url)(fileURLToPath(datasetBundlePath));
if (typeof datasetModule.handler !== 'function') throw new Error('Dataset Lambda handler is missing');
console.log(`Packaged ${fileURLToPath(datasetZipPath)}`);

const analysisTargets = [
  ['analysis-api', '../backend/analysis/api-handler.ts'],
  ['analysis-worker', '../backend/analysis/worker-handler.ts'],
];
Object.assign(process.env, {
  ANALYSES_BUCKET_NAME: 'packaging-results',
  ANALYSES_TABLE_NAME: 'packaging-analysis-jobs',
  ANALYSES_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/123456789012/packaging-analysis.fifo',
  ANALYSES_DLQ_ARN: 'arn:aws:sqs:ap-south-1:123456789012:packaging-dlq.fifo',
});
for (const [name, entryPoint] of analysisTargets) {
  const bundlePath = new URL(name + '-lambda.cjs', outputDirectory);
  const zipPath = new URL(name + '-lambda.zip', outputDirectory);
  await build({
    entryPoints: [fileURLToPath(new URL(entryPoint, import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    outfile: fileURLToPath(bundlePath),
    sourcemap: false,
    legalComments: 'none',
    minify: false,
  });
  const bundle = new Uint8Array(await readFile(bundlePath));
  await writeFile(zipPath, zipSync(
    { 'index.js': [bundle, { mtime: new Date(1980, 0, 1, 0, 0, 0) }] },
    { level: 9 },
  ), { mode: 0o600 });
  const packaged = createRequire(import.meta.url)(fileURLToPath(bundlePath));
  if (typeof packaged.handler !== 'function') throw new Error(name + ' handler missing from Lambda bundle');
  if (name === 'analysis-worker') await packaged.handler({ Records: [] });
  console.log('Packaged ' + fileURLToPath(zipPath));
}
