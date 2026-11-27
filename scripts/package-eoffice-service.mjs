import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = new URL('../artifacts/eoffice/', import.meta.url);
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../backend/eoffice/deployment/handler.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: fileURLToPath(new URL('handler.mjs', directory)),
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  logLevel: 'info',
});
console.log('Packaged isolated eOffice service bundle');
await build({
  entryPoints: [fileURLToPath(new URL('../backend/eoffice/deployment/operator.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: fileURLToPath(new URL('operator.mjs', directory)),
  sourcemap: false, legalComments: 'none', minify: false, logLevel: 'info',
});
console.log('Packaged isolated eOffice operator tool');
