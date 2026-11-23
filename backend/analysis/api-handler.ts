import { createAnalysisApi } from './core';
import { awsAnalysisDependencies } from './aws';
import { createDocumentChatApi, qwenDocumentChat } from './chat';

const deps = awsAnalysisDependencies();
const analyses = createAnalysisApi(deps.datasets, deps.files, deps.jobs, deps.queue, deps.results, deps.origin);
const documentChat = createDocumentChatApi(deps.datasets, deps.files, qwenDocumentChat, deps.origin);
export const handler: typeof analyses = event =>
  /^\/api\/datasets\/[0-9a-f-]+\/chat$/.test(event.requestContext.http.path)
    ? documentChat(event) : analyses(event);
