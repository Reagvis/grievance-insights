import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EofficeError } from '../schema';
import type { MalwareScanner } from '../documents';

type ScannerConfig = Readonly<{
  executable: string;
  maximumSignatureAgeMs: number;
  temporaryRoot: string;
}>;
const defaultConfig: ScannerConfig = {
  executable: '/usr/bin/clamscan',
  maximumSignatureAgeMs: 48 * 60 * 60 * 1000,
  temporaryRoot: tmpdir(),
};
const prefix = 'eoffice-clam-';
const unavailable = () => new EofficeError(
  503, 'Malware scanner unavailable.', 'Document retrieval is unavailable.',
);

async function purgeScratch(root: string): Promise<void> {
  let entries: string[];
  try { entries = await readdir(root); } catch { throw unavailable(); }
  try {
    await Promise.all(entries.filter(name => name.startsWith(prefix))
      .map(name => rm(join(root, name), { recursive: true, force: true })));
  } catch { throw unavailable(); }
}

/** Real Lambda-container ClamAV scanner. ClamAV's stdin implementation may use
 * scratch files internally, so each scan receives an isolated TMPDIR which is
 * removed before any verdict is returned. No document scratch survives reuse.
 */
export function lambdaClamScanner(overrides: Partial<ScannerConfig> = {}): MalwareScanner {
  const config = { ...defaultConfig, ...overrides };
  let tail: Promise<void> = Promise.resolve();
  const scan: MalwareScanner = async (bytes, deadline) => {
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || deadline <= Date.now()) throw unavailable();
    await purgeScratch(config.temporaryRoot);
    let scratch: string;
    try { scratch = await mkdtemp(join(config.temporaryRoot, prefix)); } catch { throw unavailable(); }
    const remaining = Math.min(7000, deadline - Date.now());
    if (remaining <= 0) {
      await rm(scratch, { recursive: true, force: true });
      throw unavailable();
    }
    // ClamAV validates the daily database's embedded build timestamp on every
    // warm/cold scan. The long-lived main database is not an age signal.
    const maximumDays = Math.max(1, Math.floor(config.maximumSignatureAgeMs / 86400000));
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.executable, [
        '--no-summary', '--stdout',
        '--fail-if-cvd-older-than=' + maximumDays,
        '--max-scansize=8M', '--max-filesize=2M', '--max-files=100',
        '--max-recursion=8', '--alert-exceeds-max=yes',
        '-',
      ], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, TMPDIR: scratch } });
    } catch {
      try { await rm(scratch, { recursive: true }); } catch { /* fail closed below */ }
      throw unavailable();
    }
    if (!child.stdout || !child.stdin) {
      child.kill('SIGKILL');
      try { await rm(scratch, { recursive: true }); } catch { /* fail closed below */ }
      throw unavailable();
    }
    const stdout = child.stdout, stdin = child.stdin;
    return new Promise<'clean' | 'infected'>((resolve, reject) => {
      let output = '', finishing = false;
      const finish = async (result?: 'clean' | 'infected') => {
        if (finishing) return;
        finishing = true;
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise<void>(done => {
            child.once('close', () => done());
            child.kill('SIGKILL');
          });
        }
        try { await rm(scratch, { recursive: true }); }
        catch { reject(unavailable()); return; }
        if (result) resolve(result);
        else reject(unavailable());
      };
      const timer = setTimeout(() => { void finish(); }, remaining);
      child.once('error', () => { void finish(); });
      stdout.on('data', chunk => {
        output += Buffer.from(chunk).toString('utf8');
        if (output.length > 2048) void finish();
      });
      child.once('close', code => {
        if (/Heuristics\.Limits\.Exceeded|SCAN SUMMARY|ERROR/i.test(output)) {
          void finish(); return;
        }
        if (code === 0 && /^stdin: OK\s*$/m.test(output)) void finish('clean');
        else if (code === 1 && /^stdin: .+ FOUND\s*$/m.test(output)) void finish('infected');
        else void finish();
      });
      stdin.once('error', () => { void finish(); });
      stdin.end(bytes);
    });
  };
  return (bytes, deadline) => {
    const result = tail.then(() => scan(bytes, deadline));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
