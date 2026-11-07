import {expect,it} from 'vitest';
import {close,connect,create,edit,inspect,rigShoe} from './helpers';
import {restoreRoom} from '../src/roomStorage';
it('shares full wagers, locks Ready, retains pair evaluation on restore and settles replay safely',async()=>{
 const guest=await create('Pair player'),peer=await connect(guest.session);
 try{
  await rigShoe(guest.session.inviteId,['8','10','8','7']);await peer.send({type:'StartBetting'});
  expect(await peer.send({type:'PlaceBet',amount:2000,perfectPairsAmount:20})).toMatchObject({type:'error',code:'INSUFFICIENT_FUNDS'});
  expect(await peer.send({type:'PlaceBet',amount:20,perfectPairsAmount:20})).toMatchObject({type:'ack'});
  await peer.send({type:'Ready'});const inPlay=await peer.last();expect(inPlay.players[0]!.perfectPairs).toEqual({wager:20});expect(inPlay.legalActions).not.toContain('PlaceBet');
  const stored=await inspect(guest.session.inviteId,room=>room);expect(restoreRoom(stored,Date.now()).room.engine.players[0]!.perfectPairsRound?.kind).toBe('mixed');
  const damaged=structuredClone(stored);damaged.engine.players[0]!.perfectPairsRound!.kind='perfect';expect(()=>restoreRoom(damaged,Date.now())).toThrow();
  const id=crypto.randomUUID();await peer.send({type:'Stand'},{id});const done=await peer.last();expect(done.players[0]!.perfectPairs).toEqual({wager:20,kind:'mixed',returned:140});expect(done.players[0]!.roundResult).toEqual({net:100,outcome:'won'});
  expect(await peer.send({type:'Stand'},{id})).toMatchObject({type:'ack'});expect((await peer.last()).players[0]!.balance).toBe(done.players[0]!.balance);
 }finally{await close(peer);}
});
it('retains the settled side-bet record when temporary chips are refilled before Next round',async()=>{
 const guest=await create('Refill player'),peer=await connect(guest.session);
 try{
  await rigShoe(guest.session.inviteId,['8','10','7','7']);await edit(guest.session.inviteId,room=>{room.engine.players[0]!.balance=40;});
  await peer.send({type:'StartBetting'});await peer.send({type:'PlaceBet',amount:20,perfectPairsAmount:20});await peer.send({type:'Ready'});await peer.send({type:'Stand'});
  expect((await peer.last()).players[0]!.balance).toBe(0);expect(await peer.send({type:'Refill'})).toMatchObject({type:'ack'});
  const stored=await inspect(guest.session.inviteId,room=>room);expect(restoreRoom(stored,Date.now()).room.engine.players[0]!.perfectPairsRound).toMatchObject({wager:20,kind:'none',returned:0});
  await peer.send({type:'NextRound'});expect((await peer.last()).players[0]!.perfectPairs).toEqual({wager:0});
 }finally{await close(peer);}
});
