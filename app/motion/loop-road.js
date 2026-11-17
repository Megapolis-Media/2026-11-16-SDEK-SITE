import { blend3, bound, lerp, ramp } from './projection.js';
import { laneWidths, projectTruck, roadLaneOffset, roadPoint, roadYaw, wheelSpin, wrapped } from './road.js';
import { driveDistance, driveOffset, firstTruckV, highwayParcel, highwayToConsole, parcelSlots, roadEnd, roadStart, truckLane } from './highway.js';

const turn = 2 * Math.PI;
export const broadcastLane = 4;
const roadLength = roadStart - roadEnd;
const flatHighway = highwayToConsole(0);
const lobeRoundness = .12;
const radiusX = 25.8 / (1 + lobeRoundness);
const radiusZ = 14.8;
const bridgeHeight = 4.95;
const anchor = .455;
const anchorZ = 3.22;
const cut = .046;

function figurePoint(v) {
  const angle = (v - .25) * turn;
  const rise = ramp(.081, .224, v) * (1 - ramp(.276, .418, v));
  // Broaden the shoulders of both lobes while keeping their original span.
  return [radiusX * (Math.sin(angle) - lobeRoundness * Math.sin(3 * angle)),
    .31 + bridgeHeight * rise, radiusZ * Math.sin(2 * angle)];
}

function figureVelocity(v) {
  const angle = (v - .25) * turn;
  return [radiusX * turn * (Math.cos(angle) - 3 * lobeRoundness * Math.cos(3 * angle)),
    2 * radiusZ * turn * Math.cos(2 * angle)];
}

const start = figurePoint(anchor);
const [anchorX, anchorDepth] = figureVelocity(anchor);
const heading = roadYaw(anchorZ) - Math.atan2(-anchorX, -anchorDepth);
const sin = Math.sin(heading), cos = Math.cos(heading);
const join = roadPoint(truckLane, anchorZ);
// Match the circuit's exit to the road station under the opening truck.
const roadPerTurn = 64;
const openStart = anchor - (roadStart - anchorZ) / roadPerTurn;
const openLength = roadLength / roadPerTurn;

function rotated(x, y, z) {
  return [cos * x + sin * z, y, -sin * x + cos * z];
}

function alignedFigure(v) {
  const [x, y, z] = figurePoint(wrapped(v, 1));
  const offset = rotated(x - start[0], y - start[1], z - start[2]);
  return join.map((value, i) => value + offset[i]);
}

function greetingSpine(v) {
  return [1.8 * Math.sin(v * Math.PI * 1.09) + 1.08 * v, .03 + .22 * Math.sin(v * Math.PI), lerp(12, -27, v)];
}

function turnTo(a, b, amount) {
  return a + (wrapped(b - a + Math.PI, turn) - Math.PI) * amount;
}

const origin = alignedFigure(.25);
const offset = rotated(4, 66, 54);
const loopLook = [origin[0], 1.15, origin[2]];
export const circuitCamera = { eye: loopLook.map((value, i) => value + offset[i]), aim: loopLook, lens: 1.42 };

export const greetingRoad = { curl: 0, approach: 0, from: cut, to: cut + 1 };
const openHere = .451;
const exitStart = 7.29;
const exitEnd = 7.96;
const highwayArrival = 7.98;
const completedCircuit = { curl: 1, approach: 0, from: cut, to: cut + 1, stretch: 0 };
const openingHighway = { curl: 1, approach: 1, from: openStart, to: openStart + openLength, stretch: 0 };

function truckClearance(curl, approach) {
  return ramp(.64, 1, curl) * (1 - ramp(.65, 1, approach));
}

export function loopRoad(shot) {
  if (shot <= 5.12) return greetingRoad;
  if (shot >= highwayArrival) return openingHighway;
  if (shot >= 6.94 && shot <= exitStart) return completedCircuit;
  const curl = ramp(5.12, 6.94, shot);
  const open = ramp(exitStart, exitEnd, shot);
  const approach = ramp(7.46, highwayArrival, shot);
  return {
    curl, approach,
    from: lerp(cut, openStart, ramp(7.43, exitEnd, shot)),
    to: lerp(cut + 1, openStart + openLength, ramp(7.67, exitEnd, shot)),
    stretch: Math.sin(Math.PI * open) ** 2,
  };
}

