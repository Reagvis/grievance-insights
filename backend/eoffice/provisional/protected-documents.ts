import { createConnection } from 'node:net';
import { EofficeError } from '../schema';
import {
  HttpsDocuments, safeUrl, type DocumentAccess, type DocumentRef,
  type DocumentSource, type MalwareScanner, type Resolver, type Transport,
} from '../documents';
import type { Principal } from '../core';
import { ProvisionalJwtVerifier, type DocumentGrantScope } from './credentials';

/** The registry is operated and authenticated separately from the request body.
 * It must resolve a grant and short-lived per-resource delegated credential
 * from a trusted ACL source. Caller-provided URLs are never sufficient.
 */
export type ProtectedPermit = Readonly<{
  signedGrant: string;
  allowedHost: string;
  delegatedHeaders: Readonly<Record<string, string>>;
}>;
export interface TrustedResourceRegistry {
  resolve(scope: DocumentGrantScope, deadline: number): Promise<ProtectedPermit | null>;
}
export type SecureDocumentDependencies = Readonly<{
  verifier: ProvisionalJwtVerifier;
  registry: TrustedResourceRegistry;
  /** Real malware scanner required. No "allow all" production fallback. */
  scanner: MalwareScanner;
  /** Only for isolated offline tests; real use defaults to pinned HTTPS transport. */
  resolver?: Resolver;
  transport?: Transport;
}>;

/** A fully scoped ACL-grant check happens before DNS, transport, or parsing.
 * HttpsDocuments then repeats HTTPS allowlist, DNS pinning, redirect and size
 * controls. The JWT grant binds the *exact* URL hash, officer and session.
 */
export function createSecureDocumentSource(deps: SecureDocumentDependencies): DocumentSource {
  if (!deps.verifier || !deps.registry || typeof deps.registry.resolve !== 'function' ||
      typeof deps.scanner !== 'function')
    throw new Error('Protected document authorization and malware scanner are mandatory.');
  const accessFor = async (
    principal: Principal, ref: DocumentRef, deadline: number, sessionId?: string,
  ): Promise<DocumentAccess> => {
    const scope = { principal, ref, sessionId };
    // Use the original shared invocation deadline, not a fresh allowance.
    if (deadline <= Date.now()) throw new EofficeError(503, 'Resource grant deadline expired.', 'Document retrieval is unavailable.');
    let permit: ProtectedPermit | null;
    try { permit = await deps.registry.resolve(scope, deadline); }
    catch { throw new EofficeError(503, 'Resource authorization service unavailable.', 'Document retrieval is unavailable.'); }
    if (!permit) throw new EofficeError(422, 'Protected document grant missing.', 'The requested document is unavailable.');
    await deps.verifier.documentGrant(permit.signedGrant, scope);
    if (!permit.allowedHost || typeof permit.allowedHost !== 'string' ||
        !permit.delegatedHeaders || typeof permit.delegatedHeaders !== 'object' ||
        !Object.entries(permit.delegatedHeaders).some(([name, value]) =>
          name.toLowerCase() === 'authorization' && typeof value === 'string' &&
          /^Bearer [A-Za-z0-9._~+/-]{12,4096}$/.test(value)))
      throw new EofficeError(503, 'Per-resource credential missing.', 'Document retrieval is unavailable.');
    const allowedHosts = new Set([permit.allowedHost.toLowerCase()]);
    safeUrl(ref.download_url, allowedHosts); // no caller-selected host
    return { allowedHosts, headers: permit.delegatedHeaders };
  };
  const base = new HttpsDocuments(accessFor, deps.resolver, deps.transport, deps.scanner);
  return { fetch: (ref, principal, deadline, sessionId) => base.fetch(ref, principal, deadline, sessionId) };
}

/** ClamAV INSTREAM adapter for an operator-configured local UNIX socket.
 * Clamd and signature freshness are external deployment gates. If daemon
 * isn't running or the response is not the exact clean verdict, fail closed.
 * No document bytes are written to disk or to logs.
 */
export function unixClamdScanner(socketPath: string): MalwareScanner {
  if (!socketPath.startsWith('/') || socketPath.length > 200 || /[\r\n\0]/.test(socketPath))
    throw new Error('A separately provisioned local clamd UNIX socket is required.');
  return async (bytes, deadline) => {
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || deadline <= Date.now())
      throw new EofficeError(503, 'Scanner budget exceeded.', 'Document retrieval is unavailable.');
    const timeout = Math.min(7000, deadline - Date.now());
    return new Promise<'clean' | 'infected'>((resolve, reject) => {
      const socket = createConnection({ path: socketPath });
      let settled = false, received = '';
      const finish = (result?: 'clean' | 'infected') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (result) resolve(result);
        else reject(new EofficeError(503, 'Malware scanner failed.', 'Document retrieval is unavailable.'));
      };
      const timer = setTimeout(() => finish(), timeout);
      socket.on('connect', () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        for (let start = 0; start < bytes.length; start += 64 * 1024) {
          const chunk = Buffer.from(bytes.subarray(start, start + 64 * 1024));
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', data => {
        received += Buffer.from(data).toString('utf8');
        if (received.length > 512) { finish(); return; }
        const terminator = received.indexOf('\0');
        if (terminator < 0) return;
        const message = received.slice(0, terminator).trim();
        if (message === 'stream: OK') finish('clean');
        else if (/^stream: .+ FOUND$/.test(message)) finish('infected');
        else finish();
      });
      socket.on('error', () => finish());
      socket.on('close', () => finish());
    });
  };
}
