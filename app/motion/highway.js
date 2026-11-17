import { bound, lerp, ramp } from './projection.js';
import { laneWidths, projectTruck, roadPoint, roadYaw, wheelSpin } from './road.js';

export const truckLane = 3;
export const meterPitch = .68;
export const parcelSlots = 8;
export const xChannel = lane => (lane - truckLane) * 1.27;
export const deckRear = -2.89;
export const truckExitEnd = .74;

export const roadStart = 15.8;
export const roadEnd = -54.5;
const roadLength = roadStart - roadEnd;
const deckFront = 3.17;
const deckLength = deckFront - deckRear;
const deckY = .282;
const startingZ = [4.6, 1.8, 5.2, -12.7, 6.4, 2.7, 4.1];
const spacing = [7.42, 7.27, 7.39, 5.60, 7.56, 7.43, 7.62];

export function highwayToConsole(phase) {
  return {
    phase,
    narrow: ramp(.09, .63, phase),
    shorten: ramp(.22, .93, phase),
    straighten: ramp(.14, .83, phase),
    cover: ramp(.60, .96, phase),
    feed: ramp(.57, .98, phase),
  };
}

export function railFrame(lane, v, motion) {
  const z = lerp(roadStart, roadEnd, v);
  const road = roadPoint(lane, z);
  const exit = lane === truckLane ? lerp(ramp(.24, .60, motion.phase), ramp(.38, .70, motion.phase),
    ramp(.12, .58, v)) : 1;
  const clean = lane === truckLane ? ramp(.68, .94, motion.phase) : 0;
  const straighten = motion.straighten * exit;
  const shorten = motion.shorten * exit;
  const overlap = lane === truckLane ? ramp(.19, truckExitEnd, motion.phase) * (1 - clean) : 0;
  const yaw = roadYaw(z) * (1 - straighten);
  return {
    p: [lerp(road[0], xChannel(lane), straighten),
      lerp(road[1], deckY, shorten),
      lerp(road[2], lerp(deckFront, deckRear, v), shorten) - overlap * 73 * Math.max(0, v - .34) ** 1.15],
    across: [Math.cos(yaw), 0, -Math.sin(yaw)],
    yaw,
  };
}

export const firstTruckV = (roadStart - 3.22) / roadLength;
export const driveDistance = time => time * 19.4;

export function driveOffset(time) {
  // A camera travelling in the same direction lets the lorry gain and lose a little ground in frame.
  return 1.67 * Math.sin(time * 1.03) + .26 * Math.sin(time * 2.12);
}

function truckProgress(phase, time) {
  const roll = ramp(.03, .59, phase);
  const distance = .8 * roll ** 1.64 + .2 * ramp(.55, truckExitEnd, phase);
  return lerp(firstTruckV, 1.15, distance) + driveOffset(time) / roadLength * (1 - ramp(.06, .39, phase));
}

export function railWidth(lane, motion, v = 1, time = 0) {
  // Preserve the shoulder under the truck while the empty road ahead and behind narrows.
  const shoulder = lane === truckLane && motion.phase < truckExitEnd
    ? 1 - ramp(.080, .145, Math.abs(v - truckProgress(motion.phase, time))) : 0;
  return lerp(laneWidths[lane], .89, motion.narrow * (1 - shoulder));
}

export function highwayTruck(motion, time = 0) {
  const phase = motion.phase;
  if (phase >= truckExitEnd) return null;
  const v = truckProgress(phase, time);
  const path = progress => railFrame(truckLane, progress, motion).p;
  return { ...projectTruck(v, path), v, spin: wheelSpin(v - firstTruckV, roadLength) + wheelSpin(1, driveDistance(time)) };
}

