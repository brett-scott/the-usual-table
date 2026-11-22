import { ROULETTE_LANDING_BUDGET_MS, ROULETTE_SPIN_MS, ROULETTE_WHEEL } from '@casual/protocol';
import { expect, it } from 'vitest';
import { landingFrame, planRouletteLanding, POCKET_RADIUS, scheduleRouletteLanding, spinFrame, TRACK_RADIUS } from './rouletteWheelMotion';

it('slows the opposite orbits and leaves the ball outside all pockets while awaiting the result', () => {
  for (const round of [1, 2]) {
    const samples = [0, 3000, 6500, ROULETTE_SPIN_MS, ROULETTE_SPIN_MS + 2500].map(time => spinFrame(round, time));
    expect(samples[0]!.radius).toBe(TRACK_RADIUS);
    expect(samples.at(-1)!.radius).toBeLessThan(TRACK_RADIUS);
    for (const [index, frame] of samples.entries()) {
      expect(frame.rotorSpeed).toBeGreaterThan(0);
      expect(frame.ballSpeed).toBeLessThan(0);
      expect(frame.radius).toBeGreaterThan(71);
      if (index === 0) continue;
      const previous = samples[index - 1]!;
      expect(Math.abs(frame.ballSpeed)).toBeLessThan(Math.abs(previous.ballSpeed));
      expect(Math.abs(frame.rotorSpeed)).toBeLessThan(Math.abs(previous.rotorSpeed));
      expect((frame.rotor - previous.rotor) * (frame.ball - previous.ball)).toBeLessThan(0);
    }
  }
});

it('decelerates from the incoming speed into all 37 confirmed pockets within the landing budget', () => {
  for (const round of [1, 2, 117]) {
    for (const elapsed of [0, 3000, 7600, ROULETTE_SPIN_MS, ROULETTE_SPIN_MS + 2500, ROULETTE_SPIN_MS + 8000]) {
      const start = spinFrame(round, elapsed);
      for (const [index, number] of ROULETTE_WHEEL.entries()) {
        const plan = planRouletteLanding(start, number);
        expect(plan.durationMs).toBeLessThan(ROULETTE_LANDING_BUDGET_MS);
        expect(landingFrame(plan, 0)).toEqual(start);
        let previousAngle = start.ball;
        let previousSpeed = -start.ballSpeed;
        const stepMs = plan.durationMs / 100;
        for (let step = 1; step <= 100; step++) {
          const { ball } = landingFrame(plan, step * stepMs);
          const speed = 1000 * (previousAngle - ball) / stepMs;
          expect(speed).toBeGreaterThanOrEqual(0);
          expect(speed).toBeLessThan(previousSpeed);
          previousAngle = ball;
          previousSpeed = speed;
        }
        const last = landingFrame(plan, plan.durationMs);
        const pocketAngle = index * 360 / ROULETTE_WHEEL.length;
        const turns = (last.ball - last.rotor - pocketAngle) / 360;
        expect(turns).toBeCloseTo(Math.round(turns), 8);
        expect(last.radius).toBe(POCKET_RADIUS);
        expect(last.lift).toBe(0);
        expect(last.rotorSpeed).toBe(0);
        expect(last.ballSpeed).toBeCloseTo(0);
      }
    }
  }
});

it('lands at the shared countdown boundary without accelerating, including when the result arrives late', () => {
  for (const durationMs of [3000, ROULETTE_LANDING_BUDGET_MS]) {
    const start = spinFrame(1, ROULETTE_SPIN_MS + ROULETTE_LANDING_BUDGET_MS - durationMs);
    for (const [index, winner] of ROULETTE_WHEEL.entries()) {
      const plan = scheduleRouletteLanding(start, winner, durationMs)!;
      expect(plan.durationMs).toBe(durationMs);
      expect(landingFrame(plan, 0)).toEqual(start);
      let previous = start;
      for (let step = 1; step <= 20; step++) {
        const frame = landingFrame(plan, step * durationMs / 20);
        expect(frame.ball).toBeLessThanOrEqual(previous.ball);
        expect(Math.abs(frame.ballSpeed)).toBeLessThan(Math.abs(previous.ballSpeed));
        previous = frame;
      }
      const turns = (previous.ball - previous.rotor) / 360 - index / ROULETTE_WHEEL.length;
      expect(turns).toBeCloseTo(Math.round(turns), 8);
      expect(previous.radius).toBe(POCKET_RADIUS);
    }
  }
  const late = spinFrame(1, ROULETTE_SPIN_MS);
  expect(scheduleRouletteLanding(late, 0, 0)).toBeNull();
});
