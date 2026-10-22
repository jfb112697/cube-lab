import * as THREE from 'three';
import {
  AXES,
  AXIS_INDEX,
  OTHER_AXES,
  SPACING,
  createCubies,
  dominantAxis,
  isSolved,
  notate,
  snapDir,
  type AxisKey,
  type CubieData,
  type MoveSpec,
} from './core';
import { useStore, type Band } from './store';
import { sound } from './sound';

const HALF_PI = Math.PI / 2;

interface Anim {
  axis: AxisKey;
  layer: number;
  /** Current rotation about the positive axis, radians. */
  angle: number;
  from: number;
  target: number;
  t: number;
  dur: number;
  ease: (k: number) => number;
  onDone?: (quarters: number) => void;
}

interface QueuedMove extends MoveSpec {
  dur: number;
  kind: 'user' | 'undo' | 'scramble';
  ease?: (k: number) => number;
  silent?: boolean;
  onDone?: () => void;
}

export interface StickerUd {
  cubieId: number;
  normal: THREE.Vector3;
  key: string;
}

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOutQuad = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutBack = (k: number) => {
  const c = 1.35;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class CubeEngine {
  cubies = createCubies();
  byId = new Map<number, CubieData>();
  refs = new Map<number, THREE.Group>();

  anim: Anim | null = null;
  /** Preview tilt: `target` is sign*0.16 while hovered, 0 once released —
   *  tick() glides `current` toward it and disposes at rest. */
  preview: { band: Band; sign: number; current: number; target: number } | null = null;
  queue: QueuedMove[] = [];
  lastInteract = performance.now();

  viz = {
    bands: [] as Band[],
    hoveredKey: '',
    activeBand: null as Band | null,
    /** The selection's armed band — the only layer that will actually spin. */
    armed: null as Band | null,
    celebrateT: -1e9,
    popT: -1e9,
  };

  constructor() {
    for (const c of this.cubies) this.byId.set(c.id, c);
  }

  register(id: number, group: THREE.Group) {
    this.refs.set(id, group);
  }

  // ---------------------------------------------------------------- geometry

  layerCubies(band: Band): CubieData[] {
    const i = AXIS_INDEX[band.axis];
    return this.cubies.filter((c) => Math.round(c.pos.getComponent(i)) === band.layer);
  }

  /** Position/orient the layer's cubies at `angle` about the positive axis. */
  applyVisual(band: Band, angle: number) {
    const axis = AXES[band.axis];
    _q.setFromAxisAngle(axis, angle);
    for (const c of this.layerCubies(band)) {
      const g = this.refs.get(c.id);
      if (!g) continue;
      _v.copy(c.pos).multiplyScalar(SPACING).applyQuaternion(_q);
      g.position.copy(_v);
      g.quaternion.copy(_q).multiply(c.quat);
    }
  }

  /** Snap the layer's cubies back to their committed transforms. */
  applyRest(band: Band) {
    for (const c of this.layerCubies(band)) {
      const g = this.refs.get(c.id);
      if (!g) continue;
      g.position.copy(c.pos).multiplyScalar(SPACING);
      g.quaternion.copy(c.quat);
    }
  }

  /**
   * Snap every cubie back to its committed transform, optionally skipping one
   * band (the layer currently being animated/previewed). Guarantees the cube
   * can never be left at a stray angle outside the one moving layer.
   */
  snapAllToRest(except?: Band) {
    for (const c of this.cubies) {
      if (except && Math.round(c.pos.getComponent(AXIS_INDEX[except.axis])) === except.layer) continue;
      const g = this.refs.get(c.id);
      if (!g) continue;
      g.position.copy(c.pos).multiplyScalar(SPACING);
      g.quaternion.copy(c.quat);
    }
  }

  /** Commit a move logically (quarter-turn multiples only). */
  finalize(band: Band, quarters: number) {
    if (quarters !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(AXES[band.axis], quarters * HALF_PI);
      for (const c of this.layerCubies(band)) {
        c.pos.applyQuaternion(q);
        c.pos.set(Math.round(c.pos.x), Math.round(c.pos.y), Math.round(c.pos.z));
        c.quat.premultiply(q);
      }
    }
    this.applyRest(band);
  }

  // ------------------------------------------------------------------- tick

  tick(dt: number) {
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      a.angle = a.from + (a.target - a.from) * a.ease(a.t);
      const band: Band = { axis: a.axis, layer: a.layer };
      this.applyVisual(band, a.angle);
      if (a.t >= 1) {
        const quarters = Math.round(a.target / HALF_PI);
        this.anim = null;
        this.viz.activeBand = null;
        this.finalize(band, quarters);
        a.onDone?.(quarters);
      }
    } else if (this.queue.length > 0) {
      const m = this.queue.shift()!;
      if (m.quarters === 0) {
        m.onDone?.();
      } else {
        const band: Band = { axis: m.axis, layer: m.layer };
        // A gliding preview must not fight the move for the same band.
        if (this.preview) {
          this.applyRest(this.preview.band);
          this.preview = null;
        }
        // Only this band is allowed to move; everything else snaps to rest.
        this.snapAllToRest(band);
        this.anim = {
          axis: m.axis,
          layer: m.layer,
          angle: 0,
          from: 0,
          target: m.quarters * HALF_PI,
          t: 0,
          dur: m.dur,
          ease: m.ease ?? easeOutCubic,
          onDone: (q) => {
            this.afterMove(m, q);
            m.onDone?.();
          },
        };
        this.viz.activeBand = band;
        if (!m.silent) sound.whoosh();
      }
    }

    if (this.preview && !this.anim) {
      const p = this.preview;
      p.current += (p.target - p.current) * Math.min(1, dt * 10);
      if (p.target === 0 && Math.abs(p.current) < 0.002) {
        // Released preview has settled: restore exact rest and dispose.
        this.applyRest(p.band);
        this.preview = null;
        this.viz.activeBand = null;
      } else {
        this.applyVisual(p.band, p.current);
      }
    }
  }

  // ------------------------------------------------------------- move results

  private afterMove(m: QueuedMove, quarters: number) {
    if (m.kind === 'scramble') {
      sound.snap(false);
      return;
    }
    sound.snap(true);
    const spec: MoveSpec = { axis: m.axis, layer: m.layer, quarters };
    const st = useStore.getState();
    if (m.kind === 'undo') st.popMove();
    else {
      st.pushMove(spec);
      st.maybeStartTimer();
    }
    if (isSolved(this.cubies) && st.wasScrambled) {
      st.markSolved();
      this.viz.celebrateT = performance.now();
      sound.solved();
    }
  }

  /** Wrap up a tween committed directly by the pointer (not via queue). */
  private commitDirect(band: Band, quarters: number) {
    if (quarters === 0) return;
    this.afterMove({ axis: band.axis, layer: band.layer, quarters, dur: 0, kind: 'user' }, quarters);
  }

  // ------------------------------------------------------------------ hover

  hover(ud: StickerUd) {
    this.lastInteract = performance.now();
    const st = useStore.getState();
    // While a selection is open the armed layer owns the highlight — sticker
    // sweeps must not recompute bands (that was the row/column conflict and
    // the tick-sound machine gun).
    if (this.anim || st.selection || st.phase === 'busy') return;
    const c = this.byId.get(ud.cubieId);
    if (!c) return;
    const n = snapDir(_v.copy(ud.normal).applyQuaternion(c.quat), _v2);
    const nKey = dominantAxis(n);
    const bands: Band[] = OTHER_AXES[nKey].map((k) => ({
      axis: k,
      layer: Math.round(c.pos.getComponent(AXIS_INDEX[k])),
    }));
    const prev = this.viz.bands;
    const changed =
      prev.length !== bands.length || prev.some((b, i) => b.axis !== bands[i].axis || b.layer !== bands[i].layer);
    this.viz.bands = bands;
    this.viz.hoveredKey = ud.key;
    if (changed) {
      sound.tick();
      st.setHover(bands);
      st.setPhase('hover');
    } else if (st.phase !== 'hover') {
      st.setPhase('hover');
    }
  }

  clearHover(key?: string) {
    const st = useStore.getState();
    if (st.selection) return;
    // A stale pointer-out (e.g. from a sticker the ray already left for
    // another sticker) must not wipe a fresher hover.
    if (key && this.viz.hoveredKey && this.viz.hoveredKey !== key) return;
    this.viz.bands = [];
    this.viz.hoveredKey = '';
    if (st.phase === 'hover') {
      st.setHover(null);
      st.setPhase('idle');
    }
  }

  // -------------------------------------------------------------- selection

  /** Click on a sticker: select the two layers crossing there, arming one. */
  clickSelect(ud: StickerUd) {
    if (this.anim || this.queue.length > 0) return;
    const st = useStore.getState();
    if (st.phase === 'busy') return;
    const c = this.byId.get(ud.cubieId);
    if (!c) return;
    this.lastInteract = performance.now();
    // Re-clicking the same sticker dismisses the selection.
    if (st.selection && st.selection.stickerKey === ud.key) {
      this.cancelSelection();
      return;
    }
    const n = snapDir(_v.copy(ud.normal).applyQuaternion(c.quat), _v2).clone();
    const nKey = dominantAxis(n);
    const bands: Band[] = OTHER_AXES[nKey].map((k) => ({
      axis: k,
      layer: Math.round(c.pos.getComponent(AXIS_INDEX[k])),
    }));
    if (this.preview) this.releasePreview();
    this.viz.activeBand = null;
    this.viz.bands = bands;
    this.viz.armed = bands[0];
    this.viz.hoveredKey = '';
    st.setHover(null);
    st.setSelection({
      bands,
      armed: 0,
      stickerKey: ud.key,
      anchor: {
        x: c.pos.x * SPACING + n.x * 0.95,
        y: c.pos.y * SPACING + n.y * 0.95,
        z: c.pos.z * SPACING + n.z * 0.95,
        nx: n.x,
        ny: n.y,
        nz: n.z,
      },
    });
    st.setPhase('selected');
    sound.tick();
  }

  /** Arm a different candidate band (on-face switch, Tab key). */
  armBand(i: number) {
    const st = useStore.getState();
    const sel = st.selection;
    if (!sel || this.anim || i === sel.armed || !sel.bands[i]) return;
    this.lastInteract = performance.now();
    // Any in-flight preview belongs to the previously armed band: release it.
    this.releasePreview();
    this.viz.activeBand = null;
    this.viz.armed = sel.bands[i];
    st.armBand(i);
    sound.tick();
  }

  /** Let any live preview glide back to rest (kept alive for tick() to finish). */
  private releasePreview() {
    if (this.preview) this.preview.target = 0;
  }

  setPreview(band: Band, sign: number) {
    if (this.anim) return;
    const st = useStore.getState();
    const sel = st.selection;
    if (!sel) return;
    // Only the armed band may preview — inert rings can't hijack the tilt.
    const armed = sel.bands[sel.armed];
    if (!armed || armed.axis !== band.axis || armed.layer !== band.layer) return;
    this.lastInteract = performance.now();
    const p = this.preview;
    if (p && p.band.axis === band.axis && p.band.layer === band.layer) {
      // Same band: (re)tilt toward the new direction, even mid-glide-back.
      if (p.sign !== sign || p.target === 0) {
        p.sign = sign;
        p.target = sign * 0.16;
        sound.tick();
      }
      this.viz.activeBand = { ...band };
      return;
    }
    // Restore the previously previewed band before tilting a different one,
    // so a layer is never abandoned mid-preview at a stray angle.
    if (p) this.applyRest(p.band);
    this.preview = { band: { ...band }, sign, current: 0, target: sign * 0.16 };
    this.viz.activeBand = { ...band };
    sound.tick();
  }

  clearPreview(band: Band, sign: number) {
    const p = this.preview;
    if (p && p.band.axis === band.axis && p.band.layer === band.layer && p.sign === sign) {
      // Glide back to rest — never snap, never abandon the tilt.
      p.target = 0;
    }
  }

  /** Commit the move currently being previewed (arrow clicked). */
  commitFromPreview() {
    const p = this.preview;
    if (!p || this.anim) return;
    this.preview = null;
    const st = useStore.getState();
    st.setSelection(null);
    st.setPhase('idle');
    this.viz.bands = [];
    this.viz.armed = null;
    this.viz.hoveredKey = '';
    // Only the committing band may be displaced; everything else snaps to rest.
    this.snapAllToRest(p.band);
    this.anim = {
      axis: p.band.axis,
      layer: p.band.layer,
      angle: p.current,
      from: p.current,
      target: p.sign * HALF_PI,
      t: 0,
      dur: 0.3,
      ease: easeOutBack,
      onDone: (q) => this.commitDirect(p.band, q),
    };
    this.viz.activeBand = { ...p.band };
    sound.whoosh();
  }

  cancelSelection() {
    if (this.anim) return;
    // A live preview is released, not dropped — tick() glides its band back
    // to rest instead of leaving the layer stuck at a stray angle.
    this.releasePreview();
    this.viz.activeBand = null;
    this.viz.bands = [];
    this.viz.armed = null;
    this.viz.hoveredKey = '';
    const st = useStore.getState();
    st.setSelection(null);
    st.setHover(null);
    st.setPhase('idle');
  }

  // ---------------------------------------------------------------- commands

  private busy(): boolean {
    return this.queue.length > 0 || this.anim !== null;
  }

  enqueueUser(spec: MoveSpec) {
    if (this.busy()) return;
    const st = useStore.getState();
    if (st.phase === 'busy') return;
    this.cancelSelection();
    this.queue.push({ ...spec, dur: 0.18, kind: 'user', ease: easeOutBack });
  }

  undo() {
    if (this.busy()) return;
    const st = useStore.getState();
    const h = st.history;
    if (h.length === 0) return;
    const last = h[h.length - 1];
    this.cancelSelection();
    this.queue.push({ axis: last.axis, layer: last.layer, quarters: -last.quarters, dur: 0.2, kind: 'undo' });
  }

  scramble() {
    if (this.busy()) return;
    const st = useStore.getState();
    this.cancelSelection();
    st.setPhase('busy');
    useStore.setState({ scrambling: true, solvedAt: null, solvedDismissed: true });
    const moves: MoveSpec[] = [];
    const rand = (n: number) => Math.floor(Math.random() * n);
    const keys: AxisKey[] = ['x', 'y', 'z'];
    while (moves.length < 22) {
      const axis = keys[rand(3)];
      const layer = rand(3) - 1;
      const last = moves[moves.length - 1];
      const secondLast = moves[moves.length - 2];
      // Never repeat the same layer back to back; avoid 3 turns on one axis.
      if (last && last.axis === axis && last.layer === layer) continue;
      if (last && secondLast && last.axis === axis && secondLast.axis === axis) continue;
      const quarters = [1, -1, 2][rand(3)];
      moves.push({ axis, layer, quarters });
    }
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      this.queue.push({
        ...m,
        dur: 0.09,
        kind: 'scramble',
        ease: easeInOutQuad,
        silent: true,
        onDone: i === moves.length - 1 ? () => {
          const s2 = useStore.getState();
          s2.finishScramble();
          sound.ready();
        } : undefined,
      });
    }
    sound.whoosh();
  }

  resetAll() {
    this.queue = [];
    this.anim = null;
    this.preview = null;
    this.viz.bands = [];
    this.viz.hoveredKey = '';
    this.viz.activeBand = null;
    this.viz.armed = null;
    this.viz.popT = performance.now();
    const fresh = createCubies();
    for (const c of this.cubies) {
      const f = fresh.find((x) => x.id === c.id)!;
      c.pos.copy(f.pos);
      c.quat.copy(f.quat);
      const g = this.refs.get(c.id);
      if (g) {
        g.position.copy(c.pos).multiplyScalar(SPACING);
        g.quaternion.copy(c.quat);
      }
    }
    useStore.getState().resetAll();
    sound.pop();
  }
}
