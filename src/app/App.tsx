import { FlaskConical, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader, type DatasetChoice } from '../components/AppHeader';
import { AssistantDrawer, AssistantLauncher } from '../components/AssistantDrawer';
import { InsightsDashboard } from '../components/InsightsDashboard';
import { ImportDialog } from '../components/ImportDialog';
import { PAGE_SIZE, RecordExplorer } from '../components/RecordExplorer';
import { RecordDetail } from '../components/RecordDetail';
import { SummaryWorkspace, type SummaryState } from '../components/SummaryWorkspace';
import { Toasts, type Toast } from '../components/Toasts';
import { createExpandedDataset, createSampleDataset } from '../data/demoGrievances';
import { computeStats, type Dataset, type GrievanceRecord } from '../domain/grievance';
import type { SummaryScope, SummaryService } from '../domain/summary';
import { I18nContext, makeI18n, type UiLanguage } from '../i18n/strings';
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

export default function App({ summaryService = defaultSummaryService, authUser, onLogout }: { summaryService?: SummaryService; authUser?: string; onLogout?: () => void }) {
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
  const dataset: Dataset = (choice === 'imported' && imported) || (choice === 'expanded' && expanded) || sample;

  // ── Exploration state ───────────────────────────────────────────────
  const [filters, setFilters] = useState<RecordFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Last record opened — stays highlighted in the list after the detail panel closes. */
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'records' | 'summary'>('summary');

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
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState<'all' | 'filtered' | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-2), { id, kind, message }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4500);
  }, []);

  const resetForDataset = () => {
    generation.current += 1; // discard any in-flight generation
    setFilters(DEFAULT_FILTERS);
    setPage(0);
    setSelectedId(null);
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
      setSelectedId(id);
      setLastOpenedId(id);
    },
    [recordById, notify],
  );

  const step = (delta: number) => {
    const next = filtered[selectedIndex + delta];
    if (!next) return;
    setSelectedId(next.id);
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
      const wait = MIN_FEEDBACK_MS - (performance.now() - started);
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
    setAssistantOpen(false);
    setMobileView('summary');
    window.setTimeout(() => generateRef.current?.focus(), 60);
  };

  const includedSpan =
    includedStats.dateSpan && formatDate(includedStats.dateSpan.from) && formatDate(includedStats.dateSpan.to)
      ? `between ${formatDate(includedStats.dateSpan.from)} and ${formatDate(includedStats.dateSpan.to)}`
      : null;

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app" data-view={mobileView}>
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
        />

        <nav className="mobile-tabs" aria-label="Views">
          <div className="segmented" role="group">
            <button type="button" aria-pressed={mobileView === 'records'} onClick={() => setMobileView('records')}>
              {i18n.t('records')} <span className="count">{formatCount(filtered.length)}</span>
            </button>
            <button type="button" aria-pressed={mobileView === 'summary'} onClick={() => setMobileView('summary')}>
              {i18n.t('summaryTab')}
            </button>
          </div>
        </nav>

        <div className="workspace">
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

          <main className="main" id="main">
            <div className="main-inner">
              <div className="intro">
                <h1>Turn citizen complaints into a clearer picture of public service issues.</h1>
                <p>
                  {i18n.t('intro')} Currently loaded: <strong className="intro-dataset">{dataset.name}.</strong>
                </p>
              </div>

              {AWS_AUTH_ENABLED && <PersistedDatasets onSelect={useRemoteDataset} onClear={clearRemoteDataset} activeId={remoteId} />}


              <InsightsDashboard key={dataset.id} dataset={dataset} filteredCount={filtered.length}
                job={currentAnalysis?.job ?? null} report={currentAnalysis?.report ?? null}
                analysisLoading={Boolean(remoteId) && (!currentAnalysis || currentAnalysis.loading)}
                analysisError={currentAnalysis?.error ?? null} onOpenRecord={openRecord} />

              {AWS_AUTH_ENABLED && remoteId && <AnalysisWorkspace key={remoteId} datasetId={remoteId}
                records={dataset.records} onStateChange={onAnalysisStateChange} />}

              {dataset.kind === 'synthetic-expansion' && (
                <div className="notice notice--warn dataset-notice">
                  <TriangleAlert size={16} aria-hidden />
                  <span>
                    Performance-test dataset: 2,000 records generated from the 30 curated templates. Texts repeat and statuses are random, so
                    use the sample dataset for presentations.
                  </span>
                </div>
              )}
              {dataset.kind === 'imported' && dataset.isSynthetic && (
                <div className="notice notice--info dataset-notice">
                  <FlaskConical size={16} aria-hidden />
                  <span>Every imported record is flagged as synthetic demo data in the source file.</span>
                </div>
              )}

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
        </div>

        <AssistantLauncher onOpen={() => setAssistantOpen(true)} />

        {selected && (
          <RecordDetail
            record={selected}
            position={selectedIndex >= 0 ? { index: selectedIndex, total: filtered.length } : null}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onClose={() => setSelectedId(null)}
            onDownload={downloadNote}
            onCopy={(text, what) => void copyRecordText(text, what)}
          />
        )}
        {assistantOpen && <AssistantDrawer key={dataset.id} records={dataset.records} onOpenRecord={openRecord} onClose={() => setAssistantOpen(false)} onGoToSummary={goToSummary} />}
        {!AWS_AUTH_ENABLED && importOpen && <ImportDialog onClose={() => setImportOpen(false)} onUse={applyImport} onDownloadTemplate={downloadTemplate} />}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
      </div>
    </I18nContext.Provider>
  );
}
