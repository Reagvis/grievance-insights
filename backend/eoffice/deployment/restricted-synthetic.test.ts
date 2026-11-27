import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Event, Principal } from '../core';
import type { DocumentRef, Transport } from '../documents';
import type { AuditRecord } from '../provisional/audit';
import { issueDocumentGrant, issueOfficerToken, ProvisionalJwtVerifier,
  type SigningKey } from '../provisional/credentials';
import { createRestrictedSyntheticDocumentSource } from '../provisional/protected-documents';
import { createRestrictedSyntheticEofficeService } from '../provisional/service';

const issuer = 'restricted-synthetic-uat';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signer: SigningKey = { kid: 'operator-key-1', privateKey, issuer };
const principal: Principal = { department: 'finance', officer: 'officer-1', permissions: ['chat'] };
const sessionId = 'synthetic-session';
const ref: DocumentRef = {
  document_id: 'fixture-1', download_url: 'https://fixtures.example.gov/immutable/fixture-1.txt',
};
const fixtureBytes = new TextEncoder().encode('Allocation cap is 1.2 million. Synthetic fixture only.');
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const signedGrant = issueDocumentGrant(signer, {
  department: principal.department, officer: principal.officer, document: ref, sessionId,
});
const verifier = () => new ProvisionalJwtVerifier({
  issuer, publicKeys: new Map([[signer.kid, publicKey]]),
  status: { isRevoked: async () => false, revoke: async () => undefined },
});
const permit = {
  signedGrant, allowedHost: 'fixtures.example.gov',
  delegatedHeaders: { authorization: 'Bearer syntheticFixtureCredential01' },
  syntheticContentSha256: fixtureSha256,
};
const resolver = async () => [{ address: '8.8.8.8', family: 4 }];

describe('Task 22G restricted synthetic document acceptance', () => {
  it('accepts only exact operator-pinned bytes and rejects tampering before parsing', async () => {
    const download = vi.fn(async () => ({ bytes: fixtureBytes,
      contentType: 'text/plain; charset=utf-8', contentDisposition: 'attachment; filename="Fixture.txt"' }));
    const registry = { resolve: vi.fn(async () => permit) };
    const source = createRestrictedSyntheticDocumentSource({ verifier: verifier(), registry,
      resolver, transport: download as Transport });

    await expect(source.fetch(ref, principal, Date.now() + 5000, sessionId)).resolves.toMatchObject({
      document_id: ref.document_id, title: 'Fixture.txt',
      text: 'Allocation cap is 1.2 million. Synthetic fixture only.',
    });
    download.mockResolvedValueOnce({ bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
      contentType: 'text/plain; charset=utf-8', contentDisposition: '' });
    await expect(source.fetch(ref, principal, Date.now() + 5000, sessionId))
      .rejects.toMatchObject({ status: 422, diagnostic: 'Synthetic document digest mismatch.' });
  });

  it('rejects unauthorized scope and unregistered documents before transport', async () => {
    const download = vi.fn();
    const registry = { resolve: vi.fn(async () => null) };
    const source = createRestrictedSyntheticDocumentSource({ verifier: verifier(), registry,
      resolver, transport: download as Transport });
    await expect(source.fetch(ref, { ...principal, officer: 'other-officer' }, Date.now() + 5000, sessionId))
      .rejects.toMatchObject({ status: 422 });
    await expect(source.fetch({ ...ref, document_id: 'unregistered' }, principal, Date.now() + 5000, sessionId))
      .rejects.toMatchObject({ status: 422 });
    expect(download).not.toHaveBeenCalled();
  });

  it('returns the request UUID and emits payload-free audit for an exact fixture', async () => {
    const records: AuditRecord[] = [];
    const registry = { resolve: vi.fn(async () => permit) };
    const service = createRestrictedSyntheticEofficeService({
      inference: { mode: 'deterministic' },
      jwt: { issuer, publicKeys: new Map([[signer.kid, publicKey]]),
        status: { isRevoked: async () => false, revoke: async () => undefined } },
      grants: registry,
      audit: { record: async record => { records.push(record); } }, auditHmacKey: Buffer.alloc(32, 7),
      resolver, transport: (async () => ({ bytes: fixtureBytes, contentType: 'text/plain' })) as Transport,
    });
    const requestId = '11111111-2222-4333-8444-555555555555';
    const officerToken = issueOfficerToken(signer, { department: principal.department,
      officer: principal.officer, permissions: ['chat'], sessionId });
    const event: Event = { rawPath: '/api/v1/ai/chat', requestContext: { http: { method: 'POST' } },
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + officerToken },
      body: JSON.stringify({ request_id: requestId, session_id: sessionId,
        user_id: principal.officer, user_input: 'What is the allocation cap?',
        context: { documents: [ref] } }) };
    const result = await service(event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ request_id: requestId,
      answer: 'Document excerpt: Allocation cap is 1.2 million.' });
    expect(records.map(record => record.action)).toEqual([
      'request_attempt', 'authorization_success', 'request_complete',
    ]);
    expect(JSON.stringify(records)).not.toContain('Allocation cap');
    expect(JSON.stringify(records)).not.toContain(ref.download_url);
  });
});
