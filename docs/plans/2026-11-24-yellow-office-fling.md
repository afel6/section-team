# Yellow Office and Poke-and-Fling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-user yellow look for the Team Board office, and creatures that squish when pressed and fly when clicked.

**Architecture:** Both features live in the office SVG string: a palette picked by `look`, CSS `:active` for the squish and SMIL
`<animateMotion>`/`<animateTransform>` with `begin="flN.click"` for the flight. The board reads the look from a per-user
`office.json` each poll tick (as it reads `names.json`) and draws the office `Svg` with `isInteractive`.

**Tech Stack:** Node ESM (`.mjs`), `node:test`, the Claude Code Mods API (`hooks/register.tsx`, `claude plugin test`).

**Spec:** `docs/specs/2026-11-24-yellow-office-fling-design.md`

## Global Constraints

- The office source stays under 131072 characters at its worst case, and holds only plain vector: no `url(`, `href`, `data:`, `<image`, backslash, `NaN`, `undefined`, bare `&`.
- No script or `on*` attribute anywhere in the SVG.
- SMIL ids hold no `-` (a `-` in a `begin` id reads as an offset and the escape needs a banned backslash): ids are `fl0`..`fl9` by `ORDER` index.
- The look file is `~/.claude/section-team/office.json`, text exactly `{"v":1,"look":"yellow"}` or `{"v":1,"look":"night"}`; missing means `night`.
- `night` draws exactly today's office apart from the fling markup.
- Conventional commits, one per task, no attribution lines.

## Review Focus

1. A creature clicked while walking to or from its desk: the flight sits inside the walk group, so both compose (Task 2 test).
2. A broken, empty or oversized `office.json`: the office draws `night`, one debug log line while it lasts, nothing throws (Task 3 test); `/team office yellow` then overwrites it (it holds only the look).
3. Odd custom names (spaces, accents) never reach an id or a `begin` value (Task 2 test: ids are `fl0`..`fl9` whatever the names).
4. The worst case (every builder walking in with a problem, yellow, ten flights) under the size limit (Task 2 test).
5. Riva (yellow) on the yellow office: her body against the corridor rug has a contrast ratio of at least 2 (Task 1 test).

---

### Task 1: Yellow palette in the office picture

**Files:**
- Modify: `hooks/office.mjs` (`room()`, `officeSvg()`)
- Test: `tests/office.test.mjs`

**Interfaces:**
- Produces: `officeSvg({ states, names, moves, now, look })`, `look` is `'night' | 'yellow'`, anything else draws `night`. Export `LOOKS = ['night', 'yellow']`.

