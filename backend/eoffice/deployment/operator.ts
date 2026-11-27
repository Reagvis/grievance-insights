import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SafeAudit } from '../provisional/audit';
import { issueDocumentGrant, sha256Url, type SigningKey } from '../provisional/credentials';
import { OperatorCredentialManager } from '../provisional/service';
import { DynamoAuditSink, DynamoCredentialStatus } from './aws-adapters';

type Input = Record<string, unknown>;
const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Invalid ' + name);
  return value;
};
const input = JSON.parse(await new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = [];
  process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
  process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  process.stdin.on('error', reject);
})) as Input;
const action = process.argv[2];
const privateKeyPath = process.env.EOFFICE_OPERATOR_PRIVATE_KEY_FILE;
const kid = process.env.EOFFICE_OPERATOR_KID;
const issuer = process.env.EOFFICE_JWT_ISSUER;
const credentialsTable = process.env.EOFFICE_CREDENTIALS_TABLE;
const registryTable = process.env.EOFFICE_REGISTRY_TABLE;
const auditTable = process.env.EOFFICE_AUDIT_TABLE;
const auditKey = process.env.EOFFICE_AUDIT_HMAC_KEY;
if (!privateKeyPath || !kid || !issuer || !credentialsTable || !registryTable || !auditTable || !auditKey)
  throw new Error('Operator environment is incomplete.');
const signer: SigningKey = { kid, issuer,
  privateKey: createPrivateKey(await readFile(privateKeyPath, 'utf8')) };
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }),
  { marshallOptions: { removeUndefinedValues: true } });
const status = new DynamoCredentialStatus(client, credentialsTable);
const audit = new SafeAudit(new DynamoAuditSink(client, auditTable),
  new Uint8Array(Buffer.from(auditKey, 'base64')));
const manager = new OperatorCredentialManager(signer, status, audit);

if (action === 'issue-officer' || action === 'rotate-officer') {
  if (!Array.isArray(input.permissions)) throw new Error('Invalid permissions');
  const scope = { department: text(input.department, 'department'), officer: text(input.officer, 'officer'),
    permissions: input.permissions as ('chat' | 'summarize' | 'extract' | 'draft-reply')[],
    ...(input.sessionId ? { sessionId: text(input.sessionId, 'sessionId') } : {}) };
  const issued = action === 'rotate-officer'
    ? await manager.rotateOfficer(text(input.previousCredentialId, 'previousCredentialId'), scope)
    : await manager.issueOfficer(scope);
  process.stdout.write(JSON.stringify(issued) + '\n');
} else if (action === 'revoke') {
  if (input.kind !== 'officer' && input.kind !== 'document') throw new Error('Invalid credential kind');
  await manager.revoke(input.kind, text(input.credentialId, 'credentialId'));
  process.stdout.write('{"status":"revoked"}\n');
} else if (action === 'register-document') {
  const department = text(input.department, 'department');
  const officer = text(input.officer, 'officer');
  const document = { document_id: text(input.documentId, 'documentId'), download_url: text(input.downloadUrl, 'downloadUrl') };
  const sessionId = input.sessionId ? text(input.sessionId, 'sessionId') : undefined;
  const allowedHost = text(input.allowedHost, 'allowedHost').toLowerCase();
  const delegatedToken = text(input.delegatedToken, 'delegatedToken');
  const signedGrant = issueDocumentGrant(signer, { department, officer, document, sessionId, ttlSeconds: 300 });
  const credentialId = (JSON.parse(Buffer.from(signedGrant.split('.')[1], 'base64url').toString('utf8')) as { jti: string }).jti;
  const id = [department, officer, document.document_id, sessionId ?? '-'].join('#');
  await client.send(new PutCommand({ TableName: registryTable,
    Item: { id, department, officer, documentId: document.document_id, sessionId,
      urlSha256: sha256Url(document.download_url), signedGrant, allowedHost, delegatedToken,
      expiresAt: Math.floor(Date.now() / 1000) + 300 },
    ConditionExpression: 'attribute_not_exists(id) OR expiresAt < :now',
    ExpressionAttributeValues: { ':now': Math.floor(Date.now() / 1000) } }));
  await audit.emit({ action: 'credential_issued', outcome: 'success', endpoint: 'operator',
    department, officer, credentialId });
  process.stdout.write(JSON.stringify({ credentialId, expiresIn: 300 }) + '\n');
} else throw new Error('Use issue-officer, rotate-officer, revoke, or register-document.');