export function highwayParcel(lane, slot, motion, level, faderZ, time, previous, console) {
  const { phase, shorten, feed } = motion;
  // Keep the truck lane clear on the highway. Its cartons enter at the far end after the truck leaves.
  const traffic = lane === truckLane ? ramp(.67, .88, phase) : 1;
  if (traffic < .003) return null;
  const travel = 1 - ramp(.11, .47, phase);
  const shift = Math.sin(time * 1.74 + lane * .84) * (1.28 + 1.61 * travel)
    + Math.sin(time * 2.47 + slot * .53) * .29;
  const z = startingZ[lane] - spacing[lane] * slot + shift;
  const from = (roadStart - z) / roadLength;
  const isFader = slot === 0;
  const sizeOnRoad = isFader ? (lane === 4 ? 1.01 : .76 + .05 * (lane % 3)) : .53 + .09 * ((lane + slot * 2) % 4);
  const toFader = ramp(.72, .95, phase);
  let v, rise, visualSize;
  if (isFader) {
    const channelPosition = (deckFront - bound(faderZ, deckRear + .66, deckFront - .68)) / deckLength;
    v = lerp(from, channelPosition, toFader);
    rise = 0;
    visualSize = [.87, .285, .76];
  } else {
    // The last point on a rail is also the source of the column above it.
    const length = lerp(roadLength, deckLength, shorten);
    const tier = slot - 1;
    const distance = lerp((from - 1) * length, .47 + tier * meterPitch, feed);
    v = 1 + Math.min(0, distance) / length;
    rise = Math.max(0, distance);
    visualSize = [.85 + (tier % 2) * .04, .49, .72 + (tier % 2) * .05];
  }

  const { p, yaw } = railFrame(lane, v, motion);
  const lift = ramp(.01, .73, rise);
  const atRear = isFader ? 0 : ramp(.72, 1, v) * motion.feed;
  const dressing = isFader ? toFader : ramp(.04, .91, rise);
  const tierLevel = isFader || slot === 1 ? 1 : ramp(-.26, .11, level - (slot - 1) * meterPitch);
  const roadVisibility = 1 - ramp(.93, 1.04, from);
  const scale = (traffic * lerp(roadVisibility, tierLevel, isFader ? toFader : lift)) ** .70;
  if (scale < .031) return null;
  const size = visualSize.map((target, i) => lerp(sizeOnRoad * (i === 2 ? 1.045 : 1), target, dressing)
    * scale * (1 - .31 * atRear * (1 - ramp(.31, .96, rise))));
  const hover = .092 + Math.sin(time * 2.4 + lane + slot * .76) * .033;
  const buoyancy = .052 * Math.sin(time * 3.1 + lane * .58)
    + bound(level / 4.7) * .06;
  const seated = console ? ramp(.81, .99, feed) : 0;
  const stackMotion = console
    ? .073 - .475 * (1 - console.wake)
      + .068 * console.idle * Math.sin(time * 2.57 + lane * .71)
      + .21 * bound(level / 4.7) * console.wake
      + (.26 + slot * .046) * console.beat + .18 * console.power
    : 0;
  const pY = p[1] + size[1] * .5 + (isFader ? lerp(hover, .046, toFader)
    : hover * (1 - atRear) + rise + lerp(buoyancy * lift, stackMotion, seated));
  const center = [p[0], pY, p[2] - .24 * lift];
  if (previous) {
    const width = (Math.hypot(size[0], size[2]) + Math.hypot(previous.size[0], previous.size[2])) * .5;
    const distance = Math.hypot(center[0] - previous.p[0], center[2] - previous.p[2]);
    const clearance = (size[1] + previous.size[1]) * .5 + .065;
    const separation = 1 - ramp(width + .02, width + .29, distance);
    center[1] += Math.max(0, previous.p[1] + clearance - pY) * separation;
  }
  return {
    p: center,
    size,
    foot: p,
    yaw: yaw + (.048 * (1 - dressing)) * Math.sin(time * 1.44 + lane + slot * .32),
    alpha: 1,
    tape: isFader ? lerp(.94, .58, toFader) : .94,
    v,
    rise,
  };
}
