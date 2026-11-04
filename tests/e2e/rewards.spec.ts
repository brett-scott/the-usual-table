import { expect,test } from '@playwright/test';
import { accountId,providerFixture } from './authFixture';
const initial={contract:1,currency:'virtual-chips',unitsPerChip:100,accountId,status:'active',version:1,availableUnits:123456,atTablesUnits:0,pendingReturnUnits:0};
async function signIn(page:import('@playwright/test').Page){await page.goto('./#/games');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Continue with Google'}).click();await expect(page.getByRole('button',{name:'Account menu for Reward player'})).toBeVisible();}
test('daily allowance claims once, updates the wallet, and recovers a lost response without double credit',async({page},info)=>{
  await providerFixture(page,'google','success','Reward player');let balance=initial.availableUnits;let next:number|null=null;let claims=0;let loseReply=true;
  await page.route('**/api/v1/account/wallet',route=>route.fulfill({json:{...initial,availableUnits:balance}}));
  await page.route('**/api/v1/account/allowance',async route=>{
    let claimed=false;if(route.request().method()==='POST'){
      expect(route.request().postData()).toBeNull();if(next===null){balance+=100000;next=Date.now()+86400000;claims++;claimed=true;}
      if(loseReply){loseReply=false;await route.abort();return;}
    }
    await route.fulfill({json:{contract:1,accountId,amountUnits:100000,cooldownMs:86400000,serverNow:Date.now(),nextEligibleAt:next,canClaim:next===null,claimed,wallet:{...initial,availableUnits:balance}}});
  });
  await signIn(page);const menu=page.getByRole('button',{name:'Account menu for Reward player'});await menu.click();
  await page.getByRole('menuitem',{name:'Claim 1,000 chips',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'Retry allowance'})).toBeVisible();
  await page.getByRole('menuitem',{name:'Retry allowance'}).click();
  await expect(page.getByRole('menuitem',{name:/Available in/})).toBeDisabled();
  await expect(page.getByRole('group',{name:'Account wallet'})).toContainText('2,234.56');expect(claims).toBe(1);
  await page.screenshot({path:info.outputPath('daily-allowance.png')});
  await page.reload();await menu.click();await expect(page.getByRole('menuitem',{name:/Available in/})).toBeDisabled();expect(claims).toBe(1);
});
test('level and game achievements show earned rewards, claim once and stay private to accounts',async({page},info)=>{
  await providerFixture(page,'google','success','Reward player');let claimed=false;let grants=0;
  await page.route('**/api/v1/account/wallet',route=>route.fulfill({json:{...initial,availableUnits:initial.availableUnits+(claimed?110000:0)}}));
  await page.route('**/api/v1/account/progression',async route=>{
    let amount=0;if(route.request().method()==='POST'){expect(route.request().postData()).toBeNull();if(!claimed){claimed=true;grants++;amount=110000;}}
    await route.fulfill({json:{contract:1,accountId,policy:'progress-v1',startsAt:Date.now()-10000,xpPerRound:10,xp:'100',level:2,levelStartXp:'100',nextLevelXp:'300',
      levelRewardUnits:100000,claimedLevel:claimed?2:1,readyRewardUnits:claimed?'0':'110000',claimedUnits:amount,wallet:{...initial,availableUnits:initial.availableUnits+(claimed?110000:0)},
      achievements:[{id:'blackjack:first-round',gameId:'blackjack',name:'First Round',description:'Complete a saved-chip Blackjack round.',rewardUnits:10000,target:1,progress:'10',unlocked:true,claimed}]}});
  });
  await signIn(page);const menu=page.getByRole('button',{name:'Account menu for Reward player'});await menu.click();await page.getByRole('menuitem',{name:'Progress & achievements',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Progress & achievements'});await expect(dialog.getByRole('heading',{name:'Level 2'})).toBeVisible();
  await expect(dialog.getByRole('tabpanel',{name:'Blackjack achievements'})).toContainText('First Round');
  await dialog.getByRole('button',{name:'Claim 1,100 reward chips'}).click();await expect(dialog.getByRole('status')).toHaveText('1,100 chips added to your wallet.');
  await expect(dialog.getByRole('button',{name:'No rewards to claim'})).toBeDisabled();
  await expect(dialog.getByRole('tabpanel',{name:'Blackjack achievements'})).toContainText('Claimed');expect(grants).toBe(1);
  await page.screenshot({path:info.outputPath('progress-achievements.png')});
  await dialog.getByRole('tab',{name:'Crash',exact:true}).click();await expect(dialog.getByRole('tabpanel',{name:'Crash achievements'})).toContainText('when it launches');
  await page.keyboard.press('Escape');await menu.click();await expect(page.getByRole('group',{name:'Account wallet'})).toContainText('2,334.56');
  await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
});
