// The Team Board office: ten desks, each builder's creature at its desk while its section has work,
// strolling the corridor between the two rows while it is free.
import { CREW, buildCreature, r2, join, ell, poly, rrect, bar } from './creatures.mjs';
import { NAME_RE } from './lib/names.mjs';
import { flingMarkup } from './fling.mjs';

const CREW_CSS = ".cr-svg{overflow:visible}.cr-svg g,.cr-svg path{transform-box:fill-box}.cr-sit{animation:cr-sit 3.8s ease-in-out infinite;transform-origin:50% 100%}.cr-hover{animation:cr-hover 4.4s ease-in-out infinite}.cr-blink{animation:cr-blink 5.2s infinite;transform-origin:50% 50%}.cr-sway{animation:cr-sway 3.4s ease-in-out infinite;transform-origin:50% 100%}.cr-twitch{animation:cr-twitch 4.6s ease-in-out infinite;transform-origin:50% 100%}.cr-wag{animation:cr-wag 1.6s ease-in-out infinite;transform-origin:0% 100%}.cr-wave{animation:cr-wave 2.8s ease-in-out infinite;transform-origin:50% 0%}.cr-float{animation:cr-float 3.2s ease-in-out infinite}.cr-tilt{animation:cr-tilt 3.6s ease-in-out infinite;transform-origin:30% 30%}.cr-glow{animation:cr-glow 2.4s ease-in-out infinite}.cr-gear{animation:cr-spin 2.4s linear infinite;transform-origin:50% 50%}.cr-dots{animation:cr-glow 1.4s ease-in-out infinite}.cr-spark{animation:cr-twinkle 1.6s ease-in-out infinite;transform-origin:50% 50%}.cr-z{animation:cr-z 3s ease-in-out infinite}.st-running .cr-sit,.st-running .cr-hover{animation-duration:1.1s}.st-waiting .cr-look{animation:cr-look 3.4s ease-in-out infinite}.st-done .cr-sit,.st-done .cr-hover{animation:cr-hop 1.5s ease-in-out infinite;transform-origin:50% 100%}.st-problem .cr-sit,.st-problem .cr-hover{animation:cr-shake 2.6s ease-in-out infinite}.st-asleep .cr-sit,.st-asleep .cr-hover{animation:cr-breathe 5.5s ease-in-out infinite;transform-origin:50% 100%}.st-asleep .cr-blink,.st-done .cr-blink{animation:none}.st-asleep{filter:saturate(.45)}@keyframes cr-sit{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-1.2px) scale(.99,1.015)}}@keyframes cr-hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@keyframes cr-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}@keyframes cr-sway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}@keyframes cr-twitch{0%,78%,100%{transform:rotate(0)}84%{transform:rotate(-7deg)}90%{transform:rotate(4deg)}}@keyframes cr-wag{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}@keyframes cr-wave{0%,100%{transform:skewX(-5deg)}50%{transform:skewX(5deg)}}@keyframes cr-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}@keyframes cr-tilt{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(5deg)}}@keyframes cr-glow{0%,100%{opacity:.35}50%{opacity:1}}@keyframes cr-spin{to{transform:rotate(360deg)}}@keyframes cr-twinkle{0%,100%{transform:scale(.7);opacity:.6}50%{transform:scale(1.15);opacity:1}}@keyframes cr-z{0%{transform:translateY(2px);opacity:0}30%{opacity:1}100%{transform:translateY(-4px);opacity:0}}@keyframes cr-look{0%,100%{transform:translateX(0)}25%,40%{transform:translateX(-2px)}60%,75%{transform:translateX(2px)}}@keyframes cr-hop{0%,60%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(-5px) scale(.97,1.04)}40%{transform:translateY(0) scale(1.05,.94)}}@keyframes cr-shake{0%,70%,100%{transform:translateX(0)}74%,82%{transform:translateX(-1.2px)}78%,86%{transform:translateX(1.2px)}}@keyframes cr-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.97)}}@media (prefers-reduced-motion: reduce){.cr-svg *{animation:none !important}}";
const SCALE = 1.1;
const ROOM = { w: 1000, h: 620 };
const ROWS = [
  { base: 205, sections: ['frontend', 'backend', 'database', 'testing', 'security'] },
  { base: 545, sections: ['devops', 'uiux', 'docs', 'ai-llm', 'mobile'] },
];
const ORDER = ROWS.flatMap((row) => row.sections);
const SEATED = new Set(['running', 'waiting', 'problem']);
const WALK_MS = 2200;
const WALK_S = WALK_MS / 1000;
const CHAIR = {
  frontend: '#5B34C9', backend: '#3F7F2A', database: '#B5793F', testing: '#A16207', security: '#3730A3',
  devops: '#0F766E', uiux: '#B45FC2', docs: '#C2703A', 'ai-llm': '#0284C7', mobile: '#C2551A',
};
const OFFICE_CSS = '.of-glow{animation:cr-glow 1.8s ease-in-out infinite}'
  + '.of-glow2{animation:cr-glow 2.6s ease-in-out -1s infinite}'
  + '.of-step{animation:of-step .37s ease-in-out 6}'
  + '@keyframes of-step{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}'
  // Poke and fling (fling.mjs): the flight's rotate centre is in room units, so its group keeps the view box, not its own box.
  + '.cr-svg .grab{cursor:grab;transform-box:view-box;transform-origin:0 0}.cr-svg .grab:active{cursor:grabbing}'
  + '.squish{transform-origin:50% 100%;transition:transform .12s}.grab:active .squish{transform:scale(1.15,.82)}.grab:active .oops{opacity:1}';

