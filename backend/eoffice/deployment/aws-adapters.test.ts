import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  DynamoAuditSink, DynamoCredentialStatus, DynamoResourceRegistry,
  DynamoCognitoClientAuthorization, verificationFromEnvironment,
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
    client.item = { id: 'officer#token-1', revoked: false };
    await expect(status.isRevoked('officer', 'token-1')).rejects.toThrow(/Malformed/);
  });
  it('returns only an exact unexpired trusted resource permit', async () => {
    const client = new FakeClient();
    client.item = { id: 'finance#officer-1#doc-1#session-1', department: 'finance',
      officer: 'officer-1', documentId: 'doc-1', sessionId: 'session-1',
      urlSha256: sha256Url(ref.download_url), signedGrant: 'signed.jwt.value',
      allowedHost: 'files.example.gov', delegatedToken: 'delegated.token.value',
      syntheticContentSha256: 'a'.repeat(64),
      expiresAt: Math.floor(Date.now() / 1000) + 60 };
    const registry = new DynamoResourceRegistry(client as never, 'registry', new Set(['files.example.gov']));
    await expect(registry.resolve({ principal, ref, sessionId: 'session-1' }, Date.now() + 1000))
      .resolves.toEqual({ signedGrant: 'signed.jwt.value', allowedHost: 'files.example.gov',
        delegatedHeaders: { authorization: 'Bearer delegated.token.value' },
        syntheticContentSha256: 'a'.repeat(64) });
    client.item = { ...client.item, urlSha256: '0'.repeat(64) };
    await expect(registry.resolve({ principal, ref, sessionId: 'session-1' }, Date.now() + 1000))
      .resolves.toBeNull();
    client.item = { ...client.item, urlSha256: sha256Url(ref.download_url), allowedHost: 'other.example.gov' };
    await expect(registry.resolve({ principal, ref, sessionId: 'session-1' }, Date.now() + 1000))
      .resolves.toBeNull();
    client.item = { ...client.item, allowedHost: 'files.example.gov', syntheticContentSha256: '0'.repeat(63) };
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

describe('Task 22I Cognito application authorization', () => {
  const issuer = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_pool';
  const accessEvent = (overrides: Record<string, unknown> = {}) => ({
    rawPath: '/api/v1/ai/chat', body: JSON.stringify({ user_id: 'officer-1', session_id: 'session-1' }),
    requestContext: { authorizer: { jwt: { claims: {
      iss: issuer, token_use: 'access', client_id: 'client-1',
      iat: Math.floor(Date.now() / 1000) - 1, exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    }, scopes: ['eoffice-api/chat'] } } },
  });
  it('binds a valid Cognito client to its officer, department and session', async () => {
    const client = new FakeClient();
    client.item = { id: 'client#client-1', clientId: 'client-1', department: 'finance',
      officer: 'officer-1', sessionId: 'session-1', permissions: ['chat'], enabled: true,
      tokensValidAfter: Math.floor(Date.now() / 1000) - 60 };
    const auth = new DynamoCognitoClientAuthorization(client as never, 'clients', issuer, 'eoffice-api');
    await expect(auth.authorize(accessEvent())).resolves.toEqual({ credentialId: 'client-1', sessionId: 'session-1',
      principal: { department: 'finance', officer: 'officer-1', permissions: ['chat'] } });
    expect((client.commands[0] as GetCommand).input).toMatchObject({ TableName: 'clients',
      Key: { id: 'client#client-1' }, ConsistentRead: true });
  });
  it('rejects suspended clients and every token issued before tokensValidAfter', async () => {
    const client = new FakeClient();
    client.item = { id: 'client#client-1', clientId: 'client-1', department: 'finance',
      officer: 'officer-1', sessionId: 'session-1', permissions: ['chat'], enabled: false,
      tokensValidAfter: 0 };
    const auth = new DynamoCognitoClientAuthorization(client as never, 'clients', issuer, 'eoffice-api');
    await expect(auth.authorize(accessEvent())).rejects.toMatchObject({ status: 403 });
    client.item = { ...client.item, enabled: true, tokensValidAfter: Math.floor(Date.now() / 1000) + 1 };
    await expect(auth.authorize(accessEvent())).rejects.toMatchObject({ status: 403 });
  });
  it('rejects a wrong scope, officer or session independently of Cognito authentication', async () => {
    const client = new FakeClient();
    client.item = { id: 'client#client-1', clientId: 'client-1', department: 'finance',
      officer: 'officer-1', sessionId: 'session-1', permissions: ['chat'], enabled: true,
      tokensValidAfter: 0 };
    const auth = new DynamoCognitoClientAuthorization(client as never, 'clients', issuer, 'eoffice-api');
    const wrongSession = accessEvent();
    wrongSession.body = JSON.stringify({ user_id: 'officer-1', session_id: 'other' });
    await expect(auth.authorize(wrongSession)).rejects.toMatchObject({ status: 403 });
    const wrongOfficer = accessEvent();
    wrongOfficer.body = JSON.stringify({ user_id: 'other', session_id: 'session-1' });
    await expect(auth.authorize(wrongOfficer)).rejects.toMatchObject({ status: 403 });
    const wrongScope = accessEvent();
    wrongScope.requestContext.authorizer.jwt.scopes = ['eoffice-api/summarize'];
    await expect(auth.authorize(wrongScope)).rejects.toMatchObject({ status: 403 });
  });
});
