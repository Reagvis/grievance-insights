import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Event } from '../core';
import { createRestrictedSyntheticEofficeService, type InferenceSelection } from '../provisional/service';
import { createDeploymentAdapters } from './aws-adapters';
import { bedrockModel } from '../aws';
import { signedAwsRequest } from '../../analysis/aws-http';
import { auditRequestId } from '../provisional/audit';

async function secret(arn: string | undefined): Promise<string> {
  const region = process.env.AWS_REGION;
  if (!arn || !region) throw new Error('Secret configuration is missing.');
  const response = await signedAwsRequest('secretsmanager', region, 'POST',
    'https://secretsmanager.' + region + '.amazonaws.com/',
    new TextEncoder().encode(JSON.stringify({ SecretId: arn })),
    { 'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'secretsmanager.GetSecretValue' }, 2000);
  const body = await response.json() as { SecretString?: unknown };
  if (typeof body.SecretString !== 'string' || !body.SecretString) throw new Error('Secret unavailable.');
  return body.SecretString;
}
let service: Promise<ReturnType<typeof createRestrictedSyntheticEofficeService>> | undefined;
/** Real inference is a reviewed operator opt-in. Missing configuration is
 * deliberately offline/deterministic; an invalid value fails initialization.
 */
export function deploymentInference(mode = process.env.EOFFICE_INFERENCE_MODE): InferenceSelection {
  if (mode === undefined || mode === '' || mode === 'deterministic') return { mode: 'deterministic' };
  if (mode === 'bedrock') return { mode: 'bedrock', model: bedrockModel };
  throw new Error('Unsupported eOffice inference mode.');
}
function configuredService() {
  if (!service) service = (async () => {
    if (process.env.EOFFICE_DOCUMENT_ACCEPTANCE_MODE !== 'restricted-synthetic-pinned-v1')
      throw new Error('Restricted synthetic fixture mode is not explicitly enabled.');
    const [publicKeys, auditKey] = await Promise.all([
      secret(process.env.EOFFICE_PUBLIC_KEYS_SECRET_ARN),
      secret(process.env.EOFFICE_AUDIT_HMAC_SECRET_ARN),
    ]);
    process.env.EOFFICE_PUBLIC_KEYS_JSON = publicKeys;
    process.env.EOFFICE_AUDIT_HMAC_KEY = auditKey;
    const adapters = createDeploymentAdapters();
    return createRestrictedSyntheticEofficeService({
      ...adapters, authorizeOfficer: adapters.authorizeOfficer,
      inference: deploymentInference(),
    });
  })().catch(error => {
    service = undefined;
    throw error;
  });
  return service;
}

/** API Gateway HTTP API payload v2 adapter. Base64 is deliberately preserved
 * so the core rejects it as non-UTF8 JSON. No fixture headers or identity are
 * synthesized by this deployment handler.
 */
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const coreEvent = toCoreEvent(event);
  const deadline = Date.now() + 25_000;
  try {
    return (await configuredService())(coreEvent, deadline);
  } catch {
    const requestId = auditRequestId(coreEvent);
    return { statusCode: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ ...(requestId ? { request_id: requestId } : {}),
        system_error_message: 'Service initialization unavailable.',
        user_error_message: 'AI service could not complete the request.' }) };
  }
}

export function toCoreEvent(event: APIGatewayProxyEventV2WithJWTAuthorizer): Event {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) headers[name] = value;
  return {
    rawPath: event.rawPath,
    body: event.body ?? null,
    isBase64Encoded: event.isBase64Encoded === true,
    requestContext: {
      http: { method: event.requestContext?.http?.method },
      authorizer: event.requestContext?.authorizer?.jwt ? {
        jwt: {
          claims: event.requestContext.authorizer.jwt.claims,
          scopes: event.requestContext.authorizer.jwt.scopes ?? undefined,
        },
      } : undefined,
    },
    headers,
  };
}
