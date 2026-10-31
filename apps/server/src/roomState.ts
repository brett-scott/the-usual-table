import { createRoom, expireDecision, GameError, project, transition, type RandomIndex, type RoomState } from '@casual/engine';
import { RESULTS_DURATION_MS, resultsRevealDelay, type LobbyVisibility, type PlayerIcon, type Action, type ActionType, type Command, type Snapshot } from '@casual/protocol';
import { recordWalletRound, sealWalletSeat, walletActions, walletHasFunds, type RoomWallet } from './roomWallet';

export const RESERVATION_MS = 60_000;
export const PRESENCE_MS = 30_000;
export const ROOM_IDLE_MS = 24 * 60 * 60 * 1000;
export interface Member {
  hash: string; connected: boolean; controllerId: string | null; leaveAfterRound: boolean;
  reservationDeadline: number | null; presenceDeadline: number | null;
  claimId: string | null; claimVersion: number; retiredClaims: string[];
}
export interface OnlineRoom {
  schema: 2 | 3; id: string; revision: number; managerId: string; engine: RoomState;
  wallet?: RoomWallet;
  members: Record<string, Member>; locked: Record<string, 'ready' | 'out'>;
  bettingDeadline: number | null; insuranceDeadline: number | null; lastActivity: number;
  roundDeadline?: number | null;
  gameId?: 'blackjack'; visibility?: LobbyVisibility;
  tickets: { hash: string; playerId: string; expires: number; claimId: string; claimVersion: number }[];
  receipts: { id: string; playerId: string; revision: number }[];
  commandRates: Record<string, { start: number; count: number }>;
}
export function newMember(hash: string, now: number): Member {
  return { hash, connected: false, controllerId: null, leaveAfterRound: false, reservationDeadline: now + RESERVATION_MS, presenceDeadline: null, claimId: null, claimVersion: 0, retiredClaims: [] };
}
export function assertRule(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new GameError(code, message);
}
export function newRoom(id: string, playerId: string, name: string, hash: string, random: RandomIndex, now: number, icon?: PlayerIcon): OnlineRoom {
  const engine = createRoom(name, random, now, icon); engine.players[0]!.id = playerId;
  return { schema: 2, id, revision: 0, managerId: playerId, engine,
    members: { [playerId]: newMember(hash, now) },
    locked: {}, bettingDeadline: null, insuranceDeadline: null, roundDeadline: null, lastActivity: now, tickets: [], receipts: [], commandRates: {} };
}
export function resultsDeadline(room: OnlineRoom) {
  return room.engine.phase === 'ROUND_COMPLETE' ? room.roundDeadline === undefined ? room.engine.updatedAt + RESULTS_DURATION_MS : room.roundDeadline : null;
}
function core(room: OnlineRoom, playerId: string, action: Action, random: RandomIndex, now: number, handId?: string) {
  const wasComplete = room.engine.phase === 'ROUND_COMPLETE'; const deadline = resultsDeadline(room);
  const before = project(room.engine, playerId);
  room.engine = transition(room.engine, { protocol: 1, id: `core-${room.revision}-${room.engine.revision}`, revision: room.engine.revision, roundId: room.engine.roundId, playerId, handId, action }, random, now);
  recordWalletRound(room);
  room.roundDeadline = room.engine.phase === 'ROUND_COMPLETE' ? wasComplete ? deadline : now + resultsRevealDelay(before, project(room.engine, playerId)) + RESULTS_DURATION_MS : null;
  if (room.engine.phase === 'INSURANCE' && room.insuranceDeadline === null) room.insuranceDeadline = now + 15_000;
  if (room.engine.phase !== 'INSURANCE') room.insuranceDeadline = null;
}
function dealLocked(room: OnlineRoom, random: RandomIndex, now: number) {
  room.bettingDeadline = null;
  for (const p of room.engine.players) if (room.locked[p.id] !== 'ready') p.bet = 0;
  const first = room.engine.players.find(p => room.locked[p.id] === 'ready');
  if (first) core(room, first.id, { type: 'Ready' }, random, now);
  room.locked = {};
}
function openBetting(room: OnlineRoom, now: number) {
  room.bettingDeadline = now + 30_000; room.locked = {};
  for (const p of room.engine.players) {
    if (p.balance >= 20 && p.bet < 20) p.bet = 20;
    if (!room.members[p.id]!.connected || p.balance < 20 || room.members[p.id]!.leaveAfterRound) room.locked[p.id] = 'out';
  }
}
function baseRoomActions(room: OnlineRoom, playerId: string): ActionType[] {
  const p = room.engine.players.find(p => p.id === playerId);
  if (!p || room.members[playerId]?.leaveAfterRound) return [];
  const actions: ActionType[] = ['Leave'];
  if (room.engine.phase === 'BETTING') {
    if (p.balance < 20) actions.push('Refill');
    if (room.bettingDeadline === null) { if (playerId === room.managerId) actions.push('StartBetting'); }
    else if (!room.locked[playerId]) {
      actions.push('PlaceBet', 'SitOut');
      if (p.bet >= 20 && p.balance >= p.bet) actions.push('Ready');
    }
    return actions;
  }
  if (room.engine.phase === 'ROUND_COMPLETE') {
    if (playerId === room.managerId) actions.push('NextRound');
    if (p.balance < 20) actions.push('Refill');
    return actions;
  }
  return [...actions, ...project(room.engine, playerId).legalActions];
}
export function roomActions(room: OnlineRoom, playerId: string): ActionType[] {
  return walletActions(room, playerId, baseRoomActions(room, playerId));
}
export function roomSnapshot(room: OnlineRoom, playerId: string): Snapshot {
  assertRule(room.members[playerId], 'SESSION_INVALID', 'Your guest session is no longer valid.');
  const snapshot = project(room.engine, playerId);
  return { ...snapshot, revision: room.revision, roundDeadline: resultsDeadline(room), legalActions: roomActions(room, playerId),
    room: { inviteId: room.id, gameId: room.gameId ?? 'blackjack', visibility: room.visibility ?? 'private', managerPlayerId: room.managerId, bettingOpen: room.bettingDeadline !== null, bettingDeadline: room.bettingDeadline, insuranceDeadline: room.insuranceDeadline, claimVersion: room.members[playerId]!.claimVersion },
    players: snapshot.players.map(p => ({ ...p, connected: room.members[p.id]!.connected, reservationDeadline: room.members[p.id]!.reservationDeadline, leavingAfterRound: room.members[p.id]!.leaveAfterRound, ready: room.locked[p.id] === 'ready', sittingOut: room.locked[p.id] === 'out' })) };
}
export function applyCommand(previous: OnlineRoom, command: Command, random: RandomIndex, now: number): OnlineRoom {
  assertRule(previous.members[command.playerId], 'SESSION_INVALID', 'Your guest session is no longer valid.');
  if (previous.receipts.some(r => r.id === command.id && r.playerId === command.playerId)) return previous;
  assertRule(command.revision === previous.revision && command.roundId === previous.engine.roundId, 'STALE_STATE', 'The table changed. Review the current hand and try again.');
  assertRule(roomActions(previous, command.playerId).includes(command.action.type), 'INVALID_ACTION', 'This action is not available for your seat now.');
  const room = structuredClone(previous); const { playerId, action } = command;
  switch (action.type) {
    case 'StartBetting': openBetting(room, now); break;
    case 'NextRound': core(room, playerId, action, random, now); openBetting(room, now); break;
    case 'Ready': room.locked[playerId] = 'ready'; break;
    case 'SitOut': room.locked[playerId] = 'out'; break;
    case 'Leave': {
      const member = room.members[playerId]!;
      member.leaveAfterRound = true; member.connected = false; member.reservationDeadline = null; member.presenceDeadline = null;
      if (room.locked[playerId] !== 'ready') room.locked[playerId] = 'out';
      break;
    }
    default: core(room, playerId, action, random, now, command.handId);
  }
  if (room.bettingDeadline !== null && room.engine.players.every(p => room.locked[p.id])) dealLocked(room, random, now);
  room.revision++; room.lastActivity = now;
  room.receipts.push({ id: command.id, playerId, revision: room.revision }); room.receipts = room.receipts.slice(-128);
  return room;
}
export function expireRoomDecisions(previous: OnlineRoom, random: RandomIndex, now: number): OnlineRoom {
  const room = structuredClone(previous); let changed = false;
  const deadline = resultsDeadline(room);
  if (deadline !== null && now >= deadline) {
    room.roundDeadline = null;
    const starter = room.engine.players.find(p => room.members[p.id]?.connected && !room.members[p.id]?.leaveAfterRound);
    if (starter) { core(room, starter.id, { type: 'NextRound' }, random, now); openBetting(room, now); }
    changed = true;
  }
  if (room.bettingDeadline !== null && now >= room.bettingDeadline) { dealLocked(room, random, now); changed = true; }
  if (room.insuranceDeadline !== null && now >= room.insuranceDeadline) {
    for (const p of room.engine.players) if (room.engine.insurance[p.id] && !room.engine.insurance[p.id]!.decided) core(room, p.id, { type: 'InsuranceDecision', amount: 0 }, random, now);
    changed = true;
  }
  const engine = expireDecision(room.engine, now);
  if (engine !== room.engine) {
    const completed = room.engine.phase !== 'ROUND_COMPLETE' && engine.phase === 'ROUND_COMPLETE';
    if (completed) {
      const id = engine.players[0]!.id;
      room.roundDeadline = now + resultsRevealDelay(project(room.engine, id), project(engine, id)) + RESULTS_DURATION_MS;
    }
    room.engine = engine; recordWalletRound(room); changed = true;
  }
  if (!changed) return previous;
  room.revision++; room.lastActivity = now; return room;
}

