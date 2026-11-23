import { createEofficeApi } from './core';
import { bedrockModel } from './aws';
import { HttpsDocuments } from './documents';
import { EofficeError } from './schema';

// No production eOffice authentication or protected-file credentials are defined in Phase 1 v2.0.
// Both boundaries remain fail-closed until the separately issued government specification arrives.
export const handler = createEofficeApi({
  authorize: async () => null,
  model: bedrockModel,
  documents: new HttpsDocuments(async () => {
    throw new EofficeError(503, 'Protected document credentials are not configured.', 'Document retrieval is unavailable.');
  }),
});
