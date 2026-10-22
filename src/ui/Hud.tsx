import { useEffect, useMemo, useState } from 'react';
import { AXIS_CSS, notate } from '../cube/core';
import { useStore } from '../cube/store';
import type { CubeEngine } from '../cube/engine';

function useClock() {
  const timerStart = useStore((s) => s.timerStart);
  const timerStop = useStore((s) => s.timerStop);
  const [, force] = useState(0);
  const running = timerStart !== null && timerStop === null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 83);
    return () => clearInterval(id);
  }, [running]);
  const ms = timerStart === null ? 0 : (timerStop ?? performance.now()) - timerStart;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${s.toString().padStart(2, '0')}.${t}`;
}

function TimerChip() {
  const time = useClock();
  const active = useStore((s) => s.timerStart !== null && s.timerStop === null);
  return (
    <div className={`chip mono ${active ? 'chip--live' : ''}`}>
      <span className="chip-label">TIME</span>
      <span>{time}</span>
    </div>
  );
}

function MovesChip() {
  const moves = useStore((s) => s.moves);
  return (
    <div className="chip mono">
      <span className="chip-label">MOVES</span>
      <span>{moves}</span>
    </div>
  );
}

function HistoryRibbon() {
  const history = useStore((s) => s.history);
  const scrambling = useStore((s) => s.scrambling);
  const chips = useMemo(() => history.map((m) => notate(m.axis, m.layer, m.quarters)), [history]);
  return (
    <div className="history" aria-live="polite">
      {scrambling ? (
        <span className="history-empty">scrambling…</span>
      ) : chips.length === 0 ? (
        <span className="history-empty">your moves will appear here</span>
      ) : (
        chips.slice(-14).map((c, i, arr) => <span key={`${c}-${i}`} className={`hist-chip ${i === arr.length - 1 ? 'hist-chip--new' : ''}`}>{c}</span>)
      )}
    </div>
  );
}

function HintBar() {
  const phase = useStore((s) => s.phase);
  const hoverBands = useStore((s) => s.hoverBands);
  const selection = useStore((s) => s.selection);
  const scrambling = useStore((s) => s.scrambling);
  const coarse = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
    [],
  );

  let text = '';
  if (scrambling) text = 'Scrambling — hang tight…';
  else if (phase === 'selected') text = 'Pick a layer on the sticker’s switch, then tap a ring arrow to spin';
  else if (phase === 'hover') text = 'Click a sticker to spin its row or column';
  else
    text = coarse
      ? 'Tap a sticker to choose its row or column — one finger orbits, pinch to zoom'
      : 'Hover a sticker to light up its layers — click to choose one';

  const bands = selection?.bands ?? hoverBands;
  return (
    <div className="hint">
      {bands && !scrambling && (
        <span className="hint-dots">
          {bands.map((b, i) => (
            <span
              key={b.axis + b.layer}
              className={`hint-dot${selection && i !== selection.armed ? ' hint-dot--dim' : ''}`}
              style={{ background: AXIS_CSS[b.axis] }}
            />
          ))}
        </span>
      )}
      <span>{text}</span>
    </div>
  );
}

function SolvedOverlay({ engine }: { engine: CubeEngine }) {
  const solvedAt = useStore((s) => s.solvedAt);
  const dismissed = useStore((s) => s.solvedDismissed);
  const dismiss = useStore((s) => s.dismissSolved);
  const moves = useStore((s) => s.moves);
  const time = useClock();
  const confetti = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.9,
        dur: 2.2 + Math.random() * 1.6,
        color: ['#22d3ee', '#f6c453', '#f472c8', '#0fbf62', '#2e6bf0', '#e23c32'][i % 6],
        rot: Math.random() * 360,
        size: 6 + Math.random() * 7,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [solvedAt],
  );
  if (solvedAt === null || dismissed) return null;
  return (
    <div className="solved-overlay">
      <div className="confetti" aria-hidden>
        {confetti.map((c, i) => (
          <i
            key={i}
            style={{
              left: `${c.left}%`,
              background: c.color,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`,
              width: c.size,
              height: c.size * 0.5,
              transform: `rotate(${c.rot}deg)`,
            }}
          />
        ))}
      </div>
      <div className="solved-card">
        <div className="solved-title">SOLVED</div>
        <div className="solved-stats">
          <span className="mono">{time}</span> · <span className="mono">{moves}</span> moves
        </div>
        <div className="solved-actions">
          <button
            className="btn btn--primary"
            onClick={() => {
              dismiss();
              engine.scramble();
            }}
          >
            Scramble again
          </button>
          <button className="btn" onClick={dismiss}>
            Keep browsing
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpPanel() {
  const open = useStore((s) => s.helpOpen);
  const setOpen = useStore((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    <div className="help-backdrop" onClick={() => setOpen(false)}>
      <div className="help" onClick={(e) => e.stopPropagation()}>
        <button className="help-close" onClick={() => setOpen(false)} aria-label="Close help">
          ✕
        </button>
        <h2>How to play</h2>
        <div className="help-row">
          <span className="help-emoji">🖱️</span>
          <p>
            <strong>Turn a layer.</strong> <em>Click</em> any sticker: a small switch pops up on that cubie’s
            face naming the two layers that cross there. Tap a segment (or press <kbd>Tab</kbd>) to choose which
            face of the cube spins.
          </p>
        </div>
        <div className="help-row">
          <span className="help-emoji">🎯</span>
          <p>
            <strong>Pick a spin.</strong> The chosen layer’s glowing ring carries two arrows — hover one to
            preview the direction, click it to commit. <em>Click the sticker again</em> or press <kbd>Esc</kbd>{' '}
            to cancel.
          </p>
        </div>
        <div className="help-row">
          <span className="help-emoji">🧭</span>
          <p>
            <strong>Orbit.</strong> Drag the background to rotate the view, scroll to zoom.
          </p>
        </div>
        <div className="help-row">
          <span className="help-emoji">⌨️</span>
          <p>
            <strong>Keys.</strong>{' '}
            <kbd>R</kbd> <kbd>L</kbd> <kbd>U</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>B</kbd> <kbd>M</kbd> <kbd>E</kbd>{' '}
            <kbd>S</kbd> turn faces (hold <kbd>Shift</kbd> to reverse), <kbd>Tab</kbd> switches the armed layer,{' '}
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Space</kbd> scramble, <kbd>Esc</kbd> cancel.
          </p>
        </div>
        <div className="help-legend">
          <span><i style={{ background: AXIS_CSS.x }} /> X-layers</span>
          <span><i style={{ background: AXIS_CSS.y }} /> Y-layers</span>
          <span><i style={{ background: AXIS_CSS.z }} /> Z-layers</span>
        </div>
      </div>
    </div>
  );
}

export default function Hud({ engine }: { engine: CubeEngine }) {
  const muted = useStore((s) => s.muted);
  const toggleMute = useStore((s) => s.toggleMute);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const helpOpen = useStore((s) => s.helpOpen);
  const canUndo = useStore((s) => s.history.length > 0 && !s.scrambling);
  const busy = useStore((s) => s.scrambling);

  return (
    <div className="hud">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <i /><i /><i /><i /><i /><i /><i /><i /><i />
          </div>
          <div>
            <div className="brand-name">CUBE LAB</div>
            <div className="brand-sub">react × three.js</div>
          </div>
        </div>
        <div className="stats">
          <TimerChip />
          <MovesChip />
        </div>
      </header>

      <SolvedOverlay engine={engine} />

      <footer className="bottom-bar">
        <HistoryRibbon />
        <HintBar />
        <div className="btn-bar">
          <button className="btn btn--primary" onClick={() => engine.scramble()} disabled={busy}>
            Scramble
          </button>
          <button className="btn" onClick={() => engine.undo()} disabled={!canUndo}>
            ↩ Undo
          </button>
          <button className="btn" onClick={() => engine.resetAll()}>
            Reset
          </button>
          <button className="btn btn--icon" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            className={`btn btn--icon ${helpOpen ? 'btn--active' : ''}`}
            onClick={() => setHelpOpen(!helpOpen)}
            title="How to play"
            aria-label="How to play"
          >
            ?
          </button>
        </div>
      </footer>

      <HelpPanel />
    </div>
  );
}
