import * as THREE from 'three';

export type AxisKey = 'x' | 'y' | 'z';

/** Positive unit vectors for each rotation axis. */
export const AXES: Record<AxisKey, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export const AXIS_INDEX: Record<AxisKey, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** The two "other" axes for a face normal along a given axis. */
export const OTHER_AXES: Record<AxisKey, [AxisKey, AxisKey]> = {
  x: ['y', 'z'],
  y: ['x', 'z'],
  z: ['x', 'y'],
};

/** Distinct indicator colors per rotation axis — used for bands, arcs and HUD. */
export const AXIS_CSS: Record<AxisKey, string> = {
  x: '#22d3ee',
  y: '#f6c453',
  z: '#f472c8',
};
export const AXIS_HEX: Record<AxisKey, number> = {
  x: 0x22d3ee,
  y: 0xf6c453,
  z: 0xf472c8,
};

export const SPACING = 1.065;

export interface StickerDef {
  /** Unique key, e.g. "12:101" (cubie id + normal components). */
  key: string;
  /** Outward normal in cubie-local space (unit, axis aligned). */
  n: THREE.Vector3;
  color: number;
}

export interface CubieData {
  id: number;
  /** Logical grid position, components in {-1,0,1}. Mutated as moves commit. */
  pos: THREE.Vector3;
  /** Accumulated orientation. Mutated as moves commit. */
  quat: THREE.Quaternion;
  stickers: StickerDef[];
}

/** Standard(ish) color scheme: U white, D yellow, F green, B blue, R red, L orange. */
export const FACE_COLORS: { n: THREE.Vector3; color: number }[] = [
  { n: new THREE.Vector3(0, 1, 0), color: 0xf2f5fb }, // U
  { n: new THREE.Vector3(0, -1, 0), color: 0xffd028 }, // D
  { n: new THREE.Vector3(0, 0, 1), color: 0x0fbf62 }, // F
  { n: new THREE.Vector3(0, 0, -1), color: 0x2e6bf0 }, // B
  { n: new THREE.Vector3(1, 0, 0), color: 0xe23c32 }, // R
  { n: new THREE.Vector3(-1, 0, 0), color: 0xff8b1f }, // L
];

export function createCubies(): CubieData[] {
  const cubies: CubieData[] = [];
  let id = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const pos = new THREE.Vector3(x, y, z);
        const stickers: StickerDef[] = [];
        for (const f of FACE_COLORS) {
          if (pos.dot(f.n) === 1) {
            stickers.push({
              key: `${id}:${f.n.x}${f.n.y}${f.n.z}`,
              n: f.n.clone(),
              color: f.color,
            });
          }
        }
        cubies.push({ id: id++, pos, quat: new THREE.Quaternion(), stickers });
      }
    }
  }
  return cubies;
}

const PLUS_Z = new THREE.Vector3(0, 0, 1);

/** Quaternion that orients a +Z-facing object along `n`. */
export function quatFromDir(n: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(PLUS_Z, n.clone().normalize());
}

/** Dominant axis key of a (near axis-aligned) direction vector. */
export function dominantAxis(v: THREE.Vector3): AxisKey {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return 'x';
  if (ay >= az) return 'y';
  return 'z';
}

/** Round a near-axis-aligned unit vector to the exact signed axis unit vector. */
export function snapDir(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const k = dominantAxis(v);
  out.set(0, 0, 0);
  out[k] = Math.sign(v[k]) || 1;
  return out;
}

const _w = new THREE.Vector3();

/** Is the cube solved (every face uniform)? */
export function isSolved(cubies: CubieData[]): boolean {
  for (const f of FACE_COLORS) {
    let color = -1;
    for (const c of cubies) {
      for (const s of c.stickers) {
        _w.copy(s.n).applyQuaternion(c.quat);
        if (snapDir(_w, _w).equals(f.n)) {
          if (color < 0) color = s.color;
          else if (color !== s.color) return false;
        }
      }
    }
  }
  return true;
}

const LETTERS: Record<AxisKey, [string, string, string]> = {
  x: ['L', 'M', 'R'],
  y: ['D', 'E', 'U'],
  z: ['B', 'S', 'F'],
};

/** Standard cube notation for a move: quarter turns about the positive axis. */
export function notate(axis: AxisKey, layer: number, quarters: number): string {
  const letter = LETTERS[axis][layer + 1];
  // Sign that converts "+90deg about positive axis" quarters into
  // "clockwise from outside that face" quarters.
  const signBase = layer !== 0 ? -Math.sign(layer) : axis === 'z' ? -1 : 1;
  const cw = signBase * quarters;
  const n = ((cw % 4) + 4) % 4;
  if (n === 1) return letter;
  if (n === 2) return letter + '2';
  return letter + "'";
}

export interface MoveSpec {
  axis: AxisKey;
  layer: number;
  quarters: number;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  return `${m}:${s.toString().padStart(2, '0')}.${t}`;
}
