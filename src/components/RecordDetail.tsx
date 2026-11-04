import { ChevronLeft, ChevronRight, Copy, Download, FlaskConical, MessageSquareText, UserRound, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useDialog } from '../app/useDialog';
import { categoryOf, hasResponse, UNCATEGORIZED, type GrievanceRecord } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import { formatCount, formatDate } from '../utils/format';
import { StatusBadge } from './StatusBadge';

type Props = {
  record: GrievanceRecord;
  position: { index: number; total: number } | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDownload: (record: GrievanceRecord) => void;
  onCopy: (text: string, what: string) => void;
};

const LANGUAGE_LABEL: Record<GrievanceRecord['language'], string> = {
  te: 'Telugu',
  en: 'English',
  mixed: 'Mixed Telugu / English',
  unknown: 'Not recorded',
};

export function RecordDetail({ record, position, onPrev, onNext, onClose, onDownload, onCopy }: Props) {
  const { t, categoryLabel } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, ref);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [record.id]);
  const responded = hasResponse(record);
  const textLang = record.language === 'en' ? 'en' : 'te';

  const value = (v: string | null | undefined) =>
    v && v.trim() ? <dd>{v}</dd> : <dd className="not-recorded">{t('notRecorded')}</dd>;

  const cat = categoryOf(record);

  return (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-title-row">
            <h2 id="detail-title">{record.id}</h2>
            <StatusBadge status={record.status} />
            <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose} data-autofocus>
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="drawer-nav">
            <span className="pos num">
              {position
                ? `${formatCount(position.index + 1)} ${t('of')} ${formatCount(position.total)} in current list`
                : 'Opened from the report — not in the current filtered list'}
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

          <section className="text-block text-block--complaint" aria-labelledby="complaint-h">
            <div className="text-block-head">
              <h3 id="complaint-h">
                <UserRound size={16} aria-hidden />
                {t('citizenComplaint')}
              </h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopy(record.complaintText, 'Complaint')}>
                <Copy size={13} aria-hidden />
                {t('copy')}
              </button>
            </div>
            <div className="text-body">
              <p className="te source-text" lang={textLang}>
                {record.complaintText}
              </p>
            </div>
          </section>

          <section className="text-block text-block--response" aria-labelledby="response-h">
            <div className="text-block-head">
              <h3 id="response-h">
                <MessageSquareText size={16} aria-hidden />
                {t('departmentResponse')}
              </h3>
              {responded && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopy(record.responseText as string, 'Response')}>
                  <Copy size={13} aria-hidden />
                  {t('copy')}
                </button>
              )}
            </div>
            {responded ? (
              <div className="text-body">
                <p className="te source-text" lang="te">
                  {record.responseText}
                </p>
              </div>
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
        </div>
      </div>
    </>
  );
}
