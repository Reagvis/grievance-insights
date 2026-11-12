import { FileSearch, FlaskConical, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader, type DatasetChoice } from '../components/AppHeader';
import { AppNav } from '../components/AppNav';
import { AssistantLauncher, ChatPanel, useChatStore, type ScopeOption } from '../components/ChatPanel';
import { DashboardPage, type BrowseTarget } from '../components/DashboardPage';
import { LoadingScreen } from '../components/LoadingScreen';
import { InsightsDashboard } from '../components/InsightsDashboard';
import { ImportDialog } from '../components/ImportDialog';
import { PAGE_SIZE, RecordExplorer } from '../components/RecordExplorer';
import { RecordDetail } from '../components/RecordDetail';
import { SummaryWorkspace, type SummaryState } from '../components/SummaryWorkspace';
import { Toasts, type Toast } from '../components/Toasts';
import { EmptyState } from '../components/EmptyState';
import { createExpandedDataset, createSampleDataset } from '../data/demoGrievances';
import { computeStats, type Dataset, type GrievanceRecord } from '../domain/grievance';
import type { SummaryScope, SummaryService } from '../domain/summary';
import { I18nContext, makeI18n, type UiLanguage } from '../i18n/strings';
import { fetchAllComplaints, fetchHealth, HttpChatService, HttpSummaryService, type LoadProgress } from '../services/api/backend';
import { api, IS_LIVE } from '../services/api/config';
import type { HealthInfo } from '../services/api/wire';
import { LookupChatService, type ChatScope, type ChatService } from '../services/chat';
import { AWS_AUTH_ENABLED, defaultSummaryService } from '../services/runtimeServices';
import { PersistedDatasets } from '../components/PersistedDatasets';
import { AnalysisWorkspace } from '../components/AnalysisWorkspace';
import type { AnalysisJob, AnalysisReport } from '../services/analysisApi';
import {
  buildNoteText,
  buildRecordsZip,
  DownloadError,
  downloadStamp,
  noteFileName,
  triggerDownload,
  utf8Blob,
  zipFolderName,
} from '../utils/downloads';
import { formatCount, formatDate } from '../utils/format';
import type { ImportResult } from '../utils/importer';
import { DEFAULT_FILTERS, describeFilters, filterRecords, filtersKey, isFiltered, listCategories, type RecordFilters } from '../utils/recordSearch';
import { buildSummaryMarkdown, summaryFileName } from '../utils/summaryExport';
import { useRoute, type Page } from '../utils/route';
import { useMediaQuery } from '../utils/useMediaQuery';

/** Brief, honest feedback for local work — enough to register, not a fake "AI is thinking" delay. */
const MIN_FEEDBACK_MS = 350;
const LANG_KEY = 'grievance-insights.uiLang';

function readStoredLang(): UiLanguage {
  try {
    return localStorage.getItem(LANG_KEY) === 'te' ? 'te' : 'en';
  } catch {
    return 'en';
  }
}

