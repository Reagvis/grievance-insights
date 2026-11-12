import { createAnalysisApi } from './core';
import { awsAnalysisDependencies } from './aws';

const deps = awsAnalysisDependencies();
export const handler = createAnalysisApi(deps.datasets, deps.files, deps.jobs, deps.queue, deps.results, deps.origin);
