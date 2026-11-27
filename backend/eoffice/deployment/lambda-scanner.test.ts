import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { lambdaClamScanner } from './lambda-scanner';

const directories: string[] = [];
async function fixture(script: string) {
  const root = await mkdtemp(join(tmpdir(), 'eoffice-clam-test-'));
  directories.push(root);
  const executable = join(root, 'clamscan');
  await writeFile(executable, '#!/bin/sh\n' + script + '\n');
  await chmod(executable, 0o700);
  return { root, executable, scanner: lambdaClamScanner({
    executable, temporaryRoot: root, maximumSignatureAgeMs: 48 * 3600000,
  }) };
}
afterEach(async () => Promise.all(directories.splice(0)
  .map(path => rm(path, { recursive: true, force: true }))));

describe('Task 22G Lambda ClamAV fail-closed adapter', () => {
  it('passes native freshness/limit controls on every clean 2 MiB scan without --infected', async () => {
    const { root, scanner } = await fixture(`
case " $* " in *" --infected "*) exit 2;; esac
case " $* " in *" --fail-if-cvd-older-than=2 "*) :;; *) exit 2;; esac
printf '%s' "$*" > "$0.args"
cat >/dev/null
echo 'stdin: OK'
exit 0`);
    await expect(scanner(new Uint8Array(2 * 1024 * 1024), Date.now() + 5000)).resolves.toBe('clean');
    const args = await readFile(join(root, 'clamscan.args'), 'utf8');
    expect(args).toContain('--alert-exceeds-max=yes');
    expect(args).not.toContain('--infected');
    expect((await readdir(root)).filter(name => name.startsWith('eoffice-clam-'))).toEqual([]);
  });
  it('recognizes the standard EICAR infected verdict', async () => {
    const { scanner } = await fixture("cat >/dev/null; echo 'stdin: Eicar-Signature FOUND'; exit 1");
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    await expect(scanner(Buffer.from(eicar), Date.now() + 5000)).resolves.toBe('infected');
  });
  it('rechecks freshness on warm scans instead of caching readiness', async () => {
    const { root, scanner } = await fixture(`
cat >/dev/null
if test -f "$(dirname "$0")/stale"; then echo 'LibClamAV Error: database is outdated' ; exit 2; fi
echo 'stdin: OK'; exit 0`);
    await expect(scanner(Buffer.from('clean'), Date.now() + 5000)).resolves.toBe('clean');
    await writeFile(join(root, 'stale'), 'yes');
    await expect(scanner(Buffer.from('clean'), Date.now() + 5000)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects scan-limit verdicts and cleans scratch after timeout/error', async () => {
    const limited = await fixture("cat >/dev/null; echo 'stdin: Heuristics.Limits.Exceeded FOUND'; exit 1");
    await expect(limited.scanner(Buffer.from('clean'), Date.now() + 5000))
      .rejects.toMatchObject({ status: 503 });
    const timeout = await fixture("echo private > \"$TMPDIR/document\"; sleep 2");
    await expect(timeout.scanner(Buffer.from('clean'), Date.now() + 100))
      .rejects.toMatchObject({ status: 503 });
    expect((await readdir(timeout.root)).filter(name => name.startsWith('eoffice-clam-'))).toEqual([]);
    const failed = await fixture('exit 2');
    await expect(failed.scanner(Buffer.from('clean'), Date.now() + 5000))
      .rejects.toMatchObject({ status: 503 });
    expect((await readdir(failed.root)).filter(name => name.startsWith('eoffice-clam-'))).toEqual([]);
  });
});
