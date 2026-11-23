import { signedAwsRequest } from '../analysis/aws-http';
import { MODEL_ID, MODEL_REGION } from '../analysis/schema';
import type { Model } from './core';
/** Reuses the deployed grievance worker's SigV4 Converse transport, not its prompts. */
export const bedrockModel: Model = async (system, prompt, maxTokens) => {
  const url = 'https://bedrock-runtime.' + MODEL_REGION + '.amazonaws.com/model/' + encodeURIComponent(MODEL_ID) + '/converse';
  const body = new TextEncoder().encode(JSON.stringify({
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature: 0 },
  }));
  const response = await signedAwsRequest('bedrock', MODEL_REGION, 'POST', url, body, { 'content-type': 'application/json' });
  const result = await response.json() as { stopReason?: string; output?: { message?: { content?: { text?: string }[] } } };
  if (result.stopReason !== 'end_turn') throw new Error('Incomplete model response');
  return result.output?.message?.content?.map(c => c.text ?? '').join('') ?? '';
};
