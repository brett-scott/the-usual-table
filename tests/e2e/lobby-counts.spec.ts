import {expect,test} from '@playwright/test';
import {GAME_CATALOG} from '@casual/protocol';
const games=GAME_CATALOG.filter(game=>game.status==='available');
test('gallery counts refresh without hiding games, pause behind table dialogs and recover from service failures',async({page},info)=>{
  await page.clock.install();let requests=0,revision=0,mode:'ready'|'offline'|'incomplete'='ready';
  await page.route('**/api/v1/games/lobby-counts',async route=>{
    requests++;if(mode==='offline'){await route.abort();return;}
    await route.fulfill({json:{counts:games.slice(0,mode==='incomplete'?1:games.length).map((game,index)=>({gameId:game.id,count:index+revision}))}});
  });
  await page.route('**/api/v1/games/blackjack/lobbies',route=>route.fulfill({json:{gameId:'blackjack',lobbies:[]}}));
  await page.goto('./#/games');
  for(let index=0;index<games.length;index++)await expect(page.getByRole('article',{name:games[index]!.name,exact:true})).toContainText(`${index} open ${index===1?'table':'tables'}`);
  await page.screenshot({path:info.outputPath('gallery-lobby-counts.png')});
  const blackjack=page.getByRole('article',{name:'Blackjack',exact:true}),link=blackjack.getByRole('link',{name:'Find a Table',exact:true});
  revision=1;await page.clock.fastForward(15000);await expect(blackjack).toContainText('1 open table');
  await link.click();await expect(page.getByRole('dialog',{name:'Find a Table',exact:true})).toBeVisible();const before=requests;
  await page.clock.fastForward(30000);expect(requests).toBe(before);
  await page.keyboard.press('Escape');await expect(link).toBeFocused();await expect.poll(()=>requests).toBeGreaterThan(before);
  mode='offline';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(blackjack).toContainText('Tables unavailable');await expect(blackjack).not.toContainText('0 open tables');
  mode='incomplete';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>requests).toBeGreaterThan(before+2);await expect(blackjack).toContainText('Tables unavailable');
  mode='ready';revision=0;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(blackjack).toContainText('0 open tables');
  await link.click();await expect(page.getByRole('button',{name:'Create a table',exact:true})).toBeEnabled();
});
