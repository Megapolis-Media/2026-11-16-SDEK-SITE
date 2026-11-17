const tau = 2 * Math.PI;
const near = .72;
export const lerp = (a, b, t) => a + (b - a) * t;
export const bound = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
export const ease = t => t * t * (3 - 2 * t);
export const ramp = (start, end, value) => ease(bound((value - start) / (end - start)));
export const blend3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const normal = (x, y, z) => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};

function path(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}

export function colorMix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const aa = rgb(a), bb = rgb(b);
  const channel = i => Math.round(lerp(aa[i], bb[i], t)).toString(16).padStart(2, '0');
  return '#' + channel(0) + channel(1) + channel(2);
}

function shade(hex, multiplier, lift = 0) {
  return 'rgb(' + rgb(hex).map(channel => Math.round(bound(channel * multiplier + lift, 0, 255))).join(',') + ')';
}

export function mapPoints(view, point) {
  const y = view.pitch ? point[1] * view.cp + point[2] * view.sp : point[1];
  const z = view.pitch ? point[2] * view.cp - point[1] * view.sp : point[2];
  return [
    view.p[0] + (view.c * point[0] + view.s * z) * view.scale,
    view.p[1] + y * view.scale,
    view.p[2] + (view.c * z - view.s * point[0]) * view.scale,
  ];
}

function angledPoint(point, rotation) {
  const sine = Math.sin(rotation), cosine = Math.cos(rotation);
  return [point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine, point[2]];
}

const planes = [
  { at: [0, 1, 3, 2], axis: 2, face: -1 },
  { at: [4, 6, 7, 5], axis: 2, face: 1 },
  { at: [0, 2, 6, 4], axis: 0, face: -1 },
  { at: [1, 5, 7, 3], axis: 0, face: 1 },
  { at: [0, 4, 5, 1], axis: 1, face: -1 },
  { at: [2, 3, 7, 6], axis: 1, face: 1 },
];

const faceFactors = [[0.65, 0.89], [0.40, 1.10], [0.72, 0.86]];
const lightFactors = [[0, 6], [0, 9], [0, 5]];

function corners(x, y, z, w, h, d) {
  return Array.from({ length: 8 }, (_, i) => [
    x + (i & 1 ? 1 : -1) * w / 2,
    y + (i & 2 ? 1 : -1) * h / 2,
    z + (i & 4 ? 1 : -1) * d / 2,
  ]);
}

function clippedCornerPoints(x, z, w, d, bevel, height) {
  const left = x - w / 2, right = x + w / 2, back = z - d / 2, front = z + d / 2;
  return [[left + bevel, height, back], [right - bevel, height, back],
    [right, height, back + bevel], [right, height, front - bevel],
    [right - bevel, height, front], [left + bevel, height, front],
    [left, height, front - bevel], [left, height, back + bevel]];
}