const spineResolution = 182;
const openingSpine = v => roadPoint(truckLane, lerp(roadStart, roadEnd, v));

function buildSpine(route) {
  const { curl, approach, from, to, stretch = 0 } = route;
  if (curl === 0) return greetingSpine;
  if (approach === 1) return openingSpine;
  const figure = v => alignedFigure(lerp(from, to, v));
  if (curl === 1 && approach === 0 && stretch === 0) return figure;

  const swing = Math.sin(Math.PI * curl) ** 2;
  const release = v => lerp(approach, 1, .35 * ramp(.35, .84, v) * ramp(.01, .72, approach));
  const velocity = v => {
    const greetingX = 1.8 * Math.PI * 1.09 * Math.cos(v * Math.PI * 1.09) + 1.08;
    const [dx, dz] = figureVelocity(lerp(from, to, v));
    const home = roadYaw(lerp(roadStart, roadEnd, v));
    // Turn each cross-section progressively. Blending opposite tangent vectors
    // would stop the curve locally and fold the inside lanes back over themselves.
    const yaw = lerp(lerp(Math.atan2(-greetingX, 39), Math.atan2(-dx, -dz) + heading, curl), home, release(v));
    const speed = lerp(lerp(Math.hypot(greetingX, 39), Math.hypot(dx, dz) * (to - from), curl),
      roadLength / Math.cos(home), approach) * (1 + .35 * swing);
    return [-Math.sin(yaw) * speed, -Math.cos(yaw) * speed];
  };
  const directions = Array.from({ length: spineResolution + 1 }, (_, i) => velocity(i / spineResolution));
  const points = [[0, 0]];
  for (let i = 0; i < spineResolution; i++) {
    const mid = velocity((i + .5) / spineResolution);
    points.push(points[i].map((value, axis) => value
      + (directions[i][axis] + 4 * mid[axis] + directions[i + 1][axis]) / (6 * spineResolution)));
  }
  const sample = (v, axis) => {
    const i = bound(Math.floor(v * spineResolution), 0, spineResolution - 1);
    const t = v * spineResolution - i;
    const a = points[i][axis], b = points[i + 1][axis];
    return lerp(a, b, t * t * (3 - 2 * t)) + t * (1 - t)
      * ((1 - t) * directions[i][axis] - t * directions[i + 1][axis]) / spineResolution;
  };
  // Hold the part of the road the camera is following as the ends swing around it.
  const pivot = lerp(.39, .27, approach);
  const origin = blend3(blend3(greetingSpine(pivot), figure(pivot), curl), openingSpine(pivot), approach);
  const x = origin[0] - sample(pivot, 0), z = origin[2] - sample(pivot, 1);
  // Raise the leading bend before its footprint meets the lower deck during the turn.
  const crossingLift = 4.3 * (ramp(.57, .76, curl) * (1 - ramp(.90, 1, curl))
    + ramp(.008, .077, approach) * (1 - ramp(.19, .35, approach)));
  const height = v => {
    const rise = lerp(lerp(greetingSpine(v)[1], figure(v)[1], curl), openingSpine(v)[1], release(v));
    const lift = swing * (2.4 * ramp(.36, .66, v) - 1.1 * ramp(.06, .22, v))
      + crossingLift * (1 - ramp(.16, .40, v));
    const bridge = stretch * 2.2 * Math.sin(Math.PI * ramp(.17, .63, v));
    return rise + lift + bridge;
  };
  // Pull the two ends into the joint across the length of each lobe, before
  // the overhead camera reveals the whole circuit.
  const closure = curl < 1 ? ramp(.79, .946, curl) : 0;
  const gapX = (sample(0, 0) - sample(1, 0)) * closure;
  const gapY = (height(0) - height(1)) * closure;
  const gapZ = (sample(0, 1) - sample(1, 1)) * closure;
  return v => {
    const along = v - pivot;
    return [sample(v, 0) + x + gapX * along,
      height(v) + gapY * ramp(.90, 1, v), sample(v, 1) + z + gapZ * along];
  };
}

