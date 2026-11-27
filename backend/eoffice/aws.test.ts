import { describe, expect, it, vi } from 'vitest';
import { signedAwsRequest } from '../analysis/aws-http';
import { bedrockModel, parseEofficeConverseResponse } from './aws';

vi.mock('../analysis/aws-http', () => ({ signedAwsRequest: vi.fn() }));

const payload = JSON.stringify({
  text: 'Synthetic summary.', used_document_ids: [], evidence: [],
});
const response = (content: unknown[], stopReason = 'end_turn') => ({
  stopReason, output: { message: { content } },
});

describe('eOffice Qwen Converse response compatibility', () => {
  it('accepts valid JSON from a normal text block without changing it', () => {
    expect(parseEofficeConverseResponse(response([{ text: payload }]))).toBe(payload);
  });

  it('accepts recognized Qwen reasoning and JSON-fence presentation blocks', () => {
    const formatted = '<think>Check the requested schema without exposing this reasoning.</think>\n' +
      '```json\n' + payload + '\n```';
    expect(parseEofficeConverseResponse(response([
      { reasoningContent: { reasoningText: { text: 'Internal model reasoning.' } } },
      { text: formatted.slice(0, 45) },
      { text: formatted.slice(45) },
    ]))).toBe(payload);
  });

  it('rejects malformed or corrupted JSON instead of extracting or repairing it', () => {
    expect(() => parseEofficeConverseResponse(response([
      { text: '```json\n{"text":"broken",}\n```' },
    ]))).toThrow('Malformed model JSON');
    expect(() => parseEofficeConverseResponse(response([
      { text: payload + '\nAdditional model prose.' },
    ]))).toThrow('Malformed model JSON');
  });

  it('rejects incomplete responses and incomplete or unknown content blocks', () => {
    expect(() => parseEofficeConverseResponse(response([{ text: payload }], 'max_tokens')))
      .toThrow('Incomplete model response');
    expect(() => parseEofficeConverseResponse(response([{ text: '<think>unfinished' }])))
      .toThrow('Incomplete model reasoning response');
    expect(() => parseEofficeConverseResponse(response([{ toolUse: { name: 'unexpected' } }])))
      .toThrow('Unsupported model content block');
    expect(() => parseEofficeConverseResponse(response([
      { reasoningContent: { reasoningText: { text: 'Reasoning only.' } } },
    ]))).toThrow('Model returned no structured text');
  });

  it('keeps the eOffice deadline and request contract when reading the mocked Bedrock response', async () => {
    vi.mocked(signedAwsRequest).mockResolvedValueOnce({
      json: async () => response([{ text: '```json\n' + payload + '\n```' }]),
    } as Response);
    await expect(bedrockModel('system', 'prompt', 1600, 4321)).resolves.toBe(payload);
    expect(signedAwsRequest).toHaveBeenCalledOnce();
    expect(signedAwsRequest).toHaveBeenCalledWith(
      'bedrock', 'ap-south-1', 'POST', expect.stringContaining('/converse'),
      expect.any(Uint8Array), { 'content-type': 'application/json' }, 4321,
    );
  });
});
