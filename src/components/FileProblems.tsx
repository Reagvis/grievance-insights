import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { RemoteDataset } from '../services/datasetApi';

/** Plain-language versions of the technical reasons the backend reports. The original text stays available as a tooltip. */
export function friendlyReason(message: string | null | undefined): string {
  const m = message ?? '';
  if (/not a single full-page scan/i.test(m)) {
    return 'This PDF’s text is stored in a font the system cannot read, and the page is not a scanned picture. Try a scanned copy, or upload a TXT or DOCX version.';
  }
  const unclear = /OCR could not read page\(s\) ([\d, ]+) reliably/i.exec(m);
  if (unclear) return `The scan on page ${unclear[1].trim()} is too unclear to read reliably. Try a clearer scan.`;
  if (/OCR ran out of time/i.test(m)) return 'This document took too long to read. Split it into smaller files and upload the parts.';
  return m || 'The file could not be read.';
}

type Group = { key: string; name: string; reason: string; raw: string; ids: string[] };

/** One compact notice for every upload that did not work (instead of one big banner per file). */
export function FileProblems({ files, onRemove }: { files: RemoteDataset[]; onRemove: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  const groups = new Map<string, Group>();
  for (const f of files) {
    const raw = f.status === 'pending_upload' ? 'The upload did not finish.' : (f.error ?? 'The file could not be read.');
    const key = f.name + '\u0000' + raw;
    const g = groups.get(key) ?? { key, name: f.name, reason: friendlyReason(raw), raw, ids: [] };
    g.ids.push(f.id);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  return (
    <section className="file-problems" role="alert" aria-label="Files that could not be added">
      <div className="file-problems-head">
        <TriangleAlert size={18} aria-hidden />
        <strong>
          {files.length} {files.length === 1 ? 'file' : 'files'} could not be added
        </strong>
        <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {open ? 'Hide details' : 'Show details'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm file-problems-clear" onClick={() => onRemove(files.map((f) => f.id))}>
          Clear all
        </button>
      </div>
      {open && (
        <ul className="file-problems-list">
          {list.map((g) => (
            <li key={g.key} title={g.raw}>
              <span>
                <strong>{g.name}</strong>
                {g.ids.length > 1 ? ` (tried ${g.ids.length} times)` : ''} — {g.reason}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(g.ids)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