function datasetNotes(ds: Dataset): string[] {
  if (ds.kind === 'synthetic-expansion') {
    return [
      'Performance-test dataset: complaint texts repeat 30 templates and statuses and dates are randomly assigned, so the distribution is not meaningful.',
    ];
  }
  return [];
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

const EMPTY_DATASET: Dataset = { id: 'live-empty', name: 'CM Helpline complaints', kind: 'live', records: [], isSynthetic: false };

type LiveState = {
  status: 'loading' | 'ready' | 'error';
  dataset: Dataset | null;
  error: string | null;
  progress: LoadProgress | null;
  refreshing: boolean;
};

export default function App({ summaryService: summaryOverride, authUser, onLogout }: { summaryService?: SummaryService; authUser?: string; onLogout?: () => void }) {
  // ── Interface language ───────────────────────────────────────────────
  const [uiLang, setUiLang] = useState<UiLanguage>(readStoredLang);
  const i18n = useMemo(() => makeI18n(uiLang), [uiLang]);
  useEffect(() => {
    document.documentElement.lang = uiLang;
    try {
      localStorage.setItem(LANG_KEY, uiLang); // UI preference only — never grievance data.
    } catch {
      /* storage unavailable: preference simply isn't remembered */
    }
  }, [uiLang]);

  // ── Datasets (in memory only) ───────────────────────────────────────
  const sample = useMemo(() => createSampleDataset(), []);
  const [expanded, setExpanded] = useState<Dataset | null>(null);
  const [imported, setImported] = useState<Dataset | null>(null);
  const [choice, setChoice] = useState<DatasetChoice>('sample');
  const [remoteId, setRemoteId] = useState<string | null>(null);
  const [analysisSnapshot, setAnalysisSnapshot] = useState<{
    datasetId: string; job: AnalysisJob | null; report: AnalysisReport | null; loading: boolean; error: string;
  } | null>(null);
  const onAnalysisStateChange = useCallback((datasetId: string, job: AnalysisJob | null, report: AnalysisReport | null,
    loading: boolean, error: string) => {
    setAnalysisSnapshot(previous => previous?.datasetId === datasetId && previous.job === job && previous.report === report &&
      previous.loading === loading && previous.error === error ? previous : { datasetId, job, report, loading, error });
  }, []);
  const [live, setLive] = useState<LiveState>({ status: 'loading', dataset: null, error: null, progress: null, refreshing: false });
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const dataset: Dataset = IS_LIVE
    ? (live.dataset ?? EMPTY_DATASET)
    : (choice === 'imported' && imported) || (choice === 'expanded' && expanded) || sample;
  /** False only while the very first live load is running or has failed. */
  const dataReady = !IS_LIVE || live.dataset !== null;

  // ── Live data (real backend) ─────────────────────────────────────────
  const [skippedCount, setSkippedCount] = useState(0);
  const liveLoad = useRef(0);
  const loadLive = useCallback((mode: 'initial' | 'refresh') => {
    const run = ++liveLoad.current;
    setLive((s) => ({ ...s, status: s.dataset ? 'ready' : 'loading', error: null, progress: null, refreshing: mode === 'refresh' }));
    const ac = new AbortController();
    fetchAllComplaints(api, {
      signal: ac.signal,
      onProgress: (progress) => run === liveLoad.current && setLive((s) => ({ ...s, progress })),
      datasetName: 'CM Helpline complaints',
    })
      .then(({ dataset: ds, skipped }) => {
        if (run !== liveLoad.current) return;
        setLive({ status: 'ready', dataset: ds, error: null, progress: null, refreshing: false });
        if (skipped.length > 0) {
          console.warn(`${skipped.length} records from the server were skipped`, skipped.slice(0, 20));
          setSkippedCount(skipped.length);
        } else setSkippedCount(0);
      })
      .catch((e: unknown) => {
        if (run !== liveLoad.current) return;
        const message = e instanceof Error ? e.message : 'The complaints could not be loaded.';
        setLive((s) => ({ ...s, status: s.dataset ? 'ready' : 'error', error: message, progress: null, refreshing: false }));
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!IS_LIVE) return;
    const cancel = loadLive('initial');
    const ac = new AbortController();
    fetchHealth(api, ac.signal)
      .then((h) => {
        setHealth(h);
        setHealthError(null);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return; // unmounted / superseded, not a real failure
        setHealthError(e instanceof Error ? e.message : 'The service status could not be checked.');
      });
    return () => {
      cancel();
      ac.abort();
    };
  }, [loadLive]);

  const summaryService: SummaryService = useMemo(() => {
    if (summaryOverride) return summaryOverride;
    if (IS_LIVE) return new HttpSummaryService(api, health?.capabilities.summary === 'deterministic' ? 'deterministic' : 'ai');
    return defaultSummaryService;
  }, [summaryOverride, health]);
  const summaryUnavailable = IS_LIVE && health?.capabilities.summary === 'unavailable' ? 'The summary service is not available right now.' : null;

  // ── Exploration state ───────────────────────────────────────────────
  const [filters, setFilters] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [route, navigate] = useRoute();
  const selectedId = route.noteId;
  /** Dashboard date range (applies only to dashboard analytics). */
  const [dashRange, setDashRange] = useState({ from: '', to: '' });
  const [assistantOpen, setAssistantOpen] = useState(false);
  // With the assistant docked on the right, a note opens as an overlay instead of inline so nothing is hidden behind the panel.
  const inlineDetail = useMediaQuery('(min-width: 1024px)') && route.page === 'complaints' && !assistantOpen;
  /** Last record opened — stays highlighted in the list after the detail panel closes. */
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);

  // An async result from another dataset must never enter this dataset's dashboard.
  const currentAnalysis = remoteId && analysisSnapshot?.datasetId === remoteId ? analysisSnapshot : null;
  const filtered = useMemo(() => filterRecords(dataset.records, filters), [dataset, filters]);
  const filtersActive = isFiltered(filters);
  const categories = useMemo(() => listCategories(dataset.records), [dataset]);
  const recordById = useMemo(() => new Map(dataset.records.map((r) => [r.id, r])), [dataset]);

  // ── Summary state ───────────────────────────────────────────────────
  const [scope, setScope] = useState<SummaryScope>('all');
  const [summaryState, setSummaryState] = useState<SummaryState>({ status: 'idle', summary: null, error: null });
  const [summaryKey, setSummaryKey] = useState<string | null>(null);
  const generation = useRef(0);
  const reportRef = useRef<HTMLElement | null>(null);
  const generateRef = useRef<HTMLButtonElement | null>(null);

  const included = scope === 'all' ? dataset.records : filtered;
  const includedStats = useMemo(() => computeStats(included), [included]);
  const currentKey = `${dataset.id}|${scope}|${scope === 'filtered' ? filtersKey(filters) : '*'}`;
  const stale = summaryState.summary !== null && summaryKey !== currentKey;
  const staleReason =
    summaryState.summary && summaryState.summary.scope !== scope
      ? 'The report scope was changed.'
      : 'The search or filters changed since it was generated.';

  // ── UI chrome state ─────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState<'all' | 'filtered' | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, kind, message }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4500);
  }, []);

  // ── Assistant ────────────────────────────────────────────────────────
  const chat = useChatStore();
  const chatService: ChatService = useMemo(
    () => (IS_LIVE ? new HttpChatService(api) : new LookupChatService(() => dataset.records)),
    [dataset],
  );
  const chatUnavailable = !IS_LIVE
    ? null
    : healthError
      ? `The assistant could not be reached. ${healthError}`
      : health && !health.capabilities.chat
        ? 'The assistant is not switched on for this server yet.'
        : null;
  const chatScopes: ScopeOption[] = useMemo(() => {
    const list: ScopeOption[] = [];
    const note = selectedId ? recordById.get(selectedId) : undefined;
    if (note) list.push({ key: 'note', label: `This complaint (${note.id})`, scope: { kind: 'records', recordIds: [note.id] } as ChatScope });
    list.push({ key: 'all', label: `All complaints (${formatCount(dataset.records.length)})`, scope: { kind: 'all' } });
    if (filtersActive && filtered.length > 0 && filtered.length < dataset.records.length) {
      list.push({ key: 'filtered', label: `Current list (${formatCount(filtered.length)})`, scope: { kind: 'records', recordIds: filtered.map((r) => r.id) } });
    }
    return list;
  }, [selectedId, recordById, dataset.records.length, filtersActive, filtered]);

  const resetForDataset = () => {
    chat.reset();
    generation.current += 1; // discard any in-flight generation
    setFilters(DEFAULT_FILTERS);
    setPage(0);
    navigate({ ...route, noteId: null }, { replace: true });
    setDashRange({ from: '', to: '' });
    setLastOpenedId(null);
    setScope('all');
    setSummaryState({ status: 'idle', summary: null, error: null });
    setSummaryKey(null);
  };

  const changeDataset = (next: DatasetChoice) => {
    if (next === choice) return;
    if (next === 'expanded' && !expanded) setExpanded(createExpandedDataset());
    if (AWS_AUTH_ENABLED) { sessionStorage.removeItem('grievance-insights.remoteDatasetId'); setRemoteId(null); }
    resetForDataset();
    setChoice(next);
  };

  const useRemoteDataset = (loaded: Dataset) => {
    resetForDataset();
    setImported(loaded);
    setRemoteId(loaded.id);
    setChoice('imported');
  };

  const clearRemoteDataset = () => {
    resetForDataset();
    setImported(null);
    setRemoteId(null);
    setChoice('sample');
  };

  const updateFilters = useCallback((patch: Partial<RecordFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }, []);

  // ── Record detail navigation ────────────────────────────────────────
  const selected = selectedId ? (recordById.get(selectedId) ?? null) : null;
  const selectedIndex = selected ? filtered.findIndex((r) => r.id === selected.id) : -1;

  const openRecord = useCallback(
    (id: string) => {
      if (!recordById.has(id)) {
        notify('error', `Case ${id} is not in the loaded dataset.`);
        return;
      }
      navigate({ page: route.page, noteId: id });
      setLastOpenedId(id);
    },
    [recordById, notify, navigate, route.page],
  );

  const closeRecord = () => navigate({ page: route.page, noteId: null });

  // A stable link (#/complaints?id=…) to a record that is not in the loaded dataset: say so, then drop the id.
  useEffect(() => {
    if (dataReady && route.noteId && !recordById.has(route.noteId)) {
      notify('error', `Case ${route.noteId} is not in the loaded dataset.`);
      navigate({ page: route.page, noteId: null }, { replace: true });
    }
  }, [dataReady, route.noteId, route.page, recordById, notify, navigate]);

  // A failed refresh keeps the data already on screen; tell the user instead of replacing it with an error page.
  useEffect(() => {
    if (live.error && live.dataset) notify('error', `Could not refresh the data: ${live.error}`);
  }, [live.error, live.dataset, notify]);

  const step = (delta: number) => {
    const next = filtered[selectedIndex + delta];
    if (!next) return;
    navigate({ page: route.page, noteId: next.id }, { replace: true });
    setLastOpenedId(next.id);
    setPage(Math.floor((selectedIndex + delta) / PAGE_SIZE));
  };

  // ── Downloads ───────────────────────────────────────────────────────
  const safeDownload = (fn: () => void, success: string) => {
    try {
      fn();
      notify('success', success);
    } catch (e) {
      notify('error', e instanceof DownloadError ? e.message : 'The download could not be started in this browser.');
    }
  };

  const downloadNote = (record: GrievanceRecord) => {
    const name = noteFileName(record);
    safeDownload(() => triggerDownload(utf8Blob(buildNoteText(record, dataset.name), 'text/plain'), name), `Download started: ${name}`);
  };

  const downloadZip = async (which: 'all' | 'filtered') => {
    const records = which === 'all' ? dataset.records : filtered;
    if (records.length === 0) {
      notify('error', 'There are no records to export.');
      return;
    }
    setZipBusy(which);
    await sleep(30); // let the busy state paint before the synchronous zip
    try {
      const scopeNote = which === 'all' ? 'All records in the dataset' : `Filtered records (${describeFilters(filters)})`;
      const zip = buildRecordsZip(dataset, records, scopeNote);
      const name = `${zipFolderName(dataset)}${which === 'filtered' ? '-filtered' : ''}-${downloadStamp()}.zip`;
      safeDownload(
        () => triggerDownload(new Blob([zip as BlobPart], { type: 'application/zip' }), name),
        `ZIP download started: ${formatCount(records.length)} notes with manifest`,
      );
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'The ZIP file could not be created.');
    } finally {
      setZipBusy(null);
    }
  };

  // ── Summary generation & export ─────────────────────────────────────
  const generate = async () => {
    if (included.length === 0) return;
    const run = ++generation.current;
    const key = currentKey;
    const records = included;
    setSummaryState((s) => ({ ...s, status: 'generating', error: null }));
    const started = performance.now();
    try {
      const summary = await summaryService.generate([...records], {
        scope,
        scopeDescription: describeFilters(filters),
        reportLanguage: 'en',
        datasetName: dataset.name,
        isSyntheticData: dataset.isSynthetic,
        datasetNotes: datasetNotes(dataset),
      });
      // Local demo work is instant, so hold the busy state just long enough to register. A real service needs no padding.
      const wait = (IS_LIVE ? 0 : MIN_FEEDBACK_MS) - (performance.now() - started);
      if (wait > 0) await sleep(wait);
      if (run !== generation.current) return;
      setSummaryState({ status: 'ready', summary, error: null });
      setSummaryKey(key);
      window.requestAnimationFrame(() => reportRef.current?.focus());
    } catch (e) {
      if (run !== generation.current) return;
      setSummaryState((s) => ({ ...s, status: 'error', error: e instanceof Error ? e.message : 'Summary generation failed.' }));
    }
  };

  const summary = summaryState.summary;

  const copySummary = async () => {
    if (!summary || stale) return;
    try {
      await copyText(buildSummaryMarkdown(summary));
      notify('success', 'Summary copied as Markdown');
    } catch {
      notify('error', 'The browser blocked clipboard access. Use Download Markdown instead.');
    }
  };

  const downloadMarkdown = () => {
    if (!summary || stale) return;
    const name = summaryFileName(summary);
    safeDownload(() => triggerDownload(utf8Blob(buildSummaryMarkdown(summary), 'text/markdown'), name), `Download started: ${name}`);
  };

  const printReport = () => {
    if (!summary || stale) return;
    window.print();
  };

  const copyRecordText = async (text: string, what: string) => {
    try {
      await copyText(text);
      notify('success', `${what} copied`);
    } catch {
      notify('error', 'The browser blocked clipboard access.');
    }
  };

  // ── Import ──────────────────────────────────────────────────────────
  const applyImport = (result: ImportResult) => {
    const ds: Dataset = {
      id: `imported-${Date.now()}`,
      name: `Imported · ${result.fileName} · ${formatCount(result.records.length)} records`,
      kind: 'imported',
      records: result.records,
      isSynthetic: result.records.length > 0 && result.records.every((r) => r.isSyntheticDemo),
      sourceFileName: result.fileName,
    };
    if (AWS_AUTH_ENABLED) {
      sessionStorage.removeItem('grievance-insights.remoteDatasetId');
      setRemoteId(null);
    }
    resetForDataset();
    setImported(ds);
    setChoice('imported');
    setImportOpen(false);
    notify('success', `Using ${formatCount(result.records.length)} imported records from ${result.fileName}`);
  };

  const downloadTemplate = (content: string, name: string, type: string) =>
    safeDownload(() => triggerDownload(utf8Blob(content, type), name), `Download started: ${name}`);

  const goToSummary = () => {
    navigate({ page: 'summary', noteId: null });
    window.setTimeout(() => generateRef.current?.focus(), 80);
  };

  const goToPage = (page: Page) => navigate({ page, noteId: null });

  /** Dashboard → Complaints: reset the explorer, then apply exactly what was clicked plus the dashboard date range. */
  const browse = (target: BrowseTarget) => {
    setFilters({
      ...DEFAULT_FILTERS,
      category: target.category ?? 'all',
      response: target.response ?? 'all',
      dateFrom: dashRange.from,
      dateTo: dashRange.to,
    });
    setPage(0);
    navigate({ page: 'complaints', noteId: null });
  };

  /** Dashboard → Summary with an explicit scope (all records, or the dashboard date range as a filtered scope). */
  const summarizeFromDashboard = (which: 'all' | 'range') => {
    if (which === 'range') {
      setFilters({ ...DEFAULT_FILTERS, dateFrom: dashRange.from, dateTo: dashRange.to });
      setPage(0);
      setScope('filtered');
    } else {
      setScope('all');
    }
    goToSummary();
  };

  useEffect(() => {
    const label = { dashboard: 'Dashboard', complaints: 'All Complaints', summary: 'Consolidated Summary' }[route.page];
    document.title = `${label} · Grievance Insights`;
  }, [route.page]);

  const includedSpan =
    includedStats.dateSpan && formatDate(includedStats.dateSpan.from) && formatDate(includedStats.dateSpan.to)
      ? `between ${formatDate(includedStats.dateSpan.from)} and ${formatDate(includedStats.dateSpan.to)}`
      : null;

  const detail = selected ? (
    <RecordDetail
      record={selected}
      inline={inlineDetail}
      position={selectedIndex >= 0 ? { index: selectedIndex, total: filtered.length } : null}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
      onClose={closeRecord}
      onDownload={downloadNote}
      onCopy={(text, what) => void copyRecordText(text, what)}
    />
  ) : null;

  const datasetBanners = (
    <>
      {dataset.kind === 'synthetic-expansion' && (
        <div className="notice notice--warn dataset-notice">
          <TriangleAlert size={16} aria-hidden />
          <span>
            Performance-test dataset: 2,000 records generated from the 30 curated templates. Texts repeat and statuses are random, so use the
            sample dataset for presentations.
          </span>
        </div>
      )}
      {dataset.kind === 'imported' && dataset.isSynthetic && (
        <div className="notice notice--info dataset-notice">
          <FlaskConical size={16} aria-hidden />
          <span>Every imported record is flagged as synthetic demo data in the source file.</span>
        </div>
      )}
    </>
  );

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app" data-page={route.page} data-assistant={assistantOpen ? 'open' : undefined}>
        <AppHeader
          datasetChoice={choice}
          authUser={authUser}
          onLogout={onLogout}
          importedLabel={imported ? `Imported · ${imported.sourceFileName} (${formatCount(imported.records.length)})` : null}
          isSynthetic={dataset.isSynthetic}
          onDatasetChange={changeDataset}
          onImport={() => AWS_AUTH_ENABLED ? document.getElementById('remote-dataset-file')?.click() : setImportOpen(true)}
          uiLang={uiLang}
          onLangChange={setUiLang}
          live={
            IS_LIVE
              ? {
                  loadedAt: live.dataset?.loadedAt ?? null,
                  refreshing: live.refreshing || (live.status === 'loading' && !live.dataset),
                  onRefresh: () => loadLive('refresh'),
                  mock: health?.mode === 'mock',
                }
              : null
          }
        />
        {dataReady && <AppNav page={route.page} onNavigate={goToPage} complaintCount={dataset.records.length} />}

        {AWS_AUTH_ENABLED && (
          // Stays mounted on every page so the saved dataset is restored on load and the header Import button works anywhere.
          <div className="aws-data" hidden={route.page !== 'dashboard'}>
            <PersistedDatasets onSelect={useRemoteDataset} onClear={clearRemoteDataset} activeId={remoteId} />
          </div>
        )}

        {!dataReady && (
          <LoadingScreen
            status={live.status === 'error' ? 'error' : 'loading'}
            progress={live.progress}
            error={live.error}
            onRetry={() => loadLive('initial')}
          />
        )}

        {dataReady && skippedCount > 0 && (
          <div className="notice notice--warn skipped-notice" role="status">
            <TriangleAlert size={16} aria-hidden />
            <span>
              {formatCount(skippedCount)} {skippedCount === 1 ? 'record was' : 'records were'} left out because the server sent them incomplete (no ID or no complaint text). Counts
              below cover the records that loaded.
            </span>
          </div>
        )}

        {dataReady && route.page === 'dashboard' && (
          <DashboardPage
            dataset={dataset}
            from={dashRange.from}
            to={dashRange.to}
            onRangeChange={(from, to) => setDashRange({ from, to })}
            onBrowse={browse}
            onOpenRecord={openRecord}
            onSummarize={summarizeFromDashboard}
            aiSummary={summaryService.mode === 'server-ai'}
          />
        )}

        {AWS_AUTH_ENABLED && remoteId && route.page === 'dashboard' && (
          <div className="aws-insights">
            <AnalysisWorkspace key={remoteId} datasetId={remoteId} records={dataset.records} onStateChange={onAnalysisStateChange} />
            <InsightsDashboard
              key={dataset.id}
              dataset={dataset}
              filteredCount={filtered.length}
              job={currentAnalysis?.job ?? null}
              report={currentAnalysis?.report ?? null}
              analysisLoading={!currentAnalysis || currentAnalysis.loading}
              analysisError={currentAnalysis?.error ?? null}
              onOpenRecord={openRecord}
              onOpenReport={() => goToPage('summary')}
            />
          </div>
        )}

        {dataReady && route.page === 'complaints' && (
          <div className="workspace workspace--complaints">
            <RecordExplorer
              totalCount={dataset.records.length}
              filtered={filtered}
              filters={filters}
              onFiltersChange={updateFilters}
              onReset={() => updateFilters(DEFAULT_FILTERS)}
              categories={categories}
              selectedId={selectedId ?? lastOpenedId}
              onOpen={openRecord}
              page={page}
              onPageChange={setPage}
              onDownloadAll={() => void downloadZip('all')}
              onExportFiltered={() => void downloadZip('filtered')}
              zipBusy={zipBusy}
            />
            {inlineDetail && (
              <main className="detail-pane" id="main" aria-label="Selected complaint">
                {detail ?? (
                  <EmptyState icon={<FileSearch size={28} aria-hidden />}>
                    Select a complaint to read the citizen’s complaint and the department’s response, and to download that note.
                  </EmptyState>
                )}
              </main>
            )}
          </div>
        )}

        {dataReady && route.page === 'summary' && (
          <main className="main" id="main">
            <div className="main-inner">
              <div className="intro">
                <h1>Consolidated summary</h1>
                <p>One report across your complaints and the responses recorded for them.</p>
              </div>
              {datasetBanners}
              <div id="deterministic-report">
                <SummaryWorkspace
                scope={scope}
                onScopeChange={setScope}
                allCount={dataset.records.length}
                filteredCount={filtered.length}
                filtersActive={filtersActive}
                filtersDescription={describeFilters(filters)}
                included={{ count: included.length, categories: includedStats.categoryCount, dateSpan: includedSpan }}
                state={summaryState}
                stale={stale}
                staleReason={staleReason}
                isSynthetic={dataset.isSynthetic}
                processing={summaryService.mode}
                unavailableReason={summaryUnavailable}
                onGenerate={() => void generate()}
                onCopy={() => void copySummary()}
                onDownloadMarkdown={downloadMarkdown}
                onPrint={printReport}
                onOpenRecord={openRecord}
                reportRef={reportRef}
                generateRef={generateRef}
                />
              </div>
              {!summary && <div className="print-only print-empty">Generate a consolidated summary before printing.</div>}
            </div>
          </main>
        )}

        {dataReady && !assistantOpen && <AssistantLauncher onOpen={() => setAssistantOpen(true)} />}

        {!inlineDetail && dataReady && detail}
        {assistantOpen && (
          <ChatPanel
            store={chat}
            service={chatService}
            scopes={chatScopes}
            knownIds={new Set(recordById.keys())}
            unavailableReason={chatUnavailable}
            onOpenRecord={openRecord}
            onClose={() => setAssistantOpen(false)}
          />
        )}
        {!AWS_AUTH_ENABLED && importOpen && <ImportDialog onClose={() => setImportOpen(false)} onUse={applyImport} onDownloadTemplate={downloadTemplate} />}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
      </div>
    </I18nContext.Provider>
  );
}
