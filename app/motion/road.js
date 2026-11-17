import { bound, ease, mapPoints } from './projection.js';

const lanes = [-7.34, -5.24, -3.09, 0, 3.19, 5.32, 7.36];
export const laneWidths = [1.45, 1.54, 1.50, 3.64, 1.51, 1.56, 1.61];

export const roadX = z => .38 + 3.1 * Math.sin((z + 1.6) * .111) + .103 * z;
export const roadYaw = z => Math.atan(.3441 * Math.cos((z + 1.6) * .111) + .103);
export const roadRise = i => .04 + (i === 3 ? 0 : .22 + Math.abs(i - 3) * .12 + (i > 3 ? .21 : 0));
export const roadLaneOffset = (lane, z) => lanes[lane] * bound(.975 + z * .0021, .83, 1.02);

export function roadPoint(lane, z) {
  const yaw = roadYaw(z);
  const offset = roadLaneOffset(lane, z);
  return [roadX(z) + Math.cos(yaw) * offset,
    roadRise(lane) + Math.sin(z * .21 + lane * .44) * .072,
    z - Math.sin(yaw) * offset];
}

export function projectTruck(at, path) {
  const center = path(at);
  const next = path(at + .001), previous = path(at - .001);
  const radius = .002 / Math.max(.001, Math.hypot(next[0] - previous[0], next[2] - previous[2]));
  const section = (frontAxle, rearAxle, front, back) => {
    const f = path(at - frontAxle * radius), r = path(at - rearAxle * radius);
    const pitch = Math.atan2(r[1] - f[1], Math.hypot(r[0] - f[0], r[2] - f[2]));
    const p = center.slice();
    p[1] = r[1] - Math.sin(pitch) * rearAxle;
    return { p, yaw: Math.atan2(r[0] - f[0], r[2] - f[2]), pitch, front, back };
  };
  const trailer = section(-1.64, 2.11, -2.18, 3.68);
  const cab = section(-3.22, -1.10, -3.72, -1.78);
  const hinge = -2.00;
  const joint = body => [body.p[0] + Math.sin(body.yaw) * Math.cos(body.pitch) * hinge,
    body.p[1] + Math.sin(body.pitch) * hinge, body.p[2] + Math.cos(body.yaw) * Math.cos(body.pitch) * hinge];
  const hitch = joint(trailer), tractor = joint(cab);
  cab.p[0] += hitch[0] - tractor[0];
  cab.p[2] += hitch[2] - tractor[2];
  const steerAxle = -2.91;
  const steerY = path(at - steerAxle * radius)[1];
  cab.pitch = Math.asin(bound((steerY - hitch[1]) / (steerAxle - hinge), -.45, .45));
  cab.p[1] = hitch[1] - Math.sin(cab.pitch) * hinge;
  return { p: trailer.p, ground: center, yaw: trailer.yaw, pitch: trailer.pitch, trailer, cab };
}

const truckHalfWidth = 1.25;
const truckRear = 3.70;
const truckFront = -3.68;

function local(position, truck) {
  const dx = position[0] - truck.p[0], dz = position[2] - truck.p[2];
  const c = Math.cos(truck.yaw), s = Math.sin(truck.yaw);
  const x = c * dx - s * dz, y = position[1] - truck.p[1], z = s * dx + c * dz;
  const a = Math.cos(truck.pitch ?? 0), b = Math.sin(truck.pitch ?? 0);
  return [x, a * y - b * z, b * y + a * z];
}

export function keepTruckClear(position, lane, [width, height, length], truck) {
  if (!truck) return;
  const [x, y, along] = local(position, truck);
  const radius = Math.hypot(width, length) * .5;
  const outside = Math.max(truckFront - radius - .18 - along, along - truckRear - radius - .18);
  const above = y - height / 2 - 3.11;
  const influence = (1 - ease(bound(outside / 2.5))) * (1 - ease(bound(above / .62)));
  const side = lane < 3 ? -1 : 1;
  const extra = Math.max(0, truckHalfWidth + radius + .28 - x * side) * influence;
  position[0] += extra * side * Math.cos(truck.yaw);
  position[2] -= extra * side * Math.sin(truck.yaw);
}

function rayBox(eye, target, min, max) {
  let start = 0;
  let end = Infinity;
  for (let i = 0; i < 3; i++) {
    const direction = target[i] - eye[i];
    if (Math.abs(direction) < 1e-6) {
      if (eye[i] < min[i] || eye[i] > max[i]) return Infinity;
      continue;
    }
    const a = (min[i] - eye[i]) / direction, b = (max[i] - eye[i]) / direction;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (start > end) return Infinity;
  }
  return start;
}

const trailerMin = [-1.165, .32, -2.2], trailerMax = [1.165, 2.84, 3.64];
const cabMin = [-1.16, .32, -3.62], cabMax = [1.16, 2.74, -1.86];

export function parcelDepth(scene, model, width, height, length, truck) {
  const z = scene.view(model.p)[2];
  if (!truck) return z;
  const trailer = truck.trailer ?? truck, cab = truck.cab ?? truck;
  const eyes = [local(scene.eye, trailer), local(scene.eye, cab)];
  const samples = [model.p,
    mapPoints(model, [-width * .43, height * .38, 0]), mapPoints(model, [width * .43, height * .38, 0]),
    mapPoints(model, [0, -height * .37, -length * .43]), mapPoints(model, [0, -height * .37, length * .43])];
  for (const point of samples) {
    const front = Math.min(rayBox(eyes[0], local(point, trailer), trailerMin, trailerMax),
      rayBox(eyes[1], local(point, cab), cabMin, cabMax));
    if (front !== Infinity) {
      return front < 1 ? Math.max(z, truck.depth + .17) : Math.min(z, truck.depth - .17);
    }
  }
  return z;
}

export function roadOccludesTruck(eye, polygon, truck) {
  const points = polygon.map((point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return [point[0] + (next[0] - point[0]) * .5, point[1] + (next[1] - point[1]) * .5,
      point[2] + (next[2] - point[2]) * .5];
  });
  points.push(...polygon, polygon[0].map((_, axis) => polygon.reduce((sum, p) => sum + p[axis], 0) / polygon.length));
  for (const part of [truck.trailer, truck.cab]) {
    if (!part) continue;
    const origin = local(eye, part);
    const min = [-1.23, .04, part.front], max = [1.23, 2.87, part.back];
    for (const point of points) {
      const hit = rayBox(origin, local(point, part), min, max);
      if (hit > 1.004 && hit < Infinity) return true;
    }
  }
  return false;
}

export function wheelSpin(progress, distance) {
  return ((progress * distance) / .345) % (Math.PI * 2);
}

export function wrapped(value, length) {
  return ((value % length) + length) % length;
}