Palette keys (night = today's values, yellow = new): `wall #2C3454 / #FFE9A3`, `ceil #363F63 / #FFD966`, `trim #232A45 / #E8B53A`,
`plank #283050 / #F2D27C`, `frame #4B5683 / #E0A82E`, `sky #1C2747 / #9ED8FF`, `stars #FDE68A / #FFFFFF`, `rug #3B4677 / #B8691C`,
`rugEdge #4A5690 / #FFD966`. Desks, chairs, props, plants and the clock keep their colours.

- [ ] **Step 1: Write the failing tests**
  - `'night is the default and matches no look'`: `officeSvg({ now: 0 }) === officeSvg({ now: 0, look: 'night' })` and `=== officeSvg({ now: 0, look: 'pink' })`.
  - `'the yellow look paints the room yellow and keeps the desks'`: yellow source contains `fill="#FFE9A3"` and `fill="#B8691C"`, contains none of `#2C3454`, `#3B4677`; both looks contain the desk top `#D9A877`.
  - `'Riva stays easy to see on the yellow rug'`: WCAG contrast of `CREW.testing.fill.body[0]` (`#FACC15`) against `#B8691C` is at least 2 (write a 6-line `contrast(a, b)` helper in the test).
- [ ] **Step 2: Run** `node --test tests/office.test.mjs` — the three new tests fail (look ignored).
- [ ] **Step 3: Implement** a `PALETTES` map in `office.mjs`, `room(pal)` reads from it, `officeSvg` picks `PALETTES[look] ?? PALETTES.night`.
- [ ] **Step 4: Run** `node --test tests/office.test.mjs` — all pass, old ones included.
- [ ] **Step 5: Commit** `feat: a yellow look for the office picture`

### Task 2: Poke and fling

**Files:**
- Create: `hooks/fling.mjs`
- Modify: `hooks/office.mjs` (`placed()`, CSS)
- Test: `tests/fling.test.mjs`, `tests/office.test.mjs`

**Interfaces:**
- Produces: `flightFor(section, { x, feet })` returns `{ style, motion, spin }`, where `style` is `'tumble' | 'float' | 'spin'`,
  `motion` a path string starting `M0 0` and ending at `0 0`, `spin` the rotate `values` string; and `flingMarkup(i, section, box, inner)`
  returns `<g id="fl${i}" class="grab">` + the SMIL children + `<g class="squish">${inner}</g>` + a surprise mark, closed.
- Styles: `float` for `uiux` and `ai-llm`; `spin` for `mobile`, `devops`, `frontend`; `tumble` for the rest (Riva is `testing`).
- Flight: horizontal reach 120 toward the room's middle (`x < 500` flies right, else left); peak `min(150, feet - 100)` so the
  creature stays inside the room; the path ends back at `0 0` (out, two small bounces, scoot home). Durations: tumble 1.6s, spin 1.2s, float 2.6s.
- The rotation centre is the creature's middle in room units: `box.x + 44`, `box.y + 46`.
- CSS added once to the office: `.grab{cursor:grab}.grab:active{cursor:grabbing}.squish{transform-origin:50% 100%;transition:transform .12s}.grab:active .squish{transform:scale(1.15,.82)}.oops{opacity:0}.grab:active .oops{opacity:1}`; the surprise mark is a red `!` text with class `oops`, also shown during the flight by a SMIL `<set attributeName="opacity" to="1" begin="flN.click">`.

- [ ] **Step 1: Write the failing tests** (`tests/fling.test.mjs`)
  - `'every section gets its style'`: the three style groups above.
  - `'flights head for the middle and come home'`: `x = 100` reach is positive, `x = 900` negative; every `motion` starts `M0 0` and ends `0 0`.
  - `'a top-row flight stays in the room'`: for `feet = 202` the lowest y in `motion` is not below `-(202 - 100)`.
  - `'the markup is one clickable group with no script'`: `flingMarkup(3, 'testing', { x: 0, y: 0 }, '<path/>')` contains `id="fl3"`, `begin="fl3.click"`, `class="squish"`, no `on` attribute (`/\son\w+=/`) and no `<script`.
- [ ] **Step 2: Write the failing office tests** (`tests/office.test.mjs`)
  - `'every creature is flingable, ids by desk number'`: `officeSvg({ now: 0 })` holds `id="fl0"`..`id="fl9"`, each once, with names set to `'Ri va'` everywhere the ids are the same.
  - `'a walking creature flies inside its walk'`: in `worst()` the text after `class="wk1"` reaches `id="fl1"` before the next `class="wk`.
  - the existing size and plain-vector tests also run with `look: 'yellow'`.
- [ ] **Step 3: Run** `node --test tests/fling.test.mjs tests/office.test.mjs` — new tests fail (no module, no ids).
- [ ] **Step 4: Implement** `hooks/fling.mjs`, then wrap the creature `<svg>` in `placed()` with `flingMarkup(i, section, box, body)` before the walk and stroll groups wrap it; add the CSS above to `OFFICE_CSS`.
- [ ] **Step 5: Run** `node --test tests/fling.test.mjs tests/office.test.mjs` — all pass.
- [ ] **Step 6: Commit** `feat: press a creature to squish it, click to fling it`

### Task 3: `/team office`, the look file and the board

**Files:**
- Create: `hooks/lib/look.mjs`, `tests/look.test.mjs`
- Modify: `hooks/office-track.mjs` (key includes the look), `hooks/register.tsx` (read the look, command, `isInteractive`), `README.md`, `CHANGELOG.md`
- Test: `tests/office-track.test.mjs`, `tests/board.test.tsx`, `tests/docs.test.mjs`

**Interfaces:**
- Consumes: `officeSvg({ ..., look })`, `LOOKS` (Task 1).
- Produces (`hooks/lib/look.mjs`): `lookFile(home)` → `${home}/.claude/section-team/office.json`; `parseLook(text | null)` →
  `{ look, problem }` (null text → `night`, no problem; over 1024 characters, bad JSON, `v !== 1` or an unknown look → `night`,
  problem `'office.json is not valid'`); `serializeLook(look)`; `applyLook(current, raw)` → `{ line, next? }`.
- `trackOffice(prev, { states, names, look, now })`: a look change rebuilds.
- Command replies (exact): `/team office` → `The office is <look>. /team office yellow|night changes it.`;
  a new look → `The office is <look> now.`; the same → `The office is already <look>.`; unknown →
  `No office look called <raw>. Looks: night, yellow.`; no home → `The office look needs USERPROFILE or HOME to be set.`;
  write refused → `Look not saved: <code>.`
- The `/team` command description adds `, or paint the office (/team office yellow|night)`.

- [ ] **Step 1: Write the failing tests**
  - `tests/look.test.mjs`: parse matrix (null, valid yellow, valid night, `{`, `{"v":2,"look":"yellow"}`, `{"v":1,"look":"pink"}`, 2000 spaces); `applyLook` lines above; `serializeLook('yellow') === '{"v":1,"look":"yellow"}'`.
  - `tests/office-track.test.mjs`: `'a look change rebuilds once'`.
  - `tests/board.test.tsx`: `/team office yellow` writes `C:/Users/u/.claude/section-team/office.json` with `{"v":1,"look":"yellow"}`, and after `clock.advance(1000)` the desktop office source contains `#FFE9A3`; a broken file draws night and logs `office.json is not valid` once over three ticks; `/team office yellow` over a broken file saves; the desktop office `Svg` has `isInteractive: true` (update the old test that pinned it unset, width and height stay unset).
  - `tests/docs.test.mjs`: the README office text includes `/team office yellow` and `office.json`.
- [ ] **Step 2: Run** `npm test` — the new tests fail.
- [ ] **Step 3: Implement** `hooks/lib/look.mjs`; add `look` to the `trackOffice` key; in `register.tsx` add `readLook($, ctx)` (like `readNames`, log slot `lastLookLog`), pass the look through `refresh` → `officeFor` → `trackOffice`/`officeSvg`, add the `office` branch to the `/team` command (`/^office(?:\s+(\S+))?$/`), set `isInteractive` on the office `Svg`; README: one **Office look** bullet after **Names** (the command, yellow per user in `~/.claude/section-team/office.json`, press to squish, click to fling, no fling in VS Code), and `office.json` in the home-folder line; CHANGELOG: an `## Unreleased` entry.
- [ ] **Step 4: Run** `npm test` and `claude plugin test .` — all pass.
- [ ] **Step 5: Commit** `feat: /team office yellow, and a clickable office on the board`

### Task 4: Check it

- [ ] `npm test`, `claude plugin test .`, `node --test bench/*.test.mjs`, `claude plugin validate --strict .` — all green, output kept.
- [ ] The real office SVG (`officeSvg` with `look: 'yellow'`) in an `iframe sandbox=""` in the browser pane: press squishes, click flings, yellow looks right; screenshot for the user.
- [ ] A fresh reviewer on the whole branch; fix critical and high findings.
- [ ] The user tries it in the desktop app once the branch is installed (their call: merge and update).
