import { Projector, blend3, bound, colorMix, ease, lerp, mapPoints, ramp } from './projection.js';
import { keepTruckClear, parcelDepth, roadOccludesTruck, roadRise as rise,
  roadX as routeX, roadYaw as routeYaw, wrapped } from './road.js';
import { deckRear, driveDistance, driveOffset, highwayToConsole, highwayParcel, highwayTruck,
  parcelSlots, railFrame, railWidth, roadEnd, roadStart, truckLane, xChannel } from './highway.js';
import { broadcastLane, circuitCamera, clearLoopTraffic, dispatchTruck, loopLane, loopParcel, loopRoad,
  packedBroadcastPose } from './loop-road.js';
import { circuitPresence, createGreetingFlight, drawParcelPhoto } from './greeting.js';
import { makeConsoleMotion } from './console-motion.js';

const road = 'road', eq = 'equalizer', deck = 'mixer', parcel = 'parcel', unfold = 'unfold', studio = 'studio', chat = 'chat', archive = 'archive', circuit = 'circuit';
const routes = [[road, eq, deck, studio], [road, deck, eq, studio], [road, parcel, unfold, studio]];
const liveRoute = [road, eq, deck, parcel, unfold, chat, archive, circuit, road];
const cameras = {
  [road]: { eye: [-5.45, 7.0, 15.4], aim: [1.25, 1.24, .08], lens: 1.10 },
  [eq]: { eye: [3.9, 3.95, 15.2], aim: [.10, 2.25, -.08], lens: 1.24 },
  [deck]: { eye: [5.1, 10.8, 13.1], aim: [.08, .38, .18], lens: 1.20 },
  [parcel]: { eye: [5.6, 4.45, 11.1], aim: [.23, 1.66, .1], lens: 1.15 },
  [unfold]: { eye: [4.1, 5.0, 13.9], aim: [.20, 1.75, .1], lens: 1.27 },
  [studio]: { eye: [4.5, 5.0, 16.5], aim: [.55, 1.97, -.33], lens: 1.23 },
  [chat]: { eye: [4.8, 5.3, 15.0], aim: [0, 1.55, .1], lens: 1.22 },
  [archive]: { eye: [5.9, 5.9, 18.0], aim: [.30, 1.15, -.35], lens: 1.26 },
};

const liveCameras = {
  [road]: { eye: [.2, 5.8, 14.5], aim: [.9, 1.42, -1.7], lens: 1.10 },
  [eq]: { eye: [3.0, 7.4, 17.2], aim: [.10, 1.71, -.67], lens: 1.15 },
  [deck]: { eye: [4.05, 8.4, 15.5], aim: [.14, .87, -.14], lens: 1.16 },
  [parcel]: { eye: [4.0, 4.5, 12.7], aim: [.39, 1.78, .1], lens: 1.20 },
  [unfold]: { eye: [2.5, 4.3, 14.8], aim: [.16, 1.95, -.46], lens: 1.21 },
  [chat]: { eye: [2.95, 4.48, 15.9], aim: [-.30, 1.33, .0], lens: 1.19 },
  [archive]: { eye: [4.4, 5.8, 16.7], aim: [.50, 1.16, -2.03], lens: 1.19 },
  [circuit]: circuitCamera,
};

const compositions = {
  [road]: [.612, .377, .975],
  [eq]: [.288, .420, .99],
  [deck]: [.293, .457, .955],
  [parcel]: [.61, .426, 1.06],
  [unfold]: [.657, .427, 1.04],
  [chat]: [.245, .432, .97],
  [archive]: [.697, .394, .93],
  [circuit]: [.343, .43, .79],
};
const portraitCompositions = {
  [road]: [.391, .239, 1.29],
  [eq]: [.50, .242, 1.27],
  [deck]: [.51, .239, 1.17],
  [parcel]: [.54, .391, 1.17],
  [unfold]: [.50, .363, 1.09],
  [chat]: [.49, .236, 1.00],
  [archive]: [.63, .255, .89],
  [circuit]: [.50, .249, .98],
};

function interpolate(values, t) {
  const [previous, from, to, next] = values;
  const tangent = (a, b) => a * b <= 0 ? 0 : 2 * a * b / (a + b);
  const left = tangent(from - previous, to - from);
  const right = tangent(to - from, next - to);
  return lerp(from, to, ease(t)) + t * (1 - t) * ((1 - t) * left - t * right);
}

function liveCamera(index, part, narrow, width) {
  const last = liveRoute.length - 2;
  const keys = [liveRoute[Math.max(0, index - 1)], liveRoute[index], liveRoute[index + 1],
    liveRoute[Math.min(last + 1, index + 2)]];
  const cameras = keys.map(key => liveCameras[key]);
  const compact = narrow ? 0 : bound((1040 - width) / 320);
  const composition = keys.map(key => {
    const frame = (narrow ? portraitCompositions : compositions)[key];
    if (key === circuit && compact > 0) return [frame[0] - compact * .017, frame[1], frame[2] * (1 - .17 * compact)];
    return key === road && compact > 0
      ? [frame[0] - compact * .040, frame[1] - compact * .008, frame[2] - compact * .082]
      : frame;
  });
  return {
    eye: [0, 1, 2].map(i => interpolate(cameras.map(camera => camera.eye[i]), part)),
    aim: [0, 1, 2].map(i => interpolate(cameras.map(camera => camera.aim[i]), part)),
    lens: interpolate(cameras.map(camera => camera.lens), part),
    layout: [0, 1, 2].map(i => interpolate(composition.map(frame => frame[i]), part)),
  };
}

const channels = [
  { paint: '#0bc480', level: 2.54, lane: -5.3, along: 1.8 },
  { paint: '#b3e9d5', level: 3.56, lane: -3.67, along: -3.55 },
  { paint: '#18e9a0', level: 4.84, lane: -2.04, along: 2.15 },
  { paint: '#21db91', level: 3.72, lane: 0, along: -6.5 },
  { paint: '#ff9b40', level: 5.46, lane: 2.07, along: -.25 },
  { paint: '#27f5b7', level: 4.02, lane: 3.82, along: -2.30 },
  { paint: '#0cb87f', level: 2.84, lane: 5.52, along: 2.40 },
];

const lead = broadcastLane;
const white = '#dcfff2';
const amber = '#ff973c';
const tape = '#e4fff1';
const count = channels.length;
const meterLevel = (i, frame) => bound(level(i, frame) - .48 + (frame.beat ?? 0) * .50, .34, 4.85);
const meterTop = (i, frame) => frame.meters?.[i] ?? meterLevel(i, frame);
const wave = (i, t) => .52 * Math.sin(t * 3.05 + i * .85)
  + .26 * Math.sin(t * 5.55 + i * 1.41) + .15 * Math.sin(t * 8.9 - i * .72);
const level = (i, frame) => frame.bands
  ? .78 + Math.pow(frame.bands[i] ?? 0, .90) * 4.54 + .20 * Math.sin(i * 1.1)
  : channels[i].level + wave(i, frame.time);
const faderZ = (i, frame) => frame.faders ? lerp(2.36, -2.12, frame.faders[i]) : 3.25 - level(i, frame) * .95;
const roadColors = ['#08a66c', '#10cc87', '#0aa574', '#15db89', '#0da673', '#17df91', '#0ab67b'];
const whiteTrack = '#c0ffe3';
const weight = (kind, a, b, u) => (a === kind ? 1 - u : 0) + (b === kind ? u : 0);

function strip(scene, x, y, start, end, width, paint, alpha = 1, bias = 0) {
  scene.fill([[x - width / 2, y, start], [x + width / 2, y, start],
    [x + width / 2, y, end], [x - width / 2, y, end]], paint, alpha, bias);
}

function plate(scene, view, x, y, z, width, depth, paint, alpha = 1, bias = 0, style) {
  scene.panel(view, [[x - width / 2, y, z + depth / 2], [x + width / 2, y, z + depth / 2],
    [x + width / 2, y, z - depth / 2], [x - width / 2, y, z - depth / 2]], paint, alpha, bias, style);
}

function deckTrack(i, v) {
  return [xChannel(i), .265, lerp(3.15, -2.06, v)];
}

function studioTrack(i, v) {
  return [xChannel(i) * .72, .272, lerp(3.17, -.10, v)];
}

function ribbonEdge(center, before, after) {
  const dx = after[0] - before[0], dz = after[2] - before[2];
  const length = Math.hypot(dx, dz) || 1;
  return { center, x: -dz / length, z: dx / length };
}

function lanePose(kind, i, v, frame) {
  if (kind === road) {
    const z = lerp(11.3, -31, v);
    const spread = .76 + .24 * (1 - v);
    return [routeX(z) + channels[i].lane * spread, rise(i) + Math.sin(z * .25 + i * .5) * .11, z];
  }
  if (kind === eq) {
    return [xChannel(i), .25 + v * level(i, frame), .42 + .12 * (1 - v) ** 2];
  }
  if (kind === deck) return deckTrack(i, v);
  if (kind === studio) return studioTrack(i, v);
  if (kind === chat) {
    const side = (i - 3) * .59;
    return [lerp(side * 1.16 - 1.61, side * .71 + 1.42, v) + Math.sin(v * Math.PI) * 1.54,
      .13 + Math.sin(v * Math.PI) * (1.02 + Math.abs(side) * .35), lerp(8.2, -8.5, v)];
  }
  if (kind === archive) {
    const side = (i - 3) * .84;
    return [side * (1.20 - v * .24) + Math.sin(v * Math.PI * .98) * 1.29,
      -.13 + v * .23 + Math.abs(side) * .08, lerp(8, -12, v)];
  }
  const direction = i < lead ? -1 : 1;
  const close = kind === parcel ? 1 : .72;
  const spread = (i - 3) * 1.48;
  return [
    lerp(spread * 1.28 + direction * 2.1, spread * close - 1.0, v) + Math.sin(v * 3.3) * (i - 3) * .57,
    rise(i) + v * (kind === unfold ? 1.02 : .47),
    lerp(7.2, -12.7, v),
  ];
}

function offsetRibbon(point, width, height = 0) {
  const [x, y, z] = point.center;
  const radius = width * (point.taper ?? 1);
  return [x + point.x * radius, y + height, z + point.z * radius];
}

function ribbonPolygon(scene, a, b, halfWidth, offset, tint, alpha, bias = 0, depth) {
  scene.fill([
    offsetRibbon(a, offset - halfWidth), offsetRibbon(a, offset + halfWidth),
    offsetRibbon(b, offset + halfWidth), offsetRibbon(b, offset - halfWidth),
  ], tint, alpha, bias, depth === undefined ? undefined : { depth });
}

function ribbonSurface(scene, vertices, halfWidth, offset, tint, alpha, depth, axis, lift = 0) {
  if (alpha <= .003) return;
  const left = vertices.map(point => offsetRibbon(point, offset - halfWidth));
  const right = vertices.map(point => offsetRibbon(point, offset + halfWidth)).reverse();
  const gradient = [[0, tint], [.48, tint], [.78, tint + 'bf'], [1, tint + Math.round(lerp(10, 242, lift)).toString(16).padStart(2, '0')]];
  scene.fill(left.concat(right), tint, alpha, 0, { depth, gradient, gradientAxis: axis });
}

function ribbonGradient(scene, vertices) {
  const near = scene.point(vertices[Math.floor(vertices.length * .24)].center);
  const far = scene.point(vertices.at(-1).center);
  return near && far ? [near, far] : undefined;
}

