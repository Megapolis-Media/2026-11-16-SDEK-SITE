import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTruck, makeParcels } from './route-objects.js';

const TAU = Math.PI * 2;
const LOOP = 12;
const palette = ['#12c477', '#ff8b20', '#25e796', '#076847', '#eefbf4', '#ffab36'];
const cartonTape = new T.Color('#f4fff7');
const cartonSeam = new T.Color('#bbd9bd');
const colors = palette.map(value => new T.Color(value));

const bends = [
  [-52, 40], [-21, 24], [-8, 15], [6, 7.3], [21, 1.7], [33, 2.0],
  [52, 12.1], [68, 17.1], [84, 10.7], [99, -4.5], [115, -11.4],
  [133, -7.0], [150, 5.4], [167, 12.2], [184, 7.8], [201, -4.6],
  [222, -15.2], [241, -9.0], [263, 1.5], [295, 5.0],
];

const tracks = [
  { offset: 0, rise: 0, width: 7.3, ripple: 0, green: '#08b770' },
  { offset: 8.6, rise: 3.3, width: 4.5, ripple: 2.4, green: '#0caf6d' },
  { offset: 15.1, rise: 6.5, width: 5.2, ripple: 4, green: '#0bbd72' },
  { offset: -15.5, rise: 8.4, width: 4.4, ripple: -6.1, green: '#0acc7b' },
  { offset: -21.7, rise: 10.9, width: 2.85, ripple: -8, green: '#08a862' },
];

const shots = [
  { s: -14.3, side: -7.4, y: 7.2, ahead: 30, aim: -4.9, up: 1.0, roll: -0.03, lead: 14.7 },
  { s: 30, side: 9.1, y: 8.2, ahead: 22, aim: 12.2, up: 2.5, roll: 0.064, lead: 14.5 },
  { s: 79, side: 1.8, y: 6.1, ahead: 19, aim: -5.6, up: 3.6, roll: -0.087, lead: 19.8 },
  { s: 125, side: 4.1, y: 13.4, ahead: 38, aim: 5.5, up: 3.0, roll: 0.036, lead: 15.4 },
  { s: 158, side: -8.2, y: 11.4, ahead: 28, aim: -5.4, up: 5.4, roll: -0.045, lead: 18.6 },
];

const smooth = value => value * value * (3 - 2 * value);
const mix = T.MathUtils.lerp;
const wrap = (value, max) => ((value % max) + max) % max;

function centerX(s) {
  let i = 0;
  while (i < bends.length - 2 && s > bends[i + 1][0]) i++;
  const a = bends[Math.max(0, i - 1)];
  const b = bends[i];
  const c = bends[i + 1];
  const d = bends[Math.min(bends.length - 1, i + 2)];
  const distance = c[0] - b[0];
  const t = T.MathUtils.clamp((s - b[0]) / distance, 0, 1);
  const m1 = (c[1] - a[1]) / (c[0] - a[0]) * distance;
  const m2 = (d[1] - b[1]) / (d[0] - b[0]) * distance;
  return mix(b[1], c[1], smooth(t)) + m1 * t * (1 - t) ** 2 + m2 * t * t * (t - 1);
}

function trackX(s, lane) {
  const swell = Math.sin((s + 18) / 18) * 0.56 + Math.sin((s - 9) / 39) * 0.44;
  return centerX(s) + lane.offset + lane.ripple * swell;
}

function elevation(s, lane) {
  return lane.rise + Math.sin((s - 14) / 24) * 0.49
    + Math.sin((s + 7) / 38) * lane.rise * 0.11;
}

function place(s, lane, lateral, lift, position) {
  const tangentX = (trackX(s + 0.08, lane) - trackX(s - 0.08, lane)) / 0.16;
  const normalX = 1 / Math.hypot(1, tangentX);
  position.set(trackX(s, lane) + normalX * lateral,
    elevation(s, lane) + lift, -s + tangentX * normalX * lateral);
  return -Math.atan(tangentX);
}

