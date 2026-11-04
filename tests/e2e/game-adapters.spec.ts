import { expect,test } from '@playwright/test';
import { openTableEntry } from './fixtures';
import { BLACKJACK_TABLE_RULES,tableInfoSchema } from '@casual/protocol';
test('game-scoped creation, private metadata and tagged commands use the shared flow',async({page,request,baseURL})=>{
  const paths:string[]=[];const frames:{type:string;gameId?:string;adapterVersion?:number}[]=[];let tampered=false;
  page.on('request',request=>{if(request.method()==='POST')paths.push(new URL(request.url()).pathname);});
  page.on('websocket',socket=>socket.on('framereceived',event=>{frames.push(JSON.parse(String(event.payload)));}));
  await page.routeWebSocket('**/api/v1/rooms/*/socket',socket=>{
    const upstream=socket.connectToServer();socket.onMessage(raw=>{
      if(String(raw).startsWith('{')){
        const value=JSON.parse(String(raw));
        if(!tampered&&value.type==='game-command'&&value.command.action.type==='StartBetting'){
          tampered=true;upstream.send(JSON.stringify({...value,gameId:'roulette'}));return;
        }
      }
      upstream.send(raw);
    });
  });
  await openTableEntry(page);await page.getByLabel('What should we call you?').fill('Shared flow');await page.getByRole('button',{name:'Create table',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open betting'})).toBeEnabled();
  expect(paths).toContain('/api/v1/games/blackjack/rooms');
  await expect.poll(()=>frames.some(frame=>frame.type==='game-snapshot'&&frame.gameId==='blackjack'&&frame.adapterVersion===1)).toBe(true);
  const id=new URL(page.url()).hash.split('/').at(-1)!;
  const metadata=await request.get(`http://127.0.0.1:${process.env.E2E_API_PORT||8787}/api/v1/rooms/${id}/info`,{headers:{Origin:new URL(baseURL!).origin}});
  expect(metadata.status()).toBe(200);const info=tableInfoSchema.parse(await metadata.json());expect(info).toMatchObject({...BLACKJACK_TABLE_RULES,roomId:id,gameId:'blackjack',adapterVersion:1});
  for(const hidden of ['engine','players','members','wallet','credential'])expect(info).not.toHaveProperty(hidden);
  await page.getByRole('button',{name:'Open betting'}).click();
  await expect(page.getByRole('alert')).toContainText('different game');await expect(page.getByRole('button',{name:'Open betting'})).toBeEnabled();expect(tampered).toBe(true);
  await page.getByRole('button',{name:'Open betting'}).click();await expect(page.getByRole('button',{name:/^Ready/})).toBeEnabled();
  await page.getByRole('button',{name:'Leave table',exact:true}).click();await expect(page.getByRole('article',{name:'Blackjack',exact:true}).getByRole('link', { name: 'Find a Table', exact: true })).toBeVisible();
});
test('future game routes stay unavailable until their engine and entry are registered',async({page,request,baseURL})=>{
  await page.goto('./#/games/baccarat');await expect(page.getByRole('heading',{name:'This game is coming soon.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create a table',exact:true})).toHaveCount(0);
  const response=await request.post(`http://127.0.0.1:${process.env.E2E_API_PORT||8787}/api/v1/games/baccarat/rooms`,{headers:{Origin:new URL(baseURL!).origin},data:{name:'No engine'}});
  expect(response.status()).toBe(400);expect(await response.json()).toMatchObject({code:'GAME_UNAVAILABLE'});
});
for(const unsupported of [{gameId:'baccarat',adapterVersion:7},{gameId:'blackjack',adapterVersion:99}])test(`an unsupported ${unsupported.gameId} adapter ${unsupported.adapterVersion} invitation never uses Blackjack entry`,async({page})=>{
  const roomId='d'.repeat(32);await page.route('**/api/v1/rooms/*/info',route=>route.fulfill({json:{...BLACKJACK_TABLE_RULES,roomId,visibility:'private',...unsupported}}));
  await page.goto(`./#/room/${roomId}`);await expect(page.getByRole('heading',{name:'Table unavailable'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Join table',exact:true})).toHaveCount(0);
});