function ribbons(scene, a, b, u, frame) {
  const time = frame.time;
  const movingRoad = weight(road, a, b, u);
  const vertical = frame.live ? 0 : weight(eq, a, b, u);
  const mixer = weight(deck, a, b, u);
  const receiving = weight(parcel, a, b, u) + weight(unfold, a, b, u);
  const air = weight(studio, a, b, u);
  const greetings = weight(chat, a, b, u);
  const records = weight(archive, a, b, u);
  const fadeIntoConsole = (1 - ramp(.37, 1, mixer + air)) * (1 - .99 * ramp(.51, 1, vertical));
  if (fadeIntoConsole < .009) return;
  const n = 36;
  for (let i = 0; i < count; i++) {
    const tint = channels[i].paint;
    const roadTint = i % 2 === 0 ? '#15cd8a' : '#0ca771';
    const roadWidth = i === 3 ? 1.94 : 1.19;
    const width = movingRoad * roadWidth + vertical * .49 + mixer * .83 + air * .47 + receiving * .49 + greetings * .22 + records * .29;
    const center = Array.from({ length: n + 1 }, (_, step) => {
      const v = step / n;
      return blend3(lanePose(a, i, v, frame), lanePose(b, i, v, frame), u);
    });
    const vertices = center.map((point, j) => ribbonEdge(point, center[Math.max(0, j - 1)], center[Math.min(n, j + 1)]));
    for (let j = 0; j < n; j++) {
      const v = (j + .5) / n;
      const p = vertices[j], q = vertices[j + 1];
      const ends = ramp(0, .10, v) * (1 - ramp(.60, 1, v));
      const far = 1 - .97 * ramp(.45, 1, v);
      const motion = (.5 + .5 * Math.sin(time * 8.2 + v * 38 + i * 1.31)) ** 8;
      const pulse = frame.bands ? motion * .74 + (frame.bands[i] ?? 0) * .26 : motion;
      const span = lerp(ends, far, movingRoad);
      const power = span * fadeIntoConsole * (1 - .38 * receiving);
      const darkPaint = colorMix(colorMix('#156250', tint, .20 + pulse * .16), roadTint, movingRoad * .92);
      const edge = colorMix('#22d595', '#e5fff2', .24 + pulse * .52);
      ribbonPolygon(scene, p, q, width * .57, 0, '#073c34', power * (.45 + .51 * movingRoad), .045);
      ribbonPolygon(scene, p, q, width * .485, 0, darkPaint, power * (.53 + .47 * movingRoad), .018);
      ribbonPolygon(scene, p, q, width * .051, width * .397, edge, power * (.49 + .47 * movingRoad), -.034);
      ribbonPolygon(scene, p, q, width * .033, -width * .31, '#b9ffe4', power * (.72 * movingRoad + .19 * receiving), -.032);
      ribbonPolygon(scene, p, q, width * .055, width * .07, i === lead ? amber : whiteTrack,
        pulse * power * (.91 * movingRoad + .44 * receiving + .58 * greetings + .41 * records), -.041);
    }
  }
}

const onConsole = highwayToConsole(1);
const onHighway = highwayToConsole(0);
const homeCourse = loopRoad(8);

function drawHighway(scene, frame, motion, amount = 1, dispersal = 0, course, tracksOnly = false) {
  if (amount < .008) return;
  const segments = 44;
  const onPanel = motion.cover;
  const display = motion.feed * (1 - ramp(.05, .45, dispersal));
  const panelDepth = consoleDepth(scene);
  const transport = amount * (1 - onPanel);
  if (course && transport > .013) {
    drawLoopRoad(scene, frame, course, { highway: motion, amount: transport });
    drawFloatingLoop(scene, frame, course);
  }
  const console = frame.wake === undefined ? undefined : frame;
  for (let i = 0; i < count; i++) {
    const color = channels[i].paint;
    const roadPaint = roadColors[i];
    const width = railWidth(i, motion, 1, frame.time);
    const roadDepth = 96 + Math.abs(i - truckLane) * .19;
    const bed = lerp(roadDepth, panelDepth - .026, onPanel ** .55);
    if (!course || onPanel > .003) {
      const rail = Array.from({ length: segments + 1 }, (_, k) => {
        const v = k / segments;
        const { p, across } = railFrame(i, v, motion);
        return { center: p, x: across[0], z: across[2], taper: railWidth(i, motion, v, frame.time) / width };
      });
      const axis = ribbonGradient(scene, rail);
      const surface = (half, inset, tint, alpha, depth) => ribbonSurface(scene, rail,
        width * half, width * inset, tint, amount * alpha * (course ? onPanel : 1), depth, axis, motion.cover);
      surface(lerp(.545, .49, onPanel), 0, colorMix('#07443b', '#315f55', onPanel), .97, bed + .009);
      surface(lerp(.484, .385, onPanel), 0, colorMix(roadPaint, '#0c292c', onPanel), 1, bed);
      surface(lerp(.23, .079, onPanel), lerp(-.22, 0, onPanel), '#061c1e', .23 + onPanel * .72, bed - .013);
      surface(lerp(.031, .021, onPanel), lerp(.447, .388, onPanel), colorMix('#bcffe7', '#82e6c5', onPanel), .95, bed - .021);
      surface(.017, lerp(-.447, -.389, onPanel), '#74ffc2', .74, bed - .028);

      for (let k = 0; k < segments; k++) {
        const v = (k + .5) / segments;
        const pulse = (.5 + .5 * Math.sin(37 * v + frame.time * 7.2 + i * 1.33)) ** 8;
        const strength = 1 - .90 * ramp(.72, 1, v) * (1 - onPanel);
        const power = (.27 * (frame.wake ?? 1) + (frame.bands?.[i] ?? 0) * .34 + frame.beat * .39) * onPanel + (1 - onPanel) * .92;
        ribbonPolygon(scene, rail[k], rail[k + 1], width * lerp(.075, .026, onPanel), width * .08,
          i === lead ? '#ffba6b' : whiteTrack, pulse * amount * strength * power * (course ? onPanel : 1), 0,
          bed - .049);
      }
    }

    if (tracksOnly) continue;
    let lowerParcel;
    for (let slot = 0; slot < parcelSlots; slot++) {
      const box = highwayParcel(i, slot, motion, meterTop(i, frame), faderZ(i, frame), frame.time, lowerParcel, console);
      if (!box) continue;
      const isFader = slot === 0;
      if (!isFader) lowerParcel = { p: box.p.slice(), size: box.size };
      const away = isFader ? 0 : ramp(.02 + slot * .018, .33 + slot * .04, dispersal);
      const volume = isFader ? 1 : Math.sqrt(amount) * (1 - away);
      if (volume < .033) continue;
      box.size = box.size.map(value => value * volume);
      box.p[1] -= away * Math.min(1.9, box.rise * .62);
      const [x, y, z] = box.foot;
      const [boxWidth] = box.size;
      if (course && transport > .025 && boxWidth > .035 && box.rise < .19) {
        box.at = box.v;
        drawLoopParcel(scene, frame, i, box, course, motion, transport);
      } else if (!course && transport > .025 && boxWidth > .15 && box.rise < .19) {
        const tail = railFrame(i, box.v - (isFader ? .037 : .026), motion).p;
        const half = boxWidth * .27;
        scene.contactShadow([x, y + .026, z], boxWidth * 1.66, boxWidth * 2.13, box.yaw, transport * .72, 77);
        scene.fill([[x - half, y + .046, z], [x + half, y + .046, z],
          [tail[0] + half * .22, tail[1] + .037, tail[2]], [tail[0] - half * .22, tail[1] + .037, tail[2]]],
        color, transport * .70, 0, { depth: 81, gradient: [[0, color + '9a'], [1, color + '00']] });
      }
      box.seated = isFader ? onPanel : 0;
      if (frame.truck) keepTruckClear(box.p, i, box.size, frame.truck);
      const luminescence = isFader ? 0 : display * (.055 + (frame.bands?.[i] ?? 0) * .21 + frame.beat * .13);
      const pigment = colorMix(highwayCartonColor(i, frame, onPanel), i === lead ? '#ffd19c' : '#b6ffdc', luminescence);
      if (isFader) box.grip = ramp(.55, .99, box.seated);
      drawBox(scene, box, pigment, 1, frame.truck);
    }
  }
}

function highwayCartonColor(lane, frame, cover) {
  const base = colorMix(roadColors[lane], channels[lane].paint, .82);
  return colorMix(base, lane === lead ? '#ffce90' : '#b8ffdf', .04 + (frame.bands?.[lane] ?? 0) * cover * .15);
}

function consoleDepth(scene) {
  return scene.view([0, .25, .20])[2];
}

function drawConsoleDisplay(scene, frame, motion, amount, dispersal) {
  if (amount < .008) return;
  const live = amount * (1 - ramp(.06, .44, dispersal));
  const growth = ramp(.79, 1, motion.phase);
  const depth = consoleDepth(scene);
  const order = { depth: depth - .019 };
  const stage = scene.object([0, 0, deckRear]);
  plate(scene, stage, 0, .294, .019, 9.07, .72 * growth, '#081f24', growth, -.012, order);
  plate(scene, stage, 0, .299, -.18 * growth, 8.86, .043, '#55a687', growth * .79, -.020, order);
  for (let i = 0; i < count; i++) {
    const { p, yaw } = railFrame(i, 1, motion);
    const inlet = scene.object(p, yaw);
    const tint = channels[i].paint;
    const height = meterTop(i, frame);
    const intensity = bound(height / 4.6);
    const inRail = railWidth(i, motion, 1, frame.time);
    const entryOrder = { depth: lerp(79, depth - .11, growth) };
    scene.case(inlet, [0, -.017, 0, inRail * .94, .108, .39 + .21 * growth, '#112f2d'], 1, .047, entryOrder.depth + .025);
    plate(scene, inlet, 0, .046, .026, inRail * .76, .104, tint,
      amount * (.15 + .23 * (frame.wake ?? 1) + intensity * .37 + frame.beat * .28), -.019, entryOrder);
    if (live < .014) continue;
    const column = .53 + height;
    for (const side of [-.505, .505]) {
      const start = mapPoints(inlet, [side, .057, -.10]);
      scene.line([start, [start[0], start[1] + column * .69, start[2] - .13]], tint,
        live * (.12 + .14 * (frame.wake ?? 1) + intensity * .23 + frame.beat * .21), 1.14, .19);
    }
    const kick = frame.beat * (i < 2 ? 1 : .42);
    if (kick > .025) {
      const top = mapPoints(inlet, [0, .23 + height, -.14]);
      const foot = mapPoints(inlet, [0, .095, -.14]);
      scene.line([foot, top], i === lead ? '#ffbd75' : '#84ffd1', live * kick * .55, 1.95, -.042, true);
    }
  }
}

const loopRailColors = ['#0f9668', '#13ba7d', '#0fa575', '#16d290', '#149a72', '#1ad393', '#129774'];

const backgroundArc = { curl: 1, approach: 0, from: .297, to: .649 };

