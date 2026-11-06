import { expect,it } from 'vitest';
import { appendBaccaratResult,emptyBaccaratRoadmap,seedBaccaratRoadmap,validBaccaratRoadmap,BACCARAT_HISTORY_LIMIT,type BaccaratResult } from '@casual/protocol';
import { beadPlate,bigRoad } from './baccaratRoadmap';
function rounds(sides:string[]):BaccaratResult[]{return sides.map((side,i)=>({roundId:i+1,outcome:side as BaccaratResult['outcome'],playerTotal:side==='player'?8:6,bankerTotal:side==='banker'?8:6})).reverse();}
it('fills the Bead Plate down six rows before opening another column, including ties',()=>{
 const cells=beadPlate(rounds(['banker','player','tie','banker','tie','player','banker']));expect(cells.map(c=>[c.column,c.row])).toEqual([[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[1,0]]);expect(cells.map(c=>c.result.roundId)).toEqual([1,2,3,4,5,6,7]);
});
it('attaches consecutive and leading ties to decisions without starting new streak columns',()=>{
 const cells=bigRoad(rounds(['tie','tie','banker','tie','banker','player','tie','tie']));expect(cells.map(c=>[c.column,c.row,c.ties,c.result.outcome])).toEqual([[0,0,3,'banker'],[0,1,0,'banker'],[1,0,2,'player']]);
 expect(bigRoad(rounds(['tie','tie']))).toMatchObject([{column:0,row:0,ties:2,leadingTie:true}]);expect(bigRoad([])).toEqual([]);
});
it('turns six-row dragon tails right and starts the next color at the top of the next streak column',()=>{
 const cells=bigRoad(rounds([...Array<string>(9).fill('banker'),...Array<string>(8).fill('player'),'banker']));expect(cells.slice(0,9).map(c=>[c.column,c.row])).toEqual([[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[1,5],[2,5],[3,5]]);expect(cells[9]).toMatchObject({column:1,row:0});expect(cells[14]).toMatchObject({column:2,row:4});expect(cells.at(-1)).toMatchObject({column:2,row:0});expect(new Set(cells.map(c=>`${c.column}:${c.row}`)).size).toBe(cells.length);
});
it('never overlaps cells or exceeds six rows across repeated streaks and ties',()=>{
 let random=17;for(let run=0;run<40;run++){const sequence=Array.from({length:300},()=>{random=(random*16807)%2147483647;return ['banker','player','tie'][random%3]!;});const cells=bigRoad(rounds(sequence));expect(new Set(cells.map(c=>`${c.column}:${c.row}`)).size).toBe(cells.length);expect(cells.every(c=>c.row>=0&&c.row<6&&c.column>=0)).toBe(true);expect(cells.filter(c=>!c.leadingTie).length+cells.reduce((sum,c)=>sum+c.ties,0)).toBe(300);}
});
it('counts completed outcomes and streaks once, with ties excluded from decision streaks',()=>{
 const values=rounds(['banker','tie','banker','banker','player','tie','player']);values[values.length-1]!.bankerTotal=6;values[values.length-1]!.playerTotal=5;
 const data=seedBaccaratRoadmap(values);expect(data).toMatchObject({completedHands:7,bankerWins:3,playerWins:2,ties:2,bankerSixWins:1,currentSide:'player',currentStreak:2,longestBankerStreak:3,longestPlayerStreak:2});expect(validBaccaratRoadmap(data)).toBe(true);expect(appendBaccaratResult(data,values[0]!)).toBe(data);expect(()=>appendBaccaratResult(data,values[1]!)).toThrow('order');
});
it('retains cumulative counts beyond the 300 plotted rounds and makes coverage of legacy history explicit',()=>{
 let data=emptyBaccaratRoadmap();for(const result of rounds(Array<string>(350).fill('banker')).reverse())data=appendBaccaratResult(data,result);
 expect(data).toMatchObject({firstRoundId:1,completedHands:350,bankerWins:350,currentStreak:350,longestBankerStreak:350});expect(data.results).toHaveLength(BACCARAT_HISTORY_LIMIT);expect(data.results.at(-1)!.roundId).toBe(51);expect(validBaccaratRoadmap(data)).toBe(true);
 const legacy=seedBaccaratRoadmap(data.results.slice(0,20));expect(legacy).toMatchObject({firstRoundId:331,completedHands:20});expect(validBaccaratRoadmap(legacy)).toBe(true);
 const corrupt={...data,bankerWins:349};expect(validBaccaratRoadmap(corrupt)).toBe(false);
});
it('retains a decision streak through more than 300 ties',()=>{
 const data=seedBaccaratRoadmap(rounds(['banker',...Array<string>(310).fill('tie')]));expect(data).toMatchObject({currentSide:'banker',currentStreak:1,ties:310});expect(validBaccaratRoadmap(data)).toBe(true);
});
