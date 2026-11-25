import { exportName, parseAssistantDocument, type ExportFormat, type Orientation } from './assistantDocument';
import { triggerDownload } from './downloads';

type Generator = (answer: string, format: ExportFormat, orientation: Orientation, signal: AbortSignal) => Promise<Blob>;

/** Future chart assets must be scoped to the same turn. Currently text only. */
export type AssistantExportAsset = { kind: 'chart'; alt: string; image: Blob };

export async function generateAssistantExport(answer: string, format: ExportFormat, orientation: Orientation, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!answer.trim()) throw new Error('There is no completed answer to export.');
  if (answer.length > 200_000) throw new Error('This answer is too long to export at once. Ask for shorter sections.');
  const blocks = parseAssistantDocument(answer);
  if (format === 'docx') {
    const { buildAssistantDocx } = await import('./assistantDocx');
    signal.throwIfAborted();
    return new Blob([Uint8Array.from(buildAssistantDocx(blocks, orientation))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  const { buildAssistantPdf } = await import('./assistantPdf');
  const bytes = await buildAssistantPdf(blocks, orientation, signal);
  signal.throwIfAborted();
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Guard immediately before the browser side effect, including after lazy loads. */
export async function downloadAssistantAnswer(
  answer: string, id: number, format: ExportFormat, orientation: Orientation, signal: AbortSignal,
  generate: Generator = generateAssistantExport, download = triggerDownload,
): Promise<void> {
  signal.throwIfAborted();
  const blob = await generate(answer, format, orientation, signal);
  signal.throwIfAborted();
  download(blob, exportName(id, format));
}
