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
  // Reagvis Labs mark: concentric hexagons around a shield (vector traced from the supplied logo).
  return (
    <span className="brand-mark" aria-hidden>
      <svg viewBox="0 0 1057.9 1057.9" width="38" height="38" fill="none">
        <path fill="#040612" fillRule="evenodd" d="M521.8 39.2L542.7 39.3L555.7 42.9L564.4 47.2L925.7 259L941.3 273.2L949.7 285.9L954.3 298.2L957.3 318.2L957.3 741.2L956.1 753.2L952.7 766.3L945.4 781.2L936 793.2L925.7 801.7L795.7 877.3L567.7 1008.7L549.7 1016.4L534.7 1018.7L514.7 1017L494.7 1008.5L132.7 800.6L118.3 787.2L108.7 771.8L103 754.2L100.6 733.2L100.8 324.2L103.3 304.2L108.5 289.2L112.4 282.2L121.7 270.1L137.7 258.1L219.7 211.4L500.7 45.9L512.1 41.2ZM522.3 134.2L539.7 134.1L557.6 142.2L848.7 313.7L859.7 321L864.6 326.2L869.4 334.2L872.7 347.2L872.8 713.2L869.2 727.2L865.7 733.2L859.7 739.1L843.7 749.2L555.7 915.7L539.7 922.3L526.7 923.4L508.7 917.3L331.7 814.1L203.7 741.4L196.4 735.2L190 725.2L186.6 709.2L186.8 350.2L188.4 339.2L192.4 330.2L198.7 322.8L215.7 311.4L500.7 143.4ZM526.3 219.2L535.7 219.1L549.7 225.1L775.5 358.2L786.4 368.2L791.7 382.2L791.7 669.2L791.2 677.2L787.9 685.2L779.7 694.9L769.7 701.3L553.7 827.9L535.7 836.2L524.7 836.4L509.1 829.2L290.7 701.8L278.4 693.2L273.8 687.2L269.8 678.2L268.9 669.2L269.2 382.2L273.4 370.2L276.7 365.7L286.7 358L490 238.2L516.7 223ZM526.9 315.2L534.7 315.3L545.7 319.9L691.7 406.1L698.1 411.2L703.6 418.2L707.4 427.2L708 434.2L707.9 625.2L706.4 633.2L703.5 639.2L693.7 649.4L659.7 669.7L544.7 736.6L531.7 741.4L521.7 739.9L510.7 735.1L367.7 650.2L361.4 645.2L355.3 637.2L352.2 629.2L351.5 622.2L351.6 432.2L353.5 423.2L356.7 416.6L362.1 410.2L367.7 406.1L512.7 321.1ZM528.3 405.2L529.7 404.5L531.7 405.6L556.7 427.8L572.7 437.5L591.7 445.4L621.7 453.8L622.7 456.2L621.7 496.2L618.5 522.2L611.8 551.2L600.7 582L587.9 605.2L573.5 624.2L555.7 642.1L531.1 660.2L527.7 660.2L516.8 653.2L493.5 633.2L476.6 613.2L460.7 587L448.2 555.2L439.5 517.2L436.5 485.2L435.9 456.2L436.7 454L467.7 445.3L489.7 435.7L511.3 421.2Z" />
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
