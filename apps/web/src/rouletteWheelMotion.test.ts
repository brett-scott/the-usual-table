import { ROULETTE_SPIN_MS, ROULETTE_WHEEL } from '@casual/protocol';
import { expect, it } from 'vitest';
import { landingFrame, POCKET_RADIUS, spinFrame, TRACK_RADIUS } from './rouletteWheelMotion';

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

it('continues counterclockwise from the last visible frame into all 37 confirmed pockets', () => {
  for (const round of [1, 2, 117]) {
    for (const elapsed of [0, 3000, 7600, ROULETTE_SPIN_MS, ROULETTE_SPIN_MS + 2500, ROULETTE_SPIN_MS + 8000]) {
      const start = spinFrame(round, elapsed);
      for (const [index, number] of ROULETTE_WHEEL.entries()) {
        expect(landingFrame(start, number, 0)).toEqual(start);
        const impact = landingFrame(start, number, 0.21);
        let highestClockwiseStep = 0;
        let previousAngle = start.ball;
        for (let step = 1; step <= 100; step++) {
          const { ball } = landingFrame(start, number, step / 100);
          highestClockwiseStep = Math.max(highestClockwiseStep, ball - previousAngle);
          previousAngle = ball;
        }
        expect(highestClockwiseStep, `round ${round}, time ${elapsed}, pocket ${number}`).toBeLessThan(1e-8);
        const last = landingFrame(start, number, 1);
        const pocketAngle = index * 360 / ROULETTE_WHEEL.length;
        const turns = (last.ball - last.rotor - pocketAngle) / 360;
        expect(turns).toBeCloseTo(Math.round(turns), 8);
        expect(impact.ball - last.ball).toBeLessThan(360);
        expect(last.radius).toBe(POCKET_RADIUS);
        expect(last.lift).toBe(0);
        expect(last.rotorSpeed).toBe(0);
        expect(last.ballSpeed).toBeCloseTo(0);
      }
    }
  }
});
