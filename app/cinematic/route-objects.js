import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = (w, h, d, radius = 0) => radius
  ? new RoundedBoxGeometry(w, h, d, 2, radius)
  : new T.BoxGeometry(w, h, d);

const surface = (color, roughness, metalness = 0, extra = {}) =>
  new T.MeshStandardMaterial({ color, roughness, metalness, ...extra });

class Assembly {
  constructor() {
    this.parts = new Map();
  }

  put(geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) {
    geometry.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(part);
  }

  box(material, x, y, z, w, h, d, radius = 0, rx = 0, ry = 0, rz = 0) {
    this.put(box(w, h, d, radius), material, x, y, z, rx, ry, rz);
  }

  group() {
    const group = new T.Group();
    for (const [material, parts] of this.parts) {
      const geometry = mergeGeometries(parts);
      parts.forEach(part => part.dispose());
      group.add(new T.Mesh(geometry, material));
    }
    return group;
  }
}

export function createTruck(logo) {
  const truck = new T.Group();
  const green = surface('#08b86b', 0.26, 0.48, { envMapIntensity: 1.25 });
  const roof = surface('#10da7e', 0.26, 0.29);
  const cab = surface('#079e61', 0.23, 0.39);
  const dark = surface('#09302d', 0.36, 0.55);
  const black = surface('#071b1b', 0.56, 0.16);
  const silver = surface('#aec8c0', 0.27, 0.82);
  const white = surface('#effff7', 0.3, 0.18, { emissive: '#588c75', emissiveIntensity: 0.25 });
  const orange = surface('#ff841f', 0.32, 0.23, { emissive: '#fe4913', emissiveIntensity: 0.24 });
  const lamp = surface('#ff611f', 0.32, 0.13, { emissive: '#ff5c1a', emissiveIntensity: 1.65 });
  const glass = surface('#083838', 0.12, 0.49, { envMapIntensity: 1.55 });
  const gasket = surface('#031615', 0.38, 0.13);
  const rubber = surface('#071717', 0.78);
  const sidewall = surface('#152d2b', 0.64);

  const a = new Assembly();
  a.box(black, 0, 0.61, 0.18, 1.66, 0.24, 7.46, 0.045);
  a.box(dark, 0, 0.78, 0.71, 1.94, 0.24, 6.72, 0.038);
  a.box(green, 0, 1.97, 0.95, 2.19, 2.22, 5.77, 0.042);
  a.box(roof, 0, 3.086, 0.95, 2.15, 0.055, 5.72, 0.017);
  a.box(white, 0, 3.101, -1.927, 2.16, 0.065, 0.046, 0.013);
  a.box(white, 0, 3.104, 3.823, 2.17, 0.058, 0.045, 0.01);

  for (const side of [-1, 1]) {
    const edge = side * 1.097;
    a.box(white, edge, 3.073, 0.95, 0.059, 0.062, 5.76, 0.013);
    a.box(silver, edge, 0.875, 0.95, 0.057, 0.074, 5.74, 0.013);
    a.box(orange, edge, 0.977, 0.95, 0.038, 0.142, 5.71, 0.008);
    a.box(dark, side * 0.82, 0.54, 0.08, 0.35, 0.41, 1.19, 0.055);
    a.box(silver, side * 0.84, 0.5, -1.44, 0.42, 0.24, 0.83, 0.045);
    a.box(dark, side * 0.91, 0.29, -2.03, 0.38, 0.12, 0.63, 0.028);
    a.box(silver, side * 1.045, 1.19, 3.81, 0.055, 0.07, 0.09, 0.006);
    a.box(silver, side * 1.048, 2.55, 3.81, 0.055, 0.07, 0.09, 0.006);
    a.box(black, side * 0.973, 0.47, 3.56, 0.24, 0.53, 0.071, 0.015);
  }
  a.box(black, 0, 1.95, 3.846, 2.105, 2.12, 0.055, 0.018);
  for (const side of [-1, 1]) {
    const center = side * 0.524;
    a.box(dark, center, 1.963, 3.885, 1.012, 2.028, 0.047, 0.018);
    a.box(silver, center, 0.957, 3.915, 0.996, 0.031, 0.014);
    a.box(silver, center, 2.967, 3.915, 0.996, 0.031, 0.014);
    for (const x of [center - 0.491, center + 0.491]) {
      a.box(silver, x, 1.964, 3.917, 0.022, 1.994, 0.015);
    }
    const lock = side * 0.225;
    a.box(silver, lock, 1.955, 3.93, 0.036, 1.978, 0.028, 0.007);
    a.box(silver, lock + side * 0.11, 1.308, 3.942, 0.24, 0.039, 0.036, 0.007);
    for (const y of [1.12, 2.71]) {
      a.box(green, side * 0.945, y, 3.936, 0.166, 0.095, 0.045, 0.01);
    }
    a.box(lamp, side * 0.84, 0.477, 3.91, 0.216, 0.094, 0.028, 0.008);
    a.box(white, side * 0.665, 0.477, 3.909, 0.074, 0.091, 0.026, 0.006);
    a.box(orange, side * 1.01, 2.99, 3.902, 0.079, 0.042, 0.022, 0.004);
  }
  a.box(dark, 0, 0.475, 3.845, 2.01, 0.236, 0.178, 0.022);
  a.box(silver, 0, 0.254, 3.778, 1.947, 0.081, 0.145, 0.016);
  a.box(white, 0, 0.495, 3.945, 0.295, 0.087, 0.016, 0.006);

  a.box(cab, 0, 1.351, -3.034, 2.1, 1.24, 1.97, 0.13);
  a.box(cab, 0, 2.244, -2.982, 2.025, 0.999, 1.7, 0.14);
  a.box(roof, 0, 2.78, -2.68, 1.979, 0.235, 1.117, 0.089, -0.08);
  a.box(white, 0, 2.793, -3.307, 2.02, 0.082, 0.16, 0.034, -0.12);
  a.box(gasket, 0, 2.24, -3.855, 1.861, 0.64, 0.072, 0.038, -0.19);
  a.box(glass, 0, 2.249, -3.902, 1.774, 0.535, 0.024, 0.019, -0.19);
  a.box(dark, 0, 2.25, -3.927, 0.041, 0.543, 0.018, 0, -0.19);
  a.box(black, 0, 1.152, -4.031, 1.57, 0.396, 0.051, 0.039);
  for (const y of [1.032, 1.102, 1.172, 1.242, 1.312]) {
    a.box(silver, 0, y, -4.064, 1.307, 0.011, 0.012);
  }
  a.box(dark, 0, 0.788, -4.034, 2.069, 0.213, 0.156, 0.031);
  for (const side of [-1, 1]) {
    a.box(gasket, side * 1.015, 2.252, -3.293, 0.046, 0.574, 0.946, 0.07);
    a.box(glass, side * 1.041, 2.256, -3.313, 0.027, 0.488, 0.855, 0.068);
    a.box(gasket, side * 1.06, 2.24, -3.587, 0.021, 0.515, 0.042, 0.004);
    a.box(dark, side * 1.061, 1.826, -2.987, 0.036, 0.055, 0.193, 0.014);
    a.box(black, side * 1.105, 2.268, -3.75, 0.207, 0.044, 0.043, 0.01);
    a.box(black, side * 1.224, 2.208, -3.698, 0.117, 0.308, 0.114, 0.04);
    a.box(silver, side * 1.222, 2.207, -3.631, 0.077, 0.233, 0.021, 0.013);
    a.box(white, side * 0.849, 0.918, -4.121, 0.262, 0.097, 0.024, 0.016);
    a.box(orange, side * 1.021, 0.95, -4.062, 0.09, 0.048, 0.04, 0.009);
    a.box(black, side * 0.964, 0.774, -3.078, 0.33, 0.085, 1.139, 0.026);
  }
  truck.add(a.group());

  const decal = new T.MeshBasicMaterial({
    map: logo, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    color: '#e5fff1', toneMapped: false,
  });
  for (const side of [-1, 1]) {
    const brand = new T.Mesh(new T.PlaneGeometry(1.54, 0.42), decal);
    brand.position.set(side * 1.121, 1.44, 2.52);
    brand.rotation.y = side * Math.PI / 2;
    truck.add(brand);
  }
  const wheels = [];
  for (const z of [-3.23, -0.96, 2.27, 2.9, 3.49]) {
    for (const side of [-1, 1]) {
      const wheel = new Assembly();
      const cylinder = (material, x, radius, width) => {
        wheel.put(new T.CylinderGeometry(radius, radius, width, 24), material, x, 0, 0, 0, 0, Math.PI / 2);
      };
      cylinder(rubber, 0, 0.396, 0.286);
      cylinder(sidewall, side * 0.146, 0.336, 0.014);
      cylinder(silver, side * 0.158, 0.251, 0.021);
      cylinder(dark, side * 0.172, 0.196, 0.018);
      cylinder(silver, side * 0.192, 0.093, 0.046);
      for (let i = 0; i < 6; i++) {
        const theta = (i / 6) * Math.PI * 2;
        wheel.box(silver, side * 0.184, 0.138 * Math.cos(theta), 0.138 * Math.sin(theta),
          0.024, 0.035, 0.035, 0.008);
      }
      const rim = wheel.group();
      rim.position.set(side * 0.864, 0.416, z);
      truck.add(rim);
      wheels.push(rim);
    }
  }
  return { truck, wheels };
}

