export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and newlines inside
 * quotes, CRLF/LF line endings, and a leading UTF-8 BOM. Returns rows of raw strings.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let fieldValue = '';
  let inQuotes = false;
  let fieldStarted = false;
  let quoteOpenedOnLine = 0;
  let line = 1;

  const pushField = () => {
    row.push(fieldValue);
    fieldValue = '';
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          fieldValue += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        fieldValue += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (!fieldStarted && fieldValue === '') {
        inQuotes = true;
        fieldStarted = true;
        quoteOpenedOnLine = line;
      } else {
        // Stray quote inside an unquoted field: keep it literally (lenient).
        fieldValue += ch;
      }
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      line += 1;
    } else if (ch === '\n') {
      pushRow();
      line += 1;
    } else {
      fieldValue += ch;
      fieldStarted = true;
    }
  }

  if (inQuotes) {
    throw new CsvParseError(`A quoted field starting on line ${quoteOpenedOnLine} is never closed.`);
  }
  // Final row (unless the file ended with a newline).
  if (fieldValue !== '' || row.length > 0) pushRow();
  return rows;
}
