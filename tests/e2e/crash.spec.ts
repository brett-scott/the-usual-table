import { expect,test,type Page } from '@playwright/test';
import { crashFixture } from './crashFixture';
import { accountId,providerFixture } from './authFixture';

async function open(page:Page,saved=false){
  await page.goto('./#/games/crash');
  if(saved){await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Continue with Google'}).click();await expect(page.getByRole('button',{name:'Account menu for Crash pilot'})).toBeVisible();}
  await page.getByRole('button',{name:'Create a table',exact:true}).click();if(!saved)await page.getByLabel('What should we call you?').fill('Pilot');
  await page.getByRole('button',{name:'Create table',exact:true}).click();await expect(page.locator('[data-phase]')).toHaveAttribute('data-connection','connected');
}
async function fits(page:Page){
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  for(const region of ['Crash game','Crash players','Game controls']){
    const el=page.getByRole('region',{name:region,exact:true});const box=(await el.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize()!.height+1);
    const dims=await el.evaluate(e=>({h:e.clientHeight,sh:e.scrollHeight,w:e.clientWidth,sw:e.scrollWidth}));expect(dims.sh,`${region} content fits`).toBeLessThanOrEqual(dims.h+1);expect(dims.sw).toBeLessThanOrEqual(dims.w+1);
  }
}
test('eight players fit while a manual cash-out, crash result, rules and the next betting window share one screen',async({page},info)=>{
  const fixture=await crashFixture(page,{players:8});await page.emulateMedia({reducedMotion:'no-preference'});await open(page);await fits(page);
  if(info.project.name==='iphone16'){await page.setViewportSize({width:393,height:659});await fits(page);}
  if(info.project.name==='desktop'){for(const size of [{width:1280,height:720},{width:1024,height:768}]){await page.setViewportSize(size);await fits(page);}await page.setViewportSize({width:1440,height:1000});}
  await page.getByRole('button',{name:'Rules',exact:true}).click();await expect(page.getByRole('dialog',{name:'Crash rules'})).toContainText('Crash wins ties');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Start rounds'}).click();await page.getByLabel('Wager (chips)',{exact:true}).fill('100');await page.getByRole('button',{name:'Place bet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Wager locked'})).toBeDisabled();fixture.fly(300);fixture.advance(7000);
  await expect(page.getByRole('button',{name:/^Cash out/})).toBeEnabled();await fits(page);await page.screenshot({path:info.outputPath('crash-eight-players-flight.png')});
  await page.getByRole('button',{name:/^Cash out/}).click();await expect(page.getByRole('button',{name:'Cashed out',exact:true})).toBeDisabled();const returned=fixture.state().players[0]!.returnedUnits;expect(returned).toBeGreaterThan(10000);
  fixture.finish();await expect(page.locator('[data-phase]')).toHaveAttribute('data-phase','results');await fits(page);await page.screenshot({path:info.outputPath('crash-results.png')});
  fixture.advance(5000);await expect(page.getByRole('button',{name:'Place bet',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Leave table',exact:true}).click();await expect(page.getByRole('article',{name:'Crash',exact:true}).getByRole('link')).toBeVisible();expect(fixture.returns()).toBe(1);
});
test('saved Crash entry, automatic payout, reload and Leave use the shared account wallet flow',async({page},info)=>{
  const fixture=await crashFixture(page,{saved:true});await open(page,true);await fits(page);
  expect(fixture.wallet().availableUnits).toBe(900000);await page.getByRole('button',{name:'Start rounds'}).click();
  await page.getByLabel('Wager (chips)',{exact:true}).fill('100');await page.getByLabel('Auto cash-out multiplier').fill('2.00');await page.getByRole('button',{name:'Place bet',exact:true}).click();
  fixture.fly(300);fixture.advance(7000);await expect(page.getByRole('button',{name:'Cashed out',exact:true})).toBeDisabled();
  await page.reload();await expect(page.locator('[data-phase]')).toHaveAttribute('data-connection','connected');expect(fixture.state().players[0]!.returnedUnits).toBe(20000);
  fixture.finish();await expect(page.getByRole('region',{name:'Game controls'})).toContainText('Returned 200 chips at 2.00×');await fits(page);await page.screenshot({path:info.outputPath('crash-saved-result.png')});
  await page.getByRole('button',{name:'Leave table',exact:true}).click();await expect(page.getByRole('heading',{name:'A game for every table.'})).toBeVisible();expect(fixture.wallet()).toMatchObject({availableUnits:1010000,atTablesUnits:0});expect(fixture.returns()).toBe(1);
});
test('real public Crash lobbies invite, share chat, resume and disappear after the final player leaves',async({page,browser})=>{
  const context=await browser.newContext({viewport:page.viewportSize()!});const peer=await context.newPage();
  try{
    await page.goto('./#/games');await page.getByRole('article',{name:'Crash',exact:true}).getByRole('link',{name:'Find a Table',exact:true}).click();await page.getByRole('button',{name:'Create a table',exact:true}).click();
    await page.getByLabel('What should we call you?').fill('Crash host');await page.getByLabel('Table visibility').selectOption('public');await page.getByRole('button',{name:'Create table',exact:true}).click();await expect(page.locator('[data-phase]')).toHaveAttribute('data-connection','connected');const invite=page.url();
    await peer.goto(invite);await peer.getByLabel('What should we call you?').fill('Crash peer');await peer.getByRole('button',{name:'Join table',exact:true}).click();await expect(peer.locator('[data-phase]')).toHaveAttribute('data-connection','connected');
    await expect(page.getByRole('region',{name:'Crash players'}).getByRole('article')).toHaveCount(2);
    if(await page.getByRole('button',{name:/^Table chat/}).isVisible())await page.getByRole('button',{name:/^Table chat/}).click();
    const sender=page.getByRole('region',{name:'Table chat'}).or(page.getByRole('dialog',{name:'Table chat'}));
    await sender.getByRole('textbox').fill('Ready for this flight');await sender.getByRole('button',{name:'Send',exact:true}).click();
    await expect(peer.getByRole('note',{name:'Message from Crash host'})).toContainText('Ready for this flight');
    if(await page.getByRole('button',{name:'Close table chat'}).isVisible())await page.getByRole('button',{name:'Close table chat'}).click();
    await peer.reload();await expect(peer.locator('[data-phase]')).toHaveAttribute('data-connection','connected');await fits(page);await fits(peer);
    await peer.getByRole('button',{name:'Leave table',exact:true}).click();await expect(page.getByRole('region',{name:'Crash players'}).getByRole('article')).toHaveCount(1);
    await page.getByRole('button',{name:'Leave table',exact:true}).click();await peer.goto(invite);await expect(peer.getByRole('heading',{name:'Table expired'})).toBeVisible();
  }finally{await context.close();}
});
test('Crash statistics and game-specific achievements appear in the shared profile and claim once',async({page},info)=>{
  await providerFixture(page,'google','success','Crash pilot');let claimed=false;
  const wallet=()=>({contract:1,currency:'virtual-chips',unitsPerChip:100,accountId,status:'active',version:claimed?2:1,availableUnits:claimed?1045000:1000000,atTablesUnits:0,pendingReturnUnits:0});
  await page.route('**/api/v1/account/wallet',route=>route.fulfill({json:wallet()}));
  const game={gameId:'crash',roundsPlayed:'2',roundsWon:'1',roundsLost:'1',roundsEven:'0',wageredUnits:'2000',returnedUnits:'6000',netUnits:'4000',bestRoundNetUnits:'5000'};
  await page.route('**/api/v1/account/statistics/details*',route=>route.fulfill({json:{accountId,summary:{contract:1,accountId,unitsPerChip:100,basis:'saved-rounds',games:[game]},
    blackjack:{trackedRounds:'0',hands:'0',wins:'0',losses:'0',pushes:'0',blackjacks:'0',busts:'0',doubles:'0',splits:'0',insuranceTaken:'0',insuranceWon:'0'},
    crash:{trackedRounds:'2',cashouts:'1',crashes:'1',highestCashoutCents:'600'}}}));
  await page.route('**/api/v1/account/progression',async route=>{
    let amount=0;if(route.request().method()==='POST'&&!claimed){claimed=true;amount=45000;}
    const definitions=[['crash:first-round','First Round',10000,1,'2'],['crash:first-cashout','First Cash-Out',10000,1,'1'],['crash:five-times','High Flyer',25000,1,'1'],['crash:25-rounds','Frequent Flyer',25000,25,'2']] as const;
    await route.fulfill({json:{contract:1,accountId,policy:'progress-v1',startsAt:1,xpPerRound:10,xp:'20',level:1,levelStartXp:'0',nextLevelXp:'100',levelRewardUnits:100000,claimedLevel:1,readyRewardUnits:claimed?'0':'45000',claimedUnits:amount,wallet:wallet(),
      achievements:definitions.map(([id,name,rewardUnits,target,progress])=>({id,gameId:'crash',name,description:'Complete the saved-chip milestone.',rewardUnits,target,progress,unlocked:Number(progress)>=target,claimed:claimed&&Number(progress)>=target}))}});
  });
  await page.goto('./#/games');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Continue with Google'}).click();const menu=page.getByRole('button',{name:'Account menu for Crash pilot'});await menu.click();await page.getByRole('menuitem',{name:'Statistics',exact:true}).click();
  const stats=page.getByRole('dialog',{name:'Your statistics'});await stats.getByRole('tab',{name:'Crash',exact:true}).click();await expect(stats.getByRole('tabpanel')).toContainText('Highest cash-out6.00×');await page.screenshot({path:info.outputPath('crash-account-statistics.png')});await page.keyboard.press('Escape');
  await menu.click();await page.getByRole('menuitem',{name:'Progress & achievements',exact:true}).click();const progress=page.getByRole('dialog',{name:'Progress & achievements'});await progress.getByRole('tab',{name:'Crash',exact:true}).click();await expect(progress.getByRole('tabpanel')).toContainText('High Flyer');
  await progress.getByRole('button',{name:'Claim 450 reward chips'}).click();await expect(progress.getByRole('button',{name:'No rewards to claim'})).toBeDisabled();await expect(progress).toContainText('450 chips added to your wallet');await page.screenshot({path:info.outputPath('crash-achievements.png')});
});
test('the lobby shows all ten latest crash values newest first without clipping and preserves them on reload',async({page},info)=>{
  const fixture=await crashFixture(page,{players:8});await open(page);
  if(info.project.name==='iphone16')await page.setViewportSize({width:393,height:659});
  const history=page.getByRole('region',{name:'Last 10 Crash results'});
  await expect(history).toContainText('No completed flights in this lobby yet.');await page.getByRole('button',{name:'Start rounds'}).click();
  const points=[125,150,200,300,450,600,800,1000,1200,2500,10000,20000];
  for(let i=0;i<points.length;i++){
    await page.getByRole('button',{name:'Place bet',exact:true}).click();await expect(page.getByRole('button',{name:'Wager locked'})).toBeDisabled();fixture.fly(points[i]!);fixture.finish();
    await expect(page.locator('[data-phase]')).toHaveAttribute('data-phase','results');await expect(history.getByRole('listitem')).toHaveCount(Math.min(10,i+1));
    if(i<points.length-1){fixture.advance(5000);await expect(page.getByRole('button',{name:'Place bet',exact:true})).toBeEnabled();}
  }
  const expected=fixture.state().history.map(h=>`${(h.multiplierCents/100).toFixed(2)}×${h.capped?' ✓':''}`);
  await expect(history.getByRole('listitem')).toHaveText(expected);
  async function checkHistory(){
    await fits(page);const area=(await history.boundingBox())!;
    const readout=(await page.getByLabel('Current multiplier',{exact:true}).locator('..').boundingBox())!;
    expect(area.y,'history stays below the multiplier and countdown').toBeGreaterThanOrEqual(readout.y+readout.height);
    for(const item of await history.getByRole('listitem').all()){
      const box=(await item.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(area.x);expect(box.x+box.width).toBeLessThanOrEqual(area.x+area.width+1);
      expect(box.y).toBeGreaterThanOrEqual(area.y);expect(box.y+box.height).toBeLessThanOrEqual(area.y+area.height+1);
      const size=await item.evaluate(e=>({width:e.clientWidth,content:e.scrollWidth}));expect(size.content).toBeLessThanOrEqual(size.width+1);
    }
  }
  await checkHistory();await page.screenshot({path:info.outputPath('crash-last-ten-results.png')});
  await page.reload();await expect(page.locator('[data-phase]')).toHaveAttribute('data-connection','connected');await expect(history.getByRole('listitem')).toHaveText(expected);await checkHistory();
  if(info.project.name==='desktop')for(const size of [{width:1280,height:720},{width:1024,height:768}]){await page.setViewportSize(size);await checkHistory();}
});
test('confirmed flight values cannot overshoot a delayed crash while the graph stays visible with reduced motion',async({page},info)=>{
  const fixture=await crashFixture(page,{players:8});await page.emulateMedia({reducedMotion:'reduce'});await open(page);
  if(info.project.name==='iphone16')await page.setViewportSize({width:393,height:659});
  await page.getByRole('button',{name:'Start rounds'}).click();const timer=page.getByRole('timer',{name:'Betting countdown'});
  await expect(timer).toContainText('10s');expect((await timer.locator('strong').boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await page.getByRole('button',{name:'Place bet',exact:true}).click();fixture.advance(7000);await expect(timer).toContainText('3s');await expect(timer).toHaveAttribute('data-urgent','true');
  const graph=page.getByRole('img',{name:'Crash flight graph'});await expect(graph).toBeVisible();const area=(await graph.boundingBox())!;expect(area.width).toBeGreaterThan(80);expect(area.height).toBeGreaterThan(40);
  await fits(page);await page.screenshot({path:info.outputPath('crash-prominent-countdown.png')});
  fixture.fly(298);fixture.advance(10900);const multiplier=page.getByLabel('Current multiplier',{exact:true});await expect(multiplier).toHaveText('2.97×');
  await page.evaluate(()=>{
    const node=document.querySelector('[aria-label="Current multiplier"]')!;const seen:string[]=[];
    (window as unknown as {crashSeen:string[]}).crashSeen=seen;new MutationObserver(()=>{seen.push(node.textContent??'');}).observe(node,{childList:true,characterData:true,subtree:true});
  });
  fixture.holdUpdates();fixture.finish();await page.clock.install();await page.clock.fastForward(5000);
  await expect(multiplier).toHaveText('2.97×');await expect(graph).toHaveAttribute('data-confirmed-cents','297');
  fixture.resumeUpdates();await expect(multiplier).toHaveText('2.98×');await expect(graph).toHaveAttribute('data-confirmed-cents','298');
  const seen=await page.evaluate(()=>(window as unknown as {crashSeen:string[]}).crashSeen);
  expect(seen.length).toBeGreaterThan(0);for(const value of seen)expect(Number.parseFloat(value)).toBeLessThanOrEqual(2.98);
  await fits(page);await page.screenshot({path:info.outputPath('crash-confirmed-result-reduced-motion.png')});
});
test('the flight curves smoothly and zooms out continuously as confirmed samples arrive',async({page},info)=>{
  test.setTimeout(60000);const fixture=await crashFixture(page,{players:8});await page.clock.install();await page.emulateMedia({reducedMotion:'no-preference'});await open(page);
  if(info.project.name==='iphone16')await page.setViewportSize({width:393,height:659});
  await page.getByRole('button',{name:'Start rounds'}).click();await page.getByRole('button',{name:'Place bet',exact:true}).click();fixture.fly(20000);
  await expect(page.locator('[data-phase]')).toHaveAttribute('data-phase','running');
  await page.evaluate(()=>{
    const frames:{at:number;x:number;y:number;cents:number;maxTime:number;maxValue:number}[]=[];
    const recording={active:true,frames};(window as unknown as {crashAnimation:typeof recording}).crashAnimation=recording;
    const sample=()=>{const graph=document.querySelector('svg[data-rendered-cents]');const path=graph?.querySelector('[data-flight-line]') as SVGPathElement|null;
      if(graph&&path){const tip=path.getPointAtLength(path.getTotalLength());frames.push({at:performance.now(),x:tip.x,y:tip.y,cents:Number(graph.getAttribute('data-rendered-cents')),maxTime:Number(graph.getAttribute('data-time-domain')),maxValue:Number(graph.getAttribute('data-multiplier-domain'))});}
      if(recording.active)requestAnimationFrame(sample);};requestAnimationFrame(sample);
  });
  for(let i=0;i<80;i++){await page.clock.runFor(250);fixture.advance(250);await expect(page.locator('[data-revision]')).toHaveAttribute('data-revision',String(fixture.state().revision));}
  const frames=await page.evaluate(()=>{const recording=(window as unknown as {crashAnimation:{active:boolean;frames:{at:number;x:number;y:number;cents:number;maxTime:number;maxValue:number}[]}}).crashAnimation;recording.active=false;return recording.frames;});
  expect(frames.length).toBeGreaterThan(500);expect(new Set(frames.map(f=>f.cents.toFixed(4))).size).toBeGreaterThan(240);expect(frames.some(f=>!Number.isInteger(f.cents))).toBe(true);
  const ceiling=fixture.state().progress!.multiplierCents;
  for(let i=1;i<frames.length;i++){
    const before=frames[i-1]!;const after=frames[i]!;const dt=after.at-before.at;
    expect(after.cents).toBeGreaterThanOrEqual(before.cents);expect(after.cents).toBeLessThanOrEqual(ceiling);
    expect(after.maxTime).toBeGreaterThanOrEqual(before.maxTime);expect(after.maxValue).toBeGreaterThanOrEqual(before.maxValue);
    expect(Math.hypot(after.x-before.x,after.y-before.y),`curve endpoint must not jump when the camera scale expands: ${JSON.stringify({before,after})}`).toBeLessThanOrEqual(Math.max(3,dt*.15));
  }
  await fits(page);await page.screenshot({path:info.outputPath('crash-smooth-zoom.png')});
  fixture.holdUpdates();await page.clock.runFor(1000);const graph=page.getByRole('img',{name:'Crash flight graph'});const stopped=await graph.getAttribute('data-rendered-cents');await page.clock.runFor(3000);await expect(graph).toHaveAttribute('data-rendered-cents',stopped!);
});
