import { CalendarDays } from 'lucide-react';
import { memo } from 'react';
import { categoryOf, hasResponse, type GrievanceRecord } from '../domain/grievance';
import { useI18n } from '../i18n/strings';
import { formatDate } from '../utils/format';
import { StatusBadge } from './StatusBadge';

type Props = {
  record: GrievanceRecord;
  selected: boolean;
  onOpen: (id: string) => void;
  /** e.g. "Added 5 minutes ago" (signed-in build). */
  addedLabel?: string | null;
};

export const RecordListItem = memo(function RecordListItem({ record, selected, onOpen, addedLabel }: Props) {
  const { categoryLabel, t } = useI18n();
  const date = formatDate(record.submittedAt);
  const responded = hasResponse(record);
  return (
    <li>
      <button
        type="button"
        className="record-row"
        aria-current={selected ? 'true' : undefined}
        data-record-id={record.id}
        onClick={() => onOpen(record.id)}
      >
        <span className="row-top">
          <span className="case-id">{record.id}</span>
          <StatusBadge status={record.status} />
        </span>
        {/* CSS line-clamp: never slices Telugu graphemes in JS */}
        <span className="row-text te" lang={record.language === 'en' ? 'en' : 'te'}>
          {record.complaintText}
        </span>
        <span className="row-meta">
          <span className="row-meta-left">
            <span className="cat">{categoryLabel(categoryOf(record))}</span>
            {date ? (
              <span className="row-date">
                <CalendarDays size={12} aria-hidden />
                {date}
              </span>
            ) : (
              <span className="row-date not-recorded">Date {t('notRecorded').toLowerCase()}</span>
            )}
          </span>
          {!responded && <span className="no-response-pill">{t('responseMissing')}</span>}
        </span>
        {addedLabel && <span className="row-added">Added {addedLabel}</span>}
      </button>
    </li>
  );
});
