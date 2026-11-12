import { FileText, LayoutDashboard, ListTree } from 'lucide-react';
import { useI18n } from '../i18n/strings';
import type { Page } from '../utils/route';

const ITEMS: Array<{ page: Page; key: 'navDashboard' | 'navComplaints' | 'navSummary'; icon: typeof FileText }> = [
  { page: 'dashboard', key: 'navDashboard', icon: LayoutDashboard },
  { page: 'complaints', key: 'navComplaints', icon: ListTree },
  { page: 'summary', key: 'navSummary', icon: FileText },
];

export function AppNav({ page, onNavigate, complaintCount }: { page: Page; onNavigate: (p: Page) => void; complaintCount: number }) {
  const { t } = useI18n();
  return (
    <nav className="app-nav" aria-label="Sections">
      <ul>
        {ITEMS.map(({ page: p, key, icon: Icon }) => (
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
