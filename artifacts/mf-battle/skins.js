// MF Battle skins: each one is a round SVG drawing, keyed by the id the server knows.
const defs = (id, inner) => `<defs>${inner}</defs>`.replace(/ID/g, id);
const shine = '<ellipse cx="38" cy="30" rx="22" ry="12" fill="#fff" opacity=".22" transform="rotate(-30 38 30)"/>';
const ring = (c) => `<circle cx="64" cy="64" r="61" fill="none" stroke="${c}" stroke-width="6"/>`;

const ART = {
  classic: (u) => defs(u, '<radialGradient id="g-ID" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#4c1d95"/></radialGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${ring('#7c3aed')}${shine}`,
  mf: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#3b1366"/><stop offset="1" stop-color="#12052b"/></radialGradient><linearGradient id="t-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${ring('#fbbf24')}<text x="64" y="80" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="46" fill="url(#t-${u})" stroke="#4a1d00" stroke-width="2" paint-order="stroke">MF</text>${shine}`,
  ocean: (u) => defs(u, '<linearGradient id="g-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#67e8f9"/><stop offset="1" stop-color="#0c4a6e"/></linearGradient><clipPath id="c-ID"><circle cx="64" cy="64" r="62"/></clipPath>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g clip-path="url(#c-${u})" fill="none" stroke="#e0f2fe" stroke-width="5" opacity=".6"><path d="M-4 60 q17 -12 34 0 t34 0 t34 0 t34 0"/><path d="M-4 82 q17 -12 34 0 t34 0 t34 0 t34 0" opacity=".7"/><path d="M-4 104 q17 -12 34 0 t34 0 t34 0 t34 0" opacity=".5"/></g>${ring('#0891b2')}${shine}`,
  lava: (u) => defs(u, '<radialGradient id="g-ID" cx=".5" cy=".55" r=".7"><stop offset="0" stop-color="#fde047"/><stop offset=".45" stop-color="#f97316"/><stop offset="1" stop-color="#7f1d1d"/></radialGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g fill="none" stroke="#3b0a0a" stroke-width="4" stroke-linecap="round" opacity=".75"><path d="M30 40 l14 12 -6 14 16 10"/><path d="M90 30 l-8 18 12 10 -4 16"/><path d="M44 96 l14 -8 12 10 14 -6"/></g>${ring('#b91c1c')}${shine}`,
  neon: (u) => `<circle cx="64" cy="64" r="62" fill="#0b0618"/><circle cx="64" cy="64" r="50" fill="none" stroke="#ff2bd6" stroke-width="5"/><circle cx="64" cy="64" r="38" fill="none" stroke="#22e3ff" stroke-width="5"/><circle cx="64" cy="64" r="26" fill="none" stroke="#a3ff3a" stroke-width="5"/><circle cx="64" cy="64" r="10" fill="#fff"/>${ring('#ff2bd6')}`,
  toxic: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".35" r=".9"><stop offset="0" stop-color="#bef264"/><stop offset="1" stop-color="#166534"/></radialGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g fill="#14532d"><circle cx="64" cy="64" r="9"/><path d="M64 64 L46 34 A34 34 0 0 1 82 34 Z"/><path d="M64 64 L98 64 A34 34 0 0 1 80 94 Z" /><path d="M64 64 L48 94 A34 34 0 0 1 30 64 Z"/></g><g fill="#ecfccb" opacity=".6"><circle cx="30" cy="92" r="6"/><circle cx="100" cy="40" r="4"/><circle cx="96" cy="96" r="5"/></g>${ring('#15803d')}${shine}`,
  tiger: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".35" r=".9"><stop offset="0" stop-color="#fdba74"/><stop offset="1" stop-color="#c2410c"/></radialGradient><clipPath id="c-ID"><circle cx="64" cy="64" r="62"/></clipPath>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g clip-path="url(#c-${u})" fill="#1c1917"><path d="M0 22 q30 10 46 -4 q-14 18 -46 22z"/><path d="M128 30 q-28 6 -44 -8 q12 22 44 24z"/><path d="M0 70 q34 0 50 -14 q-10 24 -50 30z"/><path d="M128 76 q-34 -2 -48 -16 q8 26 48 32z"/><path d="M14 112 q30 -14 50 -6 q-26 2 -40 20z"/><path d="M118 110 q-26 -10 -44 -4 q22 4 34 20z"/></g>${ring('#9a3412')}${shine}`,
  snake: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".35" r=".9"><stop offset="0" stop-color="#86efac"/><stop offset="1" stop-color="#14532d"/></radialGradient><pattern id="p-ID" width="16" height="14" patternUnits="userSpaceOnUse"><path d="M0 7 q8 -9 16 0 q-8 9 -16 0z" fill="#052e16" opacity=".35"/></pattern>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><circle cx="64" cy="64" r="62" fill="url(#p-${u})"/><g><ellipse cx="44" cy="56" rx="12" ry="14" fill="#fef08a"/><ellipse cx="84" cy="56" rx="12" ry="14" fill="#fef08a"/><rect x="41" y="44" width="6" height="24" rx="3" fill="#111"/><rect x="81" y="44" width="6" height="24" rx="3" fill="#111"/><path d="M64 84 v14 l-6 8 M64 98 l6 8" stroke="#dc2626" stroke-width="4" fill="none" stroke-linecap="round"/></g>${ring('#166534')}`,
  galaxy: (u) => defs(u, '<radialGradient id="g-ID" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#f0abfc"/><stop offset=".3" stop-color="#7c3aed"/><stop offset="1" stop-color="#0f0529"/></radialGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g fill="none" stroke="#fae8ff" stroke-width="3" opacity=".55" stroke-linecap="round"><path d="M64 64 m-6 0 a6 6 0 1 1 12 0 a14 14 0 1 1 -28 0 a22 22 0 1 1 44 0 a30 30 0 1 1 -60 0"/></g><g fill="#fff"><circle cx="24" cy="40" r="1.8"/><circle cx="102" cy="32" r="2.2"/><circle cx="96" cy="100" r="1.6"/><circle cx="34" cy="98" r="2"/><circle cx="78" cy="18" r="1.4"/></g>${ring('#a855f7')}`,
  ziggurat: (u) => defs(u, '<linearGradient id="g-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset=".5" stop-color="#ea580c"/><stop offset="1" stop-color="#fcd34d"/></linearGradient><clipPath id="c-ID"><circle cx="64" cy="64" r="62"/></clipPath>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g clip-path="url(#c-${u})"><circle cx="64" cy="58" r="20" fill="#fef3c7" opacity=".85"/><path d="M10 128 v-16 h16 v-12 h16 v-12 h44 v12 h16 v12 h16 v16z" fill="#78350f"/><path d="M56 88 h16 v40 h-16z" fill="#b45309"/></g>${ring('#c2410c')}`,
  skull: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".35" r=".9"><stop offset="0" stop-color="#f43f5e"/><stop offset="1" stop-color="#4c0519"/></radialGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g fill="#fef3c7"><path d="M64 26 c-24 0 -38 16 -38 34 c0 12 6 20 14 24 v14 h48 v-14 c8 -4 14 -12 14 -24 c0 -18 -14 -34 -38 -34z"/></g><g fill="#1c1917"><ellipse cx="50" cy="62" rx="10" ry="11"/><ellipse cx="78" cy="62" rx="10" ry="11"/><path d="M64 72 l-6 10 h12z"/><rect x="50" y="92" width="5" height="10"/><rect x="61" y="92" width="5" height="10"/><rect x="72" y="92" width="5" height="10"/></g><circle cx="50" cy="62" r="3" fill="#f43f5e"/><circle cx="78" cy="62" r="3" fill="#f43f5e"/>${ring('#be123c')}`,
  crown: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".35" r=".9"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#2e1065"/></radialGradient><linearGradient id="k-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef08a"/><stop offset="1" stop-color="#d97706"/></linearGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><path d="M26 86 l-4 -44 22 18 20 -30 20 30 22 -18 -4 44z" fill="url(#k-${u})" stroke="#78350f" stroke-width="3" stroke-linejoin="round"/><rect x="26" y="86" width="76" height="12" rx="3" fill="url(#k-${u})" stroke="#78350f" stroke-width="3"/><circle cx="64" cy="70" r="7" fill="#e11d48"/><circle cx="42" cy="76" r="5" fill="#22d3ee"/><circle cx="86" cy="76" r="5" fill="#22d3ee"/>${ring('#fbbf24')}`,
  dragon: (u) => defs(u, '<radialGradient id="g-ID" cx=".4" cy=".35" r=".9"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#064e3b"/></radialGradient><radialGradient id="e-ID" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fef08a"/><stop offset=".6" stop-color="#f59e0b"/><stop offset="1" stop-color="#b45309"/></radialGradient>')
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/><g fill="#065f46" opacity=".6"><path d="M20 30 l12 6 -2 -12z"/><path d="M108 30 l-12 6 2 -12z"/><path d="M14 70 l14 2 -8 -10z"/><path d="M114 70 l-14 2 8 -10z"/></g><ellipse cx="64" cy="64" rx="34" ry="24" fill="url(#e-${u})" stroke="#422006" stroke-width="3"/><ellipse cx="64" cy="64" rx="6" ry="22" fill="#111"/>${ring('#047857')}`,
};

let uid = 0;
/** SVG markup for a skin (falls back to Classic for unknown ids). */
export function skinSVG(id, size = 128) {
  const art = ART[id] || ART.classic;
  const u = `s${++uid}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true">${art(u)}</svg>`;
}

export const RARITY = {
  common: { ar: 'عادي', color: '#94a3b8' },
  rare: { ar: 'نادر', color: '#38bdf8' },
  epic: { ar: 'ملحمي', color: '#c084fc' },
  legendary: { ar: 'أسطوري', color: '#fbbf24' },
};
