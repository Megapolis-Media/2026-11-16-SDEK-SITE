import { Projector, blend3, bound, colorMix, lerp, mapPoints, ramp } from './projection.js';
import { railFrame, railWidth } from './highway.js';
import { loopLane, loopRoad } from './loop-road.js';
import { wrapped } from './road.js';

const dispatchLane = 0;
const carton = '#23e6a1';
const paper = '#e3fff1';
const launchTime = 1.32;
const flightLimit = 5.35;
const packageSize = [.82, .82, .8528];
const streamColors = ['#36f0aa', '#c4f3de', '#ffac56', '#60e9c4'];
const orbitPeriod = 13.6;
const maxParcels = 80;
const laneCapacity = 20;
const circuitLanes = [1, 5, 2, 4];
const circuit = loopRoad(7);
const arcResolution = 340;
const previewDuration = orbitPeriod / 2;
const previewFoldAt = previewDuration - 1.25;
const automaticPreviewInterval = previewDuration + .42;
const arcDistances = circuitLanes.map(lane => {
  let previous = loopLane(lane, 0, circuit).p;
  let total = 0;
  const distances = [0];
  for (let sample = 1; sample <= arcResolution; sample++) {
    const center = loopLane(lane, sample / arcResolution, circuit).p;
    total += Math.hypot(center[0] - previous[0], center[1] - previous[1], center[2] - previous[2]);
    distances.push(total);
    previous = center;
  }
  return distances.map(distance => distance / total);
});

export function circuitPresence(shot) {
  return ramp(6.86, 6.99, shot) * (1 - ramp(7.54, 7.89, shot));
}

function fit(ctx, value, maxWidth) {
  const content = value.replace(/\s+/g, ' ').trim();
  if (ctx.measureText(content).width <= maxWidth) return content;
  const text = Array.from(content);
  while (text.length && ctx.measureText(text.join('') + '…').width > maxWidth) text.pop();
  return text.join('') + '…';
}

function surface(width, height, paint) {
  const source = document.createElement('canvas');
  source.width = Math.ceil(width);
  source.height = Math.ceil(height);
  const ctx = source.getContext('2d');
  paint(ctx);
  return { source, width: source.width, height: source.height };
}

