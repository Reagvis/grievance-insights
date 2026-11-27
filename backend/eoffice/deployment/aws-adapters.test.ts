import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  DynamoAuditSink, DynamoCredentialStatus, DynamoResourceRegistry,
  verificationFromEnvironment,
} from './aws-adapters';
import { sha256Url } from '../provisional/credentials';

class FakeClient {
  readonly commands: unknown[] = [];
  item: Record<string, unknown> | undefined;
  async send(command: unknown) { this.commands.push(command); return { Item: this.item }; }
}
const principal = { department: 'finance', officer: 'officer-1', permissions: ['chat'] as const };
const ref = { document_id: 'doc-1', download_url: 'https://files.example.gov/doc?id=1' };

describe('Task 22G AWS operational adapters', () => {
  afterEach(() => {
    delete process.env.EOFFICE_JWT_ISSUER;
    delete process.env.EOFFICE_PUBLIC_KEYS_JSON;
  });
  it('uses strongly consistent status reads and durable revocations', async () => {
    const client = new FakeClient();
    const status = new DynamoCredentialStatus(client as never, 'status');
    expect(await status.isRevoked('officer', 'token-1')).toBe(false);
    expect((client.commands[0] as GetCommand).input).toMatchObject({
      TableName: 'status', Key: { id: 'officer#token-1' }, ConsistentRead: true,
    });
    await status.revoke('officer', 'token-1');
    expect((client.commands[1] as PutCommand).input.Item).toMatchObject({
      id: 'officer#token-1', revoked: true,
    });
  });
  it('returns only an exact unexpired trusted resource permit', async () => {
    const client = new FakeClient();
    client.item = { id: 'finance#officer-1#doc-1#session-1', department: 'finance',
      officer: 'officer-1', documentId: 'doc-1', sessionId: 'session-1',
      urlSha256: sha256Url(ref.download_url), signedGrant: 'signed.jwt.value',
      allowedHost: 'files.example.gov', delegatedToken: 'delegated.token.value',
      expiresAt: Math.floor(Date.now() / 1000) + 60 };
    const registry = new DynamoResourceRegistry(client as never, 'registry');
    await expect(registry.resolve({ principal, ref, sessionId: 'session-1' }, Date.now() + 1000))
      .resolves.toEqual({ signedGrant: 'signed.jwt.value', allowedHost: 'files.example.gov',
        delegatedHeaders: { authorization: 'Bearer delegated.token.value' } });
    client.item = { ...client.item, urlSha256: '0'.repeat(64) };
    await expect(registry.resolve({ principal, ref, sessionId: 'session-1' }, Date.now() + 1000))
      .resolves.toBeNull();
  });
  it('writes only the bounded audit schema with TTL', async () => {
    const client = new FakeClient();
    const sink = new DynamoAuditSink(client as never, 'audit', 86400);
    await sink.record({ timestamp: new Date().toISOString(), action: 'request_complete',
      outcome: 'success', endpoint: 'chat', status: 200, latencyMs: 10 });
    const item = (client.commands[0] as PutCommand).input.Item!;
    expect(item).toMatchObject({ action: 'request_complete', endpoint: 'chat', expiresAt: expect.any(Number) });
    expect(item).not.toHaveProperty('body');
  });
  it('loads only explicit RSA public verification keys', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.EOFFICE_JWT_ISSUER = 'eoffice-pilot';
    process.env.EOFFICE_PUBLIC_KEYS_JSON = JSON.stringify([{ kid: 'key-1',
      pem: publicKey.export({ type: 'spki', format: 'pem' }) }]);
    const config = verificationFromEnvironment({ isRevoked: async () => false,
      revoke: async () => undefined });
    expect(config.publicKeys.has('key-1')).toBe(true);
  });
});
