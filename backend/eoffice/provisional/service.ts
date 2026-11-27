import { createEofficeApi, type Event, type Principal, type Model } from '../core';
import type { Resolver, Transport, MalwareScanner } from '../documents';
import {
  ProvisionalJwtVerifier, issueOfficerToken, issueDocumentGrant, revokeCredential,
  type CredentialStatus, type SigningKey, type VerificationConfig,
  type VerifiedOfficer, type DocumentGrantScope,
} from './credentials';
import { SafeAudit, auditEndpoint, auditRequestId, type AuditSink } from './audit';
import {
  createRestrictedSyntheticDocumentSource, createSecureDocumentSource, type TrustedResourceRegistry,
} from './protected-documents';
import { deterministicTaskModel, strictDocumentChat } from './extractive';

export type InferenceSelection =
  | Readonly<{ mode: 'deterministic' }>
  | Readonly<{ mode: 'bedrock'; model: Model }>;

export type ProvisionalConfig = Readonly<{
  /** Explicit operator choice; no automatic real-inference fallback. */
  inference: InferenceSelection;
  jwt: VerificationConfig;
  grants: TrustedResourceRegistry;
  scanner: MalwareScanner;
  audit: AuditSink;
  auditHmacKey: Uint8Array;
  /** For offline adversarial network tests; never set from a caller request. */
  resolver?: Resolver;
  transport?: Transport;
}>;
export type IdentifiedOfficer = Readonly<{
  principal: Principal; credentialId: string; sessionId: string | undefined;
}>;
export type OfficerAuthorizer = (event: Event) => Promise<IdentifiedOfficer>;
export type RestrictedSyntheticConfig = Readonly<Omit<ProvisionalConfig, 'scanner'> & {
  /** Cognito deployment supplies this; legacy compositions retain signed officer JWT verification. */
  authorizeOfficer?: OfficerAuthorizer;
}>;
const responseHeaders = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
};
const INVOCATION_MS = 25_000;
const COMPLETION_RESERVE_MS = 1_000;

/** Bound mandatory security audit calls inside the SAME invocation deadline.
 * A nonsettling sink never keeps the HTTP response pending indefinitely.
 */
async function withinAuditBudget(
  action: () => Promise<void>, deadline: number,
): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Security audit deadline exhausted');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => {
        if (Date.now() >= deadline) throw new Error('Security audit deadline exhausted');
        return action();
      }),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Security audit deadline exceeded')), remaining);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
function unavailable(requestId?: string) {
  return {
    statusCode: 503, headers: responseHeaders,
    body: JSON.stringify({
      ...(requestId ? { request_id: requestId } : {}),
      system_error_message: 'Security audit service unavailable.',
      user_error_message: 'AI service could not complete the request.',
    }),
  };
}

/**
 * SEPARATE, NOT DEPLOYED UAT composition. The live eOffice handler continues
 * to authorize nobody. Does not import the pilot Qwen/Bedrock adapter.
 * Every request creates an isolated core invocation: no cross-user history,
 * no global private index, and no prior-document or provider-token cache.
 */
export function createProvisionalEofficeService(config: ProvisionalConfig) {
  if (!config.grants || typeof config.grants.resolve !== 'function' ||
      typeof config.scanner !== 'function')
    throw new Error('Provisional service refuses missing resource authorization or scanner.');
  const documents = createSecureDocumentSource({
    verifier: new ProvisionalJwtVerifier(config.jwt), registry: config.grants, scanner: config.scanner,
    resolver: config.resolver, transport: config.transport,
  });
  const verifier = new ProvisionalJwtVerifier(config.jwt);
  return createConfiguredService(config, documents, event => verifier.officer(event));
}

/** Explicit deployment-only synthetic fixture mode. It cannot be selected by
 * a request and never represents a malware scan or a government-document path.
 */
export function createRestrictedSyntheticEofficeService(config: RestrictedSyntheticConfig) {
  if (!config.grants || typeof config.grants.resolve !== 'function')
    throw new Error('Restricted synthetic service refuses missing resource authorization.');
  const documents = createRestrictedSyntheticDocumentSource({
    verifier: new ProvisionalJwtVerifier(config.jwt), registry: config.grants,
    resolver: config.resolver, transport: config.transport,
  });
  const verifier = new ProvisionalJwtVerifier(config.jwt);
  return createConfiguredService(config, documents,
    config.authorizeOfficer ?? (event => verifier.officer(event)));
}

