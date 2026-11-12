import { FileText, LayoutDashboard, ListTree, Upload } from 'lucide-react';
import { useI18n } from '../i18n/strings';
import type { Page } from '../utils/route';

const ITEMS: Array<{ page: Page; key: 'navUpload' | 'navDashboard' | 'navComplaints' | 'navSummary'; icon: typeof FileText }> = [
  { page: 'upload', key: 'navUpload', icon: Upload },
  { page: 'dashboard', key: 'navDashboard', icon: LayoutDashboard },
  { page: 'complaints', key: 'navComplaints', icon: ListTree },
  { page: 'summary', key: 'navSummary', icon: FileText },
];

/** `pages` picks which sections are shown (the signed-in build: Upload, All Complaints, Summary; the demo: Dashboard, All Complaints, Summary). */
export function AppNav({ page, onNavigate, complaintCount, pages }: { page: Page; onNavigate: (p: Page) => void; complaintCount: number; pages?: readonly Page[] }) {
  const { t } = useI18n();
  return (
    <nav className="app-nav" aria-label="Sections">
      <ul>
        {ITEMS.filter((item) => (pages ? pages.includes(item.page) : item.page !== 'upload')).map(({ page: p, key, icon: Icon }) => (
          <li key={p}>
            <a
              href={`#/${p}`}
              className="app-nav-link"
              aria-current={page === p ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onNavigate(p);
              }}
            >
              <Icon size={16} aria-hidden />
              {t(key)}
              {p === 'complaints' && <span className="count">{complaintCount.toLocaleString('en-IN')}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