function round(ctx, x, y, w, h, radius, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function formImage(card, text) {
  return surface(card.width, card.height, ctx => {
    const { width, height, formTop, input, send, lines, photo } = card;
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#153f39');
    background.addColorStop(1, '#09272f');
    round(ctx, .6, .6, width - 1.2, height - 1.2, 17, background, '#739f8f');
    ctx.save();
    ctx.beginPath();
    ctx.rect(3, 3, width - 6, Math.max(0, formTop - 4));
    ctx.clip();
    for (const line of lines) {
      round(ctx, line.x, line.y, line.width, line.height, 9, '#071f25', '#294b47');
      ctx.fillStyle = '#e6f9f3';
      ctx.font = '510 14px Inter, system-ui, sans-serif';
      ctx.fillText(fit(ctx, line.text, line.width - 85), line.x + 12, line.y + Math.min(26, line.height - 13));
      ctx.fillStyle = '#9bbeb3';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillText(line.time, line.x + line.width - 38, line.y + Math.min(26, line.height - 13));
    }
    ctx.restore();
    ctx.fillStyle = '#37715d';
    ctx.fillRect(1, formTop, width - 2, 1);
    if (photo) {
      round(ctx, photo.x - 2, photo.y - 2, photo.width + 4, photo.height + 4, 5, '#2b7a5e');
      ctx.drawImage(photo.canvas, photo.x, photo.y, photo.width, photo.height);
    }
    round(ctx, input.x, input.y, input.width, input.height, 9, '#061e24', '#87daba');
    ctx.fillStyle = '#effff6';
    ctx.font = '500 16px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(fit(ctx, text, input.width - 25), input.x + 12, input.y + input.height / 2);
    round(ctx, send.x, send.y, send.width, send.height, 9, '#4bf5a8');
    ctx.beginPath();
    const x = send.x + send.width / 2, y = send.y + send.height / 2;
    ctx.moveTo(x - 6, y); ctx.lineTo(x - 1.5, y + 5); ctx.lineTo(x + 7, y - 5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#063b2c';
    ctx.stroke();
  });
}

function labelFor(body, photo) {
  return surface(368, 115, ctx => {
    round(ctx, 0, 0, 368, 115, 10, paper);
    round(ctx, 13, 15, 5, 85, 3, '#1d8d67');
    if (photo) {
      const side = body ? 118 : 292;
      const factor = Math.min(side / photo.width, 87 / photo.height);
      const w = photo.width * factor, h = photo.height * factor;
      ctx.drawImage(photo, body ? 35 : (368 - w) / 2, (115 - h) / 2, w, h);
    }
    const start = photo ? 165 : 31;
    const textWidth = photo ? 178 : 318;
    ctx.fillStyle = '#073b34';
    ctx.font = '650 23px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const glyphs = Array.from(body.replace(/\s+/g, ' '));
    for (let row = 0; row < 2 && glyphs.length; row++) {
      let line = '', split = 0;
      while (glyphs.length && ctx.measureText(line + glyphs[0] + '…').width <= textWidth) {
        const glyph = glyphs.shift();
        line += glyph;
        if (glyph === ' ') split = line.length;
      }
      if (!row && glyphs.length && glyphs[0] !== ' ' && split) {
        glyphs.unshift(...Array.from(line.slice(split)));
        line = line.slice(0, split);
      }
      ctx.fillText(line.trim() + (row && glyphs.length ? '…' : ''), start, 39 + row * 36, textWidth - 3);
    }
  });
}

function photoSticker(photo) {
  const width = photo.naturalWidth || photo.width;
  const height = photo.naturalHeight || photo.height;
  return surface(192, 152, ctx => {
    ctx.fillStyle = '#ddf7e9';
    ctx.fillRect(0, 0, 192, 152);
    ctx.fillStyle = '#24634f';
    ctx.fillRect(5, 5, 182, 142);
    const scale = Math.min(182 / width, 142 / height);
    const w = width * scale, h = height * scale;
    ctx.drawImage(photo, (192 - w) / 2, (152 - h) / 2, w, h);
  });
}

export function drawParcelPhoto(scene, model, size, photo, opacity) {
  const [w, h, d] = size;
  if (!photo || model.localEye[2] <= d * .5 || opacity < .01) return;
  const depth = scene.view(model.p)[2];
  scene.rect(model, 0, -h * .034, d * .507, w * .74, h * .586, paper, opacity, -.054, {
    depth: 0, image: photo, perspective: w * scene.focal / Math.max(1, depth) > 52,
  });
}

function greetingTrack(v, course, highway, time) {
  if (!highway) return loopLane(dispatchLane, v, course);
  return { ...railFrame(dispatchLane, v, highway), width: railWidth(dispatchLane, highway, v, time) };
}

export function circuitParcelTrack(v, course, lane) {
  return loopLane(circuitLanes[lane], v, course);
}

function turnTo(from, to, amount) {
  const tau = Math.PI * 2;
  return from + (wrapped(to - from + Math.PI, tau) - Math.PI) * amount;
}

function parcelPose(rail, size, lift = 0) {
  return { p: [rail.p[0], rail.p[1] + size[1] / 2 + .064 + lift, rail.p[2]],
    size, yaw: rail.yaw, foot: rail.p, alpha: 1, tape: 1 };
}

function foldForm(scene, pose, form, card, time, label) {
  const { size: [w, h, d], yaw, pitch } = pose;
  const model = scene.object(pose.p, yaw, 1, pitch);
  const center = scene.view(pose.p)[2];
  const close = ramp(.29, .77, time);
  const walls = ramp(.27, .58, time);
  const seal = ramp(.51, .82, time);
  const viewScale = center / scene.focal;
  const wrapWidth = lerp(card.width * viewScale, w * 1.005, close);
  const wrapHeight = lerp(card.height * viewScale, h * .964, close);
  const bend = ramp(.12, .64, time) * 1.14;
  const z = lerp(0, d * .501, close);
  const slit = .17 * wrapWidth;
  const span = wrapWidth * .5;
  const segments = [0, slit, wrapWidth - slit, wrapWidth];
  const yAt = u => (Math.abs(u - span) > span - slit ? (Math.abs(u - span) - (span - slit)) : 0) * Math.sin(bend) * .07;
  const xAt = u => (u - span) - Math.sign(u - span) * (1 - Math.cos(bend)) * Math.max(0, Math.abs(u - span) - span + slit);
  const zAt = u => z - Math.max(0, Math.abs(u - span) - span + slit) * Math.sin(bend);
  scene.group(center, () => {
    if (walls > .008) {
      const wall = h * walls;
      scene.solid(model, [0, -h / 2, 0, w, .045, d, '#1a895f']);
      for (const side of [-1, 1]) {
        scene.solid(model, [side * (w / 2 - .023), (wall - h) / 2, 0, .048, wall, d, carton]);
        scene.solid(model, [0, (wall - h) / 2, side * (d / 2 - .023), w - .085, wall, .048, carton]);
        const angle = lerp(1.91, 0, seal);
        const x = side * w / 2;
        const dx = side * w / 2 * Math.cos(angle);
        const y = wall - h / 2, tip = y + Math.sin(angle) * w * .48;
        const flap = [[x, y, -d / 2], [x - dx, tip, -d / 2], [x - dx, tip, d / 2], [x, y, d / 2]];
        scene.panel(model, flap, '#3ee8a8', 1, -.007, { glossy: true, lift: 8, rim: '#abffe28c' });
        const a = blend3(flap[0], flap[3], .43), b = blend3(flap[0], flap[3], .57);
        scene.panel(model, [a, [a[0] - dx, tip + .005, a[2]], [b[0] - dx, tip + .005, b[2]], b], paper, seal, -.012);
      }
    }
    for (let i = 0; i < segments.length - 1; i++) {
      const u = segments[i], v = segments[i + 1];
      const face = [[xAt(u), wrapHeight / 2 + yAt(u), zAt(u)],
        [xAt(v), wrapHeight / 2 + yAt(v), zAt(v)], [xAt(v), -wrapHeight / 2 + yAt(v), zAt(v)],
        [xAt(u), -wrapHeight / 2 + yAt(u), zAt(u)]];
      const show = 1 - ramp(.47, .76, time);
      scene.panel(model, face, '#276d54', 1, -.024, { glossy: true, rim: '#93eac372', depth: 0 });
      if (show > .01) scene.panel(model, face, paper, show, -.031, { image: form[i], depth: 0 });
    }
    const reading = ramp(.32, .53, time) * (1 - ramp(.64, .83, time));
    if (reading > .006) {
      const width = w * lerp(1.48, .64, seal);
      const receipt = scene.object(mapPoints(model, [0, h * lerp(.55, .036, seal), d * .51]), yaw, 1, pitch - .36 * seal);
      scene.rect(receipt, 0, 0, 0, width, width * .3125, paper, reading, -.052, { image: label, depth: 0 });
    }
    drawParcelPhoto(scene, model, pose.size, pose.photo, ramp(.64, .83, time));
  });
}

function formStrips(form) {
  return [[0, .17], [.17, .83], [.83, 1]].map(([from, to]) =>
    surface((to - from) * form.width, form.height, ctx => {
      const x = Math.round(from * form.width), w = Math.round(to * form.width) - x;
      ctx.drawImage(form.source, x, 0, w, form.height, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }));
}

function messageParcel(scene, item, pose, selected, flash, drawBox, truck) {
  const tint = colorMix(item.tint, selected ? '#ffb762' : '#a7ffe0', selected ? .78 : flash * .57);
  const point = scene.point(pose.p);
  if (!point) return null;
  const size = pose.size[0] * scene.focal / point[2];
  const emphasis = Math.max(selected ? .88 : 0, flash);
  if (emphasis > .03) {
    const view = scene.object(pose.p, pose.yaw);
    const depth = scene.view(pose.p)[2];
    const ground = trackRing(pose.size[0] * 1.16).map(([x, z]) => mapPoints(view, [x, -.51 * pose.size[1], z]));
    scene.line(ground, selected ? '#ffca88' : '#afffe1', emphasis * pose.alpha, 1.65, -.62, true);
    scene.contactShadow([pose.foot[0], pose.foot[1] + .013, pose.foot[2]],
      pose.size[0] * 2.36, pose.size[2] * 2.32, pose.yaw, .68 * emphasis, depth + .09);
  }
  drawBox(scene, item.sticker ? { ...pose, photo: item.sticker } : pose, tint, 1, truck);
  return { id: item.id, x: point[0], y: point[1], size };
}

function trackRing(radius) {
  return Array.from({ length: 14 }, (_, i) => {
    const angle = i / 13 * 2 * Math.PI;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function makeMessagePreviews() {
  let requested = null;
  let active = null;
  let pending = null;
  let automatic = null;
  let presented = null;
  let priorRecent = null;
  let nextAutomatic = 0;

  return (selected, time, recent, points, visible, reduced) => {
    if (selected !== requested) {
      requested = selected;
      if (automatic?.id === selected?.id) automatic = null;
      pending = selected ? { id: selected.id, until: time + (selected.waitForLanding ? flightLimit + 4 : 2) } : null;
      if (!selected || selected.id === active?.id) active = null;
    }
    if (reduced) {
      pending = active = automatic = null;
      return null;
    }
    if (!visible) {
      active = automatic = null;
      return null;
    }
    if (recent && recent !== priorRecent && recent !== presented) automatic = { id: recent, until: time + 9 };
    priorRecent = recent;
    if (automatic && automatic.until < time) automatic = null;
    if (pending && pending.until < time) pending = null;
    if (pending?.id && points.has(pending.id)) {
      if (active && active.id !== pending.id) {
        if (active.exit === undefined && time - active.start < previewFoldAt) active.exit = time;
      } else {
        active = { id: pending.id, start: time };
        pending = null;
        nextAutomatic = time + automaticPreviewInterval;
      }
    } else if (!pending && !active && automatic && points.has(automatic.id) && time >= nextAutomatic) {
      active = { id: automatic.id, start: time };
      presented = automatic.id;
      automatic = null;
      nextAutomatic = time + automaticPreviewInterval;
    }
    if (!active) return null;
    const point = points.get(active.id);
    const age = active.exit === undefined ? time - active.start : previewFoldAt + (time - active.exit) * 1.65;
    if (age >= previewDuration) {
      active = null;
      return null;
    }
    return point ? { ...point, ...messagePreviewMotion(age) } : null;
  };
}

export function messagePreviewMotion(age) {
  return {
    appear: ramp(0, .22, age),
    fold: ramp(previewFoldAt, previewDuration - .72, age),
    fly: ramp(previewDuration - .91, previewDuration - .14, age),
    arrive: ramp(previewDuration - .33, previewDuration, age),
  };
}

export function slotAt(slot, time, advance = 0) {
  const lane = slot % circuitLanes.length;
  const ordinal = Math.floor(slot / circuitLanes.length);
  const position = wrapped(.065 + (ordinal * 9 % laneCapacity) / laneCapacity + lane * .037 + time / orbitPeriod + advance, 1);
  const arc = arcDistances[lane];
  let start = 0, end = arcResolution;
  while (end - start > 1) {
    const mid = Math.floor((start + end) / 2);
    if (arc[mid] > position) end = mid;
    else start = mid;
  }
  const v = (start + (position - arc[start]) / (arc[end] - arc[start])) / arcResolution;
  return { lane, v };
}

function trafficWindow(v, shot) {
  const opened = Math.max(1 - ramp(6.86, 6.94, shot), ramp(7.29, 7.61, shot));
  return 1 - opened * (1 - ramp(0, .115, Math.min(v, 1 - v)));
}

const departurePosition = (join, age) => lerp(join, 1.036, bound((age - launchTime) / (flightLimit - launchTime)) ** .89);

function launchForCircuit(flight, slot, track, course, age, narrow) {
  const join = narrow ? .26 : .38;
  const departure = departurePosition(join, age);
  if (flight.seat === null && age >= launchTime && course.curl > .875 && course.approach < .64) {
    let lead = 0, best = Infinity;
    const from = track(departure).p;
    for (let i = 0; i < 36; i++) {
      const distance = i / 36 - .5;
      const point = circuitParcelTrack(slotAt(flight.item.slot, flight.start + age, distance).v, course, slot.lane).p;
      const difference = Math.hypot(from[0] - point[0], from[1] - point[1], from[2] - point[2]);
      if (difference < best) {
        lead = distance;
        best = difference;
      }
    }
    flight.seat = { at: age, lead, departure, duration: 1.25 + Math.abs(lead) * 3.1 };
  }
  const seating = flight.seat;
  if (!seating) return { rail: track(departure), seated: 0, end: flightLimit, v: departure };
  const handoff = ramp(seating.at, seating.at + .49, age);
  const end = seating.at + seating.duration;
  const remaining = 1 - ramp(seating.at + .33, end, age);
  const cursor = slotAt(flight.item.slot, flight.start + age, seating.lead * remaining);
  const start = track(seating.departure + Math.min(.083, Math.max(0, age - seating.at) * .14));
  const destination = circuitParcelTrack(cursor.v, course, cursor.lane);
  const p = blend3(start.p, destination.p, handoff);
  p[1] += Math.sin(Math.PI * handoff) * .42;
  return { rail: { ...destination, p, yaw: turnTo(start.yaw, destination.yaw, handoff) },
    seated: handoff, end, v: cursor.v };
}

export function createGreetingFlight(canvas, drawBox) {
  const ctx = canvas?.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return null;
  const overlay = new Projector(ctx);
  const orbit = new Map();
  const showPreview = makeMessagePreviews();
  let flights = [];
  let previousFeed = null, previousSelected = null;
  let dirty = false;
  let occupied = [];
  let loadingPhotos = 0;

  function warmPhoto(item, scene, pose) {
    if (!item.imageUrl || item.sticker !== undefined || loadingPhotos >= 4) return;
    const point = scene.point(pose.p);
    if (!point || pose.size[0] * scene.focal / point[2] < 20
      || point[0] < 0 || point[0] > scene.width || point[1] < 0 || point[1] > scene.height) return;
    const image = new Image();
    item.sticker = null;
    loadingPhotos++;
    image.decoding = 'async';
    image.onload = () => { loadingPhotos--; item.sticker ??= photoSticker(image); };
    image.onerror = () => { loadingPhotos--; };
    image.src = item.imageUrl;
  }

  function erase() {
    if (!dirty) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = false;
  }

  function update(feed, selected, time, departures) {
    if (feed !== previousFeed || selected !== previousSelected) {
      const wanted = (feed ?? []).slice(-maxParcels);
      const initial = previousFeed === null;
      const visible = new Set(wanted.map(item => item.id));
      for (const id of orbit.keys()) if (!visible.has(id)) orbit.delete(id);
      flights = flights.filter(flight => visible.has(flight.item.id));
      const slots = new Set([...orbit.values()].map(item => item.slot));
      wanted.forEach(message => {
        if (orbit.has(message.id)) return;
        let slot = 0;
        while (slots.has(slot)) slot++;
        slots.add(slot);
        orbit.set(message.id, { ...message, slot, tint: streamColors[slot % streamColors.length],
          born: initial ? time - flightLimit : time });
      });
      occupied = [...new Set([...orbit.values()].map(item => circuitLanes[item.slot % circuitLanes.length]))];
      previousFeed = feed;
      previousSelected = selected;
    }
    for (const departure of departures) {
      const item = orbit.get(departure.message.id);
      if (!item) continue;
      const { rect } = departure.card;
      const form = formImage(departure.card, item.body);
      if (departure.card.photo) item.sticker = photoSticker(departure.card.photo.canvas);
      flights.push({ item, label: labelFor(item.body, departure.card.photo?.canvas), form: formStrips(form), rect, inCircuit: departure.inCircuit,
        start: time, width: form.width, height: form.height, seat: null });
    }
  }

  return {
    occupied: () => occupied,
    dispatchLane,
    dispatching: time => Math.max(0, ...flights.filter(flight => !flight.inCircuit).map(flight => {
      const age = time - flight.start;
      const end = flight.seat ? flight.seat.at + .49 : flightLimit + .55;
      return ramp(.17, .92, age) * (1 - ramp(end - .12, end + .34, age));
    })),
    update,
    changed: (feed, selected) => feed !== previousFeed || selected !== previousSelected,
    draw(scene, time, ratio, course, highway, entry, shot, selected, reduced, truck) {
      erase();
      const { width: w, height: h } = scene;
      const narrow = w <= 720;
      const figure = circuitPresence(shot);
      const track = course && (v => greetingTrack(v, course, highway, time));
      const hasDepartures = flights.length > 0;
      const picks = [];
      const visiblePoints = new Map();
      let mostRecent = null;
      if (track && figure > .025 && orbit.size) {
        const activeFlights = new Set(flights.map(flight => flight.item.id));
        for (const item of orbit.values()) {
          if (activeFlights.has(item.id)) continue;
          const { lane, v } = slotAt(item.slot, time);
          const rail = circuitParcelTrack(v, course, lane);
          const focus = item.id === selected?.id;
          const age = time - item.born;
          const incoming = reduced ? 0 : 1 - ramp(.14, 2.87, age);
          const settle = reduced ? 1 : ramp(0, .78, age);
          const window = trafficWindow(v, shot);
          const alpha = figure * window;
          if (alpha < .025) continue;
          const size = lerp(.69, narrow ? .95 : 1.02, Math.sqrt(alpha)) * (focus ? 1.06 : 1) * lerp(.66, 1, settle);
          const stacking = 2.15 * ramp(7.54, 7.615, shot) * (Math.floor(item.slot / circuitLanes.length) % 4) / 3;
          const flyout = stacking + 1.65 * ramp(7.50, 7.83, shot);
          const pose = parcelPose(rail, [size, size, size * 1.04], incoming * (1 - settle) * 2.2 + flyout);
          pose.alpha = alpha * lerp(.54, 1, settle);
          warmPhoto(item, scene, pose);
          const point = messageParcel(scene, item, pose, focus, incoming, drawBox, truck);
          if (point && alpha > .47) picks.push(point);
          if (point && alpha > .52) {
            visiblePoints.set(item.id, { ...point, body: item.body, imageUrl: item.imageUrl });
            if (previousFeed && age < 2.6 && item.id !== selected?.id) mostRecent = item.id;
          }
        }
      }

      if (!reduced && hasDepartures) {
        const pixels = [Math.round(w * ratio), Math.round(h * ratio)];
        if (canvas.width !== pixels[0] || canvas.height !== pixels[1]) [canvas.width, canvas.height] = pixels;
        overlay.camera(scene.eye, scene.eye.map((value, i) => value + scene.forward[i]), w, h, scene.x, scene.y, scene.focal);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const front = Math.atan2(-scene.forward[0], -scene.forward[2]);
        const cameraTilt = Math.asin(-scene.forward[1]);
        for (const flight of flights) {
          const age = time - flight.start;
          const join = narrow ? .26 : .36;
          const slot = slotAt(flight.item.slot, time);
          const ready = track && orbit.has(flight.item.id);
          let onboard = ready && !flight.inCircuit ? launchForCircuit(flight, slot, track, course, age, narrow) : null;
          if (flight.inCircuit && ready && figure > .025) {
            onboard = { rail: circuitParcelTrack(slot.v, course, slot.lane), seated: 1,
              end: launchTime + .44, v: slot.v };
          }
          const rail = onboard?.rail ?? track?.(departurePosition(join, age));
          const arrival = ramp(.87, launchTime, age);
          const land = entry > .09 && rail;
          const target = land ? parcelPose(rail, packageSize) : null;
          flight.end = onboard?.end ?? flightLimit;
          if (age < launchTime || !target) {
            const lift = ramp(.08, .75, age);
            const startX = flight.rect.left + flight.width / 2;
            const startY = flight.rect.top + flight.height / 2;
            const x = lerp(startX, w * (flight.inCircuit ? (narrow ? .49 : .47) : (narrow ? .48 : .49)), lift);
            const y = lerp(startY, Math.min(startY, h * (flight.inCircuit ? (narrow ? .414 : .48) : (narrow ? .44 : .51))), lift);
            const depth = packageSize[0] * scene.focal / (narrow ? 85 : 98);
            const end = target?.p ?? overlay.world(w * .35, h * .28, depth * 2.8);
            const position = blend3(overlay.world(x, y, depth), end, target ? arrival : ramp(.96, 2.13, age));
            if (target) position[1] += Math.sin(arrival * Math.PI) * .78;
            const matched = flight.inCircuit && onboard ? arrival : 0;
            const size = lerp(packageSize[0], (narrow ? .95 : 1.02) * (flight.item.id === selected?.id ? 1.06 : 1), matched);
            const pose = { p: position, size: [size, size, size * 1.04], alpha: target ? 1 : 1 - ramp(1.66, 2.22, age), tape: 1,
              photo: flight.item.sticker,
              yaw: turnTo(front - .32 * lift, rail?.yaw ?? front, arrival),
              pitch: lerp(cameraTilt, -.25 * Math.sin(lift * Math.PI) + .16 * lift, lift) * (1 - arrival) };
            if (pose.alpha > .02) {
              if (age < .83) foldForm(overlay, pose, flight.form, flight, age, flight.label);
              else if (target && age >= .88) drawBox(scene, pose, colorMix(carton, flight.item.tint, matched), 1, truck);
              else drawBox(overlay, pose, carton);
              if (age < .88 || !target) dirty = true;
            }
          } else {
            const seated = onboard?.seated ?? 0;
            const focus = flight.item.id === selected?.id;
            const size = lerp(packageSize[0], (narrow ? .95 : 1.02) * (focus ? 1.06 : 1), seated);
            const pose = parcelPose(rail, [size, size, size * 1.04]);
            const glow = (1 - ramp(launchTime + .18, flightLimit, age)) * (1 - seated);
            const receding = 1 - ramp(flightLimit - .95, flightLimit, age);
            pose.alpha = lerp(receding, figure * trafficWindow(onboard?.v ?? 0, shot), seated);
            const item = { ...flight.item, tint: colorMix(carton, flight.item.tint, seated), label: flight.label };
            const point = messageParcel(scene, item, pose, focus && seated > .78, glow, drawBox, truck);
            if (point && seated > .78 && pose.alpha > .47) {
              picks.push(point);
              visiblePoints.set(item.id, { ...point, body: item.body, imageUrl: item.imageUrl });
            }
          }
        }
        overlay.render();
        flights = flights.filter(flight => time - flight.start < flight.end);
      }
      return { picks, preview: showPreview(selected, time, mostRecent, visiblePoints, figure > .67 && shot < 7.35, reduced) };
    },
    clear() {
      flights = [];
      erase();
    },
  };
}