function ribbon(lane, offset, width, lift, wall = false) {
  const points = [];
  const uv = [];
  const indices = [];
  const vector = new T.Vector3();
  const start = -40;
  const end = 288;
  const steps = 547;
  for (let i = 0; i <= steps; i++) {
    const s = mix(start, end, i / steps);
    for (const edge of [-1, 1]) {
      place(s, lane, offset + (wall ? 0 : edge * width / 2), lift + (wall ? edge * width / 2 : 0), vector);
      points.push(vector.x, vector.y, vector.z);
      uv.push(edge === -1 ? 0 : 1, s);
    }
    const a = i * 2;
    if (i < steps) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function litDeck(color, travel) {
  const material = new T.MeshStandardMaterial({
    color, roughness: 0.35, metalness: 0.33, emissive: color, emissiveIntensity: 0.24,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTravel = travel;
    shader.vertexShader = 'varying vec2 vLane;\n' + shader.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLane = uv;');
    shader.fragmentShader = 'varying vec2 vLane;\nuniform float uTravel;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', String.raw`
        #include <color_fragment>
        float middle = sin(vLane.x * 3.14159265);
        float ripple = pow(0.5 + 0.5 * sin((vLane.y - uTravel) * 0.5235988 + 5.5 * vLane.x), 5.0);
        float streak = pow(0.5 + 0.5 * cos((vLane.y + uTravel * 0.7) * 0.24933275 + vLane.x * 30.0), 9.0);
        diffuseColor.rgb *= 0.67 + 0.29 * middle + 0.22 * ripple + 0.17 * streak;
      `);
  };
  return material;
}

function lightLine(color, travel, style = 0, offset = 0) {
  const c = new T.Color(color);
  return new T.ShaderMaterial({
    uniforms: {
      uTravel: travel,
      tint: { value: c },
      style: { value: style },
      shift: { value: offset },
      haze: { value: new T.Color('#06252b') },
    },
    vertexShader: String.raw`
      varying vec2 vTrack;
      varying float depth;
      void main() {
        vTrack = uv;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        depth = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: String.raw`
      uniform vec3 tint;
      uniform vec3 haze;
      uniform float style;
      uniform float shift;
      uniform float uTravel;
      varying vec2 vTrack;
      varying float depth;
      void main() {
        float x = vTrack.x;
        float y = vTrack.y;
        float veil = 1.0 - exp(-pow(depth * 0.0104, 1.63));
        float pulse = pow(0.5 + 0.5 * sin((y - uTravel + shift) * 0.5235988), 7.0);
        float speck = pow(0.5 + 0.5 * cos((y - uTravel + shift) * 0.1745329), 11.0);
        float alpha = mix(0.68, 1.0, pulse);
        if (style > 0.5) {
          alpha *= smoothstep(0.57, 0.66, fract((y + shift) * 0.25));
        }
        if (style > 1.5) {
          alpha = pow(max(0.0, sin(x * 3.14159265)), 2.6) * (0.15 + pulse * 0.64 + speck * 0.20);
        }
        if (style > 2.5) {
          alpha = pow(max(0.0, sin(x * 3.14159265)), 3.8) * speck * 0.81;
        }
        gl_FragColor = vec4(mix(tint * (0.86 + 0.32 * pulse), haze, veil * 0.78), alpha * (1.0 - veil * 0.71));
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
  });
}

function addRoads(scene, travel) {
  const alloy = new T.MeshStandardMaterial({ color: '#076348', roughness: 0.5, metalness: 0.45, side: T.DoubleSide });
  const dark = new T.MeshStandardMaterial({ color: '#052c2e', roughness: 0.39, metalness: 0.3 });
  const shoulder = new T.MeshStandardMaterial({ color: '#07644d', roughness: 0.32, metalness: 0.44 });
  const strip = (lane, x, w, y, material, wall) => scene.add(new T.Mesh(ribbon(lane, x, w, y, wall), material));
  for (let i = 0; i < tracks.length; i++) {
    const lane = tracks[i];
    const w = lane.width;
    const width = w / 2;
    strip(lane, 0, w, 0, litDeck(lane.green, travel));
    strip(lane, i === 0 ? 0.52 : -w * 0.1, w * (i === 0 ? 0.43 : 0.23), 0.012, dark);
    strip(lane, -width + 0.20, 0.4, 0.015, shoulder);
    strip(lane, width - 0.10, 0.2, 0.015, shoulder);
    for (const side of [-1, 1]) {
      strip(lane, side * width, 0.18, -0.091, alloy, true);
      strip(lane, side * (width - 0.018), 0.052, 0.021, lightLine('#71ffc0', travel, 0, i * 2));
      strip(lane, side * (width + 0.17), 0.40, -0.045, lightLine('#0efb93', travel, 2, i * 3));
      strip(lane, side * (width - 0.38), 0.045, 0.025, lightLine('#dafff1', travel, side === -1 ? 0 : 1, i * 4));
    }
    strip(lane, w * 0.31, i === 0 ? 0.11 : 0.09, 0.028, lightLine('#f0fff6', travel, 1, i * 6));
    strip(lane, -w * 0.35, 0.18, 0.026, lightLine('#f5fff9', travel, 2, i * 4));
    strip(lane, w * -0.19, 0.14, 0.027, lightLine(i === 0 ? '#fa9b32' : '#51ffc0', travel, 3, i * 7));
  }
}

function shadowTexture() {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
      const a = Math.max(0, 1 - radius);
      pixels[(y * size + x) * 4 + 3] = Math.round(a ** 1.53 * 255);
    }
  }
  const texture = new T.DataTexture(pixels, size, size, T.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = T.LinearFilter;
  return texture;
}

function lamp(scene, color, intensity, x, y, z) {
  const light = new T.DirectionalLight(color, intensity);
  light.position.set(x, y, z);
  scene.add(light);
}

function sampleShot(progress) {
  const n = Math.min(shots.length - 2, Math.floor(progress));
  const a = shots[n];
  const b = shots[n + 1];
  const t = smooth(progress - n);
  const frame = {};
  for (const key in a) frame[key] = mix(a[key], b[key], t);
  return frame;
}

function moveCamera(camera, f, progress, isMobile, phase, width, height) {
  const hero = 1 - smooth(T.MathUtils.clamp(progress * 1.8, 0, 1));
  const shift = height * hero * (isMobile ? 0.4 : 0.13);
  const view = camera.view;
  if (!view || view.fullWidth !== width || view.fullHeight !== height || Math.abs(view.offsetY - shift) > 0.4) {
    camera.setViewOffset(width, height, 0, shift, width, height);
  }
  const wobble = Math.sin(phase * 2) * 0.09;
  const xs = trackX(f.s, tracks[0]);
  camera.position.set(xs + f.side + (isMobile ? 1.6 * hero : 0) + wobble, f.y + (isMobile ? mix(1.0, 0.6, hero) : 0), -f.s);
  camera.lookAt(trackX(f.s + f.ahead, tracks[0]) + f.aim + (isMobile ? 7.2 * hero : 0),
    f.up + (isMobile ? 1.4 * hero : 0), -f.s - f.ahead);
  camera.rotateZ(f.roll + Math.sin(phase) * 0.008);
  return f.s + f.lead + (isMobile ? hero * 2.0 : 0) + Math.sin(phase) * 0.74;
}

export async function mountRoute(canvas, controls) {
  const contextOptions = { alpha: true, antialias: true, powerPreference: 'high-performance' };
  const context = canvas.getContext('webgl2', contextOptions);
  if (!context) {
    const { mountCanvasRoute } = await import('./route-canvas.js');
    return mountCanvasRoute(canvas, { ...controls, ready: () => controls.ready('canvas') }, { place, tracks, sampleShot, moveCamera });
  }
  const renderer = new T.WebGLRenderer({ canvas, context, ...contextOptions });
  renderer.setClearColor(0x051e23, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.20;
  const scene = new T.Scene();
  scene.fog = new T.FogExp2('#06252b', 0.013);
  const camera = new T.PerspectiveCamera(49, 1, 0.12, 205);
  const mobile = matchMedia('(max-width: 720px)');
  const pmrem = new T.PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  const reflections = pmrem.fromScene(studio, 0.12, 0.1, 100, { size: 64 });
  scene.environment = reflections.texture;
  scene.environmentIntensity = 0.83;
  studio.dispose();
  pmrem.dispose();

  scene.add(new T.HemisphereLight('#e8fffa', '#174242', 2.0));
  lamp(scene, '#fff4d8', 3.1, -18, 26, -12);
  lamp(scene, '#37ffd0', 1.75, 21, 14, -2);
  lamp(scene, '#a1eaff', 1.05, -9, 4, 17);

  const travel = { value: 0 };
  addRoads(scene, travel);
  const texture = await new T.TextureLoader().loadAsync('/visual/cdek-mark-white-512.png');
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const { truck, wheels } = createTruck(texture);
  scene.add(truck);

  const groundShadow = shadowTexture();
  const shadow = new T.Mesh(new T.PlaneGeometry(3.65, 10.4), new T.MeshBasicMaterial({
    map: groundShadow, color: '#010e10', opacity: 0.86, transparent: true, depthWrite: false,
  }));
  shadow.rotation.order = 'YXZ';
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;
  scene.add(shadow);

  const count = 52;
  const packs = makeParcels(count);
  const packageShadows = new T.InstancedMesh(new T.PlaneGeometry(1.68, 2.28),
    new T.MeshBasicMaterial({ map: groundShadow, color: '#02211b', opacity: 0.57, transparent: true, depthWrite: false }), count);
  packageShadows.frustumCulled = false;
  packageShadows.instanceMatrix.setUsage(T.DynamicDrawUsage);
  packageShadows.renderOrder = 2;
  scene.add(packageShadows, ...packs);
  const parcels = Array.from({ length: count }, (_, i) => ({
    lane: tracks[1 + i % (tracks.length - 1)],
    step: (Math.floor(i / 4) * 6.23 + (i % 4) * 1.71) % 81,
    lateral: Math.sin(i * 3.618) * 0.98,
    size: 0.62 + (i % 5) * 0.113 + (i % 13 === 7 ? 0.21 : 0),
    phase: i * 1.618,
  }));
  parcels.forEach((_, i) => {
    packs[0].setColorAt(i, colors[(i * 7 + Math.floor(i / 4)) % colors.length]);
    packs[1].setColorAt(i, cartonTape);
    packs[2].setColorAt(i, cartonSeam);
  });

  const dummy = new T.Object3D();
  let scroll = controls.progress();
  let frameId = 0;
  let last = performance.now();
  let clock = 0;
  let stopped = false;
  let ready = false;
  let lensWidth = 1;
  let lensHeight = 1;
  const held = () => controls.paused() || document.hidden;

  function resize() {
    if (stopped) return;
    const width = canvas.clientWidth || innerWidth;
    const height = canvas.clientHeight || innerHeight;
    lensWidth = width;
    lensHeight = height;
    const ratio = Math.min(devicePixelRatio, mobile.matches ? 1.45 : 1.65, Math.sqrt(2500000 / (width * height)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = mobile.matches ? 56 : 49;
    camera.updateProjectionMatrix();
  }

  function frame(now) {
    if (stopped) return;
    frameId = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.06);
    last = now;
    const target = controls.progress();
    const paused = held();
    if (document.hidden || (paused && ready && !controls.dirty())) return;
    if (!paused) {
      clock = wrap(clock + dt, LOOP);
      scroll = mix(scroll, target, 1 - Math.exp(-dt * 7.6));
    }
    const phase = clock / LOOP * TAU;
    const f = sampleShot(T.MathUtils.clamp(scroll, 0, shots.length - 1));
    const truckAt = moveCamera(camera, f, scroll, mobile.matches, phase, lensWidth, lensHeight);
    travel.value = clock * 3.0 + f.s * 0.3;
    truck.rotation.y = place(truckAt, tracks[0], 0.85, 0.038 + Math.sin(phase * 7) * 0.012, truck.position);
    truck.rotation.z = Math.sin(phase * 4) * 0.008;
    truck.rotation.x = Math.sin(phase * 6) * 0.005;
    for (const wheel of wheels) wheel.rotation.x = truckAt * -1.5 - phase * 3;
    place(truckAt, tracks[0], 0.85, 0.041, shadow.position);
    shadow.rotation.y = truck.rotation.y;
    const range = 81;
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      const distance = wrap(p.step + clock / LOOP * range, range);
      const at = f.s + distance - 11.0;
      const scale = p.size * Math.min(1, distance / 3.5, (range - distance) / 7.0);
      const hover = 0.12 + Math.sin(phase * 3 + p.phase) * 0.056;
      const yaw = place(at, p.lane, p.lateral, hover, dummy.position);
      dummy.rotation.set(Math.sin(phase + p.phase) * 0.08, yaw + Math.sin(p.phase) * 0.34, Math.sin(phase * 2 + p.phase) * 0.08);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      packs.forEach(mesh => mesh.setMatrixAt(i, dummy.matrix));
      place(at, p.lane, p.lateral + 0.18, 0.035, dummy.position);
      dummy.rotation.set(-Math.PI / 2, 0, yaw);
      dummy.updateMatrix();
      packageShadows.setMatrixAt(i, dummy.matrix);
    }
    packs.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    packageShadows.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      controls.ready('webgl');
    }
  }

  const lose = event => {
    event.preventDefault();
    stopped = true;
    cancelAnimationFrame(frameId);
    controls.fallback();
  };
  canvas.addEventListener('webglcontextlost', lose);
  const sizeObserver = new ResizeObserver(() => {
    resize();
    controls.invalidate();
  });
  sizeObserver.observe(canvas);
  resize();
  frameId = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
    sizeObserver.disconnect();
    canvas.removeEventListener('webglcontextlost', lose);
    const materials = new Set();
    scene.traverse(object => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      materials.add(object.material);
    });
    materials.forEach(material => material.dispose());
    reflections.dispose();
    texture.dispose();
    groundShadow.dispose();
    renderer.dispose();
  };
}
