import { X } from 'lucide-react';
import { useRef } from 'react';
import { useDialog } from '../app/useDialog';
import { AiAnalysisPane } from './AiAnalysisPane';

type Props = Parameters<typeof AiAnalysisPane>[0] & { onClose: () => void };

/** The AI analysis tools in a window over the All Complaints page (opened by the "AI analysis" button). */
export function AiAnalysisDrawer({ onClose, ...pane }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, ref);
  return (
    <div className="modal-wrap">
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className="modal ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-title" ref={ref}>
        <div className="drawer-head">
          <div className="drawer-title-row">
            <h2 id="ai-title">AI analysis</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} data-autofocus>
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div className="drawer-body">
          <AiAnalysisPane {...pane} />
        </div>
      </div>
    </div>
  );
}
