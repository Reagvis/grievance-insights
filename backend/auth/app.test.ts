import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthHandler } from './app';
import {
  InvalidCredentialsError,
  type IdentityProvider,
  type SafeLogger,
  type SessionRecord,
  type SessionStore,
} from './contracts';

const origin = 'https://telangana-gov-pilot.reagvis.com';
const token = 'A'.repeat(43);
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = 1_800_000_000;

function event(
  method: string,
  path: string,
  options: { body?: string; cookies?: string[]; origin?: string; contentType?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'example.execute-api.ap-south-1.amazonaws.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'request-id',
      routeKey: '$default',
      stage: '$default',
      time: 'now',
      timeEpoch: 0,
    },
    body: options.body,
    cookies: options.cookies,
    isBase64Encoded: false,
  };
}

class MemorySessions implements SessionStore {
  records = new Map<string, SessionRecord>();
  create = vi.fn(async (session: SessionRecord) => { this.records.set(session.tokenHash, session); });
  find = vi.fn(async (hash: string) => this.records.get(hash));
  revoke = vi.fn(async (hash: string) => { this.records.delete(hash); });
}

const credentials = JSON.stringify({ username: 'pilot-admin', password: 'correct horse battery staple' });

describe('authentication API', () => {
  let authenticate: ReturnType<typeof vi.fn<IdentityProvider['authenticate']>>;
  let sessions: MemorySessions;
  let logger: SafeLogger;
  let logError: ReturnType<typeof vi.fn<SafeLogger['error']>>;

  beforeEach(() => {
    authenticate = vi.fn<IdentityProvider['authenticate']>().mockResolvedValue({
      kind: 'authenticated',
      user: { userId: 'cognito-sub', username: 'pilot-admin' },
    });
    sessions = new MemorySessions();
    logError = vi.fn<SafeLogger['error']>();
    logger = { error: logError };
  });

  function handler() {
    return createAuthHandler({
      identityProvider: { authenticate },
      sessions,
      allowedOrigin: origin,
      sessionTtlSeconds: 3600,
      now: () => now,
      generateToken: () => token,
      logger,
    });
  }

  it('authenticates credentials, hashes the opaque token, and sets a protected host cookie', async () => {
    const response = await handler()(event('POST', '/api/auth/login', {
      origin,
      contentType: 'application/json; charset=utf-8',
      body: credentials,
    }));

    expect(response.statusCode).toBe(200);
    expect(response.cookies).toEqual([
      `__Host-grievance_session=${token}; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Strict`,
    ]);
    expect(JSON.parse(response.body ?? '')).toEqual({ authenticated: true, user: { username: 'pilot-admin' } });
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash,
      userId: 'cognito-sub',
      expiresAt: now + 3600,
      ttl: now + 3600,
    }));
    expect(sessions.records.has(token)).toBe(false);
  });

  it('returns a generic 401 for Cognito credential failures', async () => {
    authenticate.mockRejectedValue(new InvalidCredentialsError());
    const response = await handler()(event('POST', '/api/auth/login', {
      origin,
      contentType: 'application/json',
      body: credentials,
    }));
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('pilot-admin');
    expect(response.body).not.toContain('correct horse');
  });

  it('rejects Cognito challenges without returning Cognito tokens', async () => {
    authenticate.mockResolvedValue({ kind: 'challenge', challenge: 'NEW_PASSWORD_REQUIRED' });
    const response = await handler()(event('POST', '/api/auth/login', {
      origin,
      contentType: 'application/json',
      body: credentials,
    }));
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body ?? '')).toEqual({
      error: 'Authentication requires administrator assistance.',
      code: 'AUTH_CHALLENGE_REQUIRED',
    });
    expect(response.cookies).toBeUndefined();
  });

  it('validates live sessions and rejects expired sessions independently of TTL cleanup', async () => {
    sessions.records.set(tokenHash, {
      tokenHash,
      userId: 'cognito-sub',
      username: 'pilot-admin',
      createdAt: now - 10,
      expiresAt: now + 10,
      ttl: now + 10,
    });
    const live = await handler()(event('GET', '/api/auth/session', {
      cookies: [`__Host-grievance_session=${token}`],
    }));
    expect(live.statusCode).toBe(200);

    sessions.records.get(tokenHash)!.expiresAt = now;
    const expired = await handler()(event('GET', '/api/auth/session', {
      cookies: [`__Host-grievance_session=${token}`],
    }));
    expect(expired.statusCode).toBe(401);
    expect(sessions.revoke).toHaveBeenCalledWith(tokenHash);
    expect(expired.cookies?.[0]).toContain('Max-Age=0');
  });

  it('revokes a valid session on same-origin logout', async () => {
    sessions.records.set(tokenHash, {
      tokenHash,
      userId: 'cognito-sub',
      username: 'pilot-admin',
      createdAt: now,
      expiresAt: now + 3600,
      ttl: now + 3600,
    });
    const response = await handler()(event('POST', '/api/auth/logout', {
      origin,
      cookies: [`other=x; __Host-grievance_session=${token}`],
    }));
    expect(response.statusCode).toBe(204);
    expect(sessions.revoke).toHaveBeenCalledWith(tokenHash);
    expect(response.cookies?.[0]).toContain('Max-Age=0');
  });

  it('rejects missing, malformed, and duplicate session cookies', async () => {
    const missing = await handler()(event('GET', '/api/auth/session'));
    const malformed = await handler()(event('GET', '/api/auth/session', {
      cookies: ['__Host-grievance_session=not-a-token'],
    }));
    const duplicate = await handler()(event('GET', '/api/auth/session', {
      cookies: [`__Host-grievance_session=${token}; __Host-grievance_session=${token}`],
    }));
    expect([missing.statusCode, malformed.statusCode, duplicate.statusCode]).toEqual([401, 401, 401]);
    expect(sessions.find).not.toHaveBeenCalled();
  });

  it('requires the exact production origin and validates login payloads', async () => {
    const absentOrigin = await handler()(event('POST', '/api/auth/login', {
      contentType: 'application/json',
      body: credentials,
    }));
    const foreignOrigin = await handler()(event('POST', '/api/auth/logout', {
      origin: 'https://example.com',
      cookies: [`__Host-grievance_session=${token}`],
    }));
    const invalidJson = await handler()(event('POST', '/api/auth/login', {
      origin,
      contentType: 'application/json',
      body: '{bad',
    }));
    const invalidFields = await handler()(event('POST', '/api/auth/login', {
      origin,
      contentType: 'application/json',
      body: JSON.stringify({ username: '', password: '' }),
    }));
    expect([absentOrigin.statusCode, foreignOrigin.statusCode, invalidJson.statusCode, invalidFields.statusCode])
      .toEqual([403, 403, 400, 400]);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns sanitized server errors when DynamoDB operations fail', async () => {
    sessions.create.mockRejectedValueOnce(new Error(`write failed for ${token}`));
    const login = await handler()(event('POST', '/api/auth/login', {
      origin,
      contentType: 'application/json',
      body: credentials,
    }));
    sessions.find.mockRejectedValueOnce(new Error(`read failed for ${token}`));
    const session = await handler()(event('GET', '/api/auth/session', {
      cookies: [`__Host-grievance_session=${token}`],
    }));
    sessions.revoke.mockRejectedValueOnce(new Error(`delete failed for ${token}`));
    const logout = await handler()(event('POST', '/api/auth/logout', {
      origin,
      cookies: [`__Host-grievance_session=${token}`],
    }));

    for (const response of [login, session, logout]) {
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(token);
      expect(response.body).not.toContain('correct horse');
    }
    expect(JSON.stringify(logError.mock.calls)).not.toContain(token);
    expect(JSON.stringify(logError.mock.calls)).not.toContain('correct horse');
  });

  it('keeps health public and does not expose sensitive values in responses or logs', async () => {
    const response = await handler()(event('GET', '/api/health'));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');
    expect(response.body).not.toContain(token);
    expect(logError).not.toHaveBeenCalled();
  });
});
