import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { EofficeError } from '../schema';
import type { MalwareScanner } from '../documents';

type ScannerConfig = Readonly<{
  executable: string; databaseDirectory: string; maximumSignatureAgeMs: number;
}>;
const defaultConfig: ScannerConfig = {
  executable: '/usr/bin/clamscan',
  databaseDirectory: '/var/lib/clamav',
  maximumSignatureAgeMs: 48 * 60 * 60 * 1000,
};
const unavailable = () => new EofficeError(
  503, 'Malware scanner unavailable.', 'Document retrieval is unavailable.',
);

/** Real Lambda-container ClamAV scanner. Bytes are sent on stdin and are never
 * written to /tmp. Engine/signatures are immutable image content; stale images
 * fail closed and must be rebuilt rather than downloading during a request.
 */
export function lambdaClamScanner(overrides: Partial<ScannerConfig> = {}): MalwareScanner {
  const config = { ...defaultConfig, ...overrides };
  let ready: Promise<void> | undefined;
  const checkReady = () => ready ??= (async () => {
    let files: string[];
    try { files = await readdir(config.databaseDirectory); } catch { throw unavailable(); }
    const databases = files.filter(file => /^(?:main|daily|bytecode)\.(?:cvd|cld)$/.test(file));
    if (!databases.some(file => /^main\./.test(file)) || !databases.some(file => /^daily\./.test(file)))
      throw unavailable();
    const ages = await Promise.all(databases.map(async file =>
      Date.now() - (await stat(join(config.databaseDirectory, file))).mtimeMs));
    if (ages.some(age => age < 0 || age > config.maximumSignatureAgeMs)) throw unavailable();
  })();
  return async (bytes, deadline) => {
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || deadline <= Date.now()) throw unavailable();
    await checkReady();
    const remaining = Math.min(7000, deadline - Date.now());
    if (remaining <= 0) throw unavailable();
    return new Promise<'clean' | 'infected'>((resolve, reject) => {
      const child = spawn(config.executable,
        ['--no-summary', '--stdout', '--infected', '--database=' + config.databaseDirectory, '-'],
        { stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '', settled = false;
      const finish = (result?: 'clean' | 'infected') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        result ? resolve(result) : reject(unavailable());
      };
      const timer = setTimeout(() => finish(), remaining);
      child.once('error', () => finish());
      child.stdout.on('data', chunk => {
        output += Buffer.from(chunk).toString('utf8');
        if (output.length > 2048) finish();
      });
      child.once('close', code => {
        if (code === 0 && /: OK\s*$/m.test(output)) finish('clean');
        else if (code === 1 && /: .+ FOUND\s*$/m.test(output)) finish('infected');
        else finish();
      });
      child.stdin.once('error', () => finish());
      child.stdin.end(bytes);
    });
  };
}
