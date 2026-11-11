import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  InvalidCredentialsError,
  type AuthenticationResult,
  type IdentityProvider,
  type SessionRecord,
  type SessionStore,
} from './contracts';

function identityFromToken(result: AuthenticationResultType | undefined) {
  if (!result?.IdToken) throw new Error('Cognito authentication result did not include an ID token');
  const payloadPart = result.IdToken.split('.')[1];
  if (!payloadPart) throw new Error('Cognito returned a malformed ID token');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (typeof payload.sub !== 'string' || typeof payload['cognito:username'] !== 'string') {
    throw new Error('Cognito ID token is missing required identity claims');
  }
  return { userId: payload.sub, username: payload['cognito:username'] };
}

export class CognitoIdentityProvider implements IdentityProvider {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
    private readonly clientId: string,
  ) {}

  async authenticate(username: string, password: string): Promise<AuthenticationResult> {
    try {
      const response = await this.client.send(new AdminInitiateAuthCommand({
        UserPoolId: this.userPoolId,
        ClientId: this.clientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }));
      if (response.ChallengeName) return { kind: 'challenge', challenge: response.ChallengeName };
      return { kind: 'authenticated', user: identityFromToken(response.AuthenticationResult) };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (['NotAuthorizedException', 'UserNotFoundException', 'PasswordResetRequiredException'].includes(name)) {
        throw new InvalidCredentialsError();
      }
      throw error;
    }
  }
}

export class DynamoSessionStore implements SessionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(session: SessionRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: session,
      ConditionExpression: 'attribute_not_exists(tokenHash)',
    }));
  }

  async find(tokenHash: string): Promise<SessionRecord | undefined> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { tokenHash },
      ConsistentRead: true,
    }));
    return result.Item as SessionRecord | undefined;
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { tokenHash } }));
  }
}

export function createAwsDependencies() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const tableName = process.env.SESSIONS_TABLE_NAME;
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS ?? '28800');
  if (!userPoolId || !clientId || !tableName || !allowedOrigin || !Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds <= 0) {
    throw new Error('Authentication Lambda configuration is incomplete');
  }

  return {
    identityProvider: new CognitoIdentityProvider(new CognitoIdentityProviderClient({}), userPoolId, clientId),
    sessions: new DynamoSessionStore(
      DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
      tableName,
    ),
    allowedOrigin,
    sessionTtlSeconds,
  };
}
