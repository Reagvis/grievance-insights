import { FlaskConical, Upload } from 'lucide-react';
import type { UiLanguage } from '../i18n/strings';
import { useI18n } from '../i18n/strings';

export type DatasetChoice = 'sample' | 'expanded' | 'imported';

type Props = {
  datasetChoice: DatasetChoice;
  importedLabel: string | null;
  isSynthetic: boolean;
  onDatasetChange: (choice: DatasetChoice) => void;
  onImport: () => void;
  uiLang: UiLanguage;
  onLangChange: (lang: UiLanguage) => void;
};

export function BrandMark() {
  // Abstract stack of notes resolving into a single summary line — no insignia.
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3.5" width="10" height="2" rx="1" fill="#fff" opacity=".55" />
        <rect x="3" y="7.5" width="12" height="2" rx="1" fill="#fff" opacity=".75" />
        <rect x="3" y="11.5" width="8" height="2" rx="1" fill="#fff" opacity=".55" />
        <rect x="3" y="15.5" width="14" height="2" rx="1" fill="#7fd1c8" />
      </svg>
    </span>
  );
}

export function AppHeader({ datasetChoice, importedLabel, isSynthetic, onDatasetChange, onImport, uiLang, onLangChange }: Props) {
  const { t } = useI18n();
  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">{t('appName')}</span>
          <span className="brand-sub">{t('appSubtitle')}</span>
        </div>
      </div>
      <span className="proto-badge" title={isSynthetic ? 'All records shown are synthetic demonstration data' : 'Prototype running on locally imported data'}>
        <FlaskConical size={13} aria-hidden />
        {isSynthetic ? t('prototypeBadge') : t('prototypeBadgeImported')}
      </span>
      <div className="header-actions">
        <div className="dataset-picker">
          <label htmlFor="dataset-select" className="sr-only">
            {t('dataset')}
          </label>
          <select
            id="dataset-select"
            className="select"
            value={datasetChoice}
            onChange={(e) => onDatasetChange(e.target.value as DatasetChoice)}
          >
            <option value="sample">{t('datasetSample')}</option>
            <option value="expanded">{t('datasetExpanded')}</option>
            {importedLabel && <option value="imported">{importedLabel}</option>}
          </select>
        </div>
        <button type="button" className="btn btn-secondary btn-header" onClick={onImport}>
          <Upload size={14} aria-hidden />
          {t('importData')}
        </button>
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
