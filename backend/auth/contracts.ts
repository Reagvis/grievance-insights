export interface AuthenticatedUser {
  userId: string;
  username: string;
}

export type AuthenticationResult =
  | { kind: 'authenticated'; user: AuthenticatedUser }
  | { kind: 'challenge'; challenge: string };

export interface IdentityProvider {
  authenticate(username: string, password: string): Promise<AuthenticationResult>;
}

export interface SessionRecord extends AuthenticatedUser {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  ttl: number;
}

export interface SessionStore {
  create(session: SessionRecord): Promise<void>;
  find(tokenHash: string): Promise<SessionRecord | undefined>;
  revoke(tokenHash: string): Promise<void>;
}

export interface SafeLogger {
  error(message: string, context?: Record<string, string>): void;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}
