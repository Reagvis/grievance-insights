import { openWorksheet } from './datasetApi';
import { buildWorkbookChart, type ChartDecision } from '../utils/workbookCharts';

/** The existing GET worksheet endpoint does all real session/owner authorization. */
export async function loadAuthorizedChart(datasetId: string, sheetIndex: number, question: string, signal: AbortSignal): Promise<ChartDecision> {
  signal.throwIfAborted();
  const { worksheet } = await openWorksheet(datasetId, sheetIndex, signal);
  signal.throwIfAborted();
  return buildWorkbookChart(worksheet, question);
}
