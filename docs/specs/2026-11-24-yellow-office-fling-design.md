# Yellow office and poke-and-fling creatures

Date: 2026-11-24. Size: a small change (short design).

## Why
The user's favourite colour is yellow and they find the creatures funny. They want the Team Board office to feel yellow and
want to grab and throw the creatures for fun. The yellow testing creature is now named Riva (done: `~/.claude/section-team/names.json`).

## Goals
1. **Yellow look, per user.** `/team office yellow` saves `{"v":1,"look":"yellow"}` in `~/.claude/section-team/office.json`;
   `/team office night` (or no file) keeps today's dark office. Read each poll tick, like `names.json`, so it shows within a second
   in every open chat. Yellow: butter-yellow walls, honey floor, a sunny sky in the windows, a warm rug down the corridor.
2. **Poke and fling.** On every creature, at a desk or in the corridor:
   - press and hold: it squishes and shows a surprised mark (CSS `:active`), cursor `grab` / `grabbing`;
   - click (release): it flies up in an arc, spins, bounces and lands back on its spot (SMIL `begin="<id>.click"`).
   - Each creature has its own silly flight (a few flight styles shared out, for example a big tumble for Riva, a slow
     drifting float for the floaters Lumi and Echo, a fast spin for Zip).

## Non-goals
- Real drag where the creature follows the mouse (rejected below).
- Throwing desk props; changing the board cards or the Claude app's own theme.
- The terminal (it draws no office) and VS Code (it draws the office as a still image, so no fling there; the yellow look still shows).

## Anti-goals (a failure even if it works)
- The office stops showing states, walks or names correctly, or the board gets slow.
- A creature, Riva above all, is hard to see on the yellow background.
- The office source passes the 131072-character `Svg` limit (today about 45000).

## Constraints
- The office `Svg` may hold no script: the engine strips it and the frame has no `allow-scripts`. Only CSS (`:active`, `:hover`)
  and SMIL animation are available.
- The fling needs `isInteractive` on the office `Svg`: desktop and mobile then draw it in a sandboxed frame instead of an image.
  Today a test pins `isInteractive` as unset; that test changes on purpose.
- A rebuild of the office picture (a state, name or walk change) cuts a flight short. Accepted.
- `prefers-reduced-motion` stops the CSS motion only; a fling runs only when the person clicks, so it stays.

## Spike (2026-11-24, throwaway)
In Chromium, a creature inside an `iframe sandbox=""` (no scripts) took a click and flew along its SMIL path. Not yet seen in the
desktop app itself: the build's board test checks the engine accepts the markup, and the user tries it by hand at the end.

## Approaches
- **A. Poke and fling (picked by the user).** All in the SVG: CSS `:active` squish, SMIL flight on click. Smooth, no hook work,
  works on desktop and mobile. You cannot choose where it lands.
- **B. Real drag.** An invisible `Client` over the office reads the pointer and the hook rebuilds the picture as it moves.
  Rejected: the pointer comes in text-cell steps (about 8 x 18 px), the whole picture would be rebuilt many times a second, desktop only.
- **C. Click a creature, hook animates it.** Rejected for the same rebuild cost as B, with no gain over A.

## Decided
- Poke and fling: the user's pick.
- Yellow as the user's own setting, not the default for everyone: my call, said to the user, not objected to.

## Left to the builder
- The exact palette (checked so every creature stays clearly visible), the flight paths and which creature gets which style.
- Flights stay inside the room: a creature near a wall flies toward the middle.
- Tests: the office markup (one flight per creature, unique ids, the yellow palette, the size limit), the board's `Svg` on desktop
  (`isInteractive`, accepted by the engine), `/team office` saving, reading a missing or broken `office.json` (falls back to night
  with one logged line, like `names.json`).
