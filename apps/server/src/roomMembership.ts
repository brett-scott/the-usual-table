import { GameError } from '@casual/engine';
import type { HostedRoom } from './games/contracts';
export const RESERVATION_MS=60_000;
export const PRESENCE_MS=30_000;
export const ROOM_IDLE_MS=24*60*60*1000;
export interface Member {
  hash:string;connected:boolean;controllerId:string|null;leaveAfterRound:boolean;
  reservationDeadline:number|null;presenceDeadline:number|null;claimId:string|null;claimVersion:number;retiredClaims:string[];
  account?:{id:string;expiresAt:number};
}
export function newMember(hash:string,now:number):Member {
  return {hash,connected:false,controllerId:null,leaveAfterRound:false,reservationDeadline:now+RESERVATION_MS,presenceDeadline:null,claimId:null,claimVersion:0,retiredClaims:[]};
}
export function assertRule(value:unknown,code:string,message:string):asserts value {if(!value)throw new GameError(code,message);}
export function disconnectMember(room:HostedRoom,playerId:string,now:number) {
  const member=room.members[playerId];if(!member?.connected)return false;
  member.connected=false;member.presenceDeadline=null;member.reservationDeadline=member.leaveAfterRound?null:now+RESERVATION_MS;
  room.lastActivity=Math.max(room.lastActivity,now);return true;
}