export function disconnectMember(room: OnlineRoom, playerId: string, now: number) {
  const member = room.members[playerId];
  if (!member?.connected) return false;
  member.connected = false; member.presenceDeadline = null;
  member.reservationDeadline = member.leaveAfterRound ? null : now + RESERVATION_MS;
  room.lastActivity = Math.max(room.lastActivity, now);
  return true;
}
/** Membership cleanup never changes the shoe or cancels a locked/committed wager. */
export function collectSeats(room: OnlineRoom, now: number) {
  let changed = false;
  const activeId = room.engine.players[room.engine.activePlayer]?.id;
  for (const p of [...room.engine.players]) {
    const member = room.members[p.id]!;
    if (member.connected && member.presenceDeadline !== null && now >= member.presenceDeadline) changed = disconnectMember(room, p.id, member.presenceDeadline) || changed;
    if (!member.connected && member.reservationDeadline !== null && now >= member.reservationDeadline) {
      member.reservationDeadline = null; member.leaveAfterRound = true; changed = true;
    }
    const lockedWager = room.engine.phase === 'BETTING' && room.bettingDeadline !== null && room.locked[p.id] === 'ready';
    const unresolvedHand = p.hands.length > 0 && room.engine.phase !== 'BETTING' && room.engine.phase !== 'ROUND_COMPLETE';
    if (member.leaveAfterRound && !lockedWager && !unresolvedHand) {
      if (!sealWalletSeat(room, p.id)) continue;
      room.engine.players = room.engine.players.filter(other => other.id !== p.id);
      delete room.members[p.id]; delete room.locked[p.id]; delete room.commandRates[p.id];
      room.tickets = room.tickets.filter(ticket => ticket.playerId !== p.id);
      changed = true;
    }
  }
  if (activeId) room.engine.activePlayer = Math.max(0, room.engine.players.findIndex(p => p.id === activeId));
  if (!room.members[room.managerId]?.connected || room.members[room.managerId]?.leaveAfterRound) {
    const manager = room.engine.players.find(p => room.members[p.id]!.connected && !room.members[p.id]!.leaveAfterRound)?.id
      ?? room.engine.players.find(p => !room.members[p.id]!.leaveAfterRound)?.id ?? '';
    if (manager !== room.managerId) { room.managerId = manager; changed = true; }
  }
  room.tickets = room.tickets.filter(ticket => ticket.expires > now && room.members[ticket.playerId] && !room.members[ticket.playerId]!.leaveAfterRound);
  return changed;
}
export function nextAlarm(room: OnlineRoom) {
  const deadlines: (number | null)[] = [room.bettingDeadline, room.insuranceDeadline, room.engine.decisionDeadline, resultsDeadline(room)];
  for (const member of Object.values(room.members)) deadlines.push(member.presenceDeadline, member.reservationDeadline);
  if (!Object.values(room.members).some(member => member.connected) && !walletHasFunds(room)) deadlines.push(room.lastActivity + ROOM_IDLE_MS);
  if (room.wallet?.outbox.length) deadlines.push(room.wallet.retryAt ?? 0);
  const pending = deadlines.filter((value): value is number => value !== null);
  return pending.length ? Math.min(...pending) : null;
}
