import { createPublicKey, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AuditRecord, AuditSink } from '../provisional/audit';
import type { CredentialKind, CredentialStatus, VerificationConfig } from '../provisional/credentials';
import { sha256Url } from '../provisional/credentials';
import type { ProtectedPermit, TrustedResourceRegistry } from '../provisional/protected-documents';

type DocumentClient = Pick<DynamoDBDocumentClient, 'send'>;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const host = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Strongly consistent, fail-closed credential revocation status. */
export class DynamoCredentialStatus implements CredentialStatus {
  constructor(private readonly client: DocumentClient, private readonly table: string) {
    if (!table) throw new Error('Credential status table is required.');
  }
  async isRevoked(kind: CredentialKind, jti: string): Promise<boolean> {
    if (!identifier.test(jti)) throw new Error('Invalid credential identifier.');
    const result = await this.client.send(new GetCommand({
      TableName: this.table, Key: { id: kind + '#' + jti }, ConsistentRead: true,
    }));
    return result.Item?.revoked === true;
  }
  async revoke(kind: CredentialKind, jti: string): Promise<void> {
    if (!identifier.test(jti)) throw new Error('Invalid credential identifier.');
    await this.client.send(new PutCommand({
      TableName: this.table,
      Item: { id: kind + '#' + jti, revoked: true, revokedAt: new Date().toISOString() },
    }));
  }
}

type RegistryItem = Readonly<{
  id: string; department: string; officer: string; documentId: string;
  sessionId?: string; urlSha256: string; signedGrant: string;
  allowedHost: string; delegatedToken: string; expiresAt: number;
}>;

/** Registry rows are written only after an operator verifies the upstream ACL.
 * Caller request fields are selectors and must exactly match that trusted row.
 */
export class DynamoResourceRegistry implements TrustedResourceRegistry {
  constructor(private readonly client: DocumentClient, private readonly table: string) {
    if (!table) throw new Error('Resource registry table is required.');
  }
  async resolve(scope: Parameters<TrustedResourceRegistry['resolve']>[0], deadline: number): Promise<ProtectedPermit | null> {
    const id = [scope.principal.department, scope.principal.officer,
      scope.ref.document_id, scope.sessionId ?? '-'].join('#');
    if (deadline <= Date.now() || !identifier.test(scope.principal.department) ||
        !identifier.test(scope.principal.officer) || !identifier.test(scope.ref.document_id)) return null;
    const result = await this.client.send(new GetCommand({
      TableName: this.table, Key: { id }, ConsistentRead: true,
    }));
    const item = result.Item as RegistryItem | undefined;
    const now = Math.floor(Date.now() / 1000);
    if (!item || item.id !== id || item.department !== scope.principal.department ||
        item.officer !== scope.principal.officer || item.documentId !== scope.ref.document_id ||
        (item.sessionId ?? undefined) !== scope.sessionId ||
        item.urlSha256 !== sha256Url(scope.ref.download_url) ||
        !Number.isSafeInteger(item.expiresAt) || item.expiresAt <= now ||
        !host.test(item.allowedHost) || !item.signedGrant ||
        !/^[A-Za-z0-9._~+/-]{12,4096}$/.test(item.delegatedToken)) return null;
    return {
      signedGrant: item.signedGrant,
      allowedHost: item.allowedHost.toLowerCase(),
      delegatedHeaders: { authorization: 'Bearer ' + item.delegatedToken },
    };
  }
}

/** Payload-free audit table. TTL is metadata retention, not content retention. */
export class DynamoAuditSink implements AuditSink {
  constructor(private readonly client: DocumentClient, private readonly table: string,
    private readonly retentionSeconds = 30 * 24 * 60 * 60) {
    if (!table || retentionSeconds < 86400 || retentionSeconds > 90 * 86400)
      throw new Error('Bounded audit retention is required.');
  }
  async record(event: AuditRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.table,
      Item: { eventId: randomUUID(), ...event,
        expiresAt: Math.floor(Date.now() / 1000) + this.retentionSeconds },
      ConditionExpression: 'attribute_not_exists(eventId)',
    }));
  }
}

type PublicKeyConfig = Readonly<{ kid: string; pem: string }>;
export function verificationFromEnvironment(status: CredentialStatus): VerificationConfig {
  const issuer = process.env.EOFFICE_JWT_ISSUER;
  const encoded = process.env.EOFFICE_PUBLIC_KEYS_JSON;
  if (!issuer || !encoded) throw new Error('JWT verification configuration is missing.');
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { throw new Error('JWT public key configuration is invalid.'); }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('JWT public key configuration is invalid.');
  const keys = new Map<string, ReturnType<typeof createPublicKey>>();
  for (const entry of parsed as PublicKeyConfig[]) {
    if (!entry || !identifier.test(entry.kid) || typeof entry.pem !== 'string' || keys.has(entry.kid))
      throw new Error('JWT public key configuration is invalid.');
    keys.set(entry.kid, createPublicKey(entry.pem));
  }
  return { issuer, publicKeys: keys, status };
}

export function createDeploymentAdapters(client = DynamoDBDocumentClient.from(
  new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } },
)) {
  const statusTable = process.env.EOFFICE_CREDENTIALS_TABLE;
  const registryTable = process.env.EOFFICE_REGISTRY_TABLE;
  const auditTable = process.env.EOFFICE_AUDIT_TABLE;
  const auditKey = process.env.EOFFICE_AUDIT_HMAC_KEY;
  if (!statusTable || !registryTable || !auditTable || !auditKey)
    throw new Error('eOffice deployment configuration is incomplete.');
  const key = Buffer.from(auditKey, 'base64');
  if (key.byteLength < 32) throw new Error('Audit HMAC key is invalid.');
  const retention = Number(process.env.EOFFICE_AUDIT_RETENTION_SECONDS ?? 30 * 86400);
  const status = new DynamoCredentialStatus(client, statusTable);
  return {
    jwt: verificationFromEnvironment(status),
    grants: new DynamoResourceRegistry(client, registryTable),
    audit: new DynamoAuditSink(client, auditTable, retention),
    auditHmacKey: new Uint8Array(key),
  };
}
