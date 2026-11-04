import type { CaseStatus } from '../domain/grievance';
import { useI18n } from '../i18n/strings';

export function StatusBadge({ status }: { status: CaseStatus }) {
  const { statusLabel } = useI18n();
  return (
    <span className={`status status--${status}`} title={status === 'unknown' ? 'Resolution status not recorded in source' : undefined}>
      {statusLabel(status)}
    </span>
  );
}
