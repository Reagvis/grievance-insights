import { createHash, randomBytes } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  InvalidCredentialsError,
  type IdentityProvider,
  type SafeLogger,
  type SessionRecord,
  type SessionStore,
} from './contracts';

const COOKIE_NAME = '__Host-grievance_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USERNAME_MAX_LENGTH = 128;
const PASSWORD_MAX_LENGTH = 256;

interface AuthDependencies {
  identityProvider: IdentityProvider;
  sessions: SessionStore;
  allowedOrigin: string;
  sessionTtlSeconds: number;
  now?: () => number;
  generateToken?: () => string;
  logger?: SafeLogger;
}

interface LoginBody {
  username: string;
  password: string;
}

class RequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const defaultLogger: SafeLogger = {
  error(message, context) {
    console.error(message, context ?? {});
  },
};

function headers(event: APIGatewayProxyEventV2): Record<string, string> {
  return Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value ?? '']),
  );
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  };
}

function parseLogin(event: APIGatewayProxyEventV2): LoginBody {
  const requestHeaders = headers(event);
  if (!requestHeaders['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new RequestError(415, 'Use Content-Type: application/json.');
  }

  let value: unknown;
  try {
    const text = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : event.body;
    value = JSON.parse(text ?? '');
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'Request body must be a JSON object.');
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.username !== 'string' ||
    body.username.length < 1 ||
    body.username.length > USERNAME_MAX_LENGTH ||
    body.username.trim() !== body.username ||
    typeof body.password !== 'string' ||
    body.password.length < 1 ||
    body.password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new RequestError(400, 'Provide a valid username and password.');
  }
  return { username: body.username, password: body.password };
}

function requireOrigin(event: APIGatewayProxyEventV2, allowedOrigin: string): void {
  if (headers(event).origin !== allowedOrigin) {
    throw new RequestError(403, 'Request origin is not allowed.');
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sessionToken(event: APIGatewayProxyEventV2): string | undefined {
  const matches = (event.cookies ?? [])
    .flatMap((cookieHeader) => cookieHeader.split(';'))
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`))
    .map((part) => part.slice(COOKIE_NAME.length + 1));
  if (matches.length !== 1 || !TOKEN_PATTERN.test(matches[0])) return undefined;
  return matches[0];
}

function setCookie(token: string, maxAge: number): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function clearCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function createAuthHandler(dependencies: AuthDependencies) {
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
  const generateToken = dependencies.generateToken ?? (() => randomBytes(32).toString('base64url'));
  const logger = dependencies.logger ?? defaultLogger;

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const route = event.requestContext.http;

    try {
      if (route.method === 'GET' && route.path === '/api/health') {
        return json(200, { status: 'ok' });
      }

      if (route.method === 'POST' && route.path === '/api/auth/login') {
        requireOrigin(event, dependencies.allowedOrigin);
        const credentials = parseLogin(event);
        const authentication = await dependencies.identityProvider.authenticate(
          credentials.username,
          credentials.password,
        );
        if (authentication.kind === 'challenge') {
          return json(403, {
            error: 'Authentication requires administrator assistance.',
            code: 'AUTH_CHALLENGE_REQUIRED',
          });
        }

        const token = generateToken();
        if (!TOKEN_PATTERN.test(token)) throw new Error('Session token generator returned an invalid token');
        const issuedAt = now();
        const session: SessionRecord = {
          tokenHash: hashToken(token),
          userId: authentication.user.userId,
          username: authentication.user.username,
          createdAt: issuedAt,
          expiresAt: issuedAt + dependencies.sessionTtlSeconds,
          ttl: issuedAt + dependencies.sessionTtlSeconds,
        };
        await dependencies.sessions.create(session);

        return {
          ...json(200, {
            authenticated: true,
            user: { username: authentication.user.username },
          }),
          cookies: [setCookie(token, dependencies.sessionTtlSeconds)],
        };
      }

      if (route.method === 'GET' && route.path === '/api/auth/session') {
        const token = sessionToken(event);
        if (!token) return json(401, { error: 'Authentication required.' });
        const tokenHash = hashToken(token);
        const session = await dependencies.sessions.find(tokenHash);
        if (!session || session.expiresAt <= now()) {
          if (session) {
            try {
              await dependencies.sessions.revoke(tokenHash);
            } catch {
              logger.error('Expired session cleanup failed');
            }
          }
          return {
            ...json(401, { error: 'Authentication required.' }),
            cookies: [clearCookie()],
          };
        }
        return json(200, { authenticated: true, user: { username: session.username } });
      }

      if (route.method === 'POST' && route.path === '/api/auth/logout') {
        requireOrigin(event, dependencies.allowedOrigin);
        const token = sessionToken(event);
        if (!token) return json(401, { error: 'Authentication required.' });
        await dependencies.sessions.revoke(hashToken(token));
        return {
          statusCode: 204,
          headers: { 'cache-control': 'no-store' },
          cookies: [clearCookie()],
        };
      }

      return json(404, { error: 'API endpoint not found.' });
    } catch (error) {
      if (error instanceof RequestError) return json(error.statusCode, { error: error.message });
      if (error instanceof InvalidCredentialsError) return json(401, { error: 'Invalid username or password.' });
      logger.error('Authentication request failed', { route: `${route.method} ${route.path}` });
      return json(500, { error: 'Authentication service unavailable.' });
    }
  };
}
