export class EofficeError extends Error {
  constructor(readonly status: number, readonly diagnostic: string, readonly publicMessage: string) { super(diagnostic); }
}
export const invalid = (message = 'Invalid request.') => new EofficeError(400, message, 'The request is invalid.');
export const unprocessable = (message = 'Unable to process supplied material.') => new EofficeError(422, message, 'The supplied document or schema could not be processed.');
const badModel = (message: string) => new EofficeError(502, message, 'AI processing failed.');
export const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function bounded(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= limit;
}
export type Schema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };
type Primitive = 'string' | 'number' | 'integer' | 'boolean' | 'null';
const primitives = new Set<Primitive>(['string', 'number', 'integer', 'boolean', 'null']);
function types(value: unknown): Primitive[] {
  const result = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(result) || !result.length || !result.every(v => primitives.has(v as Primitive)) || new Set(result).size !== result.length) throw unprocessable('Unsupported JSON Schema type.');
  return result as Primitive[];
}
/** Deliberately limited to flat objects of typed scalar properties. Unsupported keywords are rejected. */
export function parseSchema(value: unknown): Schema {
  if (!isObject(value) || value.type !== 'object' || !isObject(value.properties)) throw unprocessable('Expected a JSON Schema object.');
  if (Object.keys(value).some(k => !['type', 'properties', 'required'].includes(k))) throw unprocessable('Unsupported JSON Schema keyword.');
  const names = Object.keys(value.properties);
  if (!names.length || names.length > 32) throw unprocessable('Schema property count exceeds limit.');
  const required = value.required ?? [];
  if (!Array.isArray(required) || required.some(n => typeof n !== 'string' || !names.includes(n)) || new Set(required).size !== required.length) throw unprocessable('Invalid required properties.');
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) throw unprocessable('Invalid schema property name.');
    const property = value.properties[name];
    if (!isObject(property) || Object.keys(property).some(k => k !== 'type')) throw unprocessable('Unsupported property schema.');
    const t = types(property.type);
    if (!required.includes(name) && !t.includes('null')) throw unprocessable('Optional properties must be nullable.');
    if (required.includes(name) && t.includes('null')) throw unprocessable('Required properties must be non-null.');
  }
  return { type: 'object', properties: value.properties, required: required as string[] };
}
export function validateExtraction(schema: Schema, value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw badModel('Model returned no extraction object.');
  const names = Object.keys(schema.properties);
  if (Object.keys(value).some(k => !names.includes(k))) throw badModel('Model returned undeclared fields.');
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const t = types((schema.properties[name] as Record<string, unknown>).type);
    const data = value[name] === undefined ? null : value[name];
    if (data === null) {
      if (!t.includes('null')) throw unprocessable('Required field ' + name + ' could not be extracted.');
    } else {
      if (schema.required?.includes(name) && typeof data === 'string' && !data.trim())
        throw unprocessable('Required field ' + name + ' could not be extracted.');
      const ok = t.some(kind => (kind === 'string' && typeof data === 'string' && !!data.trim()) ||
        (kind === 'number' && typeof data === 'number' && Number.isFinite(data)) ||
        (kind === 'integer' && typeof data === 'number' && Number.isSafeInteger(data)) ||
        (kind === 'boolean' && typeof data === 'boolean'));
      if (!ok) throw badModel('Malformed extracted field ' + name + '.');
    }
    result[name] = data;
  }
  return result;
}
