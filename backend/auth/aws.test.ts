import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it, vi } from 'vitest';
import { CognitoIdentityProvider } from './aws';
import { InvalidCredentialsError } from './contracts';

function idToken(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function provider(response: unknown) {
  const send = vi.fn().mockResolvedValue(response);
  return {
    service: new CognitoIdentityProvider(
      { send } as unknown as CognitoIdentityProviderClient,
      'ap-south-1_pool',
      'client-id',
    ),
    send,
  };
}

describe('Cognito identity adapter', () => {
  it('uses admin password auth and retains only identity claims', async () => {
    const { service, send } = provider({
      AuthenticationResult: {
        AccessToken: 'not-for-browser',
        IdToken: idToken({ sub: 'user-sub', 'cognito:username': 'pilot-admin' }),
      },
    });
    await expect(service.authenticate('pilot-admin', 'password')).resolves.toEqual({
      kind: 'authenticated',
      user: { userId: 'user-sub', username: 'pilot-admin' },
    });
    expect(send.mock.calls[0][0].input).toEqual({
      UserPoolId: 'ap-south-1_pool',
      ClientId: 'client-id',
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: 'pilot-admin', PASSWORD: 'password' },
    });
  });

  it('reports Cognito challenges without exposing challenge parameters', async () => {
    const { service } = provider({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ChallengeParameters: { sensitive: 'value' },
      Session: 'cognito-session',
    });
    await expect(service.authenticate('pilot-admin', 'password')).resolves.toEqual({
      kind: 'challenge',
      challenge: 'NEW_PASSWORD_REQUIRED',
    });
  });

  it('normalizes user-enumeration and credential failures', async () => {
    for (const name of ['NotAuthorizedException', 'UserNotFoundException', 'PasswordResetRequiredException']) {
      const { service, send } = provider({});
      send.mockRejectedValueOnce(Object.assign(new Error('sensitive Cognito detail'), { name }));
      await expect(service.authenticate('pilot-admin', 'password')).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
  });
});
