# Browser Games

A collection of free games that run directly in the browser. Plain HTML/CSS/JS, no build step, no dependencies.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Any static host works for deployment (GitHub Pages, Netlify, Cloudflare Pages, etc.).

## Games

### Grand Prix Racer (`games/racing/`)

Top-down racer on four fictional circuits: Monzano, Monterra, Silverbrook and Spavelle.

- **Arrow keys** (or WASD) to drive, **Esc** to pause, **R** to restart
- On-screen buttons on touch devices
- 1/3/5 laps, 0/3/5 AI opponents, three difficulty levels
- Best lap per circuit is saved in the browser

| File | Purpose |
| --- | --- |
| `tracks.js` | Track layouts (control points) and spline geometry |
| `physics.js` | Car handling, barriers, lap counting, AI drivers (no DOM, testable in Node) |
| `game.js` | Rendering, input, HUD, menus and race flow |

To add a circuit, append an entry to `TRACKS` in `tracks.js`. Points are listed in driving order and the first point is the start/finish line.
