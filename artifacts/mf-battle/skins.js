// MF Battle skins: each one is a round SVG drawing, keyed by the id the server knows.
// Two free skins (the fly, MF) and the limited "One Piece" pack — original, simplified
// fan-style drawings, not copies of any official artwork.
const defs = (id, inner) => `<defs>${inner}</defs>`.replace(/ID/g, id);
const shine = '<ellipse cx="38" cy="30" rx="22" ry="12" fill="#fff" opacity=".2" transform="rotate(-30 38 30)"/>';
const ring = (c, w = 6) => `<circle cx="64" cy="64" r="61" fill="none" stroke="${c}" stroke-width="${w}"/>`;
const clip = (u) => `<clipPath id="c-${u}"><circle cx="64" cy="64" r="62"/></clipPath>`;
const rays = (u, color, n = 16) => {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = a + Math.PI / n;
    d += `M64 64 L${(64 + Math.cos(a) * 90).toFixed(1)} ${(64 + Math.sin(a) * 90).toFixed(1)} L${(64 + Math.cos(b) * 90).toFixed(1)} ${(64 + Math.sin(b) * 90).toFixed(1)}Z`;
  }
  return `<path d="${d}" fill="${color}" clip-path="url(#c-${u})"/>`;
};

const ART = {
  // The classic little fly.
  fly: (u) => defs(u, `<radialGradient id="g-ID" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#e0f2fe"/><stop offset="1" stop-color="#7dd3fc"/></radialGradient><radialGradient id="e-ID" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fca5a5"/><stop offset=".6" stop-color="#dc2626"/><stop offset="1" stop-color="#7f1d1d"/></radialGradient><pattern id="p-ID" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.1" fill="#450a0a" opacity=".35"/></pattern>`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + '<g fill="#fff" stroke="#93c5fd" stroke-width="2" opacity=".85"><ellipse cx="38" cy="50" rx="22" ry="12" transform="rotate(-35 38 50)"/><ellipse cx="90" cy="50" rx="22" ry="12" transform="rotate(35 90 50)"/></g>'
    + '<g stroke="#1f2937" stroke-width="3" stroke-linecap="round"><path d="M50 86 l-12 14"/><path d="M64 90 v16"/><path d="M78 86 l12 14"/></g>'
    + '<ellipse cx="64" cy="76" rx="22" ry="20" fill="#374151"/><path d="M46 78 h36 M47 86 h34" stroke="#111827" stroke-width="3"/>'
    + `<circle cx="51" cy="58" r="14" fill="url(#e-${u})"/><circle cx="77" cy="58" r="14" fill="url(#e-${u})"/><circle cx="51" cy="58" r="14" fill="url(#p-${u})"/><circle cx="77" cy="58" r="14" fill="url(#p-${u})"/>`
    + '<circle cx="46" cy="53" r="4" fill="#fff" opacity=".8"/><circle cx="72" cy="53" r="4" fill="#fff" opacity=".8"/>'
    + `${ring('#0ea5e9')}${shine}`,

  // MF: gold monogram on a shield, with a small crown.
  mf: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".35" r=".85"><stop offset="0" stop-color="#4c1d95"/><stop offset=".7" stop-color="#1e1b4b"/><stop offset="1" stop-color="#0b0618"/></radialGradient><linearGradient id="t-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7c2"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></linearGradient><linearGradient id="s-ID" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22e3ff"/><stop offset="1" stop-color="#9b5cff"/></linearGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${rays(u, 'rgba(155,92,255,.18)', 12)}`
    + `<path d="M64 24 l34 12 v24 c0 22 -15 38 -34 46 c-19 -8 -34 -24 -34 -46 v-24z" fill="url(#s-${u})" opacity=".9"/><path d="M64 31 l28 10 v19 c0 18 -12 31 -28 38 c-16 -7 -28 -20 -28 -38 v-19z" fill="#120a26"/>`
    + `<text x="64" y="80" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="34" letter-spacing="-1" fill="url(#t-${u})" stroke="#3b1a00" stroke-width="1.5" paint-order="stroke">MF</text>`
    + `<path d="M50 22 l5 -9 9 7 9 -7 5 9z" fill="url(#t-${u})" stroke="#3b1a00" stroke-width="1.5" stroke-linejoin="round"/>`
    + '<g fill="#fff"><circle cx="24" cy="40" r="1.6"/><circle cx="104" cy="44" r="2"/><circle cx="98" cy="98" r="1.4"/><circle cx="28" cy="94" r="1.8"/></g>'
    + `${ring('#fbbf24')}`,

  // Joy Boy: sun god — white cloud hair, straw hat, huge laugh, sun rays.
  joyboy: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#fffbe6"/><stop offset=".55" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${rays(u, 'rgba(255,255,255,.45)', 18)}`
    + '<g fill="#fff" stroke="#e5e7eb" stroke-width="1.5"><circle cx="34" cy="58" r="13"/><circle cx="94" cy="58" r="13"/><circle cx="40" cy="42" r="12"/><circle cx="88" cy="42" r="12"/><circle cx="30" cy="76" r="10"/><circle cx="98" cy="76" r="10"/></g>'
    + '<ellipse cx="64" cy="70" rx="26" ry="28" fill="#fde7d4"/>'
    + '<ellipse cx="64" cy="34" rx="36" ry="7" fill="#facc15" stroke="#a16207" stroke-width="2"/><path d="M44 34 c0 -16 40 -16 40 0z" fill="#fde047" stroke="#a16207" stroke-width="2"/><rect x="44" y="27" width="40" height="5" fill="#dc2626"/>'
    + '<g fill="#fff" stroke="#dc2626" stroke-width="2.5"><circle cx="53" cy="62" r="6"/><circle cx="75" cy="62" r="6"/></g><circle cx="53" cy="62" r="2.2" fill="#dc2626"/><circle cx="75" cy="62" r="2.2" fill="#dc2626"/>'
    + '<path d="M44 74 q20 30 40 0z" fill="#7f1d1d"/><path d="M46 75 q18 9 36 0 v4 q-18 7 -36 0z" fill="#fff"/><path d="M48 56 l-4 6 M48 66 l-3 4" stroke="#7c2d12" stroke-width="1.6"/>'
    + `${ring('#f59e0b')}`,

  // Roger: captain's hat with a skull, big moustache, red sea of pirates.
  roger: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#450a0a"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + '<path d="M30 76 c-6 22 10 40 34 40 c24 0 40 -18 34 -40z" fill="#7f1d1d"/>'
    + '<ellipse cx="64" cy="72" rx="24" ry="26" fill="#f2c9a5"/>'
    + '<path d="M22 46 c10 -26 74 -26 84 0 c-8 6 -18 8 -42 8 c-24 0 -34 -2 -42 -8z" fill="#111827" stroke="#facc15" stroke-width="2.5"/>'
    + '<g fill="#fff"><circle cx="64" cy="36" r="6"/><path d="M54 44 l20 -6 M54 38 l20 6" stroke="#fff" stroke-width="2.5"/></g><circle cx="62" cy="35" r="1.4" fill="#111827"/><circle cx="66" cy="35" r="1.4" fill="#111827"/>'
    + '<g fill="#111827"><path d="M52 66 l8 -2 v3z"/><path d="M76 66 l-8 -2 v3z"/></g>'
    + '<path d="M40 84 c8 -12 18 -6 24 -2 c6 -4 16 -10 24 2 c-6 -2 -10 2 -12 6 c-4 -6 -8 -6 -12 -2 c-4 -4 -8 -4 -12 2 c-2 -4 -6 -8 -12 -6z" fill="#1f2937"/>'
    + '<path d="M54 96 q10 6 20 0" stroke="#7f1d1d" stroke-width="3" fill="none" stroke-linecap="round"/>'
    + `${ring('#fbbf24')}`,

  // Kaido: storm-blue dragon king — two horns, long hair, furious eyes.
  kaido: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".35" r=".85"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#0f172a"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + '<path d="M18 22 l10 8 -6 2z M106 18 l-8 10 6 2z" fill="#fde047" opacity=".7"/>'
    + '<path d="M28 50 c-6 30 -2 56 8 68 h56 c10 -12 14 -38 8 -68z" fill="#111827"/>'
    + '<ellipse cx="64" cy="70" rx="26" ry="28" fill="#c7b9a6"/>'
    + '<g fill="#e7e5e4" stroke="#57534e" stroke-width="2"><path d="M50 48 c-16 -6 -26 -18 -24 -38 c6 12 16 20 30 28z"/><path d="M78 48 c16 -6 26 -18 24 -38 c-6 12 -16 20 -30 28z"/></g>'
    + '<path d="M38 50 c8 -12 44 -12 52 0 c-10 -4 -42 -4 -52 0z" fill="#111827"/>'
    + '<g stroke="#111827" stroke-width="4" stroke-linecap="round"><path d="M46 60 l12 4"/><path d="M82 60 l-12 4"/></g><g fill="#fef08a"><circle cx="53" cy="67" r="3"/><circle cx="75" cy="67" r="3"/></g>'
    + '<path d="M48 84 q16 -8 32 0 c-2 14 -8 24 -16 26 c-8 -2 -14 -12 -16 -26z" fill="#111827"/><path d="M54 86 h20" stroke="#f8fafc" stroke-width="2"/>'
    + `${ring('#818cf8')}`,

  // Zoro: green hair, black bandana, scar over a closed eye, three swords.
  zoro: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".4" r=".85"><stop offset="0" stop-color="#16a34a"/><stop offset="1" stop-color="#052e16"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + `<g clip-path="url(#c-${u})" stroke-linecap="round"><path d="M10 112 L116 22" stroke="#e5e7eb" stroke-width="5"/><path d="M14 22 L118 110" stroke="#e5e7eb" stroke-width="5"/><path d="M64 4 V124" stroke="#e5e7eb" stroke-width="5" opacity=".9"/><g fill="#facc15"><circle cx="30" cy="95" r="5"/><circle cx="98" cy="95" r="5"/><circle cx="64" cy="110" r="5"/></g></g>`
    + '<ellipse cx="64" cy="70" rx="26" ry="28" fill="#f1c7a1"/>'
    + '<path d="M38 56 c-2 -18 10 -30 26 -30 c16 0 28 12 26 30 c-6 -6 -10 -4 -14 -8 c-4 4 -10 2 -12 -2 c-4 4 -10 2 -12 -2 c-4 4 -10 6 -14 12z" fill="#22c55e" stroke="#14532d" stroke-width="2"/>'
    + '<path d="M38 52 c10 -10 42 -10 52 0 l-2 6 c-12 -6 -36 -6 -48 0z" fill="#111827"/>'
    + '<path d="M46 66 h12" stroke="#111827" stroke-width="3" stroke-linecap="round"/><path d="M52 56 l-2 22" stroke="#b91c1c" stroke-width="2.5"/><ellipse cx="76" cy="66" rx="4" ry="4.5" fill="#111827"/>'
    + '<path d="M54 90 q10 4 20 0" stroke="#7c2d12" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M90 66 v10" stroke="#facc15" stroke-width="3"/>'
    + `${ring('#22c55e')}`,

  // Sanji: blond hair over one eye, curly eyebrow, cigarette, black suit.
  sanji: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".4" r=".85"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1e3a8a"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + `<g clip-path="url(#c-${u})"><path d="M20 128 c4 -22 22 -30 44 -30 c22 0 40 8 44 30z" fill="#111827"/><path d="M56 98 l8 22 8 -22z" fill="#e0f2fe"/><path d="M62 100 h4 l2 18 -4 4 -4 -4z" fill="#1d4ed8"/></g>`
    + '<ellipse cx="64" cy="66" rx="25" ry="28" fill="#f6d2b4"/>'
    + '<path d="M38 64 c-4 -26 8 -40 28 -40 c18 0 30 12 26 30 c-6 -8 -16 -10 -22 -12 c-2 12 -12 24 -32 22z" fill="#fde047" stroke="#ca8a04" stroke-width="2"/>'
    + '<path d="M70 58 c4 -5 12 -5 14 0 c1 3 -3 4 -4 1" stroke="#111827" stroke-width="2.5" fill="none" stroke-linecap="round"/><ellipse cx="76" cy="66" rx="3.6" ry="4" fill="#111827"/>'
    + '<path d="M58 88 q8 3 14 -2" stroke="#7c2d12" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
    + '<path d="M70 86 l18 -4" stroke="#f8fafc" stroke-width="4" stroke-linecap="round"/><circle cx="89" cy="82" r="2.5" fill="#f97316"/><path d="M92 78 q6 -6 2 -12 q-4 -6 4 -12" stroke="#cbd5e1" stroke-width="2" fill="none" opacity=".8"/>'
    + `${ring('#fde047')}`,

  // Imu: a shadow on the empty throne — dark silhouette, glowing ringed eyes.
  imu: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#7f1d1d"/><stop offset=".6" stop-color="#1c0505"/><stop offset="1" stop-color="#000"/></radialGradient><radialGradient id="e-ID" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fecaca"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${rays(u, 'rgba(239,68,68,.12)', 10)}`
    + '<path d="M64 20 c-20 0 -34 16 -34 38 c0 18 4 36 -6 60 h80 c-10 -24 -6 -42 -6 -60 c0 -22 -14 -38 -34 -38z" fill="#020202"/>'
    + '<path d="M44 26 l6 -12 6 10 8 -14 8 14 6 -10 6 12z" fill="#0a0a0a" stroke="#7f1d1d" stroke-width="1.5"/>'
    + `<circle cx="52" cy="60" r="9" fill="url(#e-${u})"/><circle cx="76" cy="60" r="9" fill="url(#e-${u})"/>`
    + '<g fill="none" stroke="#ef4444" stroke-width="1.6"><circle cx="52" cy="60" r="5"/><circle cx="76" cy="60" r="5"/></g><g fill="#111"><circle cx="52" cy="60" r="1.8"/><circle cx="76" cy="60" r="1.8"/></g>'
    + '<g fill="#fff" opacity=".9"><circle cx="64" cy="98" r="5"/><circle cx="58" cy="94" r="4"/><circle cx="70" cy="94" r="4"/><circle cx="58" cy="102" r="4"/><circle cx="70" cy="102" r="4"/></g><circle cx="64" cy="98" r="2.5" fill="#facc15"/>'
    + `${ring('#7f1d1d')}`,

  // Whitebeard: the great crescent moustache, bandana, the sea behind him.
  whitebeard: (u) => defs(u, `<linearGradient id="g-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#075985"/></linearGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + `<g clip-path="url(#c-${u})" fill="none" stroke="#e0f2fe" stroke-width="4" opacity=".45"><path d="M-4 104 q17 -10 34 0 t34 0 t34 0 t34 0"/><path d="M-4 118 q17 -10 34 0 t34 0 t34 0 t34 0"/></g>`
    + '<ellipse cx="64" cy="70" rx="27" ry="29" fill="#e8b88f"/>'
    + '<path d="M36 50 c4 -20 52 -20 56 0 c-14 -6 -42 -6 -56 0z" fill="#1f2937"/><path d="M90 50 l12 -4 -4 10z" fill="#1f2937"/>'
    + '<g stroke="#111827" stroke-width="3.5" stroke-linecap="round"><path d="M46 62 l12 2"/><path d="M82 62 l-12 2"/></g><g fill="#111827"><circle cx="53" cy="68" r="2.6"/><circle cx="75" cy="68" r="2.6"/></g>'
    + '<path d="M26 66 c2 16 20 22 38 14 c18 8 36 2 38 -14 c-6 10 -22 12 -38 4 c-16 8 -32 6 -38 -4z" fill="#fff" stroke="#cbd5e1" stroke-width="2"/>'
    + '<path d="M56 92 q8 4 16 0" stroke="#7c2d12" stroke-width="3" fill="none" stroke-linecap="round"/>'
    + `${ring('#f8fafc')}`,

  // Usopp: the long nose, curly hair, goggles on the forehead.
  usopp: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".4" r=".85"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#b45309"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + '<g fill="#111827"><circle cx="34" cy="50" r="13"/><circle cx="46" cy="36" r="13"/><circle cx="64" cy="30" r="14"/><circle cx="82" cy="36" r="13"/><circle cx="94" cy="50" r="13"/><circle cx="30" cy="68" r="10"/><circle cx="98" cy="68" r="10"/></g>'
    + '<ellipse cx="64" cy="72" rx="24" ry="27" fill="#c68a5c"/>'
    + '<g><rect x="40" y="44" width="48" height="6" rx="3" fill="#78350f"/><circle cx="54" cy="46" r="8" fill="#f97316" stroke="#78350f" stroke-width="2.5"/><circle cx="74" cy="46" r="8" fill="#f97316" stroke="#78350f" stroke-width="2.5"/><circle cx="52" cy="44" r="2.5" fill="#fff" opacity=".7"/><circle cx="72" cy="44" r="2.5" fill="#fff" opacity=".7"/></g>'
    + '<g fill="#111827"><ellipse cx="54" cy="66" rx="3" ry="4"/><ellipse cx="74" cy="66" rx="3" ry="4"/></g>'
    + '<path d="M62 72 h42 c6 0 6 7 0 7 h-42z" fill="#b97a4c" stroke="#7c2d12" stroke-width="2"/>'
    + '<path d="M52 90 q12 8 24 0" stroke="#7c2d12" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
    + `${ring('#78350f')}`,
};

let uid = 0;
/** SVG markup for a skin (falls back to the fly for unknown ids). */
export function skinSVG(id, size = 128) {
  const art = ART[id] || ART.fly;
  const u = `s${++uid}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true">${art(u)}</svg>`;
}

/** Rarities, weakest to strongest: common, rare, legendary, mythic (ملحمي — the top). */
export const RARITY = {
  common: { ar: 'عادي', color: '#94a3b8', rank: 1 },
  rare: { ar: 'نادر', color: '#38bdf8', rank: 2 },
  legendary: { ar: 'أسطوري', color: '#fbbf24', rank: 3 },
  mythic: { ar: 'ملحمي', color: '#ff3b6b', rank: 4 },
};
