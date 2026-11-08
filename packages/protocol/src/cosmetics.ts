import {z} from 'zod';
import {accountProfileSchema,PROFILE_BORDERS} from './profile';

export const COLLECTION_CAPABILITY='usual-player-profiles-v2';
export const TABLE_THEMES=['classic','midnight','moonlit','rosewood','jade'] as const;
export const CARD_ARTWORK=['ivory','porcelain','letterpress'] as const;
export const CARD_BACKS=['traditional','geometric','moonphase','deco','botanical'] as const;
export const COLLECTION_BORDERS=['moonstone','garden-edge','club-glint','lunar-orbit','soft-halo'] as const;
export const cosmeticCategorySchema=z.enum(['theme','artwork','back','border']);
export const cosmeticSelectionSchema=z.object({theme:z.enum(TABLE_THEMES),artwork:z.enum(CARD_ARTWORK),back:z.enum(CARD_BACKS),border:z.enum([...PROFILE_BORDERS,...COLLECTION_BORDERS])}).strict();
export type CosmeticSelection=z.infer<typeof cosmeticSelectionSchema>;
export type CosmeticCategory=z.infer<typeof cosmeticCategorySchema>;
export type CosmeticDefinition={category:CosmeticCategory;id:string;name:string;collection:string;requirement:string;motion?:boolean;free?:boolean};
export const COSMETICS:readonly CosmeticDefinition[]=[
  {category:'theme',id:'classic',name:'Usual Club',collection:'usual',requirement:'Included',free:true},
  {category:'theme',id:'midnight',name:'Midnight',collection:'usual',requirement:'Included',free:true},
  {category:'theme',id:'moonlit',name:'Moonlit Club',collection:'moonlit',requirement:'Reach level 5'},
  {category:'theme',id:'rosewood',name:'Rosewood Lounge',collection:'rosewood',requirement:'First saved-chip win'},
  {category:'theme',id:'jade',name:'Jade Garden',collection:'jade',requirement:'Play 25 saved Blackjack rounds'},
  {category:'artwork',id:'ivory',name:'Warm Ivory',collection:'usual',requirement:'Included',free:true},
  {category:'artwork',id:'porcelain',name:'Porcelain',collection:'moonlit',requirement:'Reach level 3'},
  {category:'artwork',id:'letterpress',name:'Letterpress',collection:'rosewood',requirement:'Play 25 saved Blackjack rounds'},
  ...CARD_BACKS.map((id,i)=>({category:'back' as const,id,name:['Traditional','Geometric','Moonphase','Lounge Deco','Garden Weave'][i]!,collection:['usual','usual','moonlit','rosewood','jade'][i]!,requirement:['Included','Included','Reach level 5','First saved-chip win','Play 25 saved Blackjack rounds'][i]!,free:i<2})),
  ...PROFILE_BORDERS.map((id,i)=>({category:'border' as const,id,name:['Minimal','Sage','Brass','Midnight','Copper','Amethyst','Laurel'][i]!,collection:'usual',requirement:'Included',free:true})),
  {category:'border',id:'moonstone',name:'Moonstone',collection:'moonlit',requirement:'Reach level 5'},
  {category:'border',id:'garden-edge',name:'Garden Edge',collection:'jade',requirement:'Play 25 saved Blackjack rounds'},
  {category:'border',id:'club-glint',name:'Club Glint',collection:'rosewood',requirement:'First saved-chip win',motion:true},
  {category:'border',id:'lunar-orbit',name:'Lunar Orbit',collection:'moonlit',requirement:'Reach level 5',motion:true},
  {category:'border',id:'soft-halo',name:'Soft Halo',collection:'independent',requirement:'Reach level 3',motion:true},
];
export const DEFAULT_COSMETICS:CosmeticSelection={theme:'classic',artwork:'ivory',back:'traditional',border:'none'};
export const cosmeticKey=(category:CosmeticCategory,id:string)=>`${category}:${id}`;
export const collectionSchema=z.object({contract:z.literal(1),accountId:z.string().uuid(),profile:accountProfileSchema,selection:cosmeticSelectionSchema,owned:z.array(z.string().max(80)).max(100)}).strict().superRefine((value,ctx)=>{
  if(value.accountId!==value.profile.accountId||value.selection.border!==value.profile.appearance.border)ctx.addIssue({code:'custom',message:'Collection owner or border mismatch'});
  for(const [category,id] of Object.entries(value.selection))if(!value.owned.includes(`${category}:${id}`))ctx.addIssue({code:'custom',message:'Equipped item must be owned'});
});
export const equipCosmeticSchema=z.object({category:cosmeticCategorySchema,id:z.string().min(1).max(40),version:z.number().int().nonnegative().safe()}).strict().refine(value=>COSMETICS.some(c=>c.category===value.category&&c.id===value.id),'Choose a catalogue item');
export type Collection=z.infer<typeof collectionSchema>;
