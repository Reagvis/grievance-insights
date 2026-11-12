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
import { FileProblems } from '../components/FileProblems';
import { SummaryFilters } from '../components/SummaryFilters';
import { UploadPage, type BatchResult } from '../components/UploadPage';
import { loadAllComplaints, type AllComplaints, type SourceRef } from '../services/allComplaints';
import { removeDataset } from '../services/datasetApi';
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
import { DEFAULT_FILTERS, describeFilters, filterRecords, isFiltered, listCategories, type RecordFilters } from '../utils/recordSearch';
import { applySummaryFilter, describeSummaryFilter, isSummaryFiltered, NO_SUMMARY_FILTER, summaryFilterKey, type SummaryFilter } from '../utils/summaryFilter';
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

/** The AWS build ships no sample data: nothing is shown until a real uploaded file is opened. */
const NO_DATASET: Dataset = { id: 'no-dataset', name: 'No dataset open', kind: 'imported', records: [], isSynthetic: false };
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
  const sample = useMemo(() => (import.meta.env.MODE === 'aws' ? NO_DATASET : createSampleDataset()), []) // inline MODE check so the AWS bundle drops the sample data entirely;
  const [expanded, setExpanded] = useState<Dataset | null>(null);
  const [imported, setImported] = useState<Dataset | null>(null);
  const [choice, setChoice] = useState<DatasetChoice>('sample');
  // ── Signed-in build: every uploaded file merged into one list ───────────
  const [all, setAll] = useState<AllComplaints | null>(null);
  const [allError, setAllError] = useState<string | null>(null);
  const [analysisDatasetId, setAnalysisDatasetId] = useState<string | null>(null);
  const reloadAll = useCallback(async () => {
    try {
      setAll(await loadAllComplaints());
      setAllError(null);
    } catch (e) {
      setAllError(e instanceof Error ? e.message : 'Your complaints could not be loaded.');
    }
  }, []);
  useEffect(() => {
    if (AWS_AUTH_ENABLED) void reloadAll();
  }, [reloadAll]);
  // Files still being extracted (PDFs) are picked up automatically when they finish.
  useEffect(() => {
    if (!AWS_AUTH_ENABLED || !all?.files.some((f) => f.status === 'extracting' || f.status === 'validating')) return;
    const timer = window.setInterval(() => void reloadAll(), 6000);
    return () => window.clearInterval(timer);
  }, [all, reloadAll]);
  const awsDataset = useMemo<Dataset>(() => ({ id: 'all-complaints', name: 'All complaints', kind: 'imported', records: all?.records ?? [], isSynthetic: false }), [all]);
  const addedAtById = useMemo(() => (all ? new Map([...all.sourceOf].map(([recordId, src]) => [recordId, src.addedAt])) : undefined), [all]);
  const readyFiles = useMemo(() => all?.files.filter((f) => f.status === 'ready') ?? [], [all]);
  const activeAnalysisId = readyFiles.find((f) => f.id === analysisDatasetId)?.id ?? readyFiles[0]?.id ?? null;
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
  const dataset: Dataset = AWS_AUTH_ENABLED
    ? awsDataset
    : IS_LIVE
      ? (live.dataset ?? EMPTY_DATASET)
      : (choice === 'imported' && imported) || (choice === 'expanded' && expanded) || sample;
  /** False only while the very first live load is running or has failed. */
  const dataReady = AWS_AUTH_ENABLED ? all !== null : !IS_LIVE || live.dataset !== null;
  const pagesReady = dataReady;

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
  const currentAnalysis = activeAnalysisId && analysisSnapshot?.datasetId === activeAnalysisId ? analysisSnapshot : null;
  const filtered = useMemo(() => filterRecords(dataset.records, filters), [dataset, filters]);
  const filtersActive = isFiltered(filters);
  const categories = useMemo(() => listCategories(dataset.records), [dataset]);
  const recordById = useMemo(() => new Map(dataset.records.map((r) => [r.id, r])), [dataset]);

  // ── Summary state ───────────────────────────────────────────────────
  const [summaryState, setSummaryState] = useState<SummaryState>({ status: 'idle', summary: null, error: null });
  const [summaryKey, setSummaryKey] = useState<string | null>(null);
  const generation = useRef(0);
  const reportRef = useRef<HTMLElement | null>(null);
  const generateRef = useRef<HTMLButtonElement | null>(null);

  // The Summary page has its own filter (separate from the All Complaints list filters).
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>(NO_SUMMARY_FILTER);
  const fileIdOf = useCallback((r: GrievanceRecord) => all?.sourceOf.get(r.id)?.datasetId, [all]);
  const fileNameOf = useCallback((id: string) => all?.files.find((f) => f.id === id)?.name, [all]);
  const included = useMemo(() => applySummaryFilter(dataset.records, summaryFilter, AWS_AUTH_ENABLED ? fileIdOf : undefined), [dataset, summaryFilter, fileIdOf]);
  const scope: SummaryScope = isSummaryFiltered(summaryFilter) ? 'filtered' : 'all';
  const summaryScopeText = describeSummaryFilter(summaryFilter, fileNameOf);
  const includedStats = useMemo(() => computeStats(included), [included]);
  const currentKey = `${dataset.id}|${summaryFilterKey(summaryFilter)}`;
  const stale = summaryState.summary !== null && summaryKey !== currentKey;
  const staleReason =
    summaryState.summary && summaryState.summary.scope !== scope
      ? 'The report scope was changed.'
      : 'The summary filters changed since it was generated.';

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
    setSummaryFilter(NO_SUMMARY_FILTER);
    setSummaryState({ status: 'idle', summary: null, error: null });
    setSummaryKey(null);
  };

  const changeDataset = (next: DatasetChoice) => {
    if (next === choice) return;
    if (next === 'expanded' && !expanded && import.meta.env.MODE !== 'aws') setExpanded(createExpandedDataset());
    resetForDataset();
    setChoice(next);
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
        scopeDescription: summaryScopeText,
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
    resetForDataset();
    setImported(ds);
    setChoice('imported');
    setImportOpen(false);
    notify('success', `Using ${formatCount(result.records.length)} imported records from ${result.fileName}`);
  };

  const goToSummary = () => {
    navigate({ page: 'summary', noteId: null });
    window.setTimeout(() => generateRef.current?.focus(), 80);
  };

  const goToPage = (page: Page) => navigate({ page, noteId: null });

  // Signed-in build: there is no Dashboard page; the front door is the upload screen.
  useEffect(() => {
    if (AWS_AUTH_ENABLED && route.page === 'dashboard') navigate({ page: 'upload', noteId: null }, { replace: true });
  }, [route.page, navigate]);

  const onUploaded = async ({ files, records, failed }: BatchResult) => {
    await reloadAll();
    if (files > 0) {
      resetForDataset();
      notify('success', `Added ${formatCount(records)} ${records === 1 ? 'complaint' : 'complaints'} from ${files} ${files === 1 ? 'file' : 'files'}`);
    }
    if (failed === 0 && files > 0) navigate({ page: 'complaints', noteId: null });
  };

  /** Files that never became complaints (failed / unfinished uploads) hold no data, so they are removed without a prompt. */
  const removeProblemFiles = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => removeDataset(id)));
      await reloadAll();
      notify('success', ids.length === 1 ? 'Removed' : `Removed ${ids.length} files`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not remove the files.');
    }
  };

  /** Uploads are stored as files, so "delete" removes the file a complaint came from (all of its complaints). */
  const deleteSourceFile = async (source: { datasetId: string; fileName: string; fileRecordCount: number }) => {
    const many = source.fileRecordCount > 1;
    const question = many
      ? `Delete "${source.fileName}" and all ${formatCount(source.fileRecordCount)} complaints in it? This cannot be undone.`
      : `Delete this complaint (file "${source.fileName}")? This cannot be undone.`;
    if (!window.confirm(question)) return;
    try {
      await removeDataset(source.datasetId);
      closeRecord();
      resetForDataset();
      await reloadAll();
      notify('success', many ? `Deleted ${source.fileName}` : 'Complaint deleted');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'The file could not be deleted.');
    }
  };

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
      setSummaryFilter({ ...NO_SUMMARY_FILTER, dateFrom: dashRange.from, dateTo: dashRange.to });
    } else {
      setSummaryFilter(NO_SUMMARY_FILTER);
    }
    goToSummary();
  };

  useEffect(() => {
    const label = { upload: 'Upload', dashboard: 'Dashboard', complaints: 'All Complaints', summary: 'Consolidated Summary' }[route.page];
    document.title = `${label} · Reagvis Labs`;
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
      sourceFile={AWS_AUTH_ENABLED && all?.sourceOf.get(selected.id) ? { name: all.sourceOf.get(selected.id)!.fileName, recordCount: all.sourceOf.get(selected.id)!.fileRecordCount } : undefined}
      onDeleteSource={AWS_AUTH_ENABLED && all?.sourceOf.get(selected.id) ? () => void deleteSourceFile(all.sourceOf.get(selected.id) as SourceRef) : undefined}
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
          onImport={() => (AWS_AUTH_ENABLED ? goToPage('upload') : setImportOpen(true))}
          uiLang={uiLang}
          onLangChange={setUiLang}
          realData={AWS_AUTH_ENABLED ? { datasetName: null } : null}
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
        {pagesReady && <AppNav page={route.page} onNavigate={goToPage} complaintCount={dataset.records.length} pages={AWS_AUTH_ENABLED ? ['upload', 'complaints', 'summary'] : undefined} />}

        {!dataReady && (
          <LoadingScreen
            status={(AWS_AUTH_ENABLED ? (allError ? 'error' : 'loading') : live.status) === 'error' ? 'error' : 'loading'}
            progress={AWS_AUTH_ENABLED ? null : live.progress}
            error={AWS_AUTH_ENABLED ? allError : live.error}
            onRetry={() => (AWS_AUTH_ENABLED ? void reloadAll() : loadLive('initial'))}
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

        {AWS_AUTH_ENABLED && pagesReady && route.page === 'upload' && <UploadPage onBatchDone={(r) => void onUploaded(r)} onViewAll={() => goToPage('complaints')} />}

        {!AWS_AUTH_ENABLED && pagesReady && route.page === 'dashboard' && (
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

        {AWS_AUTH_ENABLED && pagesReady && route.page === 'complaints' && all && (
          <div className="file-banners">
            <FileProblems files={all.files.filter((f) => f.status === 'failed' || f.status === 'pending_upload')} onRemove={(ids) => void removeProblemFiles(ids)} />
            {all.files.some((f) => f.status === 'extracting' || f.status === 'validating') && (
              <div className="file-banner file-banner--working" role="status">
                <span>
                  {all.files.filter((f) => f.status === 'extracting' || f.status === 'validating').length} file(s) still being read. They appear here when ready.
                </span>
              </div>
            )}
            {all.unreadable.length > 0 && (
              <div className="file-banner file-banner--failed" role="alert">
                <span>Some files could not be opened just now: {all.unreadable.join(', ')}. <button type="button" className="link-button" onClick={() => void reloadAll()}>Try again</button></span>
              </div>
            )}
          </div>
        )}

        {AWS_AUTH_ENABLED && pagesReady && route.page === 'complaints' && dataset.records.length === 0 && (
          <main className="main" id="main">
            <div className="main-inner">
              <EmptyState icon={<FileSearch size={28} aria-hidden />} action={<button type="button" className="btn btn-primary" onClick={() => goToPage('upload')}>Upload complaints</button>}>
                No complaints yet. Upload a file to see its complaints here.
              </EmptyState>
            </div>
          </main>
        )}

        {pagesReady && route.page === 'complaints' && !(AWS_AUTH_ENABLED && dataset.records.length === 0) && (
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
              addedAt={AWS_AUTH_ENABLED ? addedAtById : undefined}
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

        {pagesReady && route.page === 'summary' && (
          <main className="main" id="main">
            <div className="main-inner">
              <div className="intro">
                <h1>Consolidated summary</h1>
                <p>One report across your complaints and the responses recorded for them.</p>
              </div>
              {datasetBanners}
              <SummaryFilters
                records={dataset.records}
                filter={summaryFilter}
                onChange={setSummaryFilter}
                includedCount={included.length}
                files={AWS_AUTH_ENABLED ? readyFiles.map((f) => ({ id: f.id, name: f.name, count: f.recordCount })) : undefined}
                fileIdOf={AWS_AUTH_ENABLED ? fileIdOf : undefined}
              />
              <div id="deterministic-report">
                <SummaryWorkspace
                scope={scope}
                scopeControl={<span />}
                onScopeChange={(next) => {
                  if (next === 'all') setSummaryFilter(NO_SUMMARY_FILTER);
                }}
                allCount={dataset.records.length}
                filteredCount={included.length}
                filtersActive={isSummaryFiltered(summaryFilter)}
                filtersDescription={summaryScopeText}
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

              {AWS_AUTH_ENABLED && activeAnalysisId && (
                <section className="ai-analysis-section" aria-label="AI analysis">
                  <h2>AI analysis</h2>
                  <p>AI analysis runs on one uploaded file at a time. Choose the file, start the analysis, and the results appear below.</p>
                  <label className="ai-file-picker">
                    File{' '}
                    <select className="select" value={activeAnalysisId} onChange={(e) => setAnalysisDatasetId(e.target.value)}>
                      {readyFiles.map((f) => (
                        <option key={f.id} value={f.id}>{f.name} ({f.recordCount} {f.recordCount === 1 ? 'complaint' : 'complaints'})</option>
                      ))}
                    </select>
                  </label>
                  <AnalysisWorkspace key={'run-' + activeAnalysisId} datasetId={activeAnalysisId} records={all?.recordsByDataset.get(activeAnalysisId) ?? []} onStateChange={onAnalysisStateChange} />
                  <InsightsDashboard
                    key={'view-' + activeAnalysisId}
                    dataset={{ id: activeAnalysisId, name: readyFiles.find((f) => f.id === activeAnalysisId)?.name ?? 'File', kind: 'imported', records: all?.recordsByDataset.get(activeAnalysisId) ?? [], isSynthetic: false }}
                    filteredCount={all?.recordsByDataset.get(activeAnalysisId)?.length ?? 0}
                    job={currentAnalysis?.job ?? null}
                    report={currentAnalysis?.report ?? null}
                    analysisLoading={!currentAnalysis || currentAnalysis.loading}
                    analysisError={currentAnalysis?.error ?? null}
                    onOpenRecord={openRecord}
                    onOpenReport={() => document.getElementById('deterministic-report')?.scrollIntoView({ behavior: 'smooth' })}
                  />
                </section>
              )}
            </div>
          </main>
        )}

        {pagesReady && !assistantOpen && <AssistantLauncher onOpen={() => setAssistantOpen(true)} />}

        {!inlineDetail && pagesReady && detail}
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
        {!AWS_AUTH_ENABLED && importOpen && <ImportDialog onClose={() => setImportOpen(false)} onUse={applyImport} />}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
      </div>
    </I18nContext.Provider>
  );
}
