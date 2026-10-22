import { create } from 'zustand';
import type { AxisKey, MoveSpec } from './core';

export type Phase = 'idle' | 'hover' | 'selected' | 'busy';

export interface Band {
  axis: AxisKey;
  layer: number;
}

/** World-space anchor for the on-face switch pill (clicked sticker). */
export interface SelectionAnchor {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface Selection {
  /** The two candidate layers crossing at the clicked sticker. */
  bands: Band[];
  /** Index into bands: the layer currently armed to spin. */
  armed: number;
  /** Sticker key that opened this selection (re-clicking it dismisses). */
  stickerKey: string;
  anchor: SelectionAnchor;
}

interface Store {
  phase: Phase;
  hoverBands: Band[] | null;
  selection: Selection | null;

  history: MoveSpec[];
  moves: number;
  wasScrambled: boolean;
  solvedAt: number | null;
  solvedDismissed: boolean;
  timerStart: number | null;
  timerStop: number | null;
  muted: boolean;
  helpOpen: boolean;
  scrambling: boolean;

  setPhase: (p: Phase) => void;
  setHover: (bands: Band[] | null) => void;
  setSelection: (s: Selection | null) => void;
  armBand: (i: number) => void;
  cancelSelection: () => void;

  pushMove: (m: MoveSpec) => void;
  popMove: () => void;
  maybeStartTimer: () => void;
  markSolved: () => void;
  finishScramble: () => void;
  resetAll: () => void;

  toggleMute: () => void;
  setHelpOpen: (open: boolean) => void;
  dismissSolved: () => void;
}

export const useStore = create<Store>((set, get) => ({
  phase: 'idle',
  hoverBands: null,
  selection: null,

  history: [],
  moves: 0,
  wasScrambled: false,
  solvedAt: null,
  solvedDismissed: true,
  timerStart: null,
  timerStop: null,
  muted: false,
  helpOpen: false,
  scrambling: false,

  setPhase: (p) => set({ phase: p }),
  setHover: (bands) => set({ hoverBands: bands }),
  setSelection: (s) => set({ selection: s }),
  armBand: (i) => set((s) => (s.selection ? { selection: { ...s.selection, armed: i } } : {})),
  cancelSelection: () => set((s) => (s.selection ? { selection: null, phase: 'idle' } : {})),

  pushMove: (m) =>
    set((s) => {
      const history = [...s.history, m];
      return { history, moves: history.length };
    }),
  popMove: () =>
    set((s) => {
      const history = s.history.slice(0, -1);
      return { history, moves: history.length };
    }),
  maybeStartTimer: () => {
    const s = get();
    if (s.wasScrambled && s.timerStart === null) set({ timerStart: performance.now() });
  },
  markSolved: () => {
    const s = get();
    if (s.solvedAt !== null) return;
    set({
      solvedAt: performance.now(),
      solvedDismissed: false,
      timerStop: s.timerStart !== null ? performance.now() : null,
    });
  },
  finishScramble: () =>
    set({
      phase: 'idle',
      scrambling: false,
      wasScrambled: true,
      history: [],
      moves: 0,
      timerStart: null,
      timerStop: null,
      solvedAt: null,
      solvedDismissed: true,
    }),
  resetAll: () =>
    set({
      phase: 'idle',
      scrambling: false,
      wasScrambled: false,
      history: [],
      moves: 0,
      timerStart: null,
      timerStop: null,
      solvedAt: null,
      solvedDismissed: true,
      selection: null,
      hoverBands: null,
    }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setHelpOpen: (open) => set({ helpOpen: open }),
  dismissSolved: () => set({ solvedDismissed: true }),
}));
