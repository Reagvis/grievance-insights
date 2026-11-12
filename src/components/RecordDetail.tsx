import { ChevronLeft, ChevronRight, Copy, Download, FlaskConical, Languages, MessageSquareText, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../app/useDialog';
import { categoryOf, hasResponse, UNCATEGORIZED, type GrievanceRecord } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import { formatCount, formatDate } from '../utils/format';
import { StatusBadge } from './StatusBadge';
import { displayedText, englishTranslation, type TextView } from '../data/englishTranslations';
import { TranslatedText } from './TranslatedText';

type Props = {
  record: GrievanceRecord;
  position: { index: number; total: number } | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDownload: (record: GrievanceRecord) => void;
  onCopy: (text: string, what: string) => void;
  /** Render as a static panel beside the list (no overlay, no focus trap). */
  inline?: boolean;
};

const LANGUAGE_LABEL: Record<GrievanceRecord['language'], string> = {
  te: 'Telugu',
  en: 'English',
  mixed: 'Mixed Telugu / English',
  unknown: 'Not recorded',
};

export function RecordDetail({ record, position, onPrev, onNext, onClose, onDownload, onCopy, inline = false }: Props) {
  const { t, categoryLabel } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [textView, setTextView] = useState<TextView>('original');
  useDialog(!inline, onClose, ref);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [record.id]);
  const responded = hasResponse(record);
  // Bundled translations only exist for the demo texts; for real data the bar would offer nothing, so it is hidden.
  const canTranslate = englishTranslation(record.complaintText) !== null || (responded && englishTranslation(record.responseText as string) !== null);

  const value = (v: string | null | undefined) =>
    v && v.trim() ? <dd>{v}</dd> : <dd className="not-recorded">{t('notRecorded')}</dd>;

  const cat = categoryOf(record);

  return (
    <>
      {!inline && <div className="backdrop" onClick={onClose} aria-hidden />}
      <div
        className={inline ? 'drawer drawer--inline' : 'drawer'}
        role={inline ? 'region' : 'dialog'}
        aria-modal={inline ? undefined : true}
        aria-labelledby="detail-title"
        ref={ref}
      >
        <div className="drawer-head">
          <div className="drawer-title-row">
            <h2 id="detail-title">{record.id}</h2>
            <StatusBadge status={record.status} />
            <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose} data-autofocus={inline ? undefined : true}>
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="drawer-nav">
            <span className="pos num">
              {position
                ? `${formatCount(position.index + 1)} ${t('of')} ${formatCount(position.total)} in current list`
                : 'Not in the current filtered list'}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrev} disabled={!position || position.index === 0}>
              <ChevronLeft size={15} aria-hidden />
              {t('previous')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onNext}
              disabled={!position || position.index >= position.total - 1}
            >
              {t('next')}
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
        </div>

        <div className="drawer-body" ref={bodyRef}>
          <dl className="meta-grid">
            <div>
              <dt>{t('category')}</dt>
              {cat === UNCATEGORIZED ? <dd className="not-recorded">{t('notRecorded')}</dd> : <dd>{categoryLabel(cat)}</dd>}
            </div>
            <div>
              <dt>Issue type</dt>
              {value(record.issueType)}
            </div>
            <div className="wide">
              <dt>Department</dt>
              {value(record.department)}
            </div>
            <div>
              <dt>District</dt>
              {value(record.district)}
            </div>
            <div>
              <dt>Language</dt>
              <dd>{LANGUAGE_LABEL[record.language]}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              {value(formatDate(record.submittedAt))}
            </div>
            <div>
              <dt>Responded</dt>
              {value(formatDate(record.respondedAt))}
            </div>
            <div>
              <dt>Response in source</dt>
              <dd>{responded ? 'Provided' : <span className="not-recorded">Not provided</span>}</dd>
            </div>
            <div>
              <dt>Resolution status</dt>
              {record.status === 'unknown' ? (
                <dd className="not-recorded">{t('statusNotRecorded')}</dd>
              ) : (
                <dd>
                  <StatusBadge status={record.status} />
                </dd>
              )}
            </div>
            <div className="wide">
              <dt>Source file</dt>
              {record.originalFileName ? <dd>{record.originalFileName}</dd> : <dd className="not-recorded">No original file attached</dd>}
            </div>
          </dl>

          {canTranslate && (
          <div className="translation-bar">
            <div className="translation-bar-label"><Languages size={18} aria-hidden /><div><label htmlFor="text-language">Read in</label><span>Source: {LANGUAGE_LABEL[record.language]}</span></div></div>
            <select id="text-language" className="select" value={textView} onChange={(event) => setTextView(event.target.value as TextView)}>
              <option value="original">Original language</option>
              <option value="en">English</option>
              <option value="both">Original + English</option>
            </select>
            <p>English translations are available for sample records. Downloads keep the original text.</p>
          </div>
          )}

          <section className="text-block text-block--complaint" aria-labelledby="complaint-h">
            <div className="text-block-head">
              <h3 id="complaint-h">
                <UserRound size={16} aria-hidden />
                {t('citizenComplaint')}
              </h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopy(displayedText(record.complaintText, textView), 'Complaint')}>
                <Copy size={13} aria-hidden />
                {t('copy')}
              </button>
            </div>
            <TranslatedText text={record.complaintText} view={canTranslate ? textView : 'original'} />
          </section>

          <section className="text-block text-block--response" aria-labelledby="response-h">
            <div className="text-block-head">
              <h3 id="response-h">
                <MessageSquareText size={16} aria-hidden />
                {t('departmentResponse')}
              </h3>
              {responded && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopy(displayedText(record.responseText as string, textView), 'Response')}>
                  <Copy size={13} aria-hidden />
                  {t('copy')}
                </button>
              )}
            </div>
            {responded ? (
              <TranslatedText text={record.responseText as string} view={canTranslate ? textView : 'original'} />
            ) : (
              <div className="text-body text-body--empty">{t('noResponse')}</div>
            )}
            {responded && record.status !== 'resolved' && (
              <p className="record-note">A response is recorded, but the source does not mark this complaint as resolved.</p>
            )}
          </section>

          {record.isSyntheticDemo && (
            <p className="record-note">
              <FlaskConical size={13} aria-hidden />
              Synthetic demonstration record. Not real CM Helpline data.
            </p>
          )}
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-primary" onClick={() => onDownload(record)}>
            <Download size={15} aria-hidden />
            {t('downloadNote')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {inline ? 'Close note' : 'Back'}
          </button>
        </div>
      </div>
    </>
  );
}
