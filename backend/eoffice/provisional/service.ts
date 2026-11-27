import { EofficeError } from '../schema';
import { createEofficeApi, type Event, type Principal } from '../core';
import type { Resolver, Transport, MalwareScanner } from '../documents';
import {
  ProvisionalJwtVerifier, issueOfficerToken, issueDocumentGrant, revokeCredential,
  type CredentialStatus, type SigningKey, type VerificationConfig,
  type VerifiedOfficer, type DocumentGrantScope,
} from './credentials';
import { SafeAudit, auditEndpoint, auditRequestId, type AuditSink } from './audit';
import {
  createSecureDocumentSource, type TrustedResourceRegistry,
} from './protected-documents';
import { deterministicTaskModel, strictDocumentChat } from './extractive';

export type ProvisionalConfig = Readonly<{
  jwt: VerificationConfig;
  grants: TrustedResourceRegistry;
  scanner: MalwareScanner;
  audit: AuditSink;
  auditHmacKey: Uint8Array;
  /** For offline adversarial network tests; never set from a caller request. */
  resolver?: Resolver;
  transport?: Transport;
}>;
const responseHeaders = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
};
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
  const verifier = new ProvisionalJwtVerifier(config.jwt);
  const audit = new SafeAudit(config.audit, config.auditHmacKey);
  const documents = createSecureDocumentSource({
    verifier, registry: config.grants, scanner: config.scanner,
    resolver: config.resolver, transport: config.transport,
  });

  return async (event: Event) => {
    const started = Date.now();
    const requestId = auditRequestId(event);
    const endpoint = auditEndpoint(event);
    let identified: VerifiedOfficer | undefined;
    try {
      // If the audit sink is down, do not authorize or retrieve anything.
      await audit.emit({ action: 'request_attempt', outcome: 'pending', endpoint,
        requestId });
    } catch { return unavailable(requestId); }

    const core = createEofficeApi({
      authorize: async rawEvent => {
        identified = await verifier.officer(rawEvent as Event);
        await audit.emit({
          action: 'authorization_success', outcome: 'allowed', endpoint,
          requestId, department: identified.principal.department,
          officer: identified.principal.officer,
          credentialId: identified.credentialId,
        });
        return identified.principal;
      },
      documents,
      // In strict UAT mode chat is extractive only; no external model or
      // optional history resolver. Other tasks use deterministic bounded
      // UAT output, not paid inference or unsupported narrative synthesis.
      strictChat: strictDocumentChat,
      model: deterministicTaskModel,
    });
    const result = await core(event);
    try {
      await audit.emit({
        action: 'request_complete',
        outcome: result.statusCode >= 400 ? (result.statusCode === 403 ? 'denied' : 'error') : 'success',
        endpoint, requestId,
        department: identified?.principal.department,
        officer: identified?.principal.officer,
        credentialId: identified?.credentialId,
        status: result.statusCode,
        latencyMs: Date.now() - started,
      });
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
