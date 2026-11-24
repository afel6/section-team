// Poke and fling: in the office picture a creature squishes while pressed (CSS :active, in office.mjs) and, on a click,
// flies, spins, bounces and comes home (SMIL, begun by the click). No script: the office is drawn in a script-less frame.
import { r2 } from './creatures.mjs';

// office.mjs draws each creature in a box 88 units wide whose feet sit 88 below its top (80 x 84 at SCALE 1.1).
const HALF_W = 44;
const MID_Y = 46;
const FEET_Y = 88;
const BOX_H = 92.4;
const ROOM_MID = 500;
const REACH = 120;
const MAX_PEAK = 150;
// A flight's peak lifts the feet no higher than this, so the whole creature stays inside the room.
const TOP_FEET = 100;

const STYLE = { uiux: 'float', 'ai-llm': 'float', mobile: 'spin', devops: 'spin', frontend: 'spin' };

// Each style: seconds, a path from 0 0 out and back to 0 0 (r the signed reach, h the peak), turns in degrees and their key times.
const FLIGHTS = {
  // Up and over in a big arc, two little bounces, then a scoot home.
  tumble: {
    dur: 1.6, turns: [0, 540, 720, 720], at: '0;.45;.6;1',
    path: (r, h) => `M0 0C${r2(r * 0.2)} ${-h} ${r2(r * 0.8)} ${-h} ${r} 0Q${r2(r * 1.08)} ${r2(-h * 0.3)} ${r2(r * 1.15)} 0`
      + `Q${r2(r * 1.18)} ${r2(-h * 0.1)} ${r2(r * 1.2)} 0L0 0`,
  },
  // Straight up like a top, three turns, one bounce.
  spin: {
    dur: 1.2, turns: [0, 1080, 1080], at: '0;.6;1',
    path: (r, h) => `M0 0C${r2(r * 0.1)} ${-h} ${r2(r * 0.3)} ${-h} ${r2(r * 0.4)} 0Q${r2(r * 0.45)} ${r2(-h * 0.15)} ${r2(r * 0.5)} 0L0 0`,
  },
  // Drifts up, sways, and floats slowly back down.
  float: {
    dur: 2.6, turns: [0, -12, 10, -6, 0], at: '0;.25;.5;.75;1',
    path: (r, h) => `M0 0C${r2(r * 0.3)} ${-h} ${r2(r * 0.9)} ${-h} ${r2(r * 0.7)} ${r2(-h * 0.6)}`
      + `C${r2(r * 0.5)} ${r2(-h * 0.3)} ${r2(r * 0.2)} ${r2(-h * 0.2)} 0 0`,
  },
};

// A section's flight from a creature whose middle is at x and feet at feet: toward the room's middle, peaking inside the room.
export function flightFor(section, { x, feet }) {
  const style = STYLE[section] ?? 'tumble';
  const { dur, turns, at, path } = FLIGHTS[style];
  const dir = x < ROOM_MID ? 1 : -1;
  const h = r2(Math.max(0, Math.min(MAX_PEAK, feet - TOP_FEET)));
  const spin = style === 'float' ? turns : turns.map((a) => a * dir);
  return { style, dur, motion: path(dir * REACH, h), spin, at };
}

// The creature's drawing (inner, in a box whose top-left is box) wrapped so a press squishes it and a click flings it.
// Its id is fl<desk number>: a '-' in a SMIL begin id would read as an offset.
export function flingMarkup(i, section, box, inner) {
  const id = `fl${i}`;
  const begin = `${id}.click`;
  const cx = r2(box.x + HALF_W);
  const cy = r2(box.y + MID_Y);
  const f = flightFor(section, { x: cx, feet: box.y + FEET_Y });
  return `<g id="${id}" class="grab">`
    + `<animateMotion begin="${begin}" dur="${f.dur}s" path="${f.motion}" fill="remove"/>`
    + `<animateTransform attributeName="transform" type="rotate" additive="sum" begin="${begin}" dur="${f.dur}s"`
    + ` values="${f.spin.map((a) => `${a} ${cx} ${cy}`).join(';')}" keyTimes="${f.at}" fill="remove"/>`
    // A still, unseen hit area: the squish pulls the creature's top out from under a pointer that pressed there, and a release
    // that lands outside the group would start no flight.
    + `<rect x="${box.x}" y="${box.y}" width="${HALF_W * 2}" height="${BOX_H}" fill="#000" fill-opacity="0"/>`
    + `<g class="squish">${inner}</g>`
    + `<text class="oops" x="${r2(box.x + 74)}" y="${r2(box.y + 18)}" opacity="0" font-size="22" font-weight="700" font-family="sans-serif" fill="#EF4444">!`
    + `<set attributeName="opacity" to="1" begin="${begin}" dur="${f.dur}s"/></text>`
    + '</g>';
}