function drawFloatingLoop(scene, frame, route) {
  const growth = ramp(.55, .995, route.approach) * (1 - ramp(.06, .41, frame.roadProgress));
  const light = ramp(0, .18, growth);
  if (light <= .003) return;
  const n = 33;
  for (const lane of [0, 1, 2]) {
    const points = Array.from({ length: n + 1 }, (_, i) => {
      const v = i / n;
      const spine = loopLane(lane, lerp(1, v, growth), backgroundArc);
      return { center: [spine.p[0] - 20.2, spine.p[1] + 2.3, spine.p[2] - 14.0],
        x: Math.cos(spine.yaw), z: -Math.sin(spine.yaw) };
    });
    const axis = ribbonGradient(scene, points);
    const width = (.64 + .18 * lane) * growth;
    ribbonSurface(scene, points, width, 0, '#0a554c', .98 * light, 103 + lane * .1, axis);
    ribbonSurface(scene, points, width * .92, 0, '#11ad7b', .84 * light, 102 + lane * .1, axis);
    ribbonSurface(scene, points, width * .053, width * .82, '#a7ffdc', .90 * light, 101 + lane * .1, axis);
    for (let i = 0; i < n; i++) {
      const v = i / n;
      const pulse = (.5 + .5 * Math.sin(v * 32 + frame.time * 7.8 + lane)) ** 11;
      if (pulse < .08) continue;
      ribbonPolygon(scene, points[i], points[i + 1], width * .13, -width * .14,
        '#bcffe1', pulse * .72 * light, 0, 100 + lane * .1);
    }
  }
}

function trackPoint(lane, v, route, highway, time) {
  if (!highway) return loopLane(lane, v, route);
  const { p, yaw } = railFrame(lane, v, highway);
  return { p, yaw, width: railWidth(lane, highway, v, time) };
}

function drawLoopRoad(scene, frame, route, { entry = 1, delivery = 1, broadcast, highway, amount = 1 } = {}) {
  const { approach, curl } = route;
  const segments = 104;
  const circuitDetail = ramp(.40, .90, curl) * (1 - ramp(.38, .94, approach));
  const material = ramp(.12, .76, entry);
  const roadway = approach * (1 - (highway?.narrow ?? 0));
  const film = driveDistance(frame.time);
  const markPhase = frame.time * 11.7;
  const traffic = [];
  for (let lane = 0; lane < count; lane++) {
    const tint = colorMix(channels[lane].paint, roadColors[lane], .65);
    const vertices = Array.from({ length: segments + 1 }, (_, index) => {
      const v = index / segments;
      const track = trackPoint(lane, v, route, highway, frame.time);
      const center = entry === 1 ? track.p : blend3(lanePose(unfold, lane, v, frame), track.p, entry);
      return { center, x: Math.cos(track.yaw), z: -Math.sin(track.yaw), width: lerp(.49, track.width, material) };
    });
    const railPaint = colorMix(colorMix('#1c5952', loopRailColors[lane], material), roadColors[lane], approach);
    const dark = colorMix('#082d31', '#031e26', material);
    const dispatch = lane === frame.dispatchLane ? frame.dispatchRoom : 0;
    for (let index = 0; index < segments; index++) {
      const a = vertices[index], b = vertices[index + 1];
      const v = (index + .5) / segments;
      const veil = .83 * ramp(.55, .97, v) * approach;
      const farTint = colorMix(railPaint, '#07524a', veil);
      const phase = v * lerp(39, Math.PI * 12, curl * (1 - approach)) + markPhase + lane * .95;
      const pulse = (.5 + .5 * Math.sin(phase)) ** 10;
      const width = (a.width + b.width) * .25;
      const lit = .71 + pulse * .29;
      const prepared = ramp(0, .10, v) * (1 - ramp(.60, 1, v)) * .43;
      const opacity = amount * lerp(prepared, 1, material);
      const floor = scene.view(blend3(a.center, b.center, .5))[2];
      const deck = colorMix(farTint, '#6fffbd', pulse * .091);
      const wall = lerp(.05, .21, circuitDetail);
      const edge = colorMix('#a4fddb', '#54b292', veil);
      const belowCamera = ramp(.37, .67, approach);
      const left = [offsetRibbon(a, -a.width * .5), offsetRibbon(b, -b.width * .5)];
      const right = [offsetRibbon(a, a.width * .5), offsetRibbon(b, b.width * .5)];
      // Overlap the antialiased edges along the same rails, including on bends.
      const corners = [blend3(...left, -.031), blend3(...right, -.031),
        blend3(...right, 1.031), blend3(...left, 1.031)];
      const top = corners.map(point => scene.view(point));
      if (scene.visible(top)) {
        const truck = frame.truck;
        const underTruck = truck && lane === truckLane && Math.abs(v - truck.v) < .10
          && a.center[1] < truck.p[1] + .85 && b.center[1] < truck.p[1] + .85;
        const overlaps = truck && !underTruck && Math.abs(floor - truck.depth) < 13
          && roadOccludesTruck(scene.eye, corners, truck);
        const sort = lerp(floor + .34, 80.5, belowCamera);
        const sorting = underTruck ? Math.max(sort, truck.depth + .47)
          : overlaps ? Math.min(sort, truck.depth - .24) : sort;
        const band = (half, offset, color, alpha, order, start = 0, end = 1) => {
          const lo = (1 + (offset - half) / width) * .5;
          const hi = (1 + (offset + half) / width) * .5;
          const lower = blend3(top[0], top[1], lo), higher = blend3(top[0], top[1], hi);
          const endLower = blend3(top[3], top[2], lo), endHigher = blend3(top[3], top[2], hi);
          const span = start === 0 && end === 1 ? [lower, higher, endHigher, endLower]
            : [blend3(lower, endLower, start), blend3(higher, endHigher, start),
              blend3(higher, endHigher, end), blend3(lower, endLower, end)];
          scene.surface(span, color, alpha, sorting + order, true);
        };
        scene.surface(top, deck, opacity, sorting, true);
        if (circuitDetail > .008) {
          for (const side of [-1, 1]) {
            const first = side < 0 ? 0 : 1, last = side < 0 ? 3 : 2;
            const lowered = ([x, y, z]) => scene.view([x, y - wall, z]);
            scene.surface([top[first], lowered(corners[first]), lowered(corners[last]), top[last]],
            side < 0 ? '#124c46' : '#176b55', opacity * circuitDetail, sorting + .025);
          }
        }
        band(width * .40, -width * .34, dark, .31 * material * amount, -.013);
        band(width * .052, -width * .934, '#164f47', opacity * .90, -.018);
        band(width * .052, width * .934, '#185b51', opacity * .88, -.018);
        band(width * .019, -width * .877, edge, opacity * (.69 + .25 * lit), -.021);
        band(width * .028, width * .865, tint, opacity * (.77 + .21 * pulse), -.022);
        if (dispatch > .01) {
          band(width * .043, -width * .65, '#edffd7', opacity * dispatch * (.38 + .45 * pulse), -.046);
          band(width * .043, width * .65, '#edffd7', opacity * dispatch * (.38 + .45 * pulse), -.046);
        }
        if (pulse > .025) {
          band(width * .11, .13 * width, lane === lead ? '#ffd093' : whiteTrack,
            pulse * (.94 - veil * .66) * opacity, -.032);
        }
        // Staggered markings follow their own rail around the overpass.
        if (index % 4 === (lane + 1) % 2 && circuitDetail > .04) {
          band(width * .028, width * .49, lane === lead ? '#ffc879' : '#afffe5', circuitDetail * .83, -.039, .21, .68);
        }
        if (lane === truckLane && index % 6 === 2 && roadway < .99) {
          for (const side of [-1, 1]) {
            band(width * .067, width * side * .72, side > 0 ? '#ffc471' : '#c5ffeb', opacity * .67 * (1 - roadway), -.044, .30, .49);
          }
        }
        if (roadway > .01) {
          const distance = v * (roadStart - roadEnd) + film + lane * .72;
          const dash = .5 + .5 * Math.sin(distance * (lane === truckLane ? 1.10 : .62));
          const moving = dash ** (lane === truckLane ? 3.2 : 7.5) * opacity * roadway;
          if (moving > .017) {
            if (lane === truckLane) {
              band(width * .037, width * -.68, '#e0ffed', moving * .96, -.052);
              band(width * .022, width * .68, '#ffbc68', moving * .88, -.054);
            } else {
              band(width * .028, width * -.59, '#a6ffda', moving * .72, -.051);
            }
          }
        }
      }
    }

    if (highway || entry < .999 || delivery < .17 || lane === truckLane) continue;
    const guestSpace = 1 - Math.max(dispatch ?? 0, frame.greetingLanes?.includes(lane) ? frame.greetingRoom : 0);
    if (guestSpace < .018) continue;
    for (let slot = 0; slot < parcelSlots; slot++) {
      if (lane === lead && slot === 0 && broadcast) continue;
      const box = loopParcel(lane, slot, route, frame.time, delivery);
      if (box && box.size[0] >= .035) {
        box.alpha *= guestSpace;
        box.size = box.size.map(value => value * Math.sqrt(guestSpace));
        traffic.push({ ...box, lane, slot });
      }
    }
  }
  const priority = traffic.findIndex(box => box.lane === lead && box.slot === 0);
  if (priority > 0 && delivery === 1) traffic.unshift(...traffic.splice(priority, 1));
  const merge = ramp(.69, .99, approach);
  const deckHeights = merge ? traffic.map(box => box.p[1]) : null;
  clearLoopTraffic(traffic, frame.truck, broadcast);
  for (const [index, box] of traffic.entries()) {
    if (deckHeights) {
      box.p[1] = lerp(box.p[1], deckHeights[index], merge);
      const highwayPosition = box.p.slice();
      keepTruckClear(highwayPosition, box.lane, box.size, frame.truck);
      box.p = blend3(box.p, highwayPosition, merge);
    }
    const paint = loopCartonColor(box.lane, frame, route);
    drawLoopParcel(scene, frame, box.lane, box, route);
    drawBox(scene, box, paint, 1, frame.truck);
  }
}

const loopCartonColor = (lane, frame, route) =>
  colorMix(highwayCartonColor(lane, frame, 0), channels[lane].paint, 1 - route.approach);

function drawLoopParcel(scene, frame, lane, box, route, highway, amount = 1) {
  const paint = loopCartonColor(lane, frame, route);
  const [x, y, z] = box.foot;
  const width = box.size[0];
  const depth = scene.view(box.foot)[2] - .66;
  scene.contactShadow([x, y + .018, z], width * 1.81, width * 2.08, box.yaw, .66 * amount, depth);
  if (box.at > .045) {
    const behind = trackPoint(lane, Math.max(0, box.at - .028), route, highway, frame.time);
    const head = ribbonEdge([x, y + .021, z], behind.p, box.foot);
    const end = { ...head, center: [behind.p[0], behind.p[1] + .023, behind.p[2]] };
    scene.fill([offsetRibbon(head, -width * .21), offsetRibbon(head, width * .21),
      offsetRibbon(end, width * .045), offsetRibbon(end, -width * .045)], paint, .43 * amount, -.036,
    { depth: depth + .08, gradient: [[0, paint + 'ab'], [1, paint + '00']] });
  }
}

