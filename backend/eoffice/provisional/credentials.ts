import {
  constants, createHash, randomUUID, sign as signBytes, verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';
import { EofficeError } from '../schema';
import type { Event, Principal } from '../core';
import type { DocumentRef } from '../documents';

export const OFFICER_AUDIENCE = 'eoffice-ai-officer-uat';
export const DOCUMENT_AUDIENCE = 'eoffice-ai-document-grant-uat';
const MAX_OFFICER_SECONDS = 15 * 60;
const MAX_GRANT_SECONDS = 5 * 60;
const CLOCK_SKEW = 5;
type Task = Principal['permissions'][number];
const tasks = new Set<Task>(['chat', 'summarize', 'extract', 'draft-reply']);
const name = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const denial = () => new EofficeError(403, 'Provisional credential denied.', 'Access denied.');
const unavailable = () => new EofficeError(503, 'Credential status unavailable.', 'AI service could not complete the request.');

export type CredentialKind = 'officer' | 'document';
/** Implement in an independently secured, strongly consistent secret/status store.
 * A missing or throwing registry MUST NOT be interpreted as a valid credential.
 */
export interface CredentialStatus {
  isRevoked(kind: CredentialKind, jti: string): Promise<boolean>;
  revoke(kind: CredentialKind, jti: string): Promise<void>;
}
export type SigningKey = Readonly<{
  kid: string; privateKey: KeyObject; issuer: string;
}>;
export type VerificationConfig = Readonly<{
  issuer: string;
  /** Explicit approved public keys only; never fetch a URL from a JWT header. */
  publicKeys: ReadonlyMap<string, KeyObject>;
  status: CredentialStatus;
}>;
export type VerifiedOfficer = Readonly<{
  principal: Principal; credentialId: string;
  sessionId: string | undefined;
}>;
export type DocumentGrantScope = Readonly<{
  principal: Principal; ref: DocumentRef; sessionId: string | undefined;
}>;

type Header = { alg: string; typ: string; kid: string };
type Common = { iss: string; aud: string; sub: string; dept: string; officer: string;
  jti: string; iat: number; nbf: number; exp: number; session_id?: string };
type OfficerClaims = Common & { permissions: Task[] };
type DocumentClaims = Common & { document_id: string; url_sha256: string };

function rsaPublicKey(key: KeyObject): boolean {
  return key.type === 'public' && key.asymmetricKeyType === 'rsa' &&
    (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
}
function rsaPrivateKey(key: KeyObject): boolean {
  return key.type === 'private' && key.asymmetricKeyType === 'rsa' &&
    (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function decodePart(encoded: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 4096)
    throw denial();
  const raw = Buffer.from(encoded, 'base64url');
  if (raw.toString('base64url') !== encoded) throw denial();
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw denial(); }
}
function nowSeconds(): number { return Math.floor(Date.now() / 1000); }
export const sha256Url = (url: string): string => createHash('sha256').update(url, 'utf8').digest('hex');

/** Verified by maintained Node.js/OpenSSL RSA-SHA256 primitives, with explicit
 * JWT framing, algorithm, key, claim, time, revocation and audience validation.
 * There is intentionally no dynamic JWKS, "none", HMAC, or header-supplied key.
 */
export class ProvisionalJwtVerifier {
  constructor(private readonly config: VerificationConfig) {
    if (!config.issuer || !name(config.issuer) || !config.status ||
        !config.publicKeys.size ||
        [...config.publicKeys].some(([kid, key]) => !name(kid) || !rsaPublicKey(key)))
      throw new Error('Provisional UAT JWT verifier requires trusted issuer, RSA public keys and status.');
  }

  private async parse(token: string, kind: CredentialKind): Promise<Record<string, unknown>> {
    if (!token || token.length > 8192) throw denial();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !p)) throw denial();
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    if (!isRecord(header) || !isRecord(claims) ||
        Object.keys(header).some(k => !['alg', 'kid', 'typ'].includes(k)) ||
        header.alg !== 'RS256' || header.typ !== 'JWT' || !name(header.kid))
      throw denial();
    const key = this.config.publicKeys.get(header.kid);
    if (!key || !rsaPublicKey(key)) throw denial();
    let verified = false;
    try {
      verified = verifyBytes('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
        { key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(parts[2], 'base64url'));
    } catch { /* Treat even malformed signature bytes as denial. */ }
    if (!verified) throw denial();

    const seconds = nowSeconds();
    const maxAge = kind === 'officer' ? MAX_OFFICER_SECONDS : MAX_GRANT_SECONDS;
    if (claims.iss !== this.config.issuer ||
        claims.aud !== (kind === 'officer' ? OFFICER_AUDIENCE : DOCUMENT_AUDIENCE) ||
        !name(claims.sub) || !name(claims.dept) || !name(claims.officer) ||
        claims.sub !== claims.officer || !name(claims.jti) ||
        !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.nbf) ||
        !Number.isSafeInteger(claims.exp) ||
        (claims.iat as number) > seconds + CLOCK_SKEW ||
        (claims.nbf as number) > seconds + CLOCK_SKEW ||
        (claims.nbf as number) < (claims.iat as number) - CLOCK_SKEW ||
        (claims.exp as number) <= seconds ||
        (claims.exp as number) <= (claims.iat as number) ||
        (claims.exp as number) - (claims.iat as number) > maxAge ||
        (claims.session_id !== undefined && !name(claims.session_id)))
      throw denial();
    let revoked: boolean;
    try {
      revoked = await this.config.status.isRevoked(kind, claims.jti as string);
      if (typeof revoked !== 'boolean') throw new Error('Invalid status response');
    } catch { throw unavailable(); }
    if (revoked) throw denial();
    return claims;
  }

  async officer(event: Event): Promise<VerifiedOfficer> {
    const entries = Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() === 'authorization');
    if (entries.length !== 1 || typeof entries[0][1] !== 'string') throw denial();
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(entries[0][1]);
    if (!match) throw denial();
    const claims = await this.parse(match[1], 'officer');
    if (!Array.isArray(claims.permissions) || !claims.permissions.length ||
        claims.permissions.some(p => !tasks.has(p as Task)) ||
        new Set(claims.permissions).size !== claims.permissions.length)
      throw denial();

    // The request body is never an identity source. For this enabled UAT
    // composition, an explicit user_id and (for chat) session-bound JWT are
    // additionally required. Malformed JSON remains core's own 400 path.
    if (typeof event.body === 'string' && Buffer.byteLength(event.body, 'utf8') <= 64_000) {
      let body: unknown;
      try { body = JSON.parse(event.body); } catch { /* core will validate */ }
      if (isRecord(body)) {
        if (body.user_id !== claims.officer) throw denial();
        if (event.rawPath === '/api/v1/ai/chat' &&
            (!name(body.session_id) || claims.session_id !== body.session_id))
          throw denial();
      }
    }
    return {
      principal: { department: claims.dept as string, officer: claims.officer as string,
        permissions: claims.permissions as Task[] },
      credentialId: claims.jti as string,
      sessionId: claims.session_id as string | undefined,
    };
  }

  async documentGrant(token: string, scope: DocumentGrantScope): Promise<string> {
    const claims = await this.parse(token, 'document');
    if (!name(claims.document_id) || typeof claims.url_sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(claims.url_sha256) ||
        claims.dept !== scope.principal.department ||
        claims.officer !== scope.principal.officer ||
        claims.document_id !== scope.ref.document_id ||
        claims.url_sha256 !== sha256Url(scope.ref.download_url) ||
        (claims.session_id ?? undefined) !== scope.sessionId)
      throw new EofficeError(422, 'Protected document grant scope denied.', 'The requested document is unavailable.');
    return claims.jti as string;
  }
}

