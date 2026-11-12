import { createDatasetHandler } from './core';
import { createAwsDatasetDependencies } from './aws';

const deps = createAwsDatasetDependencies();
export const handler = createDatasetHandler(deps.store, deps.objects, deps.origin);
