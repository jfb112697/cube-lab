import { useEffect, useState } from 'react';
import Scene from './cube/Scene';
import Hud from './ui/Hud';
import { CubeEngine } from './cube/engine';
import { useStore } from './cube/store';
import type { AxisKey } from './cube/core';

const KEY_MOVES: Record<string, { axis: AxisKey; layer: number; quarters: number }> = {
  r: { axis: 'x', layer: 1, quarters: -1 },
  l: { axis: 'x', layer: -1, quarters: 1 },
  u: { axis: 'y', layer: 1, quarters: -1 },
  d: { axis: 'y', layer: -1, quarters: 1 },
  f: { axis: 'z', layer: 1, quarters: -1 },
  b: { axis: 'z', layer: -1, quarters: 1 },
  m: { axis: 'x', layer: 0, quarters: 1 },
  e: { axis: 'y', layer: 0, quarters: 1 },
  s: { axis: 'z', layer: 0, quarters: -1 },
};

export default function App() {
  const [engine] = useState(() => new CubeEngine());

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.altKey) return;
      const st = useStore.getState();
      if (ev.key === 'Escape') {
        engine.cancelSelection();
        st.setHelpOpen(false);
        return;
      }
      if (ev.key === 'Tab') {
        const sel = st.selection;
        if (sel) {
          ev.preventDefault();
          engine.armBand((sel.armed + 1) % sel.bands.length);
        }
        return;
      }
      if (ev.ctrlKey && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        engine.undo();
        return;
      }
      if (ev.code === 'Space') {
        ev.preventDefault();
        engine.scramble();
        return;
      }
      const move = KEY_MOVES[ev.key.toLowerCase()];
      if (!move) return;
      ev.preventDefault();
      engine.enqueueUser(ev.shiftKey ? { ...move, quarters: -move.quarters } : move);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return (
    <div className="app">
      <div className="vignette" aria-hidden />
      <Scene engine={engine} />
      <Hud engine={engine} />
    </div>
  );
}
