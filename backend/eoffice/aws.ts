import { signedAwsRequest } from '../analysis/aws-http';
import { MODEL_ID, MODEL_REGION } from '../analysis/schema';
import type { Model } from './core';
/** Dedicated eOffice deadline; legacy grievance Converse timeout is unchanged. */
export const bedrockModel: Model = async (system, prompt, maxTokens, timeoutMs) => {
  const url = 'https://bedrock-runtime.' + MODEL_REGION + '.amazonaws.com/model/' + encodeURIComponent(MODEL_ID) + '/converse';
  const body = new TextEncoder().encode(JSON.stringify({
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature: 0 },
  }));
  const response = await signedAwsRequest('bedrock', MODEL_REGION, 'POST', url, body,
    { 'content-type': 'application/json' }, timeoutMs);
  const result = await response.json() as { stopReason?: string; output?: { message?: { content?: { text?: string }[] } } };
  if (result.stopReason !== 'end_turn') throw new Error('Incomplete model response');
  return result.output?.message?.content?.map(c => c.text ?? '').join('') ?? '';
};
