import { FlaskConical, RefreshCw, Upload } from 'lucide-react';
import { formatDateTime } from '../utils/format';
import type { UiLanguage } from '../i18n/strings';
import { useI18n } from '../i18n/strings';

export type DatasetChoice = 'sample' | 'expanded' | 'imported';

type Props = {
  datasetChoice: DatasetChoice;
  authUser?: string;
  onLogout?: () => void;
  importedLabel: string | null;
  isSynthetic: boolean;
  onDatasetChange: (choice: DatasetChoice) => void;
  onImport: () => void;
  uiLang: UiLanguage;
  onLangChange: (lang: UiLanguage) => void;
  /** Set in live mode: replaces the demo dataset picker, import and prototype badge. */
  live?: LiveHeaderInfo | null;
  /** Set in the AWS build: real uploaded files only, so no sample/prototype labels and no sample dataset picker. */
  realData?: { datasetName: string | null } | null;
};

export function BrandMark() {
  // Abstract stack of notes resolving into a single summary line — no insignia.
  return (
    <span className="brand-mark" aria-hidden>
      <svg viewBox="0 0 36 36" width="34" height="34" fill="none">
        <rect width="36" height="36" rx="8" fill="#1e3a8a" />
        <rect x="9" y="10" width="18" height="2.75" rx="1.375" fill="#ffffff" />
        <rect x="9" y="15.25" width="14" height="2.75" rx="1.375" fill="#ffffff" fillOpacity="0.88" />
        <rect x="9" y="20.5" width="16" height="2.75" rx="1.375" fill="#ffffff" fillOpacity="0.88" />
        <rect x="9" y="25.75" width="11" height="2.75" rx="1.375" fill="#2dd4bf" />
      </svg>
    </span>
  );
}

export type LiveHeaderInfo = {
  loadedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** True when the server says it is the development mock, not the real service. */
  mock: boolean;
};

export function AppHeader({ onImport, uiLang, onLangChange, live, realData, authUser, onLogout }: Props) {
  const { t } = useI18n();
  const loadedLabel = live?.loadedAt ? formatDateTime(live.loadedAt) : null;
  const langToggle = (
    <div className="segmented lang-toggle" role="group" aria-label={t('language')}>
      <button type="button" aria-pressed={uiLang === 'en'} onClick={() => onLangChange('en')}>
        EN
      </button>
      <button type="button" aria-pressed={uiLang === 'te'} lang="te" onClick={() => onLangChange('te')} title={t('teluguCoverage')}>
        తెలుగు
      </button>
    </div>
  );
  if (realData) {
    return (
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <span className="brand-name">{t('appName')}</span>
            <span className="brand-sub">{t('appSubtitle')}</span>
          </div>
        </div>
        {realData.datasetName && (
          <span className="dataset-chip" title={realData.datasetName}>
            {realData.datasetName}
          </span>
        )}
        <div className="header-actions">
          <button type="button" className="btn btn-secondary btn-header" onClick={onImport}>
            <Upload size={14} aria-hidden />
            Upload file
          </button>
          {authUser && onLogout && (
            <div className="auth-header-user">
              <span title={authUser}>{authUser}</span>
              <button type="button" className="btn btn-secondary btn-header" onClick={onLogout}>
                Sign out
              </button>
            </div>
          )}
          {langToggle}
        </div>
      </header>
    );
  }
  if (live) {
    return (
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <span className="brand-name">{t('appName')}</span>
            <span className="brand-sub">{t('appSubtitle')}</span>
          </div>
        </div>
        {live.mock && (
          <span className="proto-badge" title="This server is a development mock. Its data and answers are not real.">
            <FlaskConical size={13} aria-hidden />
            Mock backend · not real data
          </span>
        )}
        <div className="header-actions">
          {loadedLabel && <span className="sync-label">Updated {loadedLabel}</span>}
          <button type="button" className="btn btn-secondary btn-header" onClick={live.onRefresh} disabled={live.refreshing} aria-label="Refresh data">
            <RefreshCw size={14} className={live.refreshing ? 'spin' : undefined} aria-hidden />
            {live.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {langToggle}
        </div>
      </header>
    );
  }
  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">{t('appName')}</span>
          <span className="brand-sub">{t('appSubtitle')}</span>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="btn btn-secondary btn-header" onClick={onImport}>
          <Upload size={14} aria-hidden />
          {t('importData')}
        </button>
        {authUser && onLogout && <div className="auth-header-user"><span title={authUser}>{authUser}</span><button type="button" className="btn btn-secondary btn-header" onClick={onLogout}>Sign out</button></div>}
        <div className="segmented lang-toggle" role="group" aria-label={t('language')}>
          <button type="button" aria-pressed={uiLang === 'en'} onClick={() => onLangChange('en')}>
            EN
          </button>
          <button type="button" aria-pressed={uiLang === 'te'} lang="te" onClick={() => onLangChange('te')} title={t('teluguCoverage')}>
            తెలుగు
          </button>
        </div>
      </div>
    </header>
  );
}
