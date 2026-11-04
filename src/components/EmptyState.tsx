import type { ReactNode } from 'react';

export function EmptyState({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <p>{children}</p>
      {action}
    </div>
  );
}
