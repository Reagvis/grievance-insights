import { createAuthHandler } from './app';
import { createAwsDependencies } from './aws';

export const handler = createAuthHandler(createAwsDependencies());
