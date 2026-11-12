import { categoryOf, computeStats, hasResponse, UNCATEGORIZED, type DatasetStats, type GrievanceRecord } from '../domain/grievance';
import { inDateRange, listCategories, submittedDay } from './recordSearch';

export type DashboardData = {
  /** Records inside the dashboard date range (everything when no range is set). */
  records: GrievanceRecord[];
  stats: DatasetStats;
  /** Distinct categories actually recorded — "Uncategorized" is reported separately, never counted as a category. */
  knownCategories: number;
  uncategorized: number;
  categories: Array<{ name: string; count: number; withResponse: number }>;
  recent: GrievanceRecord[];
  /** Records excluded from the range because they have no valid submission date. */
  undatedExcluded: number;
};

export const RECENT_LIMIT = 6;

/** Every dashboard figure is derived here from one record list, so the tiles, chart and list always reconcile. */
export function buildDashboard(all: readonly GrievanceRecord[], from: string, to: string): DashboardData {
  const rangeActive = from !== '' || to !== '';
  const records = rangeActive ? all.filter((r) => inDateRange(r, from, to)) : [...all];
  const stats = computeStats(records);
  const uncategorized = stats.uncategorized;
  const withResp = new Map<string, number>();
  for (const r of records) if (hasResponse(r)) withResp.set(categoryOf(r), (withResp.get(categoryOf(r)) ?? 0) + 1);
  const categories = listCategories(records).map((c) => ({ ...c, withResponse: withResp.get(c.name) ?? 0 }));
  const recent = records
    .filter((r) => submittedDay(r) !== null)
    .sort((a, b) => (submittedDay(b)! < submittedDay(a)! ? -1 : submittedDay(b)! > submittedDay(a)! ? 1 : b.id.localeCompare(a.id)))
    .slice(0, RECENT_LIMIT);
  return {
    records,
    stats,
    knownCategories: stats.categoryCount - (uncategorized > 0 ? 1 : 0),
    uncategorized,
    categories,
    recent,
    undatedExcluded: rangeActive ? all.filter((r) => submittedDay(r) === null).length : 0,
  };
}

export { UNCATEGORIZED };
