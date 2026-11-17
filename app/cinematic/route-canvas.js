import * as T from 'three';

const TAU = Math.PI * 2;
const LOOP = 12;
const faces = [
  { side: 0, sign: -1, corners: [0, 4, 6, 2], tint: 0.68 },
  { side: 0, sign: 1, corners: [1, 3, 7, 5], tint: 0.82 },
  { side: 1, sign: -1, corners: [0, 1, 5, 4], tint: 0.35 },
  { side: 1, sign: 1, corners: [2, 6, 7, 3], tint: 1.08 },
  { side: 2, sign: -1, corners: [0, 2, 3, 1], tint: 0.77 },
  { side: 2, sign: 1, corners: [4, 5, 7, 6], tint: 0.59 },
];

const colorCache = new Map();

const fleet = [
  [0, 0.60, 0.16, 1.83, 0.39, 7.70, '#163d3a'],
  [0, 0.42, 3.83, 1.96, 0.24, 0.16, '#455f5e'],
  [0, 1.98, 0.95, 2.20, 2.21, 5.77, '#09c77b'],
  [0, 3.09, 0.95, 2.12, 0.05, 5.72, '#18e58a'],
  [0, 3.10, -1.93, 2.16, 0.068, 0.065, '#e8fff4'],
  [0, 3.10, 3.83, 2.16, 0.062, 0.060, '#eafff4'],
  [0, 1.96, 3.86, 2.06, 2.08, 0.06, '#113231'],
  [0, 1.93, 3.90, 0.035, 2.04, 0.022, '#839e90'],
  [0, 2.97, 3.91, 2.0, 0.035, 0.024, '#aec8b9'],
  [0, 0.95, 3.91, 2.0, 0.041, 0.024, '#a4c4b7'],
  [0, 1.35, -3.03, 2.1, 1.22, 1.94, '#08a766'],
  [0, 2.24, -2.97, 2.0, 0.92, 1.67, '#11c477'],
  [0, 2.77, -2.72, 1.97, 0.20, 1.09, '#2be58d'],
  [0, 2.75, -3.30, 2.01, 0.092, 0.21, '#e8fff5'],
  [0, 2.28, -3.82, 1.82, 0.56, 0.06, '#102c31'],
  [0, 1.22, -4.02, 1.42, 0.40, 0.065, '#143736'],
  [0, 0.82, -4.01, 2.08, 0.20, 0.145, '#3d625b'],
];

for (const side of [-1, 1]) {
  fleet.push(
    [side * 1.10, 3.082, 0.95, 0.064, 0.060, 5.77, '#f0fff4'],
    [side * 1.10, 0.87, 0.95, 0.066, 0.076, 5.75, '#9cb4ad'],
    [side * 1.106, 0.99, 0.95, 0.042, 0.139, 5.71, '#ff9425'],
    [side * 1.01, 1.95, 3.91, 0.045, 2.06, 0.041, '#adc7ba'],
    [side * 0.26, 1.95, 3.925, 0.052, 2.02, 0.044, '#728f84'],
    [side * 0.37, 1.39, 3.947, 0.24, 0.060, 0.031, '#829e90'],
    [side * 0.84, 0.49, 3.92, 0.23, 0.096, 0.041, '#ff9d37'],
    [side * 0.65, 0.49, 3.92, 0.084, 0.096, 0.041, '#fff7c6'],
    [side * 1.016, 2.24, -3.30, 0.048, 0.54, 0.94, '#092a2b'],
    [side * 1.045, 2.27, -3.33, 0.025, 0.42, 0.85, '#387772'],
    [side * 1.063, 1.82, -2.98, 0.023, 0.053, 0.19, '#16413c'],
    [side * 1.12, 2.25, -3.64, 0.23, 0.05, 0.061, '#183f3c'],
    [side * 1.24, 2.19, -3.65, 0.13, 0.29, 0.14, '#234f4c'],
    [side * 0.89, 0.94, -4.102, 0.25, 0.091, 0.048, '#ecfff7'],
  );
}

function color(hex, multiplier, glow = 0) {
  const key = hex + ':' + multiplier + ':' + glow;
  if (!colorCache.has(key)) {
    const n = Number.parseInt(hex.slice(1), 16);
    const channels = [n >> 16, n >> 8 & 255, n & 255].map(v => Math.min(255, Math.round(v * multiplier + glow)));
    colorCache.set(key, 'rgb(' + channels.join(',') + ')');
  }
  return colorCache.get(key);
}

function polygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

