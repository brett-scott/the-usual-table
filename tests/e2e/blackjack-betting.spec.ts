import {expect,test} from '@playwright/test';
import {expectOneScreen,openTableEntry,rigShoe} from './fixtures';
test('Blackjack chip targets stack, undo, clear and settle Perfect Pairs beside a losing main hand',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});await rigShoe(page,['8','10','8','7']);
  await openTableEntry(page);await page.getByLabel('What should we call you?').fill('Pair player');await page.keyboard.press('Enter');
  const main=page.getByRole('button',{name:'Bet on Blackjack',exact:true}),pair=page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true});
  await page.getByRole('button',{name:'Clear bets',exact:true}).click();await expect(main).toHaveAttribute('data-amount','0');await expect(page.getByRole('button',{name:'Deal me in'})).toBeDisabled();
  await pair.click();await expect(page.getByRole('alert')).toContainText('main bet');await main.click();await pair.click();await pair.click();await expect(pair).toHaveAttribute('data-amount','40');
  await page.getByRole('button',{name:/Undo/}).click();await expect(pair).toHaveAttribute('data-amount','20');await expect(main).toHaveAttribute('data-amount','20');await expectOneScreen(page);
  await page.screenshot({path:info.outputPath('blackjack-chip-betting.png')});await page.getByRole('button',{name:'Deal me in'}).click();
  await expect(pair).toHaveCount(0);
  await expect(page.getByRole('region',{name:/Seat \d empty/})).toHaveCount(0);
  await expect(page.getByRole('group',{name:'Committed wagers'})).toContainText('Perfect Pairs 10');
  await expect(page.getByRole('button',{name:'Stand',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Stand',exact:true}).click();
  const results=page.getByRole('list',{name:'Wager results',exact:true});
  await expect(results.getByRole('listitem').filter({hasText:'Main lost'})).toContainText('−10');
  await expect(results.getByRole('listitem').filter({hasText:'Perfect Pairs'})).toContainText('+60');
  await expect(page.getByRole('heading',{name:'Round won · +50 chips'})).toBeVisible();
  await expectOneScreen(page);await page.screenshot({path:info.outputPath('blackjack-perfect-pairs-result.png')});
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
  const pair=page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true});
  const pairResult=page.getByRole('listitem').filter({hasText:'Perfect Pairs'});
  await expect(pairResult).toContainText('−10');
  await page.getByRole('button',{name:'Refill to 1,000',exact:true}).click();
  await expect(pairResult).toContainText('−10');await expectOneScreen(page);
  await page.getByRole('button',{name:'Next round',exact:true}).click();await expect(pair).toHaveAttribute('data-amount','0');await expect(page.getByRole('button',{name:'Deal me in'})).toBeEnabled();
});

test('each split outcome is visible beside the round net without switching cards', async ({page}, info) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await rigShoe(page,['8','10','8','7','A','5']);
  await openTableEntry(page);
  await page.getByLabel('What should we call you?').fill('Split result');
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Bet on Perfect Pairs',exact:true}).click();
  await page.getByRole('button',{name:'Deal me in'}).click();
  await page.getByRole('button',{name:'Split',exact:true}).click();
  await page.getByRole('button',{name:'Stand',exact:true}).click();
  await page.getByRole('button',{name:'Stand',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Round won · +60 chips'})).toBeVisible();
  const results=page.getByRole('list',{name:'Wager results',exact:true});
  for(const [label,net] of [['Hand 1 won','+10'],['Hand 2 lost','−10'],['Perfect Pairs','+60']] as const) {
    const result=results.getByRole('listitem').filter({hasText:label});
    await expect(result).toBeVisible();
    await expect(result).toContainText(net);
  }
  await expectOneScreen(page);
  await page.screenshot({path:info.outputPath('blackjack-split-result.png')});
});

const mainBetScenarios = [
  { result: 'push', ranks: ['10', '10', '7', '7'], heading: 'Push · stake returned', stack: '1,000', returned: 10 },
  { result: 'win', ranks: ['10', '10', '8', '7'], heading: 'Round won · +10 chips', stack: '1,010', returned: 20 },
  { result: 'loss', ranks: ['10', '10', '6', '7'], heading: 'Round lost · −10 chips', stack: '990', returned: 0 },
  { result: 'blackjack', ranks: ['A', '10', 'K', '7'], heading: 'Round won · +15 chips', stack: '1,015', returned: 25 },
];

for (const { result, ranks, heading, stack, returned } of mainBetScenarios) {
  test(`a fixed ${result} deal shows the main bet result and the returned chips`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await rigShoe(page, ranks);
    await openTableEntry(page);
    await page.getByLabel('What should we call you?').fill('Result player');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Deal me in', exact: true }).click();
    if (result !== 'blackjack') await page.getByRole('button', { name: 'Stand', exact: true }).click();

    const controls = page.getByRole('region', { name: 'Game controls', exact: true });
    await expect(controls.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(controls).toContainText(`Table stack ${stack} chips`);
    await expect(page.getByRole('group', { name: `Wager 10 chips, returned ${returned} chips`, exact: true })).toBeVisible();
    await expectOneScreen(page);
  });
}