function parcelPose(kind, i, frame, variant) {
  const t = frame.time;
  const item = channels[i];
  if (kind === road) {
    const z = item.along + .55 * Math.sin(t * 2.2 + i * .85);
    const scale = i === lead ? .93 : .57 + .14 * (i % 3);
    return { p: [routeX(z) + item.lane * (.94 + z * .006), rise(i) + .09 + scale / 2, z],
      size: [scale, scale, scale * 1.06], yaw: routeYaw(z) + .10 * Math.sin(t + i), alpha: 1, tape: 1 };
  }
  if (kind === eq) {
    if (frame.live) {
      return highwayParcel(i, 0, onConsole, meterTop(i, frame), faderZ(i, frame), t);
    }
    return { p: [xChannel(i), level(i, frame) + .52, .42],
      size: [.69, .50, .60], yaw: .03 * Math.sin(i + t * 2.1), alpha: 1, tape: .8 };
  }
  if (kind === deck) {
    if (frame.live) return { ...highwayParcel(i, 0, onConsole, meterTop(i, frame), faderZ(i, frame), t), grip: 1 };
    return { p: [xChannel(i), .535, faderZ(i, frame)], size: [.87, .285, .76], yaw: 0, alpha: 1, tape: .58 };
  }
  if (kind === parcel) {
    const isLead = i === lead;
    return { p: isLead ? [.38, 1.85 + .09 * Math.sin(t * 2), .25]
      : [xChannel(i) * 1.62 - 1.6, .73 + .2 * Math.sin(i + t * 1.15), -3.4 - i % 3 * 2.1],
    size: isLead ? (frame.live ? [2.78, 2.78, 2.58] : [3.00, 2.53, 2.29]) : [.58, .60, .59], yaw: isLead ? -.15 : .2 + i * .03,
    alpha: isLead || frame.live ? 1 : .48, tape: 1 };
  }
  if (kind === unfold) {
    return { p: i === lead ? [.18, 2.17, -.38] : [xChannel(i) * .9, .55, .8 + (i % 3) * .38],
      size: i === lead ? [5.12, 2.88, .34] : [.67, .23, .52], yaw: i === lead ? -.08 : 0,
      alpha: i === lead ? 1 : .84, tape: i === lead ? .22 : .44 };
  }
  if (kind === chat) {
    const v = (i === lead ? .46 : .13 + i * .114) + .035 * Math.sin(t * 1.7 + i);
    const position = lanePose(chat, i, v, frame);
    position[1] += i === lead ? .55 : .33;
    return { p: position, size: i === lead ? [1.40, 1.22, 1.24] : [.58, .53, .61],
      yaw: -.27 + .13 * Math.sin(t * 1.3 + i), alpha: i === lead ? 1 : .91, tape: .96 };
  }
  if (kind === archive) {
    const v = .10 + i * .115 + .04 * Math.sin(t * 1.1 + i);
    const position = lanePose(archive, i, v, frame);
    position[1] += .43;
    return { p: position, size: [.64, .45, .54], yaw: .14, alpha: .58, tape: .77 };
  }
  if (i === lead && variant !== 2) {
    return { p: [3.64, 4.53, -2.86], size: [.44, .27, .25], yaw: 0, alpha: 1, tape: .05 };
  }
  if (i === lead) {
    return { p: [.21, 2.42, -2.75], size: [7.15, 4.04, .61], yaw: 0, alpha: 1, tape: 0 };
  }
  return { p: [xChannel(i) * .72, .50, 1.44 + faderZ(i, frame) * .63],
    size: [.56, .19, .45], yaw: 0, alpha: .96, tape: .52 };
}

function transitionParcel(a, b, frame, i, u, variant) {
  const s = parcelPose(a, i, frame, variant), d = parcelPose(b, i, frame, variant);
  let p = blend3(s.p, d.p, u);
  if (frame.live && a === deck && b === parcel) {
    const arc = Math.sin(Math.PI * u) ** 2;
    p[1] += arc * (i === lead ? 1.10 : .41 + (i % 3) * .16);
    p[2] += arc * (i === lead ? .44 : -.41);
  }
  if (i === lead && a !== parcel && b !== parcel && variant !== 2) {
    const lift = Math.sin(Math.PI * u) ** 2;
    p[1] += lift * (b === studio ? 1.25 : .48);
    p[2] += lift * (b === studio ? .15 : .38);
  }
  const size = blend3(s.size, d.size, u);
  keepTruckClear(p, i, size, frame.truck);
  return {
    p, size,
    yaw: s.yaw + (wrapped(d.yaw - s.yaw + Math.PI, 2 * Math.PI) - Math.PI) * u,
    alpha: lerp(s.alpha, d.alpha, u), tape: lerp(s.tape, d.tape, u), grip: lerp(s.grip ?? 0, d.grip ?? 0, u),
    seated: weight(deck, a, b, u) + (i === lead ? 0 : weight(studio, a, b, u)),
  };
}

function drawBox(scene, transform, tint, opacity = 1, truck = null) {
  const a = transform.alpha * opacity;
  if (a < .008) return;
  const [w, h, d] = transform.size;
  const model = scene.object(transform.p, transform.yaw, 1, transform.pitch);
  const z = transform.depth ?? parcelDepth(scene, model, w, h, d, truck);
  const seating = ramp(.22, 1, transform.seated ?? 0);
  const consoleDepth = scene.view([0, .25, .20])[2] - .27;
  const depth = lerp(z, Math.min(z, consoleDepth), seating);
  scene.group(depth, () => paintBox(scene, transform, model, tint, a));
}

function paintBox(scene, transform, model, tint, a) {
  const [w, h, d] = transform.size;
  const order = { depth: 0 };
  scene.case(model, [0, 0, 0, w, h, d, tint], a, Math.min(w, h, d) * .079, 0);
  drawParcelPhoto(scene, model, transform.size, transform.photo, a);
  if (transform.grip > .01 && model.localEye[1] > h * .5) {
    for (const offset of [-.32, -.20, .20, .32]) {
      plate(scene, model, w * offset, h * .505, 0, w * .047, d * .69,
        '#143d38', a * transform.grip * .67, -.015, order);
    }
  }
  if (transform.tape < .035) return;
  const tapeAlpha = a * transform.tape;
  const tw = Math.max(.022, w * .135);
  const td = Math.max(.022, d * .145);
  if (model.localEye[1] > h / 2) {
    plate(scene, model, 0, h * .507, 0, tw, d * .91, tape, tapeAlpha, -.036, order);
    plate(scene, model, 0, h * .509, 0, w * .91, td, tape, tapeAlpha * .94, -.038, order);
  }
  if (model.localEye[2] > d / 2) {
    scene.rect(model, 0, h * .183, d * .502, tw, h * .62, tape, tapeAlpha, -.025, order);
    if (Math.min(w, d, h) > .78) {
      scene.rect(model, 0, -h * .358, d * .503, w * .82, h * .011, '#07352f', a * .48, -.026, order);
      scene.rect(model, w * .239, -h * .245, d * .503, w * .21, h * .17, '#f1daba', tapeAlpha * .69, -.027, order);
      for (let i = 0; i < 4; i++) scene.rect(model, w * (.164 + i * .043), -h * .245,
        d * .504, w * (i % 2 ? .018 : .008), h * .11, '#3a5748', tapeAlpha * .77, -.033, order);
    }
  }
  for (const side of [-1, 1]) {
    if ((model.localEye[0] - side * w * .5) * side < 0) continue;
    scene.panel(model, [[side * w * .503, h * .49, -td * .5], [side * w * .503, h * .49, td * .5],
      [side * w * .503, h * .06, td * .5], [side * w * .503, h * .06, -td * .5]], tape, tapeAlpha * .76, -.026, order);
  }
}

function roadParcels(scene, time, amount) {
  if (amount < .012) return;
  for (let i = 0; i < 16; i++) {
    const row = (i * 3 + 2) % count;
    const flight = ((i * 4.817 + time * 2.55) % 24.3) / 24.3;
    const z = lerp(-4.9, -28, flight);
    const size = .38 + .18 * (i % 4) / 3;
    const x = routeX(z) + channels[row].lane * (.94 + z * .006);
    const y = rise(row) + size / 2 + .11;
    const alpha = amount * ramp(0, .09, flight) * (1 - ramp(.61, 1, flight));
    if (alpha <= .012) continue;
    drawBox(scene, { p: [x, y, z], size: [size, size, size], yaw: routeYaw(z), alpha, tape: .7 },
      i % 6 === 1 ? '#ffa854' : channels[row].paint);
    const after = z + 1.54;
    const before = z + .30;
    scene.line([[routeX(after) + channels[row].lane * (.94 + z * .006), y - size * .44, after],
      [routeX(before) + channels[row].lane * (.94 + z * .006), y - size * .44, before]], '#8dffca', alpha * .47, 1.3, -.008);
  }
}

function drawTruck(scene, frame, roadAmount, logo) {
  const phase = frame.roadProgress;
  const truck = frame.truck;
  if (frame.live ? !truck : roadAmount < .009) return;
  const z = truck?.z ?? 2.32 + .13 * Math.sin(frame.time * 2.1) - (1 - roadAmount) * 5.4;
  const amount = frame.live ? 1 : roadAmount;
  const scale = frame.live ? 1 : .72;
  const position = truck?.p ?? [routeX(z), rise(3) + .06, z];
  const yaw = truck?.yaw ?? routeYaw(z);
  const model = scene.object(position, yaw, scale, truck?.pitch);
  const tractor = truck?.cab ? scene.object(truck.cab.p, truck.cab.yaw, scale, truck.cab.pitch) : model;
  const [gx, gy, gz] = truck?.ground ?? position;
  const ground = [gx, gy + .032, gz + .06];
  const shadowDepth = truck ? lerp(truck.depth + .05, 76.9, frame.roadFloor ?? 1) : undefined;
  scene.contactShadow(ground, 3.78 * model.scale, 9.95 * model.scale, yaw, amount * scale * .85, shadowDepth);
  scene.contactShadow(ground, 2.49 * model.scale, 8.08 * model.scale, yaw, amount * scale * .81,
    shadowDepth === undefined ? undefined : shadowDepth - .10);
  const rotation = truck?.spin ?? frame.time * 12 + phase * 19;
  const paint = () => paintTruck(scene, rotation, model, tractor, amount, logo);
  if (truck) scene.group(truck.depth, paint);
  else paint();
}

