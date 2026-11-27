import { createHmac } from 'node:crypto';
import { eofficeLimits, type Event } from '../core';

export type AuditAction =
  'request_attempt' | 'authorization_success' | 'request_complete' |
  'credential_issued' | 'credential_revoked' | 'credential_rotated';
export type AuditOutcome = 'pending' | 'allowed' | 'denied' | 'error' | 'success';
export type AuditRecord = Readonly<{
  timestamp: string;
  action: AuditAction;
  outcome: AuditOutcome;
  requestId?: string;
  endpoint: 'chat' | 'summarize' | 'extract' | 'draft-reply' | 'unknown' | 'operator';
  departmentTag?: string;
  officerTag?: string;
  credentialId?: string;
  status: number;
  latencyMs: number;
}>;
/** Separate restricted sink, retention and secure storage are Task 22G.
 * Never pass raw events, prompt, answer, protected URL, token or diagnostics.
 */
export interface AuditSink { record(event: AuditRecord): Promise<void>; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export function auditRequestId(event: Event): string | undefined {
  if (typeof event.body !== 'string' ||
      Buffer.byteLength(event.body, 'utf8') > eofficeLimits.maxRequestBytes) return undefined;
  try {
    const obj: unknown = JSON.parse(event.body);
    if (obj && typeof obj === 'object' && !Array.isArray(obj) &&
        'request_id' in obj && typeof obj.request_id === 'string' && UUID.test(obj.request_id))
      return obj.request_id;
  } catch { /* no request ID from malformed payload */ }
  return undefined;
}
export function auditEndpoint(event: Event): AuditRecord['endpoint'] {
  const name = event.rawPath?.match(/^\/api\/v1\/ai\/(chat|summarize|extract|draft-reply)$/)?.[1];
  return (name as AuditRecord['endpoint']) ?? 'unknown';
}
export class SafeAudit {
  constructor(private readonly sink: AuditSink, private readonly hmacKey: Uint8Array) {
    if (!sink || typeof sink.record !== 'function' || hmacKey.byteLength < 32)
      throw new Error('Independent restricted audit sink and pseudonymization key are required.');
  }
  private tag(identity: string): string {
    return createHmac('sha256', this.hmacKey).update(identity).digest('hex').slice(0, 24);
  }
  async emit(input: {
    action: AuditAction; outcome: AuditOutcome; endpoint: AuditRecord['endpoint'];
    requestId?: string; department?: string; officer?: string;
    credentialId?: string; status?: number; latencyMs?: number;
  }): Promise<void> {
    // Complete allowlist: do not spread caller objects into audit records.
    const event: AuditRecord = {
      timestamp: new Date().toISOString(),
      action: input.action,
      outcome: input.outcome,
      endpoint: input.endpoint,
      status: Number.isSafeInteger(input.status) && input.status! >= 0 &&
        input.status! <= 599 ? input.status! : 0,
      latencyMs: Number.isSafeInteger(input.latencyMs) && input.latencyMs! >= 0
        ? Math.min(input.latencyMs!, 60_000) : 0,
      ...(input.requestId && UUID.test(input.requestId) ? { requestId: input.requestId } : {}),
      ...(input.department && id.test(input.department)
        ? { departmentTag: this.tag(input.department) } : {}),
      ...(input.officer && id.test(input.officer)
        ? { officerTag: this.tag(input.officer) } : {}),
      ...(input.credentialId && id.test(input.credentialId)
        ? { credentialId: input.credentialId } : {}),
    };
    await this.sink.record(event);
  }
}
