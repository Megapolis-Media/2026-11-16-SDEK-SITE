export type MeterFrame = { bands: readonly number[]; beat: number; power: number };

const edges = [40, 108, 222, 450, 940, 2040, 4290, 9950];
const bound = (n: number) => Math.min(1, Math.max(0, n));
const follow = (from: number, to: number, dt: number, seconds: number) =>
  from + (to - from) * (1 - Math.exp(-dt / seconds));

export function makeAudioMeter(hzPerBin: number) {
  const toBin = (hz: number) => Math.round(hz / hzPerBin);
  const ranges = edges.slice(1).map((edge, i) => {
    const low = Math.max(1, toBin(edges[i]));
    return [low, Math.max(low + 1, toBin(edge))];
  });
  const bands = ranges.map(() => 0);
  const floor = ranges.map(() => .12);
  const ceiling = ranges.map(() => .53);
  const average = ranges.map(() => 0);
  const deviation = ranges.map(() => .05);
  const kickStart = Math.max(1, toBin(41));
  const kickEnd = Math.max(kickStart + 1, toBin(300));
  const previous = new Float32Array(kickEnd);
  const frame = { bands, beat: 0, power: 0 };
  let last = -Infinity, lastKick = -Infinity, baseline = .014;
  let low = 0, body = 0, previousLow = 0;

  return {
    read(bins: Uint8Array, now: number): MeterFrame {
      const gap = now - last;
      if (gap < 12) return frame;
      last = now;
      const dt = Math.min(.075, gap / 1000);
      let crest = 0;
      for (let i = 0; i < ranges.length; i++) {
        const [lo, limit] = ranges[i];
        const hi = Math.min(limit, bins.length);
        let peak = 0, energy = 0;
        for (let b = lo; b < hi; b++) {
          const value = bins[b] / 255;
          energy += value * value;
          peak = Math.max(value, peak);
        }
        const level = .79 * Math.sqrt(energy / Math.max(1, hi - lo)) + .21 * peak;
        floor[i] = follow(floor[i], level, dt, level < floor[i] ? .55 : 3.1);
        ceiling[i] = follow(ceiling[i], level, dt, level > ceiling[i] ? .10 : 1.48);
        const absolute = bound((level - .14) / .75);
        const accent = bound((level - floor[i] + .032) / Math.max(.21, ceiling[i] - floor[i] + .072));
        if (!Number.isFinite(gap)) average[i] = level;
        const difference = level - average[i];
        average[i] = follow(average[i], level, dt, .67);
        deviation[i] = follow(deviation[i], Math.abs(difference), dt, 1.1);
        // Expand the changes around each band's recent average in a compressed radio mix.
        const dynamics = bound(.45 + difference / Math.max(.085, deviation[i] * 2.9));
        const target = Math.min(.96, absolute * (.22 + .38 * accent + .67 * dynamics));
        bands[i] = follow(bands[i], target, dt, target > bands[i] ? .024 : .104);
        crest = Math.max(crest, bound(difference / Math.max(.10, deviation[i] * 3)) * absolute);
      }

      let rise = 0, weight = 0, bassEnergy = 0;
      for (let i = kickStart; i < Math.min(kickEnd, bins.length); i++) {
        const nowLevel = bins[i] / 255;
        const bass = 1 - .67 * (i - kickStart) / (kickEnd - kickStart);
        rise += Math.max(0, nowLevel - previous[i]) * bass;
        bassEnergy += Math.pow(10, (nowLevel - 1) * 7) * bass;
        weight += bass;
        previous[i] = nowLevel;
      }
      const flux = rise / Math.max(1, weight);
      const bass = Math.sqrt(bassEnergy / Math.max(1, weight));
      low = follow(low, bass, dt, .024);
      body = follow(body, bass, dt, .18);
      const punch = (low - body) / Math.max(.045, body);
      const attack = low - previousLow;
      previousLow = low;
      frame.beat *= Math.exp(-dt / .135);
      const threshold = Math.max(.013, baseline * 1.78 + .004);
      // Reject small harmonic changes unless bass energy is rising with them.
      const spectralHit = flux > threshold && (attack > .0026 || flux > threshold * 2.5);
      const hit = spectralHit || (punch > .16 && attack > .008);
      if (gap < 150 && now - lastKick >= 142 && hit && Math.max(bands[0] + bands[1], bass * 5) > .095) {
        frame.beat = Math.max(frame.beat, bound(.33 + Math.max(flux - threshold, punch * .11) * 5.1));
        lastKick = now;
      }
      baseline = follow(baseline, Math.min(.15, flux), dt, .54);
      frame.power = follow(frame.power, Math.max(crest, frame.beat * .84), dt, .058);
      return frame;
    },
    reset() {
      bands.fill(0);
      floor.fill(.12);
      ceiling.fill(.53);
      average.fill(0);
      deviation.fill(.05);
      previous.fill(0);
      frame.beat = 0;
      frame.power = 0;
      last = lastKick = -Infinity;
      baseline = .014;
      low = body = previousLow = 0;
    },
  };
}