function paintTruck(scene, rotation, model, tractor, amount, logo) {
  const body = [
    [0, .46, .06, 1.93, .33, 7.03, '#133e3b'],
    [0, .64, .58, 2.18, .19, 5.93, '#102c2d'],
    [0, 1.74, .68, 2.29, 2.12, 5.63, '#0ab671'],
    [0, .61, 3.53, 2.16, .14, .17, '#25504a'],
    [0, .33, 3.51, 1.90, .10, .14, '#203d37'],
    [0, 2.811, 3.481, 2.31, .049, .066, '#d8f4e9'],
    [0, 2.814, -2.145, 2.29, .052, .075, '#e0fff3'],
  ];
  for (const part of body) scene.solid(model, part, amount, { glossy: part[1] > .71 });
  for (const part of [
    [0, .97, -2.76, 2.10, .79, 1.74, '#0a905c'],
    [0, 1.92, -2.75, 2.01, 1.31, 1.62, '#10ac68'],
    [0, 2.632, -2.72, 1.91, .142, 1.48, '#19cf82'],
    [0, 2.09, -3.574, 1.76, .62, .040, '#154747'],
    [0, 2.708, -2.69, 1.95, .050, .099, '#b7f7dd'],
    [0, .63, -3.56, 2.03, .13, .16, '#234a41'],
  ]) scene.solid(tractor, part, amount, { glossy: true });
  const roof = [[-1.107, 2.819, -2.09], [1.107, 2.819, -2.09], [1.107, 2.819, 3.45], [-1.107, 2.819, 3.45]];
  scene.panel(model, roof, '#15ca83', amount, -.065, { gradient: [
    [0, '#4cffb1'], [.24, '#23e693'], [.61, '#12c980'], [1, '#09ad70'],
  ] });
  const back = scene.view(mapPoints(model, [0, 1.737, 3.54]))[2];
  const backPanel = { depth: back };
  if (model.localEye[2] > 3.54) {
    scene.rect(model, 0, 1.737, 3.515, 2.192, 2.018, '#173a39', amount, -.072, backPanel);
    scene.rect(model, 0, 1.736, 3.55, .025, 1.922, '#709c8c', amount, -.117, backPanel);
  }
  for (const side of [-1, 1]) {
    const door = side * .539;
    if (model.localEye[2] > 3.54) {
      scene.rect(model, door, 1.738, 3.523, 1.032, 1.938, '#092828', amount, -.08,
        { ...backPanel, glossy: true, light: .96 });
      scene.rect(model, door + side * .472, 1.736, 3.535, .023, 1.887, '#7da294', amount, -.10, backPanel);
      scene.rect(model, door - side * .136, 1.736, 3.54, .022, 1.839, '#486f60', amount, -.103, backPanel);
      scene.rect(model, door - side * .112, 1.018, 3.548, .187, .029, '#87ac9a', amount, -.107, backPanel);
      for (const yy of [1.11, 2.39]) {
        scene.rect(model, door + side * .457, yy, 3.544, .120, .039, '#628b7c', amount, -.106, backPanel);
      }
      scene.rect(model, side * .82, .47, 3.626, .261, .108, '#ffa15a', amount, -.112, { ...backPanel, glow: 4 });
      scene.rect(model, side * .67, .47, 3.629, .065, .102, '#f4ffea', amount, -.118, backPanel);
      scene.rect(model, side * .64, .612, 3.625, .63, .029, '#7fcbb0', amount * .81, -.113, backPanel);
      scene.rect(model, door + side * .29, .85, 3.552, .106, .045, '#e8b578', amount, -.119, backPanel);
    }
    scene.solid(model, [side * 1.151, 2.799, .672, .053, .069, 5.61, '#e9fff7'], amount, { bias: -.040 });
    scene.solid(model, [side * 1.150, .724, .667, .047, .147, 5.60, '#f3872c'], amount, { bias: -.045 });
    scene.solid(tractor, [side * 1.026, 2.046, -2.754, .051, .574, 1.095, '#174949'], amount, { bias: -.034 });
    scene.solid(tractor, [side * 1.12, 1.967, -3.32, .167, .179, .109, '#637f70'], amount, { bias: -.043 });
    scene.solid(tractor, [side * .80, .81, -3.638, .28, .13, .04, '#e9ffe9'], amount, { bias: -.044 });
    const step = side * 1.018;
    scene.solid(tractor, [step, .48, -2.24, .25, .091, .39, '#6d9183'], amount, { bias: -.036 });
    scene.solid(tractor, [step, .62, -2.24, .24, .080, .39, '#426d62'], amount, { bias: -.038 });
    for (const wheel of [-2.91, -1.21, 1.78, 2.45]) {
      const axle = wheel < -2 ? tractor : model;
      if (axle.localEye[0] * side < 0) continue;
      const x = side * 1.125;
      scene.disk(axle, [x, .342, wheel], .345, '#071d20', 'x', amount, -.09);
      scene.disk(axle, [x + side * .014, .342, wheel], .241, '#3c5b54', 'x', amount, -.113);
      scene.disk(axle, [x + side * .020, .342, wheel], .172, '#102f2e', 'x', amount, -.124);
      scene.disk(axle, [x + side * .027, .342, wheel], .088, '#a1bdaf', 'x', amount, -.143);
      for (let l = 0; l < 5; l++) {
        const angle = l * Math.PI * .4 + rotation;
        scene.disk(axle, [x + side * .031, .342 + .120 * Math.cos(angle), wheel + .120 * Math.sin(angle)],
          .014, '#85ac9e', 'x', amount, -.154);
      }
    }
    if (model.localEye[0] * side < 0) continue;
    const x = side * 1.157;
    const left = side < 0 ? -2.124 : 3.448, right = side < 0 ? 3.448 : -2.124;
    const bodyDepth = scene.view(mapPoints(model, [x, 1.74, .68]))[2];
    scene.panel(model, [[x, 2.766, left], [x, 2.766, right], [x, .805, right], [x, .805, left]],
      '#11b676', amount, -.027, { depth: bodyDepth, gradient: [
        [0, '#056755'], [.27, '#118966'], [.56, '#0e765a'], [.77, '#0a6552'], [1, '#034b43'],
      ] });
    for (const seam of [-1.73, 2.94]) {
      const surface = x + side * .006;
      scene.panel(model, [[surface, .91, seam], [surface, 2.69, seam],
        [surface, 2.69, seam + .014], [surface, .91, seam + .014]], '#b1ffdf', amount * .34, -.044, { depth: bodyDepth });
    }
    for (const light of [-1.83, -.15, 1.51, 3.18]) {
      scene.solid(model, [side * 1.176, .743, light, .018, .075, .133, '#ffb568'], amount, { bias: -.073 });
    }
    if (!logo.width) continue;
    const imprint = side * 1.169;
    const nearLogo = side === -1 ? -.50 : 1.65, farLogo = side === -1 ? 1.65 : -.50;
    scene.panel(model, [[imprint, 2.045, nearLogo], [imprint, 2.045, farLogo],
      [imprint, 1.405, farLogo], [imprint, 1.405, nearLogo]],
      white, amount, -.065, { depth: bodyDepth, image: logo, perspective: true });
  }
}

function equalizerStand(scene, amount, rhythm) {
  if (amount < .008) return;
  const frame = scene.object([0, 0, 0]);
  scene.case(frame, [0, .04, .66, 9.46, .31, 1.93, '#234943'], amount, .18);
  scene.case(frame, [0, -.13, .78, 9.70, .16, 2.07, '#123731'], amount, .09);
  for (let i = 0; i < count; i++) {
    const x = xChannel(i);
    plate(scene, frame, x, .198, .42, .79, .84, '#123a33', amount, -.012);
    plate(scene, frame, x, .205, .66, .56, .05, channels[i].paint, amount * .66, -.021);
    const top = level(i, rhythm);
    const stack = colorMix('#123931', channels[i].paint, .24);
    const postDepth = scene.view([x, .23 + top / 2, .32])[2] + .42;
    scene.case(frame, [x, .23 + top / 2, .32, .27, top, .17, stack], amount, .022, postDepth);
    for (let j = 0; j < 17; j++) {
      const v = j / 17;
      const y = .39 + j * .29;
      const lit = ramp(-.13, .13, top + .19 - y);
      if (lit < .008) break;
      const material = colorMix(stack, channels[i].paint, .52 + .41 * v);
      const depth = scene.view([x, y, .425])[2] - .05;
      scene.case(frame, [x, y, .449, .57, .177, .34, material], amount * lit, .038, depth);
      scene.rect(frame, x, y + .016, .621, .43, .026, i === lead ? '#ffd398' : '#a6ffdc',
        amount * lit * (.43 + .45 * v), -.10, { depth });
    }
  }
}

function mixingBoard(scene, amount, rhythm, compact = false, routed = false) {
  if (amount < .008) return;
  const factor = compact ? .72 : 1;
  const dx = compact || routed ? 0 : .04;
  const dz = compact ? 1.42 : 0;
  const frame = scene.object([dx, -.03, dz]);
  const w = 9.51 * factor;
  const d = compact ? 5.34 : 8.5;
  const topY = .25;
  const panelDepth = routed ? lerp(95.8, consoleDepth(scene), amount) : scene.view([dx, topY, dz])[2];
  const depth = routed ? lerp(.19, d, amount) : d;
  const width = routed ? w * lerp(.71, 1, amount) : w;
  const shift = routed ? (1 - amount) * -2.83 : 0;
  const body = routed ? 1 : amount;
  const model = routed ? scene.object([0, -.03, shift]) : frame;
  if (routed) scene.contactShadow([0, -.24, shift], width * 1.19, depth * 1.18, 0, amount * .83, panelDepth + .16);
  scene.case(model, [0, -.03, 0, width, .34, depth, '#183d3a'], body, .20, routed ? panelDepth + .14 : undefined);
  scene.case(model, [0, .17, 0, width - .15, .15, depth - .14, '#31625a'], body, .075, panelDepth + .03);
  plate(scene, model, 0, topY, 0, width - .31, Math.max(.03, depth - .35), '#163b38', body, -.014, { depth: panelDepth });
  plate(scene, model, 0, topY + .006, -depth * .39, width - .58, depth * .163, '#0a292a', amount, -.021, { depth: panelDepth });
  plate(scene, model, 0, topY + .012, depth * .448, width - .47, .07, '#7aa79a', amount * .50, -.032, { depth: panelDepth });
  const edgeLights = [width * -.47, width * .47];
  for (const x of edgeLights) plate(scene, model, x, topY + .022, 0, .055, depth * .87, '#43dba4', amount * .73,
    -.035, { depth: panelDepth });

  for (let i = 0; i < count; i++) {
    const x = xChannel(i) * factor;
    const lane = channels[i];
    const center = compact ? .18 : .36;
    const panelCenter = panelDepth;
    if (!routed) {
      plate(scene, frame, x, topY + .025, center, .84 * factor, d * .68, '#12332f', amount, -.035,
        { depth: panelCenter });
      plate(scene, frame, x, topY + .036, center + .29, .156 * factor, d * .59, '#061d20', amount, -.048,
        { depth: panelCenter });
      plate(scene, frame, x + .31 * factor, topY + .042, center + .29, .055, d * .56, '#4d9981', amount, -.058,
        { depth: panelCenter });
    }
    const details = routed ? ramp(.29, 1, amount) : amount;
    for (let j = 0; j < 12; j++) {
      const step = (j - 5.5) * d * .043;
      const solid = j % 4 === 0;
      const paint = step > faderZ(i, rhythm) * factor ? '#9be2c7' : '#37665b';
      plate(scene, model, x + .27 * factor, topY + .048, center + .27 + step,
        (solid ? .23 : .12) * factor, solid ? .046 : .031, paint, details * .91, -.081, { depth: panelCenter });
    }
    const meter = routed ? -depth * .411 : -d * .327;
    for (let j = 0; j < 7; j++) {
      const lit = ramp(-.13, .08, meterTop(i, rhythm) / 4.5 - (j + .53) / 7);
      plate(scene, model, x + (j - 3) * .089 * factor, topY + .048, meter,
        .067 * factor, .13, colorMix('#24463e', lane.paint, lit), details, -.090, { depth: panelCenter });
    }
    const button = i === lead ? '#f0a457' : '#59be9a';
    if (!routed) {
      const knobZ = -d * .424;
      scene.case(model, [x, .328, knobZ, .31 * factor, .14, .31, '#244940'], amount, .055, panelDepth - .105);
      plate(scene, model, x + .03, .406, knobZ - .03, .039, .114, '#b3e4d3', amount, -.15, { depth: panelDepth });
    }
    if (details > .005) {
      const buttonHeight = routed ? .085 * details : .085;
      const buttonZ = d * (routed ? .432 : .366);
      scene.case(model, [x, .315, buttonZ, .28 * factor, buttonHeight, .29, button], details, .039, panelDepth - .105);
    }
  }
}