const crossSection = new WeakMap();

export function loopLane(lane, v, route) {
  const { curl, approach } = route;
  let spine = crossSection.get(route);
  if (!spine) {
    spine = { centerAt: buildSpine(route), samples: new Map() };
    crossSection.set(route, spine);
  }
  const { centerAt, samples } = spine;
  let frame = samples.get(v);
  if (!frame) {
    const z = lerp(roadStart, roadEnd, v);
    const center = centerAt(v);
    const ahead = centerAt(v + .0005), behind = centerAt(v - .0005);
    const yaw = approach === 1 ? roadYaw(z) : Math.atan2(behind[0] - ahead[0], behind[2] - ahead[2]);
    frame = { z, center, yaw, c: Math.cos(yaw), s: Math.sin(yaw) };
    if (samples.size < 256) samples.set(v, frame);
  }
  const { z, center, yaw, c, s } = frame;
  const position = lane - truckLane;
  const room = truckClearance(curl, approach);
  const side = Math.sign(position);
  const circuitOffset = side * (1.61 + Math.abs(position) * 1.14);
  const travelOffset = lerp(position * 1.91, circuitOffset, curl);
  const offset = lerp(travelOffset, roadLaneOffset(lane, z), approach);
  const rise = lerp(Math.abs(position) * .12 + Math.max(0, position) * .066, Math.abs(position) * .018, curl);
  const y = center[1] + lerp(rise, roadPoint(lane, z)[1] - roadPoint(truckLane, z)[1], approach);
  const width = lerp(lerp(lane === truckLane ? 3.08 : 1.47, lane === truckLane ? 3.55 : 1.02, curl), laneWidths[lane], approach);
  const roadOffset = offset + side * room * .71;
  return { p: [center[0] + roadOffset * c, y, center[2] - roadOffset * s],
    yaw, width: width + (lane === truckLane ? room * 1.42 : 0) };
}

const handoverAt = [.18, .27, .21, 0, .343, .41, .52];
const broadcastSize = 1.10;
const handoverPosition = (lane, time) => handoverAt[lane] + Math.sin(time * .84 + lane * .43) * .026;

export function packedBroadcastPose(start, phase, time) {
  const contract = ramp(.24, .54, phase);
  const drive = ramp(.53, 1, phase);
  const size = blend3([start.size[0], start.size[0] * 9 / 16, start.size[2]], [broadcastSize, broadcastSize, broadcastSize * 1.025], contract);
  const platform = [2.05, 2.21, -1.07];
  const at = handoverPosition(broadcastLane, time);
  const lane = loopLane(broadcastLane, at, greetingRoad);
  const p = blend3(blend3(start.p, platform, contract), [lane.p[0], lane.p[1] + broadcastSize * .5 + .061, lane.p[2]], drive);
  p[1] += Math.sin(drive * Math.PI) * .77;
  return { p, size, yaw: turnTo(lerp(start.yaw, -.08, contract), lane.yaw, drive),
    alpha: 1, tape: ramp(.25, .85, contract), foot: lane.p, at };
}

export function dispatchTruck(shot, route, time = 0) {
  const lap = ramp(6.68, 7.89, shot);
  const sweep = lerp(.088, openHere, lap);
  const exact = (sweep - route.from) / (route.to - route.from);
  const reunion = ramp(7.76, highwayArrival, shot);
  const drift = driveOffset(time) / roadLength * reunion;
  const occupancy = lerp(exact, firstTruckV, reunion) + drift;
  const path = v => loopLane(truckLane, v, route).p;
  return { ...projectTruck(occupancy, path), v: occupancy,
    spin: wheelSpin(sweep - openHere, 175) + wheelSpin(reunion, driveDistance(time) + driveOffset(time)) };
}

