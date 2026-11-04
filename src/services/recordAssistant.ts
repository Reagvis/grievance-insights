import { categoryOf, computeStats, hasResponse, type GrievanceRecord } from '../domain/grievance';
import { matchesQuery, normalizeForSearch } from '../utils/recordSearch';

/** Grounded lookup and counts only; never presented as free-text AI reasoning. */
export function answerQuestion(records: GrievanceRecord[], question: string) {
  const query = normalizeForSearch(question);
  const ids = records.filter((record) => query.includes(normalizeForSearch(record.id)));
  let matches = ids.length ? ids : records;
  if (!ids.length) {
    const categories = [...new Set(records.map(categoryOf))].filter((category) => query.includes(normalizeForSearch(category)));
    if (categories.length) matches = matches.filter((record) => categories.includes(categoryOf(record)));
    if (/\b(no|without|missing)\b.*\b(response|reply)\b/.test(query)) matches = matches.filter((record) => !hasResponse(record));
    if (/\bin progress\b/.test(query)) matches = matches.filter((record) => record.status === 'in_progress');
    else if (/\bpending\b/.test(query)) matches = matches.filter((record) => record.status === 'pending');
    else if (/\bunresolved\b|\bnot resolved\b/.test(query)) matches = matches.filter((record) => record.status !== 'resolved');
    else if (/\bresolved\b/.test(query)) matches = matches.filter((record) => record.status === 'resolved');
    if (!categories.length) {
      const search = query.replace(/\b(what|which|are|is|the|a|an|most|common|show|me|all|please|how|many|summari[sz]e|summary|overview|of|about|this|these|with|without|no|missing|not|have|has|in|progress|pending|resolved|unresolved|response|responses|reply|complaint|complaints|record|records|category|categories|and)\b/g, ' ').replace(/[?!.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
      if (search) matches = matches.filter((record) => matchesQuery(record, search));
    }
  }
  const stats = computeStats(matches);
  const counts = new Map<string, number>();
  for (const record of matches) counts.set(categoryOf(record), (counts.get(categoryOf(record)) ?? 0) + 1);
  const categories = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => `${name}: ${count}`).join('; ');
  const answer = matches.length
    ? `${matches.length} matching records. ${stats.withResponse} have a recorded response; ${stats.missingResponse} have no response. Explicit status: ${stats.byStatus.resolved} resolved, ${stats.byStatus.pending} pending, ${stats.byStatus.in_progress} in progress, ${stats.byStatus.unknown} unknown. Categories: ${categories}. A response does not confirm resolution.`
    : 'No matching records. Try a case ID, category name, Telugu or English search text, or “Which water supply complaints have no response?”';
  return {
    answer, mode: 'server-local' as const, totalMatches: matches.length,
    sources: matches.slice(0, 10).map((record) => ({ id: record.id, complaintText: record.complaintText, responseText: record.responseText })),
  };
}