export function makeParcels(count) {
  const board = surface('#ffffff', 0.36, 0.25);
  const tape = surface('#ffffff', 0.31, 0.12);
  const seam = surface('#ffffff', 0.68, 0.05);
  const carton = box(1, 0.93, 1, 0.038);
  carton.translate(0, 0.465, 0);
  const parts = new Assembly();
  parts.box(tape, 0, 0.938, 0, 0.187, 0.023, 1.011, 0.006);
  parts.box(tape, 0, 0.941, 0, 1.012, 0.02, 0.182, 0.006);
  for (const side of [-1, 1]) {
    parts.box(tape, 0, 0.758, side * 0.503, 0.185, 0.353, 0.015, 0.004);
    parts.box(tape, side * 0.503, 0.803, 0, 0.015, 0.269, 0.182, 0.004);
    parts.box(seam, 0, 0.931, side * 0.245, 0.013, 0.01, 0.483);
    parts.box(seam, side * 0.504, 0.192, -0.296, 0.01, 0.043, 0.194);
    parts.box(seam, side * 0.504, 0.258, -0.312, 0.01, 0.031, 0.153);
  }
  const group = parts.group();
  const meshes = [new T.InstancedMesh(carton, board, count)];
  for (const child of group.children) {
    meshes.push(new T.InstancedMesh(child.geometry, child.material, count));
  }
  meshes.forEach(mesh => {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  });
  return meshes;
}