// A name outside the rules, or one holding a token the picture bans, draws the creature's default name.
const nameOf = (names, id) => (typeof names[id] === 'string' && NAME_RE.test(names[id]) && !/href/i.test(names[id]) ? names[id] : CREW[id].name);
// The clock's seconds hand, set to the real second so no rebuild restarts it.
const handCss = (now) => `.of-hand{transform-box:view-box;transform-origin:500px 35px;animation:cr-spin 60s linear infinite;animation-delay:-${r2((now / 1000) % 60)}s}`;
const shape = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
const line = (d, stroke, w, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const fillPath = (L, k, cls) => (L[k].d ? shape(L[k].d, L[k].fill, cls ? ` class="${cls}"` : '') : '');
const strokePath = (L, k) => (L[k].d ? line(L[k].d, L[k].stroke, L[k].w) : '');
const zText = (x, y, size, delay) => `<text class="cr-z" x="${x}" y="${y}" font-size="${size}" font-weight="700" font-family="sans-serif" fill="#64748B"${delay ? ` style="animation-delay:${delay}"` : ''}>z</text>`;

// One creature's drawing in its own 80 x 84 coordinates, its mood class on the outer group.
function creatureMarkup(section, state, bobDelay = 0) {
  const { spec, mood, layers: L, zx, zy } = buildCreature(section, state);
  const fills = (...keys) => keys.map((k) => fillPath(L, k)).join('');
  const zs = mood === 'asleep' ? zText(zx, zy, 9) + zText(zx + 6, zy - 7, 6.5, '-1.5s') : '';
  const delay = bobDelay ? ` style="animation-delay:${r2(bobDelay)}s"` : '';
  return `<g class="st-${mood}">${fillPath(L, 'shadow')}<g class="${spec.bob}"${delay}>`
    + `<g class="${spec.tb || 'cr-still'}">${fills('tb1', 'tb2')}</g>`
    + `<g class="${spec.sb || 'cr-still'}">${strokePath(L, 'sbS')}${fills('sb1', 'sb2')}</g>`
    + fills('body', 'body2', 'belly', 'acc1', 'acc2', 'acc3', 'shine', 'cheek')
    + `<g class="cr-look"><g class="cr-blink">${fills('e1', 'e2', 'e3', 'e4')}${strokePath(L, 'eS')}</g></g>`
    + strokePath(L, 'mouth')
    + `<g class="${spec.sf || 'cr-still'}">${strokePath(L, 'sfS')}${fills('sf1', 'sf2', 'sf3')}</g>`
    + strokePath(L, 'brows') + fillPath(L, 'sweat') + '</g>'
    + fillPath(L, 'gear', 'cr-gear') + fillPath(L, 'dots', 'cr-dots') + fills('badge', 'badgeMark') + fillPath(L, 'spark', 'cr-spark')
    + zs + '</g>';
}

// One creature alone, as a whole SVG document with its motion CSS inside.
function creatureSvg(section, state) {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="cr-svg" width="80" height="84" viewBox="10 10 80 84"><style>${CREW_CSS}</style>${creatureMarkup(section, state)}</svg>`;
}

const deskSpot = (section) => {
  const r = ROWS.findIndex((row) => row.sections.includes(section));
  const col = ROWS[r].sections.indexOf(section);
  return { cx: 100 + col * 200, base: ROWS[r].base, row: r };
};
// Where a free creature's feet rest in the corridor: two lanes, so ten fit side by side.
const homeSpot = (i) => ({ x: 92 + i * 91, feet: i % 2 ? 380 : 338 });
// The top-left corner of a creature's box (80 x 84 units at SCALE) whose middle bottom (50, 90) sits at (x, feet).
const boxAt = (x, feet) => ({ x: r2(x - 40 * SCALE), y: r2(feet - 80 * SCALE) });
const seatBox = (section) => {
  const { cx, base } = deskSpot(section);
  return boxAt(cx + 18, base - 3);
};
const homeBox = (i) => boxAt(homeSpot(i).x, homeSpot(i).feet);

// The room's colours for each look; desks, chairs, props, plants and the clock keep theirs.
const PALETTES = {
  night: { wall: '#2C3454', ceil: '#363F63', trim: '#232A45', plank: '#283050', frame: '#4B5683', sky: '#1C2747', stars: '#FDE68A', rug: '#3B4677', rugEdge: '#4A5690' },
  yellow: { wall: '#FFE9A3', ceil: '#FFD966', trim: '#E8B53A', plank: '#F2D27C', frame: '#E0A82E', sky: '#9ED8FF', stars: '#FFFFFF', rug: '#B8691C', rugEdge: '#FFD966' },
};
const LOOKS = Object.keys(PALETTES);

function room(pal) {
  const planks = [120, 170, 220, 420, 470, 520, 570].map((y) => `M0 ${y}H1000`).join('');
  const stars = [[226, 22], [252, 40], [289, 25], [312, 46], [684, 24], [712, 44], [748, 28], [776, 47]]
    .map(([x, y]) => ell(x, y, 1.6, 1.6)).join('');
  const window = (x) => shape(rrect(x, 12, 124, 46, 6), pal.frame) + shape(rrect(x + 5, 17, 114, 36, 4), pal.sky)
    + shape(`M${x + 60} 17H${x + 64}V53H${x + 60}Z`, pal.frame);
  const plant = (x) => shape(rrect(x - 11, 46, 22, 20, 4), '#C2703A')
    + shape(join(ell(x - 7, 38, 5, 11, -25), ell(x + 7, 38, 5, 11, 25), ell(x, 33, 5, 13)), '#4E9E33');
  return shape(rrect(0, 0, ROOM.w, ROOM.h, 22), pal.wall)
    + shape('M22 0H978A22 22 0 0 1 1000 22V70H0V22A22 22 0 0 1 22 0Z', pal.ceil)
    + shape('M0 70H1000V76H0Z', pal.trim)
    + line(planks, pal.plank, 2)
    + window(196) + window(680) + shape(stars, pal.stars, ' class="of-glow2"')
    + shape(ell(500, 35, 18, 18), '#F1F5F9') + shape(ell(500, 35, 14.5, 14.5), '#E2E8F0')
    + line('M500 35V25', '#334155', 2.4) + line('M500 35L507 39', '#334155', 2.4)
    + line('M500 37V22', '#EF4444', 1.2, ' class="of-hand"')
    + plant(34) + plant(966)
    + shape(rrect(44, 268, 912, 118, 59), pal.rug)
    + line(rrect(56, 278, 888, 98, 49), pal.rugEdge, 2, ' stroke-dasharray="10 8"');
}

function chair(section) {
  const { cx, base } = deskSpot(section);
  return shape(rrect(cx - 7, base - 58, 50, 54, 14), CHAIR[section]) + shape(rrect(cx, base - 52, 36, 7, 3.5), 'rgba(255,255,255,0.12)');
}

function desk(section, name) {
  const { cx, base } = deskSpot(section);
  return shape(rrect(cx - 74, base + 5, 148, 46, 6), '#B07C52')
    + shape(rrect(cx - 74, base + 5, 148, 6, 3), '#8F6140')
    + shape(rrect(cx - 82, base - 6, 164, 12, 5), '#D9A877')
    + shape(rrect(cx - 38, base + 18, 76, 23, 5), '#F7EEDF')
    + shape(rrect(cx - 38, base + 18, 76, 4, 2), CREW[section].fill.body[0])
    + `<text x="${cx}" y="${base + 35.5}" text-anchor="middle" font-family="sans-serif" font-size="12.5" font-weight="700" fill="#4A3426">${name}</text>`;
}

// Each section's prop on the left of its desk, (x, y) the middle of its foot on the desk top.
const PROPS = {
  backend: (x, y) => shape(rrect(x - 14, y - 46, 28, 46, 4), '#334155')
    + shape(join(...[0, 1, 2].map((k) => rrect(x - 9, y - 40 + k * 13, 18, 7, 2))), '#1E293B')
    + shape(join(ell(x + 4.5, y - 36.5, 1.8, 1.8), ell(x + 4.5, y - 10.5, 1.8, 1.8)), '#4ADE80', ' class="of-glow"')
    + shape(ell(x + 4.5, y - 23.5, 1.8, 1.8), '#FACC15', ' class="of-glow2"'),
  frontend: (x, y) => shape(rrect(x - 3, y - 14, 6, 11, 1), '#475569') + shape(rrect(x - 11, y - 4, 22, 4, 2), '#475569')
    + shape(rrect(x - 23, y - 46, 46, 33, 4), '#1E293B') + shape(rrect(x - 20, y - 43, 40, 27, 2), '#0F172A')
    + shape(rrect(x - 18, y - 41, 36, 5, 1.5), '#8B5CF6') + shape(rrect(x - 18, y - 34, 16, 15, 1.5), '#F472B6')
    + shape(join(rrect(x, y - 34, 18, 6, 1.5), rrect(x, y - 26, 18, 7, 1.5)), '#2DD4BF'),
  database: (x, y) => [0, 1, 2].map((k) => {
    const cy = y - 8 - k * 12;
    return shape(join(rrect(x - 16, cy - 6, 32, 10, 2), ell(x, cy + 4, 16, 3.5)), '#2563EB') + shape(ell(x, cy - 6, 16, 3.5), '#7CB7FF');
  }).join('') + shape(ell(x + 10, y - 8, 1.4, 1.4), '#A5F3FC', ' class="of-glow"'),
  testing: (x, y) => shape(rrect(x - 16, y - 46, 32, 44, 4), '#C08A4C') + shape(rrect(x - 13, y - 40, 26, 35, 2), '#FFFFFF')
    + shape(rrect(x - 7, y - 49, 14, 7, 2), '#64748B')
    + line('M-7 -31l3 3 5-6M-7 -20l3 3 5-6', '#16A34A', 2.2, ` transform="translate(${x} ${y})"`)
    + line(`M${x + 2} ${y - 30}H${x + 9}M${x + 2} ${y - 19}H${x + 9}`, '#94A3B8', 2),
  security: (x, y) => line(`M${x - 8} ${y - 26}V${y - 33}A8 8 0 0 1 ${x + 8} ${y - 33}V${y - 26}`, '#94A3B8', 4.5)
    + shape(rrect(x - 14, y - 28, 28, 25, 5), '#FBBF24') + shape(join(ell(x, y - 18, 3, 3), rrect(x - 1.4, y - 17, 2.8, 7, 1)), '#92400E'),
  devops: (x, y) => shape(rrect(x - 12, y - 5, 24, 5, 2), '#475569')
    + shape(ell(x, y - 13, 3.5, 6), '#FDE047', ' class="of-glow"')
    + shape(join(poly([[x - 9, y - 12], [x - 15, y - 6], [x - 6, y - 18]]), poly([[x + 9, y - 12], [x + 15, y - 6], [x + 6, y - 18]])), '#F97316')
    + shape(join(ell(x, y - 30, 8.5, 17), poly([[x - 8.5, y - 30], [x + 8.5, y - 30], [x + 6, y - 14], [x - 6, y - 14]])), '#E2E8F0')
    + shape(ell(x, y - 33, 3.8, 3.8), '#38BDF8'),
  uiux: (x, y, pal) => shape(join(ell(x, y - 12, 22, 12)), '#F5DEB3') + shape(ell(x + 9, y - 9, 4, 3.2), pal.wall)
    + shape(ell(x - 12, y - 13, 3.4, 3.4), '#EF4444') + shape(ell(x - 4, y - 18, 3.4, 3.4), '#3B82F6')
    + shape(ell(x + 5, y - 19, 3.4, 3.4), '#22C55E') + shape(ell(x - 11, y - 5, 3, 3), '#FACC15')
    + shape(bar(x + 4, y - 3, x + 20, y - 34, 3), '#92400E') + shape(ell(x + 20.5, y - 35, 2.6, 3.4, 27), '#EFA3FA'),
  docs: (x, y) => shape(rrect(x - 21, y - 9, 42, 9, 2), '#2563EB') + shape(rrect(x - 17, y - 18, 35, 9, 2), '#DC2626')
    + shape(rrect(x - 19, y - 27, 38, 9, 2), '#16A34A')
    + shape(join(rrect(x + 15, y - 7, 4, 5, 1), rrect(x + 14, y - 16, 2.5, 5, 1), rrect(x + 15, y - 25, 2.5, 5, 1)), '#F8FAFC'),
  'ai-llm': (x, y) => shape(rrect(x - 13, y - 7, 26, 7, 3), '#475569') + shape(ell(x, y - 22, 14, 14), '#8B5CF6')
    + shape(ell(x - 4, y - 26, 6, 6), '#C4B5FD', ' class="of-glow"') + shape(ell(x - 5.5, y - 28, 2, 2), '#FFFFFF'),
  mobile: (x, y) => shape(rrect(x - 8, y - 6, 16, 6, 2), '#475569') + shape(rrect(x - 11, y - 44, 22, 38, 4), '#1E293B')
    + shape(rrect(x - 9, y - 41, 18, 30, 2), '#0F172A')
    + shape(join(rrect(x - 6.5, y - 38, 5, 5, 1.2), rrect(x + 1.5, y - 38, 5, 5, 1.2)), '#FB923C')
    + shape(join(rrect(x - 6.5, y - 30, 5, 5, 1.2), rrect(x + 1.5, y - 30, 5, 5, 1.2)), '#38BDF8'),
};

// The stroll's keyframes: a slow out-and-back along the corridor, its reach set by the desk number.
function roamCss(i) {
  const { x } = homeSpot(i);
  const reach = 40 + ((i * 23) % 50);
  const dir = (x + reach > 930) ? -1 : (x - reach < 70) ? 1 : (i % 2 ? -1 : 1);
  const a = dir * reach;
  const back = Math.max(70 - x, Math.min(930 - x, -a * 0.5));
  const dur = 15 + ((i * 7) % 9);
  const at = (dx) => `{transform:translate(${r2(dx)}px,0px)}`;
  return { dur, keyframes: `@keyframes rm${i}{0%,14%${at(0)}34%,50%${at(a)}70%,84%${at(back)}100%${at(0)}}` };
}

// A move counts only when its kind agrees with the seat. Returns seconds since it began, or null.
function moveAge(move, seated, now) {
  if (!move || move.kind !== (seated ? 'arrive' : 'leave') || !Number.isFinite(move.at)) return null;
  return Math.max(0, (now - move.at) / 1000);
}

// One creature placed in the office. Seated ones sit at the desk, free ones stroll the corridor; a move
// under WALK_S old makes it walk between the two, and later rebuilds carry on from where it is (negative delays).
function placed(section, state, move, now) {
  const i = ORDER.indexOf(section);
  const seated = SEATED.has(state);
  const age = moveAge(move, seated, now);
  const walking = age !== null && age < WALK_S;
  const box = seated ? seatBox(section) : homeBox(i);
  const mood = seated || state === 'done' ? state : 'idle';
  // Wrapped for poke and fling first, so a walk or a stroll carries the flight along with the creature.
  let body = flingMarkup(i, section, box,
    `<svg x="${box.x}" y="${box.y}" width="${80 * SCALE}" height="${r2(84 * SCALE)}" viewBox="10 10 80 84" overflow="visible">${creatureMarkup(section, mood, -i * 0.37)}</svg>`);
  let css = '';
  if (!seated) {
    const roam = roamCss(i);
    const delay = walking ? `${r2(WALK_S - age)}s`
      : `-${r2((age === null ? now / 1000 + i * 1.9 : age - WALK_S) % roam.dur)}s`;
    css += `.rm${i}{animation:rm${i} ${roam.dur}s ease-in-out ${delay} infinite}${roam.keyframes}`;
    body = `<g class="rm${i}">${body}</g>`;
  }
  if (walking) {
    const from = seated ? homeBox(i) : seatBox(section);
    const dx = r2(from.x - box.x);
    const dy = r2(from.y - box.y);
    css += `.wk${i}{animation:wk${i} ${WALK_S}s ease-in-out -${r2(age)}s both}@keyframes wk${i}{from{transform:translate(${dx}px,${dy}px)}to{transform:translate(0px,0px)}}.wk${i} .of-step{animation-delay:-${r2(age)}s}`;
    body = `<g class="wk${i}"><g class="of-step">${body}</g></g>`;
  }
  return { markup: body, css, inDeskLayer: seated || walking };
}

// The whole office as one SVG document. states: section -> board state (missing is asleep, so free);
// names: section -> the name on its desk; moves: section -> { kind: 'arrive' | 'leave', at: epoch ms };
// now: epoch ms, so walks and strolls carry on where they were when the picture is rebuilt; one that is not finite counts as 0;
// look: one of LOOKS, anything else draws night.
function officeSvg({ states = {}, names = {}, moves = {}, now: clock = 0, look = 'night' } = {}) {
  const now = Number.isFinite(clock) ? clock : 0;
  const pal = Object.hasOwn(PALETTES, look) ? PALETTES[look] : PALETTES.night;
  const plan = ORDER.map((section) => ({ section, ...placed(section, states[section] ?? 'asleep', moves[section], now) }));
  const rowLayer = (r) => ROWS[r].sections.map((section) => {
    const p = plan.find((q) => q.section === section);
    return chair(section) + (p.inDeskLayer ? p.markup : '') + desk(section, nameOf(names, section))
      + PROPS[section](deskSpot(section).cx - 50, deskSpot(section).base - 6, pal);
  }).join('');
  const corridor = plan.filter((p) => !p.inDeskLayer)
    .sort((a, b) => homeSpot(ORDER.indexOf(a.section)).feet - homeSpot(ORDER.indexOf(b.section)).feet)
    .map((p) => p.markup).join('');
  const css = CREW_CSS + OFFICE_CSS + handCss(now) + plan.map((p) => p.css).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="cr-svg" width="${ROOM.w}" height="${ROOM.h}" viewBox="0 0 ${ROOM.w} ${ROOM.h}">`
    + `<style>${css}</style>${room(pal)}${rowLayer(0)}${corridor}${rowLayer(1)}</svg>`;
}

// What the office says to a reader who cannot see it.
function officeAlt({ states = {}, names = {} } = {}) {
  const seated = ORDER.filter((s) => SEATED.has(states[s] ?? 'asleep'));
  const who = (s) => `${nameOf(names, s)} (${s}) ${states[s]}`;
  const free = ORDER.length - seated.length;
  return seated.length === 0 ? 'The office: all ten builders are free, strolling the corridor.'
    : `The office: ${seated.map(who).join(', ')} at their desks; ${free} free in the corridor.`;
}

export { ORDER, SEATED, WALK_MS, LOOKS, officeSvg, officeAlt, creatureSvg };
