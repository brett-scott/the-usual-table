import { ROULETTE_SPIN_MS, ROULETTE_WHEEL } from '@casual/protocol';

export const POCKET_STEP = 360 / ROULETTE_WHEEL.length;
export const TRACK_RADIUS = 87;
export const POCKET_RADIUS = 51;

export interface WheelFrame {
  rotor: number;
  rotorSpeed: number;
  ball: number;
  ballSpeed: number;
  radius: number;
  lift: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const smooth = (amount: number) => amount * amount * (3 - 2 * amount);
const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;
const duration = ROULETTE_SPIN_MS / 1000;
const coastBallSpeed = -146;
const coastRotorSpeed = 34;

/** The rim sequence uses only public timing and the round number. The pocket is still unknown. */
export function spinFrame(round: number, elapsedMs: number): WheelFrame {
  const elapsed = Math.max(0, elapsedMs / 1000);
  const time = Math.min(elapsed, duration);
  const progress = time / duration;
  const rotorSpeed = mix(93, 38, progress);
  const ballSpeed = mix(-710, -154, progress);
  // If the result is late, coast on the apron. Only a confirmed result sends the ball into the pockets.
  const delay = elapsed - time;
  const drag = Math.exp(-delay / 1.4);
  const coast = 1.4 * (1 - drag);
  return {
    rotor: wrap(round * 59) + (93 + rotorSpeed) * time / 2 + coastRotorSpeed * delay + (rotorSpeed - coastRotorSpeed) * coast,
    rotorSpeed: mix(coastRotorSpeed, rotorSpeed, drag),
    ball: wrap(round * 97) + (-710 + ballSpeed) * time / 2 + coastBallSpeed * delay + (ballSpeed - coastBallSpeed) * coast,
    ballSpeed: mix(coastBallSpeed, ballSpeed, drag),
    radius: mix(TRACK_RADIUS, 77, smooth(clamp((progress - 0.82) / 0.18))),
    lift: 0,
  };
}

function landingDistance(from: WheelFrame, winner: number) {
  const pocket = ROULETTE_WHEEL.indexOf(winner as typeof ROULETTE_WHEEL[number]) * POCKET_STEP;
  return wrap(from.ball - from.rotor - pocket);
}

export function planRouletteLanding(from: WheelFrame, winner: number) {
  const distance = landingDistance(from, winner);
  // Roll another lap if the pocket is too close to slow down naturally.
  const travel = distance < 60 ? distance + 360 : distance;
  const relativeSpeed = from.rotorSpeed - from.ballSpeed;
  const durationMs = 2000 * travel / relativeSpeed;
  return { from, travel, durationMs };
}

export function scheduleRouletteLanding(from: WheelFrame, winner: number, durationMs: number) {
  const distance = landingDistance(from, winner);
  const travelAtIncomingSpeed = (from.rotorSpeed - from.ballSpeed) * durationMs / 1000;
  const laps = Math.max(0, Math.round((travelAtIncomingSpeed / 2 - distance) / 360));
  const travel = distance + laps * 360;
  // Aim for roughly half the incoming speed on average, adding laps when there is room.
  // A late snapshot can leave too little time for a continuous roll into the pocket.
  return travel > 0 && travel < travelAtIncomingSpeed ? { from, travel, durationMs } : null;
}

export function landingFrame({ from, travel, durationMs }: ReturnType<typeof planRouletteLanding>, elapsedMs: number): WheelFrame {
  const progress = clamp(elapsedMs / durationMs);
  const relativeSpeed = from.rotorSpeed - from.ballSpeed;
  const power = relativeSpeed * durationMs / 1000 / travel;
  const remaining = travel * (1 - progress) ** power;
  const speed = (1 - progress) ** (power - 1);
  // The slope at the start matches the incoming speeds, even when the landing time is fixed.
  const travelTime = (travel - remaining) / relativeSpeed;
  const drop = clamp(1 - remaining / 48);
  const apron = mix(from.radius, 73, smooth(progress));
  const hop = Math.abs(Math.sin(drop * Math.PI * 2)) * (1 - drop) ** 2;
  return {
    rotor: from.rotor + from.rotorSpeed * travelTime,
    rotorSpeed: from.rotorSpeed * speed,
    ball: from.ball + from.ballSpeed * travelTime,
    ballSpeed: from.ballSpeed * speed,
    radius: mix(apron, POCKET_RADIUS, smooth(drop)) + hop * 2,
    lift: hop,
  };
}
