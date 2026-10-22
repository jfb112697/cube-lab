# Cube Lab — a playable Rubik's Cube

React + Three.js (`@react-three/fiber` + `drei`) with a focus on intuitive layer indicators.

## Run

```bash
pnpm install
pnpm dev
```

Then open the printed URL (default `http://127.0.0.1:5199`).

## How to play

- **Hover** a sticker — the row and column through it light up as spin candidates.
- **Drag** along a row/column — the layer follows your pointer and snaps on release.
- **Click** a sticker — two glowing rings appear (one per candidate layer). Hover a ring
  half to preview that spin direction (the layer nudges ~10°), click to commit.
- **Orbit** by dragging the background; scroll to zoom.
- Keys: `R L U D F B M E S` (+`Shift` for reverse), `Ctrl+Z` undo, `Space` scramble, `Esc` cancel.

Colors are tied to rotation axes: cyan = X, amber = Y, pink = Z — used consistently for
band shells, rotation rings, and the HUD legend.
