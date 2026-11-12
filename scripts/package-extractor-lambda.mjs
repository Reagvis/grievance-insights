/**
 * Reproducible deployment artifact for the PDF/OCR extraction worker (artifacts/extractor-lambda.zip).
 *
 * Contents (nothing is downloaded at runtime):
 *   index.js                       esbuild bundle of backend/datasets/extractor-handler.ts (pdf.js is bundled)
 *   tessdata/{tel,eng}.traineddata version-pinned Tesseract tessdata_fast models, from the repository
 *   node_modules/tesseract.js …    tesseract.js 7 and its production dependency closure, WASM cores included.
 *                                  tesseract.js starts its own worker thread from files on disk, so it cannot be bundled.
 *
 * Reproducible: entries are sorted, timestamps are fixed, compression level is fixed.
 * Self-checking: the zip is extracted into an empty temp directory and a real OCR run is performed from there
 * (no access to the repository's node_modules), so a missing file fails packaging instead of failing in Lambda.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { unzipSync, zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
const bundlePath = join(outDir, 'extractor-lambda.cjs');
const zipPath = join(outDir, 'extractor-lambda.zip');
const MAX_ZIP_BYTES = 45 * 1024 * 1024; // direct Lambda upload limit is 50 MiB; keep headroom
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024; // Lambda limit is 250 MiB

await build({
  entryPoints: [join(root, 'backend/datasets/extractor-handler.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: bundlePath,
  external: ['tesseract.js'],
  sourcemap: false,
  legalComments: 'none',
  minify: false,
  logLevel: 'warning',
});

// ---- production dependency closure of tesseract.js ---------------------------------------------------------
const closure = new Map();
const nm = join(root, 'node_modules');
function visit(name) {
  if (closure.has(name)) return;
  const dir = join(nm, name);
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  closure.set(name, dir);
  for (const dep of Object.keys(pj.dependencies ?? {})) visit(dep);
}
visit('tesseract.js');

const SKIP_DIR = new Set(['docs', 'test', 'tests', '.github']);
// tesseract.js's own dist/ is the browser bundle (Node uses src/). Other packages keep dist/: it is their runtime code.
const skipDir = (base, name, dir) => SKIP_DIR.has(name) || (base === 'tesseract.js' && name === 'dist' && dir === join(nm, base));
const SKIP_FILE = /\.(md|map|ts)$|^(LICENSE|CHANGELOG).*$/i;
const mtime = new Date(1980, 0, 1, 0, 0, 0);
const files = {};
function add(zipName, buf) {
  files[zipName] = [new Uint8Array(buf), { mtime, level: 9 }];
}
function walk(dir, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDir(base, entry.name, dir)) walk(p, base);
    } else if (!SKIP_FILE.test(entry.name) || entry.name === 'package.json') {
      add(('node_modules/' + base + '/' + relative(join(nm, base), p)).replaceAll('\\', '/'), readFileSync(p));
    }
  }
}
for (const name of [...closure.keys()].sort()) walk(closure.get(name), name);
// Licences are kept (Apache-2.0 requires them to travel with the code).
for (const name of closure.keys()) for (const l of ['LICENSE', 'LICENSE.md', 'LICENCE']) {
  const p = join(closure.get(name), l);
  if (existsSync(p)) add('node_modules/' + name + '/' + l, readFileSync(p));
}
for (const lang of ['tel', 'eng']) add('tessdata/' + lang + '.traineddata', readFileSync(join(root, 'backend/ingest/tessdata', lang + '.traineddata')));
add('tessdata/README.md', readFileSync(join(root, 'backend/ingest/tessdata/README.md')));
add('index.js', readFileSync(bundlePath));

const ordered = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
const zip = zipSync(ordered, { level: 9 });
writeFileSync(zipPath, zip, { mode: 0o600 });

let unzipped = 0;
for (const v of Object.values(files)) unzipped += v[0].length;
if (zip.length > MAX_ZIP_BYTES) throw new Error('extractor zip is ' + (zip.length / 1048576).toFixed(1) + ' MiB; the direct-upload limit is 50 MiB');
if (unzipped > MAX_UNZIPPED_BYTES) throw new Error('extractor package expands to ' + (unzipped / 1048576).toFixed(1) + ' MiB; the Lambda limit is 250 MiB');

// ---- self-check: run the packaged artifact in an empty directory -------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'extractor-package-'));
try {
  for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(readFileSync(zipPath))))) {
    const target = join(work, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  writeFileSync(join(work, 'smoke.cjs'), `
    process.env.DATASETS_BUCKET_NAME = 'packaging'; process.env.DATASETS_TABLE_NAME = 'packaging';
    process.env.SESSIONS_TABLE_NAME = 'packaging'; process.env.ALLOWED_ORIGIN = 'https://packaging.invalid'; process.env.AWS_REGION = 'ap-south-1';
    const { handler } = require('./index.js');
    if (typeof handler !== 'function') throw new Error('extractor handler missing');
    const { createWorker, OEM } = require('tesseract.js');
    (async () => {
      await handler({ Records: [] }, { getRemainingTimeInMillis: () => 60000 });
      const worker = await createWorker('tel+eng', OEM.DEFAULT, { langPath: __dirname + '/tessdata', gzip: false, cachePath: require('os').tmpdir() + '/tess-smoke', logger: () => {} });
      const r = await worker.recognize(require('fs').readFileSync(process.argv[2]));
      await worker.terminate();
      process.stdout.write(JSON.stringify({ text: r.data.text.normalize('NFC').replace(/\\s+/g, ' ').trim(), confidence: r.data.confidence }));
    })().catch((e) => { console.error(e); process.exit(1); });
  `);
  const png = join(root, 'backend/ingest/fixtures/scan-p2.png');
  const run = spawnSync(process.execPath, ['smoke.cjs', png], { cwd: work, encoding: 'utf8', timeout: 120000 });
  if (run.status !== 0) throw new Error('Packaged extractor smoke test failed: ' + (run.stderr || run.stdout).slice(0, 800));
  const { text, confidence } = JSON.parse(run.stdout);
  if (!text.includes('సంబంధిత విభాగానికి సమస్యను పంపించాము') || confidence < 80) throw new Error('Packaged OCR returned unexpected text: ' + text.slice(0, 120));
  console.log('Packaged OCR self-check passed (confidence ' + Math.round(confidence) + ')');
} finally {
  rmSync(work, { recursive: true, force: true });
}
const hash = createHash('sha256').update(zip).digest('hex');
console.log('Packaged ' + zipPath + ' — ' + (zip.length / 1048576).toFixed(1) + ' MiB zipped, ' + (unzipped / 1048576).toFixed(1) + ' MiB unzipped, sha256 ' + hash.slice(0, 16));
