import { expect,test,type Page } from '@playwright/test';
import { accountId,providerFixture } from './authFixture';
const game={gameId:'blackjack',roundsPlayed:'4',roundsWon:'2',roundsLost:'1',roundsEven:'1',wageredUnits:'4000',returnedUnits:'5500',netUnits:'1500',bestRoundNetUnits:'1500'};
const summary={contract:1,accountId,unitsPerChip:100,basis:'saved-rounds',games:[game]};
const blackjack={trackedRounds:'4',hands:'5',wins:'2',losses:'2',pushes:'1',blackjacks:'1',busts:'1',doubles:'1',splits:'1',insuranceTaken:'1',insuranceWon:'0',perfectPairsBets:'2',perfectPairsWins:'1'};
const detailed={accountId,summary,blackjack};
async function open(page:Page){await page.goto('./#/games');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Continue with Google'}).click();await page.getByRole('button',{name:'Account menu for Stats player'}).click();await page.getByRole('menuitem',{name:'Statistics',exact:true}).click();return page.getByRole('dialog',{name:'Player profile',exact:true});}
test('profile statistics show precise saved totals, game-specific counters and owner refresh',async({page},info)=>{
  await providerFixture(page,'google','success','Stats player');let reads=0;
  await page.route('**/api/v1/account/statistics/details*',async route=>{expect(route.request().method()).toBe('GET');expect(route.request().postData()).toBeNull();expect(new URL(route.request().url()).search).toBe('?version=5');reads++;await route.fulfill({json:detailed});});
  const dialog=await open(page);await expect(dialog.getByRole('region',{name:'General statistics'})).toBeVisible();
  await dialog.getByRole('combobox',{name:'Game',exact:true}).selectOption('blackjack');
  const region=dialog.getByRole('region',{name:'Blackjack statistics',exact:true});
  await expect(region.getByText('+15',{exact:true})).toHaveCount(2);
  for(const [label,value] of [['Rounds played','4'],['Chips wagered','40'],['Chips returned','55'],['Hands played','5'],['Natural blackjacks','1'],['Perfect Pairs bets','2'],['Perfect Pairs wins','1']])await expect(region.locator('div').filter({has:page.locator('span').filter({hasText:new RegExp(`^${label}$`)})}).last().locator('strong')).toHaveText(value!);
  await expect(dialog).toContainText('Saved-chip play only');await page.screenshot({path:info.outputPath('profile-statistics.png')});
  await dialog.getByRole('button',{name:'Refresh profile'}).click();await expect.poll(()=>reads).toBe(2);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Account menu for Stats player'})).toBeFocused();
  await page.getByRole('button',{name:'Account menu for Stats player'}).click();await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await expect(dialog).not.toBeVisible();
});
test('statistics keep unavailable and wrong-owner data separate from a valid empty history',async({page},info)=>{
  await providerFixture(page,'google','success','Stats player');let mode='missing';
  await page.route('**/api/v1/account/statistics/details*',async route=>{if(mode==='missing')await route.fulfill({status:503,json:{code:'STATISTICS_NOT_CONNECTED'}});else if(mode==='offline')await route.abort();else if(mode==='wrong')await route.fulfill({json:{...detailed,accountId:crypto.randomUUID()}});else await route.fulfill({json:{...detailed,summary:{...summary,games:mode==='empty'?[]:[game]}}});});
  const dialog=await open(page);await expect(dialog.getByRole('heading',{name:'Statistics unavailable'})).toBeVisible();
  for(const next of ['offline','wrong']){mode=next;await dialog.getByRole('button',{name:'Refresh profile'}).click();await expect(dialog.getByRole('heading',{name:'Statistics unavailable'})).toBeVisible();await expect(dialog.getByText('+15',{exact:true})).toHaveCount(0);}
  mode='empty';await dialog.getByRole('button',{name:'Refresh profile'}).click();await expect(dialog).toContainText('No saved rounds yet');await expect(dialog.getByRole('region',{name:'General statistics'}).locator('strong')).toHaveText(['0','0','0','0','0','0','0','0']);
  await page.screenshot({path:info.outputPath('empty-profile-statistics.png')});mode='ready';await dialog.getByRole('button',{name:'Refresh profile'}).click();await expect(dialog.getByText('+15',{exact:true})).toHaveCount(2);
});
