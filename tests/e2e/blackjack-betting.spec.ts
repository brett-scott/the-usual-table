import {expect,test} from '@playwright/test';
import {expectOneScreen,openTableEntry,rigShoe} from './fixtures';
test('Blackjack chip targets stack, undo, clear and settle Perfect Pairs beside a losing main hand',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});await rigShoe(page,['8','10','8','7']);
  await openTableEntry(page);await page.getByLabel('What should we call you?').fill('Pair player');await page.keyboard.press('Enter');
  const main=page.getByRole('button',{name:'Bet on Blackjack',exact:true}),pair=page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true});
  await page.getByRole('button',{name:'Clear bets',exact:true}).click();await expect(main).toHaveAttribute('data-amount','0');await expect(page.getByRole('button',{name:'Deal me in'})).toBeDisabled();
  await pair.click();await expect(page.getByRole('alert')).toContainText('main bet');await main.click();await pair.click();await pair.click();await expect(pair).toHaveAttribute('data-amount','40');
  await page.getByRole('button',{name:/Undo/}).click();await expect(pair).toHaveAttribute('data-amount','20');await expect(main).toHaveAttribute('data-amount','20');await expectOneScreen(page);
  await page.screenshot({path:info.outputPath('blackjack-chip-betting.png')});await page.getByRole('button',{name:'Deal me in'}).click();await expect(pair).toBeDisabled();
  await expect(page.getByRole('button',{name:'Stand',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Stand',exact:true}).click();
  await expect(main).toHaveAttribute('data-result','loss');await expect(pair).toHaveAttribute('data-result','win');await expect(pair).toContainText('mixed pair · +60');
  await expect(page.getByRole('region',{name:'Your seat'})).toContainText('+50 chips');await expectOneScreen(page);await page.screenshot({path:info.outputPath('blackjack-perfect-pairs-result.png')});
  await page.getByRole('button',{name:'Next round',exact:true}).click();await expect(pair).toHaveAttribute('data-amount','0');
});
test('Blackjack permits a 1,000-chip main wager and prevents exceeding the target or stack',async({page})=>{
  await rigShoe(page,['10','10','7','8']);await openTableEntry(page);await page.getByLabel('What should we call you?').fill('Big chip');await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Clear bets',exact:true}).click();await page.getByRole('button',{name:'Select 1,000 chips',exact:true}).click();const main=page.getByRole('button',{name:'Bet on Blackjack',exact:true});await main.click();await expect(main).toHaveAttribute('data-amount','2000');await main.click();await expect(page.getByRole('alert')).toContainText('maximum');
  await page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Not enough');await expectOneScreen(page);
});
test('temporary refill preserves results until the next hand and clears the side wager',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await rigShoe(page,['8','10','7','7']);await openTableEntry(page);await page.getByLabel('What should we call you?').fill('Refill player');await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true}).click();await page.getByRole('button',{name:'Max Bet',exact:true}).click();await page.getByRole('button',{name:'Deal me in'}).click();await page.getByRole('button',{name:'Stand',exact:true}).click();
  const pair=page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true});await expect(pair).toHaveAttribute('data-result','loss');await page.getByRole('button',{name:'Refill to 1,000',exact:true}).click();await expect(pair).toHaveAttribute('data-amount','20');await expectOneScreen(page);
  await page.getByRole('button',{name:'Next round',exact:true}).click();await expect(pair).toHaveAttribute('data-amount','0');await expect(page.getByRole('button',{name:'Deal me in'})).toBeEnabled();
});
