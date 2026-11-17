import { bound, lerp } from './projection.js';

const resting = [.16, .29, .46, .23, .57, .38, .19];
const heightAtRest = .19;
const follow = (from, to, dt, speed) => {
  const next = lerp(from, to, 1 - Math.exp(-dt * speed));
  return Math.abs(next - to) < .002 ? to : next;
};

export function makeConsoleMotion() {
  const meters = resting.map(value => .32 + value * 4);
  const faders = resting.map(value => .08 + value * .82);
  let mix = 0, wake = 1;
  const snapshot = { meters, faders, bands: resting.slice(), beat: 0, power: 0, wake, idle: 1, state: 'idle' };

  return (reading, time, dt) => {
    const { state } = reading;
    const live = state === 'live' ? reading.frame : null;
    const parked = state === 'parked' || state === 'quiet' || (state === 'waiting' && reading.atRest);
    wake = follow(wake, parked ? 0 : 1, dt, parked ? 7.2 : 12);
    mix = follow(mix, live ? 1 : 0, dt, live ? 13 : 7.2);
    const beat = live?.beat ?? 0;
    const power = live?.power ?? 0;
    const idle = wake * (1 - mix);
    for (let i = 0; i < resting.length; i++) {
      const drift = bound(resting[i] + .13 * Math.sin(time * 2.23 + i * .88)
        + .048 * Math.sin(time * 4.15 - i * .67));
      const signal = live?.bands[i] ?? 0;
      const emphasis = beat * (i < 2 ? .86 : .57) + power * (i < 2 ? .72 : .58);
      const measuredHeight = bound(.31 + signal * 4.48 + emphasis, .19, 4.85);
      const naturalHeight = .32 + drift * 4;
      const height = heightAtRest + idle * (naturalHeight - heightAtRest) + mix * (measuredHeight - heightAtRest);
      const channel = idle * (.08 + drift * .83)
        + mix * bound(.06 + signal * .79 + beat * (i < 2 ? .23 : .14) + power * .10);
      meters[i] = follow(meters[i], height, dt, height > meters[i] ? 65 : parked ? 13.5 : 15.5);
      faders[i] = follow(faders[i], channel, dt, channel > faders[i] ? 31 : 14);
      snapshot.bands[i] = drift * idle + signal * mix;
    }
    Object.assign(snapshot, { beat, power, wake, idle, state });
    return snapshot;
  };
}
