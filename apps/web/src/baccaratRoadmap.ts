import type { BaccaratResult } from '@casual/protocol';
export interface RoadCell {column:number;row:number;result:BaccaratResult;ties:number;leadingTie:boolean}
/** Bead Plate reads top-to-bottom, then left-to-right, including every tie. Input is newest first. */
export function beadPlate(results:readonly BaccaratResult[]):RoadCell[]{return [...results].reverse().map((result,i)=>({column:Math.floor(i/6),row:i%6,result,ties:0,leadingTie:false}));}
/** Six-row Big Road: decisions form streaks, dragon tails turn right, ties stay on the last decision. */
export function bigRoad(results:readonly BaccaratResult[]):RoadCell[]{
  const cells:RoadCell[]=[];const occupied=new Set<string>();let side:'player'|'banker'|null=null;let start=-1;let tail=false;
  for(const result of [...results].reverse()){
    const last=cells.at(-1);
    if(result.outcome==='tie'){
      if(last)last.ties++;else cells.push({column:0,row:0,result,ties:1,leadingTie:true});
      continue;
    }
    let column:number;let row:number;
    if(side===null){column=0;row=0;if(last?.leadingTie){last.result=result;last.leadingTie=false;side=result.outcome;start=0;occupied.add('0:0');continue;}}
    else if(side!==result.outcome){column=start+1;row=0;while(occupied.has(`${column}:0`))column++;tail=false;}
    else if(!tail&&last!.row<5&&!occupied.has(`${last!.column}:${last!.row+1}`)){column=last!.column;row=last!.row+1;}
    else{column=last!.column+1;row=last!.row;tail=true;while(occupied.has(`${column}:${row}`))column++;}
    if(side!==result.outcome)start=column;
    side=result.outcome;occupied.add(`${column}:${row}`);cells.push({column,row,result,ties:0,leadingTie:false});
  }return cells;
}