function monitorFrame(scene, transform, amount, visual, frame, orange) {
  if (amount <= .006) return;
  const [w, h, d] = transform.size;
  const model = scene.object(transform.p, transform.yaw);
  const skin = colorMix('#285950', '#d78238', orange);
  scene.case(model, [0, 0, 0, w, h, d, skin], amount, .16);
  const front = d * .505;
  const depth = scene.view([transform.p[0] + Math.sin(transform.yaw) * front,
    transform.p[1], transform.p[2] + Math.cos(transform.yaw) * front])[2];
  const plane = (x, y, width, height, color, opacity = 1, order = 0, style = {}) => {
    scene.rect(model, x, y, front + .032 + order * .008, width, height, color,
      amount * opacity, -.19 - order * .013, { depth, ...style });
  };
  plane(0, 0, w * .965, h * .947, '#0a2325', 1, 0, { glossy: true });
  plane(0, .01, w * .912, h * .851, '#13443d', 1, 1);
  plane(-w * .109, .01, w * .690, h * .842, '#295a4b', 1, 2, { image: visual, imageShade: true });
  plane(w * .338, .01, w * .211, h * .842, '#0e302f', 1, 2);
  for (const y of [-.29, -.09, .11, .31]) plane(w * .337, h * y, w * .183, .013, '#5b9483', .48, 3);
  for (let i = 0; i < count; i++) {
    const bar = level(i, frame) / 6.3 * h * .515;
    const base = -h * .29;
    plane(w * (.257 + i * .027), base + bar / 2, w * .014, bar, i === lead ? amber : '#66fac4', .97, 4, { glow: 3 });
  }
  plane(0, h * -.453, w * .60, .017, '#a5d1bf', .58, 3);
  plane(-w * .411, h * -.452, w * .10, .035, '#68cead', 1, 3);
  plane(w * .403, h * -.449, w * .045, .039, amber, .92, 3);
  plane(-w * .365, h * .338, w * .116, h * .066, '#061e24', .81, 5);
  plane(-w * .365, h * .338, w * .094, h * .056, '#effff4', 1, 6, { text: 'CDEK FM' });

}

const screenAspect = 16 / 9;

function screenPanel(scene, model, z, width, height, rect, align, paint, alpha, depth, style) {
  const local = [[-width / 2, height / 2, z], [width / 2, height / 2, z],
    [width / 2, -height / 2, z], [-width / 2, -height / 2, z]];
  const corners = local.map(point => mapPoints(model, point));
  if (rect && align > 0) {
    const pixels = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]];
    const focalDepth = scene.view(mapPoints(model, [0, 0, z]))[2];
    for (let i = 0; i < corners.length; i++) {
      corners[i] = blend3(corners[i], scene.world(pixels[i][0], pixels[i][1], focalDepth), align);
    }
  }
  const axis = style?.grade ? [scene.point(corners[0]), scene.point(corners[3])] : null;
  scene.fill(corners, paint, alpha, 0, { depth, ...style,
    gradientAxis: axis?.every(Boolean) ? axis : undefined });
}

function insetRect(rect, inset) {
  return rect && { left: rect.left + inset, top: rect.top + inset, right: rect.right - inset, bottom: rect.bottom - inset };
}

function drawScreen(scene, pose, screen, align, power, poster) {
  if (screen?.entry >= .999) return;
  const [w, h, d] = pose.size;
  const model = scene.object(pose.p, pose.yaw);
  const faceZ = d * .504;
  const depth = lerp(scene.view(pose.p)[2], 1.21, ramp(.06, .54, align));
  const casing = 1 - ramp(.025, .24, align);
  scene.group(depth, () => {
    if (casing > .012) {
      const scale = 1 - ramp(0, .25, align) * .94;
      scene.case(model, [0, 0, -.015, w * scale, h * scale, d * casing, '#103c34'], 1, .096 * casing, .06);
    }
    screenPanel(scene, model, faceZ, w, h, screen?.box, align, '#0e3131', 1, 0, {
      gradient: [[0, '#597e73'], [.12, '#234c47'], [.75, '#0d252a'], [1, '#5a877a']], rim: '#8bd7b48e',
    });
    const pad = .058;
    const face = insetRect(screen?.box, 1);
    const splash = [[0, '#163d42'], [.3, '#0b292e'], [.72, '#102e31'], [1, '#071f25']];
    screenPanel(scene, model, faceZ + .009, w - pad, h - pad, face, align, '#09292e', 1, -.02, { gradient: splash });
    if (poster.width && power > .005) {
      screenPanel(scene, model, faceZ + .012, w - pad, h - pad, face, align, white, power, -.04,
        { image: poster, perspective: align < .999 });
      screenPanel(scene, model, faceZ + .015, w - pad, h - pad, face, align, '#071e24', power, -.05,
        { grade: true, gradient: [[0, '#041b228f'], [.48, '#06242c24'], [1, '#04191e4f']] });
    }
    if (power < .99) {
      screenPanel(scene, model, faceZ + .019, w * .94, h * .89, insetRect(screen?.box, 4), align,
        '#071e24', 1 - power, -.061, { gradient: [[0, '#a3eacc16'], [.22, '#c0ffdf38'], [.58, '#68e1af00'], [1, '#89edc20a']] });
    }
  });
}

function aperture(scene, pose, tint, roll) {
  const [w, h, d] = pose.size;
  const model = scene.object(pose.p, pose.yaw);
  const front = d * .5;
  const reach = w * .5;
  const height = h * .5;
  const turn = roll * 2.10;
  const depth = scene.view(pose.p)[2];
  scene.group(depth + .58, () => {
    scene.case(model, [0, 0, 0, w, h, d, tint], 1, .085, .10, true);
    scene.rect(model, 0, 0, -front + .037, w * .93, h * .89, '#583c2e', 1, -.026, { depth: 0 });
  });
  for (const side of [-1, 1]) {
    const hinge = side * (w * .5 - .014);
    const pt = (v, y, offset = 0) => [hinge - side * reach * v * Math.cos(turn), y,
      front + reach * v * Math.sin(turn) + offset];
    const board = [pt(0, height), pt(1, height), pt(1, -height), pt(0, -height)];
    const doorDepth = scene.view(mapPoints(model, pt(.50, 0)))[2];
    scene.group(doorDepth, () => {
      scene.panel(model, board, tint, 1, -.045, { depth: -.08, glossy: true, light: side < 0 ? .86 : .96,
        rim: '#f3b47b93' });
      scene.panel(model, [pt(1, height), pt(1, height, .047), pt(1, -height, .047), pt(1, -height)],
        '#9b5e33', 1, -.062, { depth: -.08 });
      scene.panel(model, [pt(.86, height, .049), pt(1, height, .049), pt(1, -height * .24, .049),
        pt(.86, -height * .24, .049)], tape, .95, -.074, { depth: -.08 });
    });
  }
}

function broadcastHandoff(scene, start, target, phase, screen, tint, poster) {
  // A closed carton reaches the final aspect ratio before the doors move.
  const reshape = ramp(.05, .36, phase);
  const boxSize = [4.39, 4.39 / screenAspect, 1.05];
  const box = { ...start, size: blend3(start.size, boxSize, reshape),
    yaw: lerp(start.yaw, -.102, reshape) };
  box.p = blend3(start.p, [target.p[0], target.p[1] - .015, target.p[2] - .065], reshape);
  const hinges = ramp(.40, .69, phase);
  if (hinges <= .003) {
    drawBox(scene, box, tint);
    return;
  }

  const lift = ramp(.495, .82, phase);
  const slide = ramp(.57, .89, phase);
  const support = 1 - ramp(.66, .89, phase);
  if (support > .012) {
    const scale = .08 + support * .92;
    const shell = { ...box, p: [box.p[0], box.p[1] - (1 - support) * 1.32, box.p[2] - (1 - support) * 1.33],
      size: box.size.map(value => value * scale) };
    aperture(scene, shell, tint, hinges);
  }

  if (phase <= .40) return;
  const width = lerp(boxSize[0] * .91, target.size[0], slide);
  const liftHeight = Math.sin(lift * Math.PI) * .64;
  const monitor = {
    p: [lerp(box.p[0], target.p[0], slide),
      lerp(box.p[1] - .08, target.p[1], slide) + liftHeight,
      lerp(box.p[2] - .29, target.p[2], slide) + 1.03 * Math.sin(lift * Math.PI)],
    size: [width, width / screenAspect, lerp(.36, target.size[2], slide)],
    yaw: lerp(box.yaw, target.yaw, slide),
  };
  const locked = screen?.box ? ramp(.725, .927, phase) : 0;
  drawScreen(scene, monitor, screen, locked, ramp(.76, .919, phase), poster);
}

// Archive recordings use the same carton, front doors and screen handoff as
// the broadcast chapter. Only the viewport and final poster are different.
export function mountArchiveParcel(canvas, posterUrl, reveal) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) throw new Error('Canvas is unavailable');
  const scene = new Projector(ctx);
  const image = new Image();
  const poster = { width: 0, height: 0, source: image };
  const start = parcelPose(parcel, lead, { time: 0, live: true }, 2);
  const target = parcelPose(unfold, lead, { time: 0, live: true }, 2);
  let w = 1, h = 1, ratio = 1, phase = 0, desired = 0;
  let request = 0, visible = true, disposed = false;
  let manual = false, replayAt = 0, announced = false, dirty = true;

  function publish(value) {
    if (value === announced) return;
    announced = value;
    reveal(value);
  }

  function wake() {
    if (!disposed && visible && !document.hidden && !request) request = requestAnimationFrame(draw);
  }

  function measure() {
    const rect = canvas.getBoundingClientRect();
    // Finish the handoff before the screen itself reaches the middle of the viewport.
    const center = rect.top + rect.height / 2;
    desired = manual ? 1 : ramp(innerHeight * .98, innerHeight * .57, center);
    if (canvas.parentElement?.querySelector('.parcel-screen:focus-within')) desired = 1;
    wake();
  }

  function resize() {
    w = canvas.clientWidth || 1;
    h = canvas.clientHeight || 1;
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    dirty = true;
    measure();
  }

  function draw(now) {
    request = 0;
    if (disposed || !visible || document.hidden) return;
    const next = manual ? bound((now - replayAt) / 1050) : desired;
    if (dirty || next !== phase) {
      phase = next;
      canvas.dataset.phase = phase.toFixed(3);
      dirty = false;
      const turn = ease(phase);
      const eye = blend3(liveCameras[parcel].eye, liveCameras[unfold].eye, turn);
      const aim = blend3(liveCameras[parcel].aim, liveCameras[unfold].aim, turn);
      scene.camera(eye, aim, w, h, w * .50, h * .52, w * 1.28);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const screen = { box: { left: 0, top: 0, right: w, bottom: h }, entry: 0 };
      broadcastHandoff(scene, start, target, phase, screen, channels[lead].paint, poster);
      scene.render();
      publish(phase >= .999);
    }
    if (phase !== desired) wake();
  }

  function scroll() {
    if (manual && performance.now() - replayAt > 1100) manual = false;
    measure();
  }

  image.onload = () => {
    // Fit both original covers into the shared 16:9 screen without cropping.
    const texture = document.createElement('canvas');
    texture.width = 1024; texture.height = 576;
    const paint = texture.getContext('2d');
    if (paint) {
      paint.fillStyle = '#06252b';
      paint.fillRect(0, 0, 1024, 576);
      const scale = Math.min(1024 / image.naturalWidth, 576 / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      paint.drawImage(image, (1024 - width) / 2, (576 - height) / 2, width, height);
      poster.source = texture;
      poster.width = 1024; poster.height = 576;
    } else {
      poster.width = image.naturalWidth; poster.height = image.naturalHeight;
    }
    dirty = true;
    wake();
  };
  image.onerror = () => { phase = desired = 1; publish(true); };
  image.src = posterUrl;
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!visible) { cancelAnimationFrame(request); request = 0; }
    else measure();
  }, { rootMargin: '80px' });
  intersection.observe(canvas);
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('resize', measure);
  document.addEventListener('visibilitychange', measure);
  resize();

  return {
    replay() {
      const rect = canvas.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > innerHeight - 110) {
        canvas.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      manual = true;
      replayAt = performance.now();
      phase = 0;
      desired = 1;
      dirty = true;
      publish(false);
      wake();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(request);
      observer.disconnect();
      intersection.disconnect();
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', measure);
      document.removeEventListener('visibilitychange', measure);
      image.onload = image.onerror = null;
    },
  };
}

