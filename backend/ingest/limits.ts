// The format list and limits are shared with the browser (src/domain/sourceFormats.ts) so both sides always agree.
export { SOURCE_FORMATS, CONTENT_TYPE, LIMITS, EXTENSION_FORMAT, formatFromName, type SourceFormat } from '../../src/domain/sourceFormats';

export class IngestError extends Error {
  /** `message` is safe to show to the administrator: it never contains document text. */
  constructor(
    message: string,
    readonly code:
      | 'unsupported'
      | 'too_large'
      | 'corrupt'
      | 'encrypted'
      | 'content_mismatch'
      | 'invalid_content'
      | 'limit'
      | 'needs_ocr'
      | 'ocr_failed',
  ) {
    super(message);
    this.name = 'IngestError';
  }
}
