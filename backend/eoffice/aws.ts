import { signedAwsRequest } from '../analysis/aws-http';
import { MODEL_ID, MODEL_REGION } from '../analysis/schema';
import type { Model } from './core';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Qwen can return its structured answer inside a JSON Markdown fence and can
 * emit reasoning either as a Converse reasoning-content block or a leading
 * <think> block. Unwrap only those complete, known presentation envelopes;
 * never extract a JSON-looking substring or repair malformed JSON.
 */
function structuredJsonText(raw: string): string {
  let text = raw.trim();
  if (!text) throw new Error('Model returned no structured text');
  try {
    JSON.parse(text);
    return text;
  } catch { /* Check only the explicitly supported Qwen presentation wrappers. */ }

  while (text.startsWith('<think>')) {
    const end = text.indexOf('</think>');
    if (end < 0) throw new Error('Incomplete model reasoning response');
    text = text.slice(end + '</think>'.length).trim();
  }
  const fenced = text.match(/^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced) text = fenced[1].trim();
  try {
    JSON.parse(text);
  } catch {
    throw new Error('Malformed model JSON');
  }
  return text;
}

export function parseEofficeConverseResponse(value: unknown): string {
  if (!object(value) || value.stopReason !== 'end_turn')
    throw new Error('Incomplete model response');
  const output = value.output;
  const message = object(output) ? output.message : undefined;
  const content = object(message) ? message.content : undefined;
  if (!Array.isArray(content) || !content.length)
    throw new Error('Model returned no content blocks');
  let text = '';
  let textBlocks = 0;
  for (const block of content) {
    if (!object(block)) throw new Error('Invalid model content block');
    if (Object.prototype.hasOwnProperty.call(block, 'text')) {
      if (typeof block.text !== 'string' || Object.prototype.hasOwnProperty.call(block, 'reasoningContent'))
        throw new Error('Invalid model text block');
      text += block.text;
      textBlocks++;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(block, 'reasoningContent') && object(block.reasoningContent))
      continue;
    throw new Error('Unsupported model content block');
  }
  if (!textBlocks) throw new Error('Model returned no structured text');
  return structuredJsonText(text);
}

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
  return parseEofficeConverseResponse(await response.json());
};