export function loopParcel(lane, slot, route, time, delivery = 1) {
  if (lane === truckLane) return null;
  const main = lane === broadcastLane && slot === 0;
  const home = highwayParcel(lane, slot, flatHighway, 0, 0, time);
  const seed = handoverPosition(lane, time);
  const queue = main || lane !== broadcastLane ? slot : slot - 1;
  const greeting = lane === broadcastLane && !main
    ? .465 + queue * .073 + Math.sin(time * .84 + lane * .43) * .026
    : seed + queue * (.975 - seed) / parcelSlots;
  const circuit = .108 + lane * .006 + slot * .104 + Math.sin(time * 1.03 + lane * .58) * .015;
  // Keep the TV parcel a car length ahead while the camera drops behind the truck.
  const formation = main ? .14 * ramp(.04, .26, route.approach) * (1 - ramp(.58, 1, route.approach)) : 0;
  const target = lerp(lerp(greeting, circuit, route.curl), home?.v ?? 1.035, route.approach) + formation;
  const released = ramp(.18 + slot * .026 + lane * .015, .60 + slot * .030 + lane * .017, delivery);
  const granted = main ? 1 : released;
  const at = lerp(target - .026, target, granted);
  const track = loopLane(lane, at, route);
  const volume = main ? 1 : ramp(.17, .82, released);
  const nominal = main ? broadcastSize : .57 + .045 * ((lane + slot * 2) % 4);
  const size = blend3([nominal * volume, nominal * volume, nominal * volume * 1.025], home?.size ?? [0, 0, 0], route.approach);
  const hover = main ? .061 : .061 + .036 * Math.sin(time * 2.8 + slot + lane);
  const homeLift = home ? home.p[1] - home.foot[1] - home.size[1] / 2 : .09;
  const p = [track.p[0], track.p[1] + size[1] / 2 + lerp(hover, homeLift, route.approach), track.p[2]];
  return { p, foot: track.p, size, yaw: turnTo(track.yaw, home?.yaw ?? track.yaw, route.approach), at, alpha: 1,
    tape: lerp(main ? 1 : .94, home?.tape ?? .94, route.approach) };
}

const clearance = .12;
const truckSize = [2.50, 2.96, 7.42];

// Move one package vertically only where the swept road brings two footprints together.
function overtake(box, obstacle, lowerDeck) {
  const dx = box.p[0] - obstacle.p[0];
  const dz = box.p[2] - obstacle.p[2];
  const difference = box.p[1] - obstacle.p[1];
  const space = (obstacle.size[1] + box.size[1]) * .5 + .10;
  if (Math.abs(dx) > 4.5 || Math.abs(dz) > 4.65 || Math.abs(difference) >= space + .045) return false;
  let sideways = -Infinity;
  for (const angle of [box.yaw, box.yaw + Math.PI / 2, obstacle.yaw, obstacle.yaw + Math.PI / 2]) {
    const extent = item => (Math.abs(Math.cos(item.yaw - angle)) * item.size[0]
      + Math.abs(Math.sin(item.yaw - angle)) * item.size[2]) * .5;
    const distance = Math.abs(dx * Math.cos(angle) - dz * Math.sin(angle));
    sideways = Math.max(sideways, distance - extent(box) - extent(obstacle));
  }
  const lift = (lowerDeck ? -space : space) - difference;
  const amount = (1 - ramp(.012, clearance, sideways)) * (1 - ramp(space - .025, space + .045, Math.abs(difference)));
  const movement = lift * amount;
  box.p[1] += movement;
  return Math.abs(movement) > .001;
}

export function clearLoopTraffic(boxes, truck, broadcast) {
  const placed = broadcast ? [broadcast] : [];
  if (truck) placed.push({ p: [truck.p[0], truck.p[1] + 1.48, truck.p[2]], foot: truck.p, size: truckSize, yaw: truck.yaw });
  for (const box of boxes) {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        const other = placed[pass === 1 ? placed.length - 1 - i : i];
        const lowerDeck = pass < 3 && box.foot[1] < (other.foot?.[1] ?? other.p[1]) - 2;
        moved = overtake(box, other, lowerDeck) || moved;
      }
      if (!moved) break;
    }
    placed.push(box);
  }
}
