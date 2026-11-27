import { chmod, mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { lambdaClamScanner } from './lambda-scanner';

const directories: string[] = [];
async function fixture(script: string, ageMs = 0) {
  const root = await mkdtemp(join(tmpdir(), 'eoffice-clam-'));
  directories.push(root);
  const database = join(root, 'db');
  await mkdir(database);
  for (const file of ['main.cvd', 'daily.cvd']) {
    const path = join(database, file);
    await writeFile(path, 'synthetic-signature-metadata');
    const date = new Date(Date.now() - ageMs);
    await utimes(path, date, date);
  }
  const executable = join(root, 'clamscan');
  await writeFile(executable, '#!/bin/sh\ncat >/dev/null\n' + script + '\n');
  await chmod(executable, 0o700);
  return { executable, databaseDirectory: database, maximumSignatureAgeMs: 3600000 };
}
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true }))));

describe('Task 22G Lambda ClamAV fail-closed adapter', () => {
  it('accepts only an exact clean scanner result', async () => {
    const scan = lambdaClamScanner(await fixture("echo 'stdin: OK'; exit 0"));
    await expect(scan(new Uint8Array(2 * 1024 * 1024), Date.now() + 5000)).resolves.toBe('clean');
  });
  it('recognizes the standard infected verdict', async () => {
    const scan = lambdaClamScanner(await fixture("echo 'stdin: Eicar-Signature FOUND'; exit 1"));
    await expect(scan(Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), Date.now() + 5000))
      .resolves.toBe('infected');
  });
  it('fails closed for stale signatures, scanner errors and expired deadlines', async () => {
    const stale = lambdaClamScanner(await fixture("echo 'stdin: OK'; exit 0", 7200000));
    await expect(stale(Buffer.from('clean'), Date.now() + 5000)).rejects.toMatchObject({ status: 503 });
    const error = lambdaClamScanner(await fixture('exit 2'));
    await expect(error(Buffer.from('clean'), Date.now() + 5000)).rejects.toMatchObject({ status: 503 });
    await expect(error(Buffer.from('clean'), Date.now() - 1)).rejects.toMatchObject({ status: 503 });
  });
});