/** Operator-only issuance: no new public routes and no key material stored here.
 * The signing key must be supplied from an approved secure operator environment.
 */
function signToken(signer: SigningKey, aud: string,
  claims: Record<string, unknown>, ttlSeconds: number, maxSeconds: number): string {
  if (!rsaPrivateKey(signer.privateKey) || !name(signer.kid) || !name(signer.issuer) ||
      !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > maxSeconds)
    throw new Error('Invalid operator signing configuration.');
  const issued = nowSeconds();
  const envelope = { iss: signer.issuer, aud, iat: issued, nbf: issued,
    exp: issued + ttlSeconds, jti: randomUUID(), ...claims };
  const header: Header = { alg: 'RS256', typ: 'JWT', kid: signer.kid };
  const message = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' +
    Buffer.from(JSON.stringify(envelope)).toString('base64url');
  const signature = signBytes('RSA-SHA256', Buffer.from(message),
    { key: signer.privateKey, padding: constants.RSA_PKCS1_PADDING }).toString('base64url');
  return message + '.' + signature;
}
export function issueOfficerToken(signer: SigningKey, input: {
  department: string; officer: string; permissions: readonly Task[];
  sessionId?: string; ttlSeconds?: number;
}): string {
  if (!name(input.department) || !name(input.officer) ||
      (input.sessionId !== undefined && !name(input.sessionId)) ||
      !input.permissions.length || input.permissions.some(p => !tasks.has(p)) ||
      new Set(input.permissions).size !== input.permissions.length)
    throw new Error('Invalid operator officer scope.');
  return signToken(signer, OFFICER_AUDIENCE, {
    sub: input.officer, dept: input.department, officer: input.officer,
    permissions: input.permissions, ...(input.sessionId ? { session_id: input.sessionId } : {}),
  }, input.ttlSeconds ?? MAX_OFFICER_SECONDS, MAX_OFFICER_SECONDS);
}
export function issueDocumentGrant(signer: SigningKey, input: {
  department: string; officer: string; document: DocumentRef;
  sessionId?: string; ttlSeconds?: number;
}): string {
  if (!name(input.department) || !name(input.officer) ||
      !name(input.document.document_id) || !input.document.download_url ||
      (input.sessionId !== undefined && !name(input.sessionId)))
    throw new Error('Invalid operator document grant scope.');
  return signToken(signer, DOCUMENT_AUDIENCE, {
    sub: input.officer, dept: input.department, officer: input.officer,
    document_id: input.document.document_id, url_sha256: sha256Url(input.document.download_url),
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
  }, input.ttlSeconds ?? MAX_GRANT_SECONDS, MAX_GRANT_SECONDS);
}
export async function revokeCredential(status: CredentialStatus, kind: CredentialKind, tokenId: string): Promise<void> {
  if (!name(tokenId)) throw new Error('Invalid credential identifier.');
  await status.revoke(kind, tokenId);
}