export function mountCanvasRoute(canvas, controls, route) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas is unavailable');
  const { place, tracks, sampleShot, moveCamera } = route;
  const camera = new T.PerspectiveCamera(49, 1, 0.12, 205);
  const mobile = matchMedia('(max-width: 720px)');
  const mark = new Image();
  mark.src = '/visual/cdek-mark-white-512.png';
  const matrix = new T.Matrix4();
  const point = new T.Vector3();
  const model = new T.Vector3();
  const pieces = [];
  const roadCache = new Map();
  let width = 1;
  let height = 1;
  let ratio = 1;
  let frame = 0;
  let time = 0;
  let progress = controls.progress();
  let last = 0;
  let ready = false;
  let dirty = true;
  let closed = false;

  function resize() {
    width = canvas.clientWidth || innerWidth;
    height = canvas.clientHeight || innerHeight;
    ratio = Math.min(devicePixelRatio, 1.45, Math.sqrt(1700000 / (width * height)));
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    camera.aspect = width / height;
    camera.fov = mobile.matches ? 56 : 49;
    dirty = true;
  }

  function project(x, y, z) {
    const m = matrix.elements;
    const depth = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (depth < 0.92) return null;
    const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / depth;
    const py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / depth;
    return [(px + 1) * width * 0.5, (1 - py) * height * 0.5, depth];
  }

  function roadPoint(s, lane, x, y) {
    place(s, lane, x, y, point);
    return project(point.x, point.y, point.z);
  }

  function ribbon(lane, offset, size, lift, from, to, fill, step = 0.92) {
    const left = [];
    const right = [];
    for (let s = from; s <= to + step * 0.5; s += step) {
      const v = Math.min(s, to);
      const a = roadPoint(v, lane, offset - size / 2, lift);
      const b = roadPoint(v, lane, offset + size / 2, lift);
      if (a && b) {
        left.push(a);
        right.push(b);
      }
    }
    if (left.length < 2) return;
    polygon(ctx, left.concat(right.reverse()));
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function staticRibbon(lane, offset, size, lift, from, to, fill) {
    const start = -42;
    const step = 1.2;
    const count = 282;
    const key = [lane.rise, offset, size, lift].join('/');
    let vertices = roadCache.get(key);
    if (!vertices) {
      vertices = new Float32Array(count * 6);
      for (let i = 0; i < count; i++) {
        const s = start + i * step;
        place(s, lane, offset - size / 2, lift, point);
        point.toArray(vertices, i * 6);
        place(s, lane, offset + size / 2, lift, point);
        point.toArray(vertices, i * 6 + 3);
      }
      roadCache.set(key, vertices);
    }
    const left = [];
    const right = [];
    const first = Math.max(0, Math.floor((from - start) / step));
    const last = Math.min(count - 1, Math.ceil((to - start) / step));
    for (let i = first; i <= last; i++) {
      const n = i * 6;
      const a = project(vertices[n], vertices[n + 1], vertices[n + 2]);
      const b = project(vertices[n + 3], vertices[n + 4], vertices[n + 5]);
      if (a && b) {
        left.push(a);
        right.push(b);
      }
    }
    if (left.length < 2) return;
    polygon(ctx, left.concat(right.reverse()));
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function road(f) {
    const begin = f.s - 7;
    const end = f.s + 130;
    const motion = time / LOOP * 36;
    for (const index of [0, 1, 2, 3, 4]) {
      const lane = tracks[index];
      const w = lane.width;
      const deck = ctx.createLinearGradient(width * 0.43, height * 0.03, width * 0.73, height * 0.81);
      deck.addColorStop(0, '#096349');
      deck.addColorStop(0.28, '#0dc478');
      deck.addColorStop(0.58, index === 0 ? '#11db87' : '#07b976');
      deck.addColorStop(1, '#08a564');
      staticRibbon(lane, 0, w + 0.34, -0.24, begin, end, '#043a31');
      staticRibbon(lane, 0, w, 0, begin, end, deck);
      staticRibbon(lane, index === 0 ? 0.53 : -w * 0.1, w * (index === 0 ? 0.43 : 0.29), 0.014, begin, end, '#082d30');
      staticRibbon(lane, w / 2 - 0.16, 0.31, 0.016, begin, end, '#077257');
      staticRibbon(lane, -w / 2 + 0.14, 0.25, 0.017, begin, end, '#099f6b');
      staticRibbon(lane, -w / 2 + 0.035, 0.062, 0.025, begin, end, '#71ffc1');
      staticRibbon(lane, w / 2 - 0.03, 0.052, 0.025, begin, end, '#35f89a');
      staticRibbon(lane, -w / 2 + 0.42, index === 0 ? 0.08 : 0.115, 0.029, begin, end, '#e4fff3');
      for (let s = Math.floor(begin / 7) * 7; s < end - 4; s += 7) {
        ctx.globalAlpha = 0.35 + Math.exp(-Math.max(0, s - f.s) * 0.028) * 0.61;
        ribbon(lane, w * 0.33, 0.095, 0.026, s, s + 2.9, '#effff9', 0.7);
      }
      for (let s = Math.floor((begin - motion) / 12) * 12 + motion; s < end - 8; s += 12) {
        ctx.globalAlpha = 0.11 + Math.exp(-Math.max(0, s - f.s) * 0.046) * 0.51;
        ribbon(lane, -w * 0.32, 0.17, 0.031, s, s + 5.6, '#d2ffee', 0.82);
        ribbon(lane, w * 0.23, 0.11, 0.031, s + 3.8, s + 8, index % 2 ? '#fcad49' : '#5affb2', 0.7);
      }
      ctx.globalAlpha = 1;
    }
  }

  function shape(x, y, z, yaw, scale) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const camX = camera.position.x - x;
    const camZ = camera.position.z - z;
    return {
      view: [(c * camX - s * camZ) / scale, (camera.position.y - y) / scale, (s * camX + c * camZ) / scale],
      point: (lx, ly, lz) => project(x + scale * (c * lx + s * lz), y + scale * ly, z + scale * (-s * lx + c * lz)),
    };
  }

  function fillBox(origin, data, highlight = true) {
    const [x, y, z, width, height, length, material] = data;
    const positions = [x, y, z];
    const radii = [width / 2, height / 2, length / 2];
    const vertices = Array.from({ length: 8 }, (_, i) => origin.point(
      x + (i & 1 ? 1 : -1) * radii[0],
      y + (i & 2 ? 1 : -1) * radii[1],
      z + (i & 4 ? 1 : -1) * radii[2],
    ));
    for (const face of faces) {
      if ((origin.view[face.side] - positions[face.side]) * face.sign <= radii[face.side]) continue;
      const points = face.corners.map(i => vertices[i]);
      if (points.some(p => !p)) continue;
      pieces.push({
        depth: points.reduce((sum, p) => sum + p[2], 0) / points.length,
        draw: () => {
          polygon(ctx, points);
          const base = color(material, face.tint);
          const a = points[0];
          const b = points[2];
          if (highlight && Math.hypot(a[0] - b[0], a[1] - b[1]) > 10) {
            const paint = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
            paint.addColorStop(0, color(material, face.tint * 0.69));
            paint.addColorStop(0.34, color(material, face.tint * 1.11, 7));
            paint.addColorStop(0.69, base);
            paint.addColorStop(1, color(material, face.tint * 0.79));
            ctx.fillStyle = paint;
          } else ctx.fillStyle = base;
          ctx.fill();
          ctx.strokeStyle = color(material, face.tint * 1.10, 3);
          ctx.lineWidth = 0.55;
          ctx.stroke();
        },
      });
    }
  }

  function drawWheel(origin, side, z, phase) {
    if ((origin.view[0] - side * 0.88) * side < 0) return;
    const midpoint = origin.point(side * 1.01, 0.425, z);
    if (!midpoint) return;
    pieces.push({
      depth: midpoint[2],
      draw: () => {
        for (const [radius, shade] of [[0.409, '#0b2225'], [0.329, '#254145'], [0.243, '#9ab1ae'], [0.181, '#355457'], [0.089, '#b9c9c4']]) {
          const points = Array.from({ length: 20 }, (_, i) => {
            const angle = i / 20 * TAU + phase;
            return origin.point(side * 1.019, 0.425 + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
          });
          if (points.some(p => !p)) continue;
          polygon(ctx, points);
          ctx.fillStyle = shade;
          ctx.fill();
        }
      },
    });
  }

  function drawMark(origin, side) {
    if (!mark.complete || !mark.naturalWidth || origin.view[0] * side < 0) return;
    const x = side * 1.111;
    const sign = side === -1 ? 1 : -1;
    const a = origin.point(x, 1.92, 2.35 - sign * 0.74);
    const b = origin.point(x, 1.92, 2.35 + sign * 0.74);
    const c = origin.point(x, 1.51, 2.35 - sign * 0.74);
    if (!a || !b || !c) return;
    pieces.push({
      depth: (a[2] + b[2] + c[2]) / 3 - 0.56,
      draw: () => {
        ctx.save();
        ctx.transform((b[0] - a[0]) / mark.naturalWidth, (b[1] - a[1]) / mark.naturalWidth,
          (c[0] - a[0]) / mark.naturalHeight, (c[1] - a[1]) / mark.naturalHeight, a[0], a[1]);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(mark, 0, 0);
        ctx.restore();
      },
    });
  }

  function carton(lane, at, lateral, size, paint, i) {
    const lift = 0.12 + 0.06 * Math.sin(time * TAU / LOOP * 3 + i * 1.37);
    const yaw = place(at, lane, lateral, lift, model);
    const tail = roadPoint(at - 6, lane, lateral, 0.055);
    const head = roadPoint(at, lane, lateral, 0.055);
    if (tail && head && Math.hypot(head[0] - tail[0], head[1] - tail[1]) > 2) {
      const light = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1]);
      light.addColorStop(0, paint + '00');
      light.addColorStop(1, paint + '72');
      ribbon(lane, lateral, size * 0.56, 0.041, at - 6, at, light, 0.72);
    }
    const center = project(model.x, model.y + size * 0.5, model.z);
    const margin = center ? (size / center[2]) * height * 2 : 0;
    if (!center || center[0] < -margin || center[0] > width + margin || center[1] < -margin || center[1] > height + margin) return;
    const origin = shape(model.x, model.y, model.z, yaw + 0.33 * Math.sin(i * 1.3), size);
    fillBox(origin, [0, 0.465, 0, 1, 0.93, 1, paint]);
    for (const tape of [
      [0, 0.946, 0, 0.173, 0.035, 1.01],
      [0, 0.949, 0, 1.014, 0.033, 0.18],
      [0, 0.746, -0.505, 0.18, 0.37, 0.024],
      [0, 0.746, 0.505, 0.18, 0.37, 0.024],
      [-0.505, 0.796, 0, 0.024, 0.267, 0.18],
      [0.505, 0.796, 0, 0.024, 0.267, 0.18],
    ]) fillBox(origin, [...tape, '#f1fff0'], false);
  }

  function render(now) {
    if (closed) return;
    frame = requestAnimationFrame(render);
    if (document.hidden || now - last < 31) return;
    const elapsed = Math.min((now - last) / 1000, 0.08);
    last = now;
    const paused = controls.paused();
    if (paused && ready && !dirty && !controls.dirty()) return;
    dirty = false;
    if (!paused) {
      progress = T.MathUtils.lerp(progress, controls.progress(), 1 - Math.exp(-elapsed * 7.6));
      time = (time + elapsed) % LOOP;
    }
    const f = sampleShot(progress);
    const phase = time / LOOP * TAU;
    const isMobile = mobile.matches;
    const at = moveCamera(camera, f, progress, isMobile, phase, width, height);
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    road(f);
    pieces.length = 0;
    const packs = ['#14c982', '#ff972a', '#24e594', '#087e58', '#f3fff2', '#ffac38'];
    for (let i = 0; i < 44; i++) {
      const lane = tracks[1 + i % 4];
      const relative = (Math.floor(i / 4) * 6.92 + i % 4 * 1.9 + time / LOOP * 77) % 77;
      const size = (0.67 + i % 5 * 0.14) * Math.min(1, relative / 3, (77 - relative) / 7);
      if (size < 0.03) continue;
      carton(lane, f.s + relative - 9.5, Math.sin(i * 2.9) * 0.92, size, packs[(i * 7 + Math.floor(i / 4)) % packs.length], i);
    }
    const shadow = ctx.createLinearGradient(0, height * 0.25, width, height);
    shadow.addColorStop(0, '#02171926');
    shadow.addColorStop(1, '#021719ab');
    ribbon(tracks[0], 0.85, 2.83, 0.049, at - 4.55, at + 4.95, shadow, 0.57);
    const yaw = place(at, tracks[0], 0.85, 0.043, model);
    const truck = shape(model.x, model.y, model.z, yaw, 1);
    for (const part of fleet) fillBox(truck, part);
    for (const z of [-3.23, -0.96, 2.27, 2.9, 3.49]) {
      for (const side of [-1, 1]) drawWheel(truck, side, z, phase * 3);
    }
    drawMark(truck, -1);
    drawMark(truck, 1);
    pieces.sort((a, b) => b.depth - a.depth);
    pieces.forEach(piece => piece.draw());

    if (!ready) {
      ready = true;
      controls.ready();
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  frame = requestAnimationFrame(render);
  return () => {
    closed = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