function createConfiguredService(config: RestrictedSyntheticConfig & { authorizeOfficer?: OfficerAuthorizer },
  documents: ReturnType<typeof createSecureDocumentSource>, authorizeOfficer: OfficerAuthorizer) {
  if (!config.inference ||
      (config.inference.mode !== 'deterministic' && config.inference.mode !== 'bedrock') ||
      (config.inference.mode === 'bedrock' && typeof config.inference.model !== 'function'))
    throw new Error('A valid explicit inference mode and model adapter are required.');
  const taskModel = config.inference.mode === 'bedrock'
    ? config.inference.model : deterministicTaskModel;
  const audit = new SafeAudit(config.audit, config.auditHmacKey);

  return async (event: Event, invocationDeadline?: number) => {
    const started = Date.now();
    const deadline = Math.min(started + INVOCATION_MS, invocationDeadline ?? Number.POSITIVE_INFINITY);
    const coreDeadline = deadline - COMPLETION_RESERVE_MS;
    const requestId = auditRequestId(event);
    const endpoint = auditEndpoint(event);
    let identified: VerifiedOfficer | undefined;
    try {
      // If the audit sink is down, do not authorize or retrieve anything.
      await withinAuditBudget(() => audit.emit({
        action: 'request_attempt', outcome: 'pending', endpoint, requestId,
      }), coreDeadline);
    } catch { return unavailable(requestId); }

    const core = createEofficeApi({
      authorize: async rawEvent => {
        const authorized = await authorizeOfficer(rawEvent as Event);
        identified = authorized;
        await withinAuditBudget(() => audit.emit({
          action: 'authorization_success', outcome: 'allowed', endpoint,
          requestId, department: authorized.principal.department,
          officer: authorized.principal.officer,
          credentialId: authorized.credentialId,
        }), coreDeadline);
        return authorized.principal;
      },
      documents,
      // Chat always uses current-document extractive mode, regardless of the
      // explicitly selected model for the other three Phase 1 operations.
      strictChat: strictDocumentChat,
      model: taskModel,
    });
    const result = await core(event, coreDeadline);
    try {
      await withinAuditBudget(() => audit.emit({
        action: 'request_complete',
        outcome: result.statusCode >= 400 ? (result.statusCode === 403 ? 'denied' : 'error') : 'success',
        endpoint, requestId,
        department: identified?.principal.department,
        officer: identified?.principal.officer,
        credentialId: identified?.credentialId,
        status: result.statusCode,
        latencyMs: Date.now() - started,
      }), deadline);
    } catch { return unavailable(requestId); }
    return result;
  };
}

/** Operator-only, no HTTP admin endpoints. The signer/private key, revocation
 * registry and restricted audit sink are supplied out of band. Key rotation
 * is done by issuing under the replacement kid, revoking the prior jti, and
 * updating the verifier's independently approved keyring.
 */
export class OperatorCredentialManager {
  constructor(
    private readonly signer: SigningKey,
    private readonly status: CredentialStatus,
    private readonly audit: SafeAudit,
  ) {}
  private tokenId(jwt: string): string {
    const part = jwt.split('.')[1];
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { jti: string };
    return payload.jti;
  }
  async issueOfficer(input: {
    department: string; officer: string; permissions: Principal['permissions'];
    sessionId?: string; ttlSeconds?: number;
  }): Promise<{ token: string; credentialId: string }> {
    const token = issueOfficerToken(this.signer, input);
    const credentialId = this.tokenId(token);
    await this.audit.emit({ action: 'credential_issued', outcome: 'success', endpoint: 'operator',
      department: input.department, officer: input.officer, credentialId });
    // Return the secret once to an already-authorized operator only.
    return { token, credentialId };
  }
  async issueDocument(input: {
    department: string; officer: string; document: DocumentGrantScope['ref'];
    sessionId?: string; ttlSeconds?: number;
  }): Promise<{ signedGrant: string; credentialId: string }> {
    const signedGrant = issueDocumentGrant(this.signer, input);
    const credentialId = this.tokenId(signedGrant);
    await this.audit.emit({ action: 'credential_issued', outcome: 'success', endpoint: 'operator',
      department: input.department, officer: input.officer, credentialId });
    return { signedGrant, credentialId };
  }
  async revoke(kind: 'officer' | 'document', credentialId: string): Promise<void> {
    await revokeCredential(this.status, kind, credentialId);
    await this.audit.emit({ action: 'credential_revoked', outcome: 'success', endpoint: 'operator',
      credentialId });
  }
  async rotateOfficer(previousCredentialId: string, input: {
    department: string; officer: string; permissions: Principal['permissions'];
    sessionId?: string; ttlSeconds?: number;
  }): Promise<{ token: string; credentialId: string }> {
    // If issuance/audit fails, do not silently revoke a still-live credential.
    const issued = await this.issueOfficer(input);
    await this.revoke('officer', previousCredentialId);
    await this.audit.emit({ action: 'credential_rotated', outcome: 'success',
      endpoint: 'operator', department: input.department, officer: input.officer,
      credentialId: issued.credentialId });
    return issued;
  }
}
