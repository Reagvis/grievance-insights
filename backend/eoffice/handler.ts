import { createEofficeApi } from './core';
import { bedrockModel } from './aws';
import { HttpsDocuments } from './documents';

// Deliberately fail-closed. Wire an authenticated, authorized department principal
// only after the separate eOffice authentication/protected-file-access specification arrives.
export const handler = createEofficeApi({
  authorize: async () => null,
  model: bedrockModel,
  documents: new HttpsDocuments(new Set((process.env.EOFFICE_DOCUMENT_HOSTS ?? '').split(',').filter(Boolean))),
});
