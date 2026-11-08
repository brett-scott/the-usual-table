import { z } from 'zod';
import { appearanceSchema } from '@casual/protocol';
export const profileMemberFields={profileAccountId:z.string().uuid().optional(),appearance:appearanceSchema.optional(),profileVersion:z.number().int().nonnegative().safe().optional()};
