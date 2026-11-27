import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const directory = new URL('../artifacts/eoffice/', import.meta.url);
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../backend/eoffice/deployment/handler.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: fileURLToPath(new URL('handler.cjs', directory)),
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  logLevel: 'info',
});
console.log('Packaged isolated eOffice service bundle');
const packagedHandler = createRequire(import.meta.url)(fileURLToPath(new URL('handler.cjs', directory)));
if (typeof packagedHandler.handler !== 'function') throw new Error('Packaged eOffice Lambda handler is missing');
console.log('Imported packaged eOffice handler without AWS calls');
await build({
  entryPoints: [fileURLToPath(new URL('../backend/eoffice/deployment/operator.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: fileURLToPath(new URL('operator.mjs', directory)),
  sourcemap: false, legalComments: 'none', minify: false, logLevel: 'info',
});
console.log('Packaged isolated eOffice operator tool');
