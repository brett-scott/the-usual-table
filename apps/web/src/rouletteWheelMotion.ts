import { ROULETTE_SPIN_MS, ROULETTE_WHEEL } from '@casual/protocol';

export const ROULETTE_LANDING_MS = 950;
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

/** The rim sequence uses only public timing and the round number. The pocket is still unknown. */
export function spinFrame(round: number, elapsedMs: number): WheelFrame {
  const elapsed = Math.max(0, elapsedMs / 1000);
  const time = Math.min(elapsed, duration);
  const progress = time / duration;
  const rotorSpeed = mix(93, 38, progress);
  const ballSpeed = mix(-710, -154, progress);
  // If the result is late, coast on the apron. Only a confirmed result sends the ball into the pockets.
  const drag = Math.exp(-Math.max(0, elapsed - duration) / 1.4);
  const coast = 1.4 * (1 - drag);
  return {
    rotor: wrap(round * 59) + (93 + rotorSpeed) * time / 2 + rotorSpeed * coast,
    rotorSpeed: rotorSpeed * drag,
    ball: wrap(round * 97) + (-710 + ballSpeed) * time / 2 + ballSpeed * coast,
    ballSpeed: ballSpeed * drag,
    radius: mix(TRACK_RADIUS, 77, smooth(clamp((progress - 0.82) / 0.18))),
    lift: 0,
  };
}

/** Continue counterclockwise from the apron to the pocket's final position. */
export function landingFrame(from: WheelFrame, winner: number, progress: number): WheelFrame {
  const time = clamp(progress);
  const durationSeconds = ROULETTE_LANDING_MS / 1000;
  const rotor = from.rotor + from.rotorSpeed * durationSeconds * (time - time * time / 2);
  const impactAt = 0.21;
  const drift = from.ballSpeed * durationSeconds;
  const impact = from.ball + drift * impactAt;

  if (time < impactAt) {
    return {
      rotor, rotorSpeed: from.rotorSpeed * (1 - time), ball: from.ball + drift * time,
      ballSpeed: from.ballSpeed, radius: mix(from.radius, 73, smooth(time / impactAt)), lift: 0,
    };
  }

  const pocket = ROULETTE_WHEEL.indexOf(winner as typeof ROULETTE_WHEEL[number]) * POCKET_STEP;
  const finalRotor = from.rotor + from.rotorSpeed * durationSeconds / 2;
  const travel = wrap(impact - (finalRotor + pocket));
  const settling = (time - impactAt) / (1 - impactAt);
  const settleSeconds = durationSeconds * (1 - impactAt);
  const remaining = 1 - settling;
  // Match the incoming speed where possible. This slope bound keeps the path monotone even for nearby pockets.
  const initialSlope = Math.min(-from.ballSpeed * settleSeconds, 3 * travel);
  const travelled = travel * smooth(settling) + initialSlope * settling * remaining ** 2;
  const speed = remaining * (initialSlope * remaining + (6 * travel - 2 * initialSlope) * settling) / settleSeconds;
  const hop = Math.abs(Math.sin(settling * Math.PI * 3)) * remaining ** 2;
  return {
    rotor, rotorSpeed: from.rotorSpeed * (1 - time), ball: impact - travelled,
    ballSpeed: -speed, radius: mix(73, POCKET_RADIUS, smooth(settling)) + hop * 3, lift: hop,
  };
}