export class Projector {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = [];
  }

  camera(eye, look, width, height, x, y, focal) {
    this.eye = eye;
    this.width = width;
    this.height = height;
    this.x = x;
    this.y = y;
    this.focal = focal;
    this.forward = normal(look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]);
    this.right = normal(-this.forward[2], 0, this.forward[0]);
    const [rx, , rz] = this.right;
    const [fx, fy, fz] = this.forward;
    this.up = [-rz * fy, rz * fx - rx * fz, rx * fy];
  }

  view(point) {
    const dx = point[0] - this.eye[0], dy = point[1] - this.eye[1], dz = point[2] - this.eye[2];
    const [rx, , rz] = this.right, [ux, uy, uz] = this.up, [fx, fy, fz] = this.forward;
    return [rx * dx + rz * dz, ux * dx + uy * dy + uz * dz, fx * dx + fy * dy + fz * dz];
  }

  point(point) {
    const p = this.view(point);
    if (p[2] < near) return null;
    return this.screen(p);
  }

  screen(p) {
    return [this.x + this.focal * p[0] / p[2], this.y - this.focal * p[1] / p[2], p[2]];
  }

  world(x, y, depth) {
    const horizontal = (x - this.x) * depth / this.focal;
    const vertical = (this.y - y) * depth / this.focal;
    return this.eye.map((value, i) => value + this.right[i] * horizontal + this.up[i] * vertical + this.forward[i] * depth);
  }

  clipped(points) {
    const output = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      if (p[2] >= near) output.push(this.screen(p));
      if ((p[2] >= near) !== (q[2] >= near)) {
        output.push(this.screen(blend3(p, q, (near - p[2]) / (q[2] - p[2]))));
      }
    }
    return output;
  }

  visible(points) {
    let outside = 31;
    for (const [x, y, depth] of points) {
      const plane = depth >= near ? 0 : 16;
      const horiz = this.focal * x + this.x * depth;
      const vert = this.y * depth - this.focal * y;
      const side = depth * this.width;
      const bottom = depth * this.height;
      // The plane inequalities apply to negative depth as well.
      outside &= plane | (horiz < 0 ? 1 : 0) | (horiz > side ? 2 : 0)
        | (vert < 0 ? 4 : 0) | (vert > bottom ? 8 : 0);
      if (!outside) return true;
    }
    return false;
  }

  surface(view, fill, alpha, depth, visible = false) {
    if (alpha <= .003) return;
    if (!visible && !this.visible(view)) return;
    const points = this.clipped(view);
    if (points.length >= 3) this.queue.push({ points, fill, alpha, depth });
  }

  object(p, yaw = 0, scale = 1, pitch = 0) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const x = (this.eye[0] - p[0]) / scale, z = (this.eye[2] - p[2]) / scale;
    const y = (this.eye[1] - p[1]) / scale, depth = s * x + c * z;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    return { p, s, c, scale, pitch, cp, sp, localEye: [c * x - s * z, cp * y - sp * depth, sp * y + cp * depth] };
  }

  fill(world, fill, alpha = 1, bias = 0, style = {}) {
    if (alpha <= 0.003) return;
    const view = world.map(point => this.view(point));
    const points = this.clipped(view);
    if (points.length < 3) return;
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > this.width || Math.max(...ys) < 0 || Math.min(...ys) > this.height) return;
    const { depth = points.reduce((sum, p) => sum + p[2], 0) / points.length, image, ...appearance } = style;
    this.queue.push({ points, fill, alpha, ...appearance,
      image: view.every(point => point[2] >= near) ? image : undefined, depth: depth + bias });
  }

  solid(view, data, alpha = 1, options = {}) {
    const [x, y, z, w, h, d, paint] = data;
    const center = [x, y, z];
    const radius = [w / 2, h / 2, d / 2];
    const points = corners(x, y, z, w, h, d).map(p => options.rotation ? angledPoint(p, options.rotation) : p)
      .map(p => mapPoints(view, p));
    for (const { at, axis, face } of planes) {
      if (!options.rotation && (view.localEye[axis] - center[axis]) * face <= radius[axis] - 0.0001) continue;
      const material = options.faces?.[axis]?.[face === -1 ? 0 : 1] ?? paint;
      const light = faceFactors[axis][face === -1 ? 0 : 1];
      const lift = lightFactors[axis][face === -1 ? 0 : 1];
      this.fill(at.map(i => points[i]), material, alpha, options.bias, {
        light, lift, glossy: options.glossy ?? true, rim: options.rim,
      });
    }
  }

  case(view, data, alpha = 1, bevel = .10, fixedDepth, openFront = false) {
    const [x, y, z, w, h, d, paint] = data;
    const outer = Math.min(bevel, w * .19, d * .19, h * .25);
    const bottom = y - h / 2, top = y + h / 2;
    const vertices = [
      clippedCornerPoints(x, z, w - outer * 1.1, d - outer * 1.1, outer * .63, bottom),
      clippedCornerPoints(x, z, w, d, outer, bottom + outer),
      clippedCornerPoints(x, z, w, d, outer, top - outer),
      clippedCornerPoints(x, z, w - outer * 1.1, d - outer * 1.1, outer * .63, top),
    ];
    const ref = [x, y, z];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      const ox = (vertices[1][i][0] + vertices[1][j][0]) / 2 - x;
      const oz = (vertices[1][i][2] + vertices[1][j][2]) / 2 - z;
      const facing = (view.localEye[0] - ref[0] - ox) * ox + (view.localEye[2] - ref[2] - oz) * oz;
      const side = bound(.73 + ox * .042 + oz * .057, .55, .93);
      if (facing >= 0 && !(openFront && i === 4)) {
        this.fill([vertices[0][i], vertices[0][j], vertices[1][j], vertices[1][i]].map(p => mapPoints(view, p)), paint,
          alpha, 0, { light: side * .69, lift: 1, depth: fixedDepth === undefined ? undefined : fixedDepth + .018 });
        this.fill([vertices[1][i], vertices[1][j], vertices[2][j], vertices[2][i]].map(p => mapPoints(view, p)), paint,
          alpha, 0, { light: side, lift: 5, glossy: true, depth: fixedDepth === undefined ? undefined : fixedDepth + .012 });
      }
      if (facing >= 0 || view.localEye[1] >= top + outer) {
        this.fill([vertices[2][i], vertices[2][j], vertices[3][j], vertices[3][i]].map(p => mapPoints(view, p)), paint,
          alpha, 0, { light: side * 1.14, lift: 15, glossy: true, depth: fixedDepth === undefined ? undefined : fixedDepth + .007 });
      }
    }
    if (view.localEye[1] >= top) {
      this.fill(vertices[3].map(p => mapPoints(view, p)), paint, alpha, 0, { light: 1.04, lift: 10, glossy: true, depth: fixedDepth });
    }
  }

  panel(view, points, fill, alpha = 1, bias = 0, details) {
    this.fill(points.map(point => mapPoints(view, point)), fill, alpha, bias, details);
  }

  rect(view, x, y, z, w, h, fill, alpha = 1, bias = 0, details) {
    this.panel(view, [[x - w / 2, y + h / 2, z], [x + w / 2, y + h / 2, z],
      [x + w / 2, y - h / 2, z], [x - w / 2, y - h / 2, z]], fill, alpha, bias, details);
  }

  contactShadow(center, width, length, yaw, alpha, depth) {
    if (alpha <= .006) return;
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const points = corners.map(([x, z]) => this.point([
      center[0] + x * width * .5 * cosine + z * length * .5 * sine,
      center[1], center[2] + z * length * .5 * cosine - x * width * .5 * sine,
    ]));
    if (points.some(point => !point)) return;
    if (points.every(p => p[0] < 0) || points.every(p => p[0] > this.width)
      || points.every(p => p[1] < 0) || points.every(p => p[1] > this.height)) return;
    this.queue.push({ points, alpha, depth: depth ?? this.view(center)[2], shadow: true });
  }

  disk(view, center, radius, color, axis, alpha = 1, bias = 0, details = {}) {
    const points = [];
    for (let i = 0; i < 34; i++) {
      const a = tau * i / 34, c = Math.cos(a) * radius, s = Math.sin(a) * radius;
      points.push(axis === 'z' ? [center[0] + c, center[1] + s, center[2]]
        : [center[0], center[1] + c, center[2] + s]);
    }
    this.panel(view, points, color, alpha, bias, details);
  }

  line(world, tint, alpha, thickness = 1, bias = 0, glow = false) {
    if (alpha <= 0.003) return;
    const view = world.map(point => this.view(point));
    let points = [];
    const submit = () => {
      if (points.length > 1) {
        const depth = points.reduce((sum, point) => sum + point[2], 0) / points.length;
        this.queue.push({ depth: depth + bias, points, fill: tint, alpha, thickness, glow, line: true });
      }
      points = [];
    };
    for (let i = 0; i < view.length; i++) {
      const point = view[i];
      const previous = view[i - 1];
      if (previous && (previous[2] >= near) !== (point[2] >= near)) {
        points.push(this.screen(blend3(previous, point, (near - previous[2]) / (point[2] - previous[2]))));
        if (point[2] < near) submit();
      }
      if (point[2] >= near) points.push(this.screen(point));
    }
    submit();
  }

  group(depth, draw) {
    const start = this.queue.length;
    draw();
    const items = this.queue.splice(start);
    if (items.length) this.queue.push({ depth, items });
  }

  render() {
    this.paint(this.queue);
    this.ctx.globalAlpha = 1;
    this.queue.length = 0;
  }

  paint(items) {
    const ctx = this.ctx;
    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) {
      if (item.items) {
        this.paint(item.items);
        continue;
      }
      const { points, alpha, fill } = item;
      ctx.globalAlpha = alpha;
      if (item.shadow) {
        this.paintShadow(points);
        continue;
      }
      if (item.line) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        points.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = item.thickness;
        ctx.strokeStyle = fill;
        if (item.glow) {
          ctx.shadowColor = fill;
          ctx.shadowBlur = item.thickness * 2.0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        continue;
      }
      path(ctx, points);
      if (item.image?.width && points.length === 4) {
        this.image(item);
      } else if (item.text && points.length === 4) {
        const h = Math.hypot(points[3][0] - points[0][0], points[3][1] - points[0][1]);
        if (h >= 5) {
          ctx.font = '650 ' + Math.max(5, h * .72) + 'px Inter, Arial, sans-serif';
          ctx.fillStyle = fill;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const x = points.reduce((sum, p) => sum + p[0], 0) / 4;
          const y = points.reduce((sum, p) => sum + p[1], 0) / 4;
          ctx.fillText(item.text, x, y);
        }
      } else {
        const factor = item.light ?? 1;
        const lift = item.lift ?? 0;
        const a = points[0], b = points[Math.min(2, points.length - 1)];
        if (item.gradient) {
          const [from, to] = item.gradientAxis ?? [a, b];
          const paint = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
          item.gradient.forEach(([stop, color]) => paint.addColorStop(stop, color));
          ctx.fillStyle = paint;
        } else if (item.glossy && Math.hypot(a[0] - b[0], a[1] - b[1]) > 13) {
          const paint = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
          paint.addColorStop(0, shade(fill, factor * .73, lift));
          paint.addColorStop(.27, shade(fill, factor * 1.02, lift + 2));
          paint.addColorStop(.38, shade(fill, factor * 1.12, lift + 7));
          paint.addColorStop(.62, shade(fill, factor, lift));
          paint.addColorStop(1, shade(fill, factor * .73, lift));
          ctx.fillStyle = paint;
        } else {
          ctx.fillStyle = factor === 1 && lift === 0 ? fill : shade(fill, factor, lift);
        }
        ctx.fill();
        if (item.glow) {
          ctx.save();
          ctx.globalAlpha = alpha * .54;
          ctx.shadowBlur = item.glow;
          ctx.shadowColor = fill;
          ctx.fill();
          ctx.restore();
        }
        if (item.rim) {
          ctx.strokeStyle = item.rim;
          ctx.lineWidth = .63;
          ctx.stroke();
        }
      }
    }
  }

  paintShadow([a, b, c, d]) {
    const ctx = this.ctx;
    ctx.save();
    ctx.transform((b[0] + c[0] - a[0] - d[0]) / 4, (b[1] + c[1] - a[1] - d[1]) / 4,
      (d[0] + c[0] - a[0] - b[0]) / 4, (d[1] + c[1] - a[1] - b[1]) / 4,
      (a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4);
    const paint = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    paint.addColorStop(0, '#011615');
    paint.addColorStop(.55, '#011615c9');
    paint.addColorStop(1, '#01161500');
    ctx.fillStyle = paint;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  image(item) {
    const { points: [a, b, c, d], image } = item;
    const ctx = this.ctx;
    const { width, height, source } = image;
    if (!item.imageShade && !item.perspective) {
      ctx.save();
      ctx.clip();
      ctx.transform((b[0] - a[0]) / width, (b[1] - a[1]) / width,
        (d[0] - a[0]) / height, (d[1] - a[1]) / height, a[0], a[1]);
      ctx.drawImage(source, 0, 0, width + 1, height + 1);
      ctx.restore();
      return;
    }
    const vertical = (p, q, t) => {
      if (!item.perspective) return blend3(p, q, t);
      const depth = lerp(p[2], q[2], t);
      return [(p[0] * p[2] * (1 - t) + q[0] * q[2] * t) / depth,
        (p[1] * p[2] * (1 - t) + q[1] * q[2] * t) / depth, depth];
    };
    const left = i => vertical(a, d, i);
    const right = i => vertical(b, c, i);
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 8; i++) {
      const from = i / 8;
      const to = (i + 1) / 8;
      const p = left(from), q = right(from), r = left(to);
      ctx.save();
      ctx.transform((q[0] - p[0]) / width, (q[1] - p[1]) / width,
        (r[0] - p[0]) / (height / 8), (r[1] - p[1]) / (height / 8), p[0], p[1]);
      ctx.drawImage(source, 0, from * height, width, height / 8,
        0, -.35, width + 1, height / 8 + .75);
      ctx.restore();
    }
    ctx.restore();
    if (item.imageShade) {
      path(ctx, [a, b, c, d]);
      const paint = ctx.createLinearGradient(a[0], a[1], c[0], c[1]);
      paint.addColorStop(0, '#8bffe525');
      paint.addColorStop(.47, '#064b4111');
      paint.addColorStop(1, '#041d276b');
      ctx.fillStyle = paint;
      ctx.fill();
    }
  }
}
