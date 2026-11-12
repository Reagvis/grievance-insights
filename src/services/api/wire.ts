import { normalizeStatus, type GrievanceRecord } from '../../domain/grievance';
import { detectLanguage } from '../../utils/importer';

/** Wire shape of one complaint, as documented in docs/BACKEND_CONTRACT.md. */
export type ApiComplaint = {
  id: string;
  complaintText: string;
  responseText?: string | null;
  category?: string | null;
  issueType?: string | null;
  department?: string | null;
  district?: string | null;
  submittedAt?: string | null;
  respondedAt?: string | null;
  status?: string | null;
  language?: string | null;
  sourceFileId?: string | null;
  isSynthetic?: boolean;
};

export type ComplaintPage = { items: unknown[]; nextCursor: string | null; total?: number };

export type HealthInfo = {
  status: 'ok' | 'degraded';
  version?: string;
  /** `mock` = development backend with fake responses; never present in production. */
  mode?: 'live' | 'mock';
  dataset?: { name?: string; updatedAt?: string | null; isSynthetic?: boolean };
  capabilities: { chat: boolean; summary: 'ai' | 'deterministic' | 'unavailable' };
};

export type MapResult = { record: GrievanceRecord | null; problem?: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Validate and normalise one wire complaint. Bad rows are reported, never silently invented or dropped. */
export function mapComplaint(raw: unknown): MapResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { record: null, problem: 'not an object' };
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const complaintText = typeof r.complaintText === 'string' ? r.complaintText : null;
  if (!id) return { record: null, problem: 'missing id' };
  if (!complaintText || !complaintText.trim()) return { record: null, problem: `${id}: missing complaintText` };
  const lang = r.language;
  return {
    record: {
      id,
      complaintText,
      responseText: str(r.responseText),
      category: str(r.category),
      issueType: str(r.issueType),
      department: str(r.department),
      district: str(r.district),
      submittedAt: str(r.submittedAt),
      respondedAt: str(r.respondedAt),
      status: normalizeStatus(r.status).status,
      language: lang === 'te' || lang === 'en' || lang === 'mixed' ? lang : detectLanguage(complaintText),
      originalFileName: str(r.sourceFileId),
      sourceType: 'json',
      isSyntheticDemo: r.isSynthetic === true,
    },
  };
}
