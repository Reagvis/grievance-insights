import { bedrockModel } from '../aws';
import { createProvisionalEofficeService, type ProvisionalConfig } from './service';

/** Explicit, code-only opt-in to the existing dedicated eOffice Bedrock adapter.
 * No route, deployment, credentials or paid invocation is enabled by this file.
 * Strict document-only chat always bypasses this adapter.
 */
export function createProvisionalBedrockEofficeService(
  config: Omit<ProvisionalConfig, 'inference'>,
) {
  return createProvisionalEofficeService({
    ...config,
    inference: { mode: 'bedrock', model: bedrockModel },
  });
}
