// Builder creatures: one imaginary creature per section, drawn from simple shapes.
// Every creature fills the same fixed layer slots, so one SVG template draws all ten.
const INK = '#1A1533';
const HI = '#FFFFFF';
const SHINE = 'rgba(255,255,255,0.38)';
const CHEEK = 'rgba(255,118,160,0.55)';
const FX_GRAY = '#94A3B8';
const r2 = (n) => Math.round(n * 100) / 100;
const join = (...parts) => parts.join('');

function ell(cx, cy, rx, ry, rot = 0, ccw = false) {
  const a = (rot * Math.PI) / 180;
  const dx = rx * Math.cos(a);
  const dy = rx * Math.sin(a);
  const sx = r2(cx - dx);
  const sy = r2(cy - dy);
  const ex = r2(cx + dx);
  const ey = r2(cy + dy);
  const arc = (x, y) => `A${rx} ${ry} ${rot} 1 ${ccw ? 0 : 1} ${x} ${y}`;
  return `M${sx} ${sy}${arc(ex, ey)}${arc(sx, sy)}Z`;
}

function poly(pts) {
  const area = pts.reduce((sum, [x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length];
    return sum + x * ny - nx * y;
  }, 0);
  const ordered = area < 0 ? [...pts].reverse() : pts;
  return `M${ordered.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;
}

function rrect(x, y, w, h, r) {
  const q = (px, py) => `A${r} ${r} 0 0 1 ${r2(px)} ${r2(py)}`;
  return `M${r2(x + r)} ${y}H${r2(x + w - r)}${q(x + w, y + r)}V${r2(y + h - r)}${q(x + w - r, y + h)}H${r2(x + r)}${q(x, y + h - r)}V${r2(y + r)}${q(x + r, y)}Z`;
}

function halfEll(cx, cy, rx, ry, steps = 20) {
  const pts = Array.from({ length: steps + 1 }, (_, i) => {
    const t = Math.PI + (Math.PI * i) / steps;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  });
  return poly(pts);
}

function star(cx, cy, n, outer, inner, rot = -90) {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const t = ((rot + (180 * i) / n) * Math.PI) / 180;
    const k = i % 2 ? inner : outer;
    return [cx + k * Math.cos(t), cy + k * Math.sin(t)];
  });
  return poly(pts);
}

function bar(x1, y1, x2, y2, w) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * (w / 2);
  const ny = ((x2 - x1) / len) * (w / 2);
  return poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
}

const drop = (x, y) => join(ell(x, y + 1.8, 2.3, 2.6), poly([[x - 2.15, y + 1], [x, y - 3.6], [x + 2.15, y + 1]]));

const CREW = {
  backend: {
    name: 'Moss', look: 'a round moss sprite with two antenna lights', bob: 'cr-sit', sb: 'cr-sway',
    eye: { kind: 'dot', xs: [42, 58], y: 58, rx: 3.6, ry: 4.8 }, mouth: [50, 65], badge: [75, 34], sweat: [70, 46],
    fill: {
      body: ['#6CC24A', ell(50, 63, 26, 24)],
      body2: ['#4E9E33', join(ell(39, 86, 7, 3.6), ell(61, 86, 7, 3.6), ell(43, 40.6, 6, 3), ell(52, 39.3, 5, 2.6), ell(59.5, 41.3, 4, 2.2))],
      belly: ['#C4EDA8', ell(50, 71, 15, 12)],
      sb1: ['#C6FF5E', ell(35, 23, 3.8, 3.8)],
      sb2: ['#FFD43B', ell(65, 23, 3.8, 3.8)],
      shine: [SHINE, ell(37, 49, 6, 3.4, -35)],
      cheek: [CHEEK, join(ell(35.5, 64.5, 3.2, 2), ell(64.5, 64.5, 3.2, 2))],
    },
    stroke: { sbS: ['#3F7F2A', 2, 'M43.5 42Q40 31 35.5 25M56.5 42Q60 31 64.5 25'] },
  },
  frontend: {
    name: 'Iris', look: 'a tall one-eyed watcher with a pink crest', bob: 'cr-sit', sb: 'cr-sway',
    eye: { kind: 'cyclops', xs: [50], y: 52, rx: 10.5, ry: 10.5, iris: '#2DD4BF', arcW: 7, brows: 'M40.5 40L47.5 37.6M59.5 40L52.5 37.6' },
    mouth: [50, 68.5], badge: [71, 30], sweat: [67, 43],
    fill: {
      body: ['#8B5CF6', ell(50, 61, 21, 28)],
      body2: ['#6D3FE0', join(ell(42, 88, 6, 3.2), ell(58, 88, 6, 3.2))],
      belly: ['#C9B8FF', ell(50, 76, 11, 9)],
      sb1: ['#F472B6', join(ell(43.5, 32, 3, 7, -28), ell(50, 29, 3.2, 8), ell(56.5, 32, 3, 7, 28))],
      shine: [SHINE, ell(39.5, 44, 3.4, 6.5, 25)],
      cheek: [CHEEK, join(ell(36.5, 66, 3, 1.9), ell(63.5, 66, 3, 1.9))],
    },
  },
  database: {
    name: 'Atlas', look: 'a calm keeper under a hovering stack of data disks', bob: 'cr-sit', sf: 'cr-float',
    eye: { kind: 'dot', xs: [42, 58], y: 65, rx: 3.6, ry: 4.6 }, mouth: [50, 71.5], badge: [80, 53], sweat: [73, 59],
    fill: {
      body: ['#F2C48D', ell(50, 67, 23, 20)],
      body2: ['#D99A5B', join(ell(38, 87, 7, 3.4), ell(62, 87, 7, 3.4))],
      belly: ['#FBE3C2', ell(50, 78, 12, 7)],
      acc1: ['#F2C48D', join(ell(28.6, 52, 3.3, 7.5, 12), ell(71.4, 52, 3.3, 7.5, -12))],
      sf1: ['#2563EB', join(rrect(28, 39.5, 44, 6, 3), rrect(32, 31.5, 36, 6, 3), rrect(36, 23.5, 28, 6, 3))],
      sf2: ['#7CB7FF', join(ell(50, 40.1, 22, 2.2), ell(50, 32.1, 18, 2.2), ell(50, 24.1, 14, 2.2))],
      sf3: ['#A5F3FC', join(ell(66, 43, 1.2, 1.2), ell(62.5, 35, 1.2, 1.2), ell(59, 27, 1.2, 1.2))],
      shine: [SHINE, ell(36.5, 58, 5, 2.8, -30)],
      cheek: [CHEEK, join(ell(35, 71, 3.2, 2), ell(65, 71, 3.2, 2))],
    },
  },
  testing: {
    name: 'Pico', look: 'a spiky puff holding a magnifying glass', bob: 'cr-sit', sf: 'cr-tilt',
    eye: { kind: 'dot', xs: [42, 58], y: 59, rx: 3.4, ry: 4.5 }, mouth: [50, 66], badge: [77, 35], sweat: [71, 45],
    fill: {
      body: ['#FACC15', join(star(50, 62, 14, 27, 21.5), ell(50, 62, 22.5, 22.5))],
      body2: ['#CA8A04', join(ell(42, 89, 5, 2.8), ell(58, 89, 5, 2.8))],
      belly: ['#FEF3A0', ell(50, 70, 13, 9)],
      sf1: ['#475569', bar(63.8, 64.6, 71.5, 72.3, 3.4)],
      sf2: ['rgba(186,230,253,0.35)', ell(58, 59, 6.6, 6.6)],
      shine: [SHINE, ell(39, 50, 5, 2.8, -35)],
      cheek: [CHEEK, join(ell(35.5, 65.5, 3, 1.9), ell(64.5, 65.5, 3, 1.9))],
    },
    stroke: { sfS: ['#475569', 2.4, ell(58, 59, 7.6, 7.6)] },
  },
  security: {
    name: 'Ward', look: 'a horned guardian with a visor and a shield', bob: 'cr-sit',
    eye: { kind: 'visor', xs: [41.5, 58.5], y: 56, rx: 4, ry: 2.8, arcW: 3.6, color: '#67E8F9', browY: 47 },
    mouth: null, badge: [77, 31], sweat: [72, 42],
    fill: {
      sb1: ['#FBBF24', join(poly([[31, 45], [25.5, 33], [26.5, 23], [33, 32.5], [40, 40.5]]), poly([[69, 45], [74.5, 33], [73.5, 23], [67, 32.5], [60, 40.5]]))],
      body: ['#6366F1', rrect(25, 38, 50, 50, 20)],
      body2: ['#4F46E5', join(ell(38, 88, 8, 3.4), ell(62, 88, 8, 3.4))],
      acc1: ['#1E1B4B', rrect(29.5, 50, 41, 12, 6)],
      acc2: ['#FBBF24', poly([[41, 66], [59, 66], [59, 73.5], [50, 81.5], [41, 73.5]])],
      acc3: ['#92400E', join(ell(50, 71, 1.9, 1.9), poly([[48.9, 71.5], [51.1, 71.5], [51.8, 76.5], [48.2, 76.5]]))],
      shine: [SHINE, ell(33, 45, 4, 2.4, -40)],
    },
  },
  devops: {
    name: 'Rigg', look: 'a little octopus in a hard hat', bob: 'cr-sit', sf: 'cr-wave',
    eye: { kind: 'dot', xs: [42, 58], y: 53, rx: 3.6, ry: 4.6 }, mouth: [50, 60], badge: [77, 31], sweat: [72, 42],
    fill: {
      body: ['#14B8A6', ell(50, 53, 24, 21)],
      acc1: ['#0D9488', join(ell(35.5, 47, 2.4, 1.9), ell(65, 46, 2, 1.6), ell(61.5, 40.5, 1.6, 1.3))],
      acc2: ['#FDE047', join(halfEll(50, 35, 14.5, 10.5), rrect(31.5, 33.5, 37, 4, 2))],
      acc3: ['#EAB308', rrect(48.5, 25.5, 3, 9, 1.5)],
      sf1: ['#14B8A6', join(ell(32, 74, 5, 10, 22), ell(41, 78, 5, 11, 8), ell(50, 79.5, 5, 11), ell(59, 78, 5, 11, -8), ell(68, 74, 5, 10, -22))],
      sf2: ['#99F6E4', join(ell(40, 84, 1.5, 1.5), ell(50, 86, 1.5, 1.5), ell(60, 84, 1.5, 1.5))],
      shine: [SHINE, ell(37, 45, 4.5, 2.8, -30)],
      cheek: [CHEEK, join(ell(35.5, 59, 3, 1.9), ell(64.5, 59, 3, 1.9))],
    },
  },
  uiux: {
    name: 'Lumi', look: 'a floating jelly trailing three colour ribbons', bob: 'cr-hover', sf: 'cr-wave', floats: true,
    eye: { kind: 'dot', xs: [42, 58], y: 52, rx: 3.6, ry: 4.6 }, mouth: [50, 59], badge: [76, 33], sweat: [71, 43],
    fill: {
      body: ['#EFA3FA', join(halfEll(50, 57, 23, 26), poly([[27, 56], [73, 56], [73, 66], [27, 66]]), ell(32.75, 66, 5.75, 4.5), ell(44.25, 67, 5.75, 4.5), ell(55.75, 67, 5.75, 4.5), ell(67.25, 66, 5.75, 4.5))],
      belly: ['#F9D6FD', ell(50, 49, 14, 11)],
      sf1: ['#60A5FA', ell(39.5, 78, 2.6, 7.5, 10)],
      sf2: ['#34D399', ell(50, 80, 2.6, 8.5)],
      sf3: ['#FBBF24', ell(60.5, 78, 2.6, 7.5, -10)],
      shine: [SHINE, ell(38, 41, 5, 3, -35)],
      cheek: [CHEEK, join(ell(35.5, 58, 3, 1.9), ell(64.5, 58, 3, 1.9))],
    },
  },
  docs: {
    name: 'Page', look: 'a long-eared reader with round glasses and an open book', bob: 'cr-sit', sb: 'cr-twitch',
    eye: { kind: 'dot', xs: [42, 58], y: 62, rx: 3.2, ry: 4.2 }, mouth: [50, 69.5], badge: [75, 40], sweat: [71, 50],
    fill: {
      sb1: ['#F6AD6B', join(ell(41, 33, 5.5, 15, -10), ell(59, 33, 5.5, 15, 10))],
      sb2: ['#FFD9C2', join(ell(41, 34, 2.6, 10, -10), ell(59, 34, 2.6, 10, 10))],
      body: ['#F6AD6B', ell(50, 66, 21, 21)],
      body2: ['#E08B45', join(ell(40, 87, 6.5, 3.2), ell(60, 87, 6.5, 3.2))],
      acc1: ['#2563EB', poly([[39, 75], [50, 77.5], [61, 75], [61, 84], [50, 86.5], [39, 84]])],
      acc2: ['#FFFFFF', join(poly([[40.6, 76.3], [49.3, 78.3], [49.3, 84.8], [40.6, 82.8]]), poly([[59.4, 76.3], [50.7, 78.3], [50.7, 84.8], [59.4, 82.8]]))],
      acc3: ['#E08B45', join(ell(39, 80.5, 3, 3.5), ell(61, 80.5, 3, 3.5))],
      shine: [SHINE, ell(37.5, 54, 4.5, 2.8, -30)],
      cheek: [CHEEK, join(ell(34.5, 68, 3, 1.9), ell(65.5, 68, 3, 1.9))],
    },
    stroke: { sfS: ['#3F2A1D', 1.6, join(ell(42, 62, 6, 6), ell(58, 62, 6, 6), 'M48 61.5Q50 60.3 52 61.5')] },
  },
  'ai-llm': {
    name: 'Echo', look: 'a cloud spirit that sends out little echo waves', bob: 'cr-hover', sf: 'cr-glow', floats: true,
    eye: { kind: 'dot', xs: [42.5, 57.5], y: 60, rx: 3.4, ry: 4.5 }, mouth: [50, 66.5], badge: [76, 37], sweat: [70, 45],
    fill: {
      body: ['#7DD3FC', join(ell(50, 63, 21, 16), ell(33, 67, 11, 9.5), ell(67, 67, 11, 9.5), ell(42, 50, 11, 10), ell(58.5, 49, 12, 11))],
      belly: ['#E0F2FE', ell(50, 71, 13, 6.5)],
      shine: [SHINE, ell(40, 45, 4.5, 2.6, -25)],
      cheek: [CHEEK, join(ell(35.5, 66, 3, 1.9), ell(64.5, 66, 3, 1.9))],
    },
    stroke: { sfS: ['#38BDF8', 1.8, 'M81 55Q84.5 62 81 69M86 51Q91 62 86 73M19 55Q15.5 62 19 69M14 51Q9 62 14 73'] },
  },
  mobile: {
    name: 'Zip', look: 'a pocket-sized fox with a big fluffy tail', bob: 'cr-sit', sb: 'cr-twitch', tb: 'cr-wag',
    eye: { kind: 'dot', xs: [43, 57], y: 64, rx: 3.3, ry: 4.4 }, mouth: [50, 71.5], badge: [73, 43], sweat: [68, 52],
    fill: {
      tb1: ['#E8742B', ell(71, 71, 7.5, 14, 38)],
      tb2: ['#FFF4EA', ell(78.2, 61.8, 4.6, 6.2, 38)],
      sb1: ['#FF8A3D', join(poly([[35, 60], [32, 37], [47, 52]]), poly([[65, 60], [68, 37], [53, 52]]))],
      sb2: ['#FFE1C9', join(poly([[37, 56], [35, 42.5], [44, 52]]), poly([[63, 56], [65, 42.5], [56, 52]]))],
      body: ['#FF8A3D', ell(50, 68, 18, 17.5)],
      body2: ['#E06D1F', join(ell(43, 85.5, 5, 2.8), ell(57, 85.5, 5, 2.8))],
      belly: ['#FFE1C9', ell(50, 74.5, 10, 7.5)],
      acc1: [INK, ell(50, 69.5, 1.8, 1.3)],
      shine: [SHINE, ell(41, 57, 4, 2.4, -30)],
      cheek: [CHEEK, join(ell(38.5, 70, 2.6, 1.7), ell(61.5, 70, 2.6, 1.7))],
    },
  },
};

const FILL_SLOTS = ['shadow', 'tb1', 'tb2', 'sb1', 'sb2', 'body', 'body2', 'belly', 'acc1', 'acc2', 'acc3', 'shine', 'cheek',
  'e1', 'e2', 'e3', 'e4', 'sf1', 'sf2', 'sf3', 'sweat', 'gear', 'dots', 'badge', 'badgeMark', 'spark'];
const STROKE_SLOTS = ['sbS', 'eS', 'mouth', 'sfS', 'brows'];
const STATES = ['idle', 'running', 'waiting', 'done', 'problem', 'asleep'];

const EYES = {
  dot: (e) => ({
    e1: [INK, join(...e.xs.map((x) => ell(x, e.y, e.rx, e.ry)))],
    e2: [HI, join(...e.xs.map((x) => ell(r2(x + e.rx * 0.34), r2(e.y - e.ry * 0.36), r2(e.rx * 0.38), r2(e.rx * 0.38))))],
  }),
  cyclops: (e) => {
    const [x] = e.xs;
    return {
      e1: [HI, ell(x, e.y, e.rx, e.ry)],
      e2: [e.iris, ell(x, e.y + 1, 6.6, 6.6)],
      e3: [INK, ell(x, e.y + 1, 3.3, 3.3)],
      e4: [HI, ell(x + 2.6, e.y - 1.8, 1.8, 1.8)],
    };
  },
  visor: (e) => ({
    e1: [e.color, join(...e.xs.map((x) => ell(x, e.y, e.rx, e.ry)))],
    e2: ['#ECFEFF', join(...e.xs.map((x) => ell(x, e.y, r2(e.rx * 0.45), r2(e.ry * 0.45))))],
  }),
};

function eyeArcs(e, happy) {
  const w = e.arcW || e.rx;
  return e.xs.map((x) => (happy
    ? `M${r2(x - w)} ${r2(e.y + 1)}Q${x} ${r2(e.y - w - 2)} ${r2(x + w)} ${r2(e.y + 1)}`
    : `M${r2(x - w)} ${e.y}Q${x} ${r2(e.y + w * 0.9)} ${r2(x + w)} ${e.y}`)).join('');
}

function worriedBrows(e) {
  if (e.brows) return e.brows;
  const by = e.browY ?? r2(e.y - e.ry - 3);
  return e.xs.map((x) => {
    const inward = x < 50 ? 1 : -1;
    return `M${x - inward * 4} ${r2(by + 1.2)}L${x + inward * 3} ${r2(by - 1.2)}`;
  }).join('');
}

function mouthFor([x, y], state) {
  if (state === 'done') return `M${x - 4} ${y - 0.5}Q${x} ${y + 4.5} ${x + 4} ${y - 0.5}`;
  if (state === 'problem') return `M${x - 3} ${y + 1}Q${x - 1.5} ${y - 0.4} ${x} ${y + 1}Q${x + 1.5} ${y + 2.4} ${x + 3} ${y + 1}`;
  if (state === 'asleep') return `M${x - 1.8} ${y + 1}L${x + 1.8} ${y + 1}`;
  return `M${x - 3.5} ${y}Q${x} ${y + 3} ${x + 3.5} ${y}`;
}

function emptyLayers() {
  return Object.fromEntries([
    ...FILL_SLOTS.map((k) => [k, { d: '', fill: 'none' }]),
    ...STROKE_SLOTS.map((k) => [k, { d: '', stroke: 'none', w: 0 }]),
  ]);
}

function buildCreature(section, state) {
  const spec = CREW[section] || CREW.backend;
  const mood = STATES.includes(state) ? state : 'idle';
  const L = emptyLayers();
  const put = (slot, fill, d) => { L[slot] = { d, fill }; };
  const line = (slot, stroke, w, d) => { L[slot] = { d, stroke, w }; };
  Object.entries(spec.fill).forEach(([slot, [fill, d]]) => put(slot, fill, d));
  Object.entries(spec.stroke || {}).forEach(([slot, [stroke, w, d]]) => line(slot, stroke, w, d));
  put('shadow', spec.floats ? 'rgba(26,21,51,0.10)' : 'rgba(26,21,51,0.16)', spec.floats ? ell(50, 91, 13, 2) : ell(50, 90.5, 21, 2.8));
  const e = spec.eye;
  if (mood === 'asleep' || mood === 'done') line('eS', e.color || INK, 2, eyeArcs(e, mood === 'done'));
  else Object.entries(EYES[e.kind](e)).forEach(([slot, [fill, d]]) => put(slot, fill, d));
  if (spec.mouth) line('mouth', INK, 1.7, mouthFor(spec.mouth, mood));
  const [bx, by] = spec.badge;
  if (mood === 'problem') {
    line('brows', INK, 1.7, worriedBrows(e));
    put('sweat', '#38BDF8', drop(...spec.sweat));
    put('badge', '#EF4444', ell(bx, by, 5.6, 5.6));
    put('badgeMark', HI, join(rrect(bx - 1, by - 3.6, 2, 4.4, 1), ell(bx, by + 2.8, 1.15, 1.15)));
  }
  if (mood === 'running') put('gear', FX_GRAY, join(star(bx, by, 8, 6, 4.4, 0), ell(bx, by, 2, 2, 0, true)));
  if (mood === 'waiting') put('dots', FX_GRAY, join(...[-5, 0, 5].map((o) => ell(bx + o, by, 1.8, 1.8))));
  if (mood === 'done') put('spark', '#FACC15', join(star(bx, by, 4, 6, 2), star(bx - 8, by + 7, 4, 3.2, 1.1)));
  return { spec, mood, layers: L, zx: bx - 4, zy: by + 4 };
}

export { CREW, STATES, buildCreature, r2, join, ell, poly, rrect, halfEll, star, bar, INK }