function closeBroadcast(scene, start, phase, screen, frame, poster, box, course) {
  const unlock = ramp(.245, .48, phase);
  const power = 1 - ramp(.29, .56, phase);
  const pack = ramp(.50, .76, phase);
  if (pack <= .003) {
    drawScreen(scene, start, screen, 1 - unlock, power, poster);
    return;
  }
  if (pack < .87) {
    const wrapper = { ...box, size: [box.size[0] + .06, box.size[1] + .055, box.size[2] + .10] };
    const skin = colorMix('#153b34', channels[lead].paint, ramp(0, .78, pack));
    aperture(scene, wrapper, skin, .68 * (1 - ramp(.05, .86, pack)));
    const inset = 1 - ramp(.10, .82, pack);
    const glass = { ...box, size: [box.size[0] * .96 * inset, box.size[0] * .54 * inset, .105],
      p: mapPoints(scene.object(box.p, box.yaw), [0, 0, lerp(box.size[2] * .44, 0, pack)]) };
    if (inset > .025) drawScreen(scene, glass, null, 0, power, poster);
    return;
  }
  drawLoopParcel(scene, frame, lead, box, course, undefined, ramp(.82, 1, phase));
  drawBox(scene, box, channels[lead].paint);
}

function openingFlaps(scene, hero, strength, alpha) {
  if (alpha < .01) return;
  const [w, h, d] = hero.size;
  const model = scene.object(hero.p, hero.yaw);
  const angle = .08 + strength * 1.92;
  const reach = w * .42;
  for (const side of [-1, 1]) {
    const hinge = side * w * .46;
    const gap = side * Math.cos(angle) * reach;
    const y = h * .49, endY = y + Math.sin(angle) * reach * .67;
    const face = [[hinge, y, -d * .46], [hinge - gap, endY, -d * .46],
      [hinge - gap, endY, d * .46], [hinge, y, d * .46]];
    scene.panel(model, face, '#edab55', alpha, -.06, { glossy: true, light: .92, lift: 6, rim: '#ffe4b6a0' });
    const tapeFrom = blend3(face[0], face[1], .29);
    const tapeTo = blend3(face[3], face[2], .29);
    scene.panel(model, [tapeFrom, [tapeFrom[0] - gap * .16, tapeFrom[1] + .02, tapeFrom[2]],
      [tapeTo[0] - gap * .16, tapeTo[1] + .02, tapeTo[2]], tapeTo], '#fae5ba', alpha * .73, -.08);
  }
}

function tvCamera(scene, amount, time) {
  if (amount < .009) return;
  const model = scene.object([4.86, .18 + (1 - amount) * -.6, 1.23], .23);
  scene.case(model, [0, .073, .04, 1.44, .20, 1.33, '#224b43'], amount, .11);
  scene.case(model, [0, .72, .04, .51, 1.18, .43, '#1b413a'], amount, .09);
  scene.case(model, [0, 1.60, -.02, 1.48, .79, 1.48, '#254946'], amount, .11);
  scene.case(model, [-.24, 2.07, -.1, .79, .22, .86, '#32554f'], amount, .062);
  scene.case(model, [0, 1.60, .79, 1.15, .73, .55, '#122e31'], amount, .13);
  scene.case(model, [0, 1.60, 1.075, 1.31, .89, .17, '#56776c'], amount, .10);
  scene.disk(model, [0, 1.61, 1.171], .41, '#091e23', 'z', amount, -.07);
  scene.disk(model, [0, 1.61, 1.185], .313, '#24645e', 'z', amount, -.095);
  scene.disk(model, [0, 1.61, 1.196], .247, '#102d36', 'z', amount, -.104);
  scene.disk(model, [0, 1.61, 1.21], .146, '#357e73', 'z', amount * (.55 + .18 * Math.sin(time * 2.5)), -.122);
  scene.disk(model, [-.078, 1.69, 1.224], .059, '#8cdbbf', 'z', amount * .88, -.144);
  scene.rect(model, .46, 1.88, 1.164, .14, .058, amber, amount, -.083);
  scene.solid(model, [-.64, 1.87, -.24, .10, .13, .41, '#82cbb0'], amount, { bias: -.043 });
}

function studioBase(scene, amount, frame, visual, hero, variant, unfolding) {
  if (amount + unfolding < .007) return;
  const cam = scene.object([.2, 0, -2.48]);
  scene.case(cam, [0, .19, 0, 6.8, .36, .83, '#1a4540'], amount, .18);
  scene.case(cam, [0, .68, 0, .53, 1.08, .36, '#2e6158'], amount, .08);
  const isParcelRoute = variant === 2;
  if (isParcelRoute) {
    monitorFrame(scene, hero, Math.max(amount, unfolding * .97), visual, frame, 1 - amount * .78);
  } else {
    const size = .68 + amount * .32;
    monitorFrame(scene, {
      p: [.20, 2.52 - (1 - amount) * .62, -2.74], size: [7.14 * size, 3.92 * size, .62], yaw: 0,
    }, amount, visual, frame, .16);
  }
  tvCamera(scene, Math.max(amount, unfolding * .77), frame.time);
  if (amount > .004) {
    const led = scene.object([3.64, 4.52, -2.87]);
    if (isParcelRoute) scene.case(led, [0, 0, 0, .43, .23, .23, amber], amount, .06);
    const cable = [[3.8, .005, 2.4], [4.23, .005, 2.37], [5.33, .005, 1.42], [5.48, .005, .72]];
    scene.line(cable, '#82e8c0', amount * .47, 1.3, -.013);
  }
}

function atmosphere(ctx, width, height, originX, originY, color, time) {
  const gradient = ctx.createRadialGradient(originX, originY, width * .011, originX, originY, Math.max(width, height) * .72);
  gradient.addColorStop(0, color + '91');
  gradient.addColorStop(.25, color + '69');
  gradient.addColorStop(.61, '#0a222485');
  gradient.addColorStop(1, '#06171903');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(originX, originY + height * .19, 6, originX, originY + height * .15, Math.min(width, height) * .47);
  glow.addColorStop(0, '#23cb9821');
  glow.addColorStop(.38, '#11695112');
  glow.addColorStop(1, '#09252600');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 24; i++) {
    const x = originX + Math.sin(i * 8.2) * width * (.15 + i * .0071);
    const y = originY + Math.sin(i * 2.47) * height * .29;
    const alpha = .14 + .09 * Math.sin(time * 1.4 + i);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = i % 8 === 0 ? '#f4bd6a' : '#88d3be';
    ctx.fillRect(x, y, i % 5 === 0 ? 1.6 : 1, i % 5 === 0 ? 1.6 : 1);
  }
  ctx.globalAlpha = 1;
}

function studioGrid(scene, alpha) {
  if (alpha <= .012) return;
  for (let i = -8; i <= 8; i++) {
    scene.line([[i * 1.22, -.31, 10.8], [i * 1.22, -.31, -13.2]], '#398072', alpha * .24, .65, 1.7);
    if (i > -5) scene.line([[-9.9, -.31, i * 1.18], [10.8, -.31, i * 1.18]], '#408475', alpha * .20, .65, 1.7);
  }
}

const twilight = {
  [road]: '#15463e', [eq]: '#185c50', [deck]: '#184b48',
  [parcel]: '#5a442e', [unfold]: '#2e5b51', [studio]: '#164640', [chat]: '#17554c',
  [archive]: '#103b3c', [circuit]: '#144944',
};

