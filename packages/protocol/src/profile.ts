import { z } from 'zod';
import { displayNameSchema, playerIconSchema } from './identity';
import { gameIdSchema } from './games';
import { gameStatisticsSchema, blackjackStatisticsSchema, crashStatisticsSchema, baccaratStatisticsSchema, rouletteStatisticsSchema,kenoStatisticsSchema } from './statistics';

export const PROFILE_ILLUSTRATIONS = ['fox','owl','panda','robot','cat','penguin','moon','club'] as const;
export const PROFILE_CAPABILITY='usual-player-profiles-v1';
export const PROFILE_BORDERS = ['none','sage','brass','midnight','copper','royal','orbit'] as const;
export const avatarSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('initials')}).strict(),
  z.object({kind:z.literal('emoji'),id:playerIconSchema}).strict(),
  z.object({kind:z.literal('illustration'),id:z.enum(PROFILE_ILLUSTRATIONS)}).strict(),
]);
export const appearanceSchema = z.object({avatar:avatarSchema,border:z.enum([...PROFILE_BORDERS,'moonstone','garden-edge','club-glint','lunar-orbit','soft-halo'])}).strict();
export const legacyAppearanceSchema=z.object({avatar:avatarSchema,border:z.enum(PROFILE_BORDERS)}).strict();
export function legacyAppearance(value:z.infer<typeof appearanceSchema>):z.infer<typeof legacyAppearanceSchema>{return {...value,border:PROFILE_BORDERS.includes(value.border as typeof PROFILE_BORDERS[number])?value.border as typeof PROFILE_BORDERS[number]:'brass'};}
export const profileVisibilitySchema=z.object({chips:z.boolean(),statistics:z.boolean(),achievements:z.boolean()}).strict();
export const profileDraftSchema=z.object({nickname:displayNameSchema,appearance:appearanceSchema,visibility:profileVisibilitySchema}).strict();
export const accountProfileSchema=z.object({contract:z.literal(1),accountId:z.string().uuid(),version:z.number().int().nonnegative().safe(),
  nickname:displayNameSchema.nullable(),appearance:appearanceSchema,visibility:profileVisibilitySchema}).strict();
export const saveProfileSchema=profileDraftSchema.extend({version:z.number().int().nonnegative().safe()}).strict();
export const publicStatisticsSchema=z.object({games:z.array(gameStatisticsSchema).max(8),blackjack:blackjackStatisticsSchema,
  crash:crashStatisticsSchema.optional(),baccarat:baccaratStatisticsSchema.optional(),roulette:rouletteStatisticsSchema.optional(),keno:kenoStatisticsSchema.optional()}).strict();
export const publicAchievementSchema=z.object({id:z.string().max(100),gameId:gameIdSchema,name:z.string().max(100),description:z.string().max(200),
  rewardUnits:z.number().int().nonnegative().safe(),target:z.number().int().positive(),progress:z.string().max(40).regex(/^(0|[1-9]\d*)$/),unlocked:z.boolean()}).strict();
export const publicAccountProfileSchema=z.object({kind:z.literal('account'),appearance:appearanceSchema,version:z.number().int().nonnegative().safe(),
  level:z.number().int().positive(),visibility:profileVisibilitySchema,totalSavedChipUnits:z.string().max(40).regex(/^(0|[1-9]\d*)$/).nullable().optional(),
  statistics:publicStatisticsSchema.optional(),achievements:z.array(publicAchievementSchema).max(200).optional()}).strict();
export const roomProfileSchema=z.object({contract:z.literal(1),ownAccount:z.boolean().optional(),playerId:z.string().min(1).max(100),name:displayNameSchema,stackUnits:z.number().int().nonnegative().safe(),
  funding:z.enum(['saved','temporary']),profile:z.union([publicAccountProfileSchema,z.object({kind:z.literal('guest'),appearance:appearanceSchema}).strict()])}).strict();
export type Appearance=z.infer<typeof appearanceSchema>;
export type AccountProfile=z.infer<typeof accountProfileSchema>;
export type ProfileDraft=z.infer<typeof profileDraftSchema>;
export type PublicAccountProfile=z.infer<typeof publicAccountProfileSchema>;
export type RoomProfile=z.infer<typeof roomProfileSchema>;
export const DEFAULT_APPEARANCE:Appearance={avatar:{kind:'initials'},border:'none'};
export const DEFAULT_PROFILE_VISIBILITY={chips:true,statistics:true,achievements:true} as const;