export function mountArtwork(canvas, controls) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) throw new Error('Canvas is unavailable');
  const scene = new Projector(ctx);
  const artwork = new Image();
  const mark = new Image();
  const {
    monitor = null,
    live: isLive = false,
    radio: readRadio = () => ({ state: 'idle' }),
    greetings = () => [],
    messages = () => null,
    selectedGreeting = () => null,
    projectParcels = () => {},
    presentGreeting = () => {},
    dispatch = null,
    sceneAt = value => value,
    chapterAt = value => value,
    present = () => null,
  } = controls;
  const greetingFlight = createGreetingFlight(dispatch, drawBox);
  const visual = { width: 0, height: 0, source: artwork };
  const logo = { width: 0, height: 0, source: mark };
  artwork.onload = () => { visual.width = artwork.naturalWidth; visual.height = artwork.naturalHeight; };
  mark.onload = () => { logo.width = mark.naturalWidth; logo.height = mark.naturalHeight; };
  artwork.src = '/visual/cdek-motion-monitor.webp';
  mark.src = '/visual/cdek-mark-white-512.png';
  let monitorPlaying = false;

  function updateMonitor(show) {
    if (!monitor || monitorPlaying === show) return;
    monitorPlaying = show;
    if (!show) {
      monitor.pause();
      return;
    }
    if (!monitor.getAttribute('src')) monitor.src = '/visual/cdek-motion-monitor.mp4';
    monitor.muted = true;
    void monitor.play().catch(() => {});
  }

  const syncMonitor = () => {
    if (document.hidden) {
      updateMonitor(false);
      greetingFlight?.clear();
    }
    last = 0;
  };
  document.addEventListener('visibilitychange', syncMonitor);
  let w = 1, h = 1, ratio = 1, request = 0, last = 0;
  let elapsed = 0, progress = controls.progress(), variant = controls.variant();
  let cameraA, cameraB;
  let angleChange = 0;
  let reducedLast;
  const moveConsole = isLive ? makeConsoleMotion() : null;
  let consoleFrame;
  let started = false;
  let sizeChanged = true, ready = false;
  let renderedProgress = -1;

  function resize() {
    w = canvas.clientWidth || 1;
    h = canvas.clientHeight || 1;
    ratio = Math.min(devicePixelRatio || 1, 1.55, Math.sqrt(1990000 / (w * h)));
    const width = Math.max(1, Math.round(w * ratio)), height = Math.max(1, Math.round(h * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    sizeChanged = true;
  }

  function draw(now) {
    request = requestAnimationFrame(draw);
    if (document.hidden || now - last < (isLive ? 15 : 32)) return;
    const delta = last ? (now - last) / 1000 : 0;
    const dt = Math.min(.12, delta);
    last = now;
    const reduced = controls.reduced();
    if (reduced && !reducedLast) greetingFlight?.clear();
    if (!reduced) elapsed += Math.min(.25, delta);
    const desired = controls.progress(), selection = controls.variant();
    if (selection !== variant) {
      cameraA = cameraB;
      angleChange = 1;
      variant = selection;
    }
    const distance = desired - progress;
    progress = reduced || !started || Math.abs(distance) < .0012 || Math.abs(distance) > 4.30
      ? desired : progress + distance * (1 - Math.exp(-dt * 22));
    started = true;
    const feed = isLive ? messages() : null;
    const selected = isLive ? selectedGreeting() : null;
    const sameFrame = reduced && reducedLast === reduced && !sizeChanged && angleChange <= .001 && progress === renderedProgress
      && ready && !greetingFlight?.changed(feed, selected);
    reducedLast = reduced;
    if (sameFrame) return;
    if (greetingFlight && isLive) greetingFlight.update(feed, selected, elapsed, reduced ? [] : greetings());
    sizeChanged = false;
    renderedProgress = progress;
    const stops = isLive ? liveRoute : routes[variant];
    const chapter = chapterAt(progress);
    const shot = sceneAt(chapter);
    const screen = present(chapter, shot, reduced);
    const index = Math.max(0, Math.min(stops.length - 2, Math.floor(shot)));
    const part = bound(shot - index);
    const u = ease(part);
    const a = stops[index], b = stops[index + 1];
    const narrow = w <= (isLive ? 720 : 620);
    const frameA = cameras[a], frameB = cameras[b];
    const uprightTablet = w > 720 && w <= 1000 && h > w;
    // Let the two ends meet before the archive camera reaches its overhead view.
    const orbit = isLive && a === archive ? part - .12 * Math.sin(Math.PI * part) ** 2 : part;
    cameraB = isLive ? liveCamera(index, orbit, narrow, w) : {
      eye: blend3(frameA.eye, frameB.eye, u),
      aim: blend3(frameA.aim, frameB.aim, u),
      lens: lerp(frameA.lens, frameB.lens, u),
      layout: [narrow ? .51 : .667, narrow ? .342 : .459, 1],
    };
    const fade = reduced ? 0 : angleChange;
    angleChange *= Math.exp(-dt * 7.4);
    const frame = cameraA && fade > .006 ? {
      eye: blend3(cameraB.eye, cameraA.eye, fade),
      aim: blend3(cameraB.aim, cameraA.aim, fade),
      lens: lerp(cameraB.lens, cameraA.lens, fade),
      layout: cameraB.layout,
    } : cameraB;
    const nearRoad = weight(road, a, b, u);
    const airborne = weight(studio, a, b, u);
    const opened = weight(unfold, a, b, u);
    const equalizing = weight(eq, a, b, u);
    const mixing = weight(deck, a, b, u);
    const records = weight(archive, a, b, u);
    const circuitWeight = weight(circuit, a, b, u);
    const departure = a === road ? part : 0;
    const afterScreen = isLive && a === unfold;
    const loop = isLive && (a === chat || a === archive || a === circuit);
    const exitRoad = isLive && a === road;
    const course = loop || afterScreen ? loopRoad(shot) : null;
    const onReturnHighway = loop && course === homeCourse;
    const highway = exitRoad ? highwayToConsole(part) : onReturnHighway ? onHighway : null;
    const [centerX, centerY, scale] = frame.layout;
    const consoleClearance = narrow && isLive
      ? .245 * (a === eq ? ramp(.44, .99, part) : a === deck ? 1 - ramp(.12, .92, part) : 0)
      : 0;
    const portraitCircuit = uprightTablet ? ramp(6.57, 6.99, shot) * (1 - ramp(7.26, 7.68, shot)) : 0;
    let ox = w * lerp(centerX, .5, portraitCircuit);
    let oy = h * (centerY + consoleClearance);
    let focal = Math.min(w * .80, h * (narrow ? .80 : .92)) * frame.lens * scale * lerp(1, 1.23, portraitCircuit);
    const aim = frame.aim.slice(), eye = frame.eye.slice();
    if (narrow) aim[1] += .08;
    aim[0] += .044 * Math.sin(elapsed * .7);
    if (isLive) {
      const phase = elapsed * .65;
      eye[0] += Math.sin(phase) * .61 * nearRoad;
      eye[1] += (Math.cos(phase) - 1) * .12 * nearRoad;
      aim[0] += Math.sin(phase + .54) * .23 * nearRoad;
      const tracking = driveOffset(elapsed)
        * (exitRoad ? 1 - ramp(.06, .39, part) : ramp(7.76, 7.99, shot));
      eye[2] -= tracking * .39;
      aim[2] -= tracking * .44;
      if (a === circuit) {
        const descent = ramp(.07, .34, part) * (1 - ramp(.48, .94, part));
        eye[1] -= descent * 4.6;
        aim[0] -= descent * 1.2;
        aim[2] += descent * 1.9;
      }
      const chatPosition = screen?.circuitCenter;
      if (w > 1000 && screen?.circuitBounds && chatPosition != null) {
        const box = screen.circuitBounds;
        const stage = ramp(6.72, 7, shot) * (1 - ramp(7.17, 7.68, shot));
        ox = lerp(ox, box.left + box.width * .5, stage);
        oy = lerp(oy, bound(chatPosition - 8, h * .24, h * .70), stage);
        focal = lerp(focal, Math.min(focal, box.width * 1.12, box.height * 1.9), stage);
      } else if (chatPosition != null) {
        const desired = Math.max(h * (narrow ? .18 : .25), Math.min(h * (narrow ? .52 : .67), chatPosition));
        oy += (desired - oy) * ramp(.36, .94, circuitPresence(shot));
      }
    }
    scene.camera(eye, aim, w, h, ox, oy, focal);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    atmosphere(ctx, w, h, ox, oy, colorMix(twilight[a], twilight[b], u), elapsed);
    const meterToMixer = isLive && a === eq;
    const leaveConsole = isLive && a === deck;
    // Place the rig on the near bend while it is still behind the camera.
    const liveTruck = highway ? highwayTruck(highway, elapsed)
      : loop && shot >= 5.74 ? dispatchTruck(shot, course, elapsed) : null;
    const truck = liveTruck && { ...liveTruck, depth: scene.view(liveTruck.p)[2] };
    if (moveConsole && (!reduced || !consoleFrame)) consoleFrame = moveConsole(readRadio(), elapsed, dt);
    const rhythm = { time: elapsed, bands: null, beat: 0, ...consoleFrame,
      live: isLive, roadProgress: departure, roadFloor: course?.approach, truck,
      greetingLanes: greetingFlight && isLive ? greetingFlight.occupied() : null,
      greetingRoom: circuitPresence(shot), dispatchLane: greetingFlight?.dispatchLane,
      dispatchRoom: greetingFlight && isLive && !reduced ? greetingFlight.dispatching(elapsed) : 0 };
    studioGrid(scene, (1 - nearRoad) * (1 - .73 * circuitWeight));
    if (!isLive) equalizerStand(scene, equalizing, rhythm);
    if (!isLive) mixingBoard(scene, mixing, rhythm);
    mixingBoard(scene, isLive ? opened * .23 * (1 - ramp(3.54, 4, shot)) : Math.max(airborne, opened * .59), rhythm, true);
    if (!exitRoad && !loop && !afterScreen && !meterToMixer) ribbons(scene, a, b, u, rhythm);
    if (isLive) {
      if (exitRoad) {
        mixingBoard(scene, highway.cover, rhythm, false, true);
        drawConsoleDisplay(scene, rhythm, highway, ramp(.61, .88, part), 0);
        drawHighway(scene, rhythm, highway, 1, 0, homeCourse);
        drawTruck(scene, rhythm, nearRoad, logo);
      } else if (afterScreen) {
        const monitor = parcelPose(unfold, lead, rhythm, 2);
        const box = packedBroadcastPose(monitor, part, elapsed);
        drawLoopRoad(scene, rhythm, course, { entry: ramp(.02, .67, part), delivery: part, broadcast: box });
        closeBroadcast(scene, monitor, part, screen, rhythm, visual, box, course);
      } else if (loop) {
        if (onReturnHighway) drawHighway(scene, rhythm, highway, 1, 0, course);
        else {
          drawLoopRoad(scene, rhythm, course);
          drawFloatingLoop(scene, rhythm, course);
        }
        drawTruck(scene, rhythm, nearRoad, logo);
      } else if (meterToMixer) {
        mixingBoard(scene, 1, rhythm, false, true);
        drawConsoleDisplay(scene, rhythm, onConsole, 1, part);
        drawHighway(scene, rhythm, onConsole, 1, part);
      } else if (leaveConsole) {
        const channelsOpen = ramp(.17, .98, part);
        mixingBoard(scene, 1 - channelsOpen, rhythm, false, true);
        drawHighway(scene, rhythm, onConsole, 1 - channelsOpen, 1, undefined, true);
      }
    } else {
      roadParcels(scene, elapsed, nearRoad);
      drawTruck(scene, rhythm, nearRoad, logo);
    }
    const objectRoute = isLive ? 2 : variant;
    if (!exitRoad && !afterScreen && !loop && !meterToMixer) {
      for (let i = 0; i < count; i++) {
        if (i === lead) continue;
        const opacity = isLive ? (1 - opened * .79) * (1 - records * .80) : 1;
        const transform = transitionParcel(a, b, rhythm, i, leaveConsole ? ramp(.15, .98, part) : u, objectRoute);
        const tint = leaveConsole ? colorMix(highwayCartonColor(i, rhythm, 1), channels[i].paint, u) : channels[i].paint;
        if (isLive && b === unfold) {
          const visibility = 1 - ramp(3.16, 3.58, shot);
          if (visibility < .013) continue;
          transform.size = transform.size.map(value => value * Math.sqrt(visibility));
          transform.alpha = 1;
          drawBox(scene, transform, tint);
        } else drawBox(scene, transform, tint, opacity, truck);
      }
      const hero = transitionParcel(a, b, rhythm, lead, leaveConsole ? ramp(.15, .98, part) : u, objectRoute);
      if (isLive) {
        const beforeScreen = a === parcel && b === unfold;
        if (beforeScreen) {
          broadcastHandoff(scene, parcelPose(parcel, lead, rhythm, objectRoute), parcelPose(unfold, lead, rhythm, objectRoute),
            part, screen, channels[lead].paint, visual);
        } else {
          const tint = leaveConsole ? colorMix(highwayCartonColor(lead, rhythm, 1), channels[lead].paint, u) : channels[lead].paint;
          drawBox(scene, hero, tint, 1 - records * .74, truck);
        }
      } else {
        drawBox(scene, hero, channels[lead].paint, objectRoute === 2 ? 1 - Math.max(opened, airborne) : 1);
        if (objectRoute === 2) openingFlaps(scene, hero, opened, opened * (1 - airborne));
        updateMonitor(!reduced && Math.max(airborne, opened) > .50);
        const feed = monitor && monitorPlaying && monitor.readyState >= 2 && monitor.videoWidth ? {
          width: monitor.videoWidth, height: monitor.videoHeight, source: monitor,
        } : visual;
        studioBase(scene, airborne, rhythm, feed, hero, objectRoute, opened);
      }
    }
    if (greetingFlight && isLive) {
      const roadEntry = afterScreen ? ramp(.02, .67, part) : exitRoad ? 1 - ramp(.53, .89, part) : Number(loop);
      const { picks, preview } = greetingFlight.draw(scene, elapsed, ratio, course ?? (exitRoad ? homeCourse : null), highway,
        roadEntry, shot, selected, reduced, truck);
      projectParcels(picks);
      presentGreeting(preview);
    }
    scene.render();
    if (!ready) {
      ready = true;
      controls.ready();
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  request = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(request);
    observer.disconnect();
    updateMonitor(false);
    greetingFlight?.clear();
    document.removeEventListener('visibilitychange', syncMonitor);
    artwork.onload = null;
    mark.onload = null;
  };
}
