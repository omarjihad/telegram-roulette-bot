// MF Battle skins: each one is a round SVG drawing, keyed by the id the server knows.
// Two free skins (the fly, MF) and the limited "One Piece" pack — original, simplified
// fan-style drawings, not copies of any official artwork.
const defs = (id, inner) => `<defs>${inner}</defs>`.replace(/ID/g, id);
const shine = '<ellipse cx="38" cy="30" rx="22" ry="12" fill="#fff" opacity=".2" transform="rotate(-30 38 30)"/>';
const OL = 'stroke="#1c1917" stroke-width="2.5" stroke-linejoin="round"';
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

  // Joy Boy (sun god form): flaming white hair, straw hat, red-ringed eyes, a huge laugh.
  joyboy: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".55" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#fef3c7"/><stop offset="1" stop-color="#f59e0b"/></radialGradient><radialGradient id="f-ID" cx=".45" cy=".35" r=".8"><stop offset="0" stop-color="#fff7ed"/><stop offset="1" stop-color="#f5c9a8"/></radialGradient><linearGradient id="h-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef08a"/><stop offset="1" stop-color="#eab308"/></linearGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${rays(u, 'rgba(255,255,255,.55)', 20)}`
    + `<g clip-path="url(#c-${u})" fill="#fff" stroke="#e2e8f0" stroke-width="1.5"><path d="M22 70 c-12 -6 -10 -22 2 -24 c-8 -12 4 -26 16 -18 c0 -14 18 -18 24 -6 c6 -12 24 -8 24 6 c12 -8 24 6 16 18 c12 2 14 18 2 24 c10 8 4 22 -8 20 c-2 12 -16 14 -22 6 h-24 c-6 8 -20 6 -22 -6 c-12 2 -18 -12 -8 -20z"/></g>`
    + `<ellipse cx="64" cy="74" rx="27" ry="28" fill="url(#f-${u})" ${OL}/>`
    + '<path d="M42 54 q8 -6 16 -2 M70 52 q8 -4 16 2" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>'
    + '<g stroke="#1c1917" stroke-width="2"><circle cx="53" cy="65" r="7.5" fill="#fff"/><circle cx="75" cy="65" r="7.5" fill="#fff"/></g><g fill="none" stroke="#dc2626" stroke-width="2.6"><circle cx="53" cy="65" r="4.6"/><circle cx="75" cy="65" r="4.6"/></g><circle cx="53" cy="65" r="1.8" fill="#1c1917"/><circle cx="75" cy="65" r="1.8" fill="#1c1917"/>'
    + '<path d="M46 72 l2 5 M43 74 l6 1" stroke="#7c2d12" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M40 80 q24 34 48 0 q-24 6 -48 0z" fill="#7f1d1d" stroke="#1c1917" stroke-width="2.2" stroke-linejoin="round"/><path d="M42 81 q22 5 44 0 l-2 5 q-20 4 -40 0z" fill="#fff"/><path d="M54 99 q10 -8 20 0 q-10 6 -20 0z" fill="#f43f5e"/>'
    + `<path d="M28 40 q36 -14 72 0 q-2 6 -8 7 q-28 -8 -56 0 q-6 -1 -8 -7z" fill="url(#h-${u})" ${OL}/><path d="M44 34 c2 -18 38 -18 40 0z" fill="url(#h-${u})" ${OL}/><path d="M44 33 q20 -4 40 0 l0 5 q-20 -4 -40 0z" fill="#dc2626"/>`
    + `${ring('#f59e0b')}`,

  // Gol D. Roger: the Pirate King — wild black hair, the famous moustache, captain's coat.
  roger: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".4" r=".85"><stop offset="0" stop-color="#b91c1c"/><stop offset="1" stop-color="#2a0505"/></radialGradient><radialGradient id="f-ID" cx=".45" cy=".35" r=".85"><stop offset="0" stop-color="#fde3cc"/><stop offset="1" stop-color="#e0a77f"/></radialGradient><linearGradient id="k-ID" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dc2626"/><stop offset="1" stop-color="#7f1d1d"/></linearGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>${rays(u, 'rgba(250,204,21,.12)', 14)}`
    + `<g clip-path="url(#c-${u})"><path d="M14 128 c4 -26 24 -34 50 -34 c26 0 46 8 50 34z" fill="url(#k-${u})" ${OL}/><path d="M50 96 l14 22 14 -22" fill="#fef3c7" ${OL}/><path d="M30 104 l10 -2 M88 102 l10 2" stroke="#facc15" stroke-width="3" stroke-linecap="round"/></g>`
    + '<path d="M30 60 c-8 -26 10 -44 34 -44 c24 0 42 18 34 44 c-2 -10 -8 -16 -12 -18 c2 8 -2 12 -6 14 c0 -8 -6 -14 -12 -16 c-2 8 -8 12 -16 12 c2 -6 0 -10 -4 -12 c-4 4 -10 8 -18 20z" fill="#111827" stroke="#000" stroke-width="2"/>'
    + `<ellipse cx="64" cy="70" rx="24" ry="25" fill="url(#f-${u})" ${OL}/>`
    + '<path d="M30 60 c2 14 6 20 12 24 c-2 -8 -2 -14 0 -20z M98 60 c-2 14 -6 20 -12 24 c2 -8 2 -14 0 -20z" fill="#111827"/>'
    + '<g stroke="#111827" stroke-width="3.2" stroke-linecap="round"><path d="M46 58 l12 3"/><path d="M82 58 l-12 3"/></g><g fill="#111827"><ellipse cx="53" cy="66" rx="3" ry="3.6"/><ellipse cx="75" cy="66" rx="3" ry="3.6"/></g><circle cx="54" cy="65" r="1" fill="#fff"/><circle cx="76" cy="65" r="1" fill="#fff"/>'
    + '<path d="M38 70 c6 -2 14 2 26 6 c12 -4 20 -8 26 -6 c4 0 8 -4 8 -8 c2 8 -4 14 -12 14 c-10 0 -16 2 -22 6 c-6 -4 -12 -6 -22 -6 c-8 0 -14 -6 -12 -14 c0 4 4 8 8 8z" fill="#111827"/>'
    + '<path d="M50 86 q14 12 28 0 q-14 4 -28 0z" fill="#7f1d1d" stroke="#1c1917" stroke-width="2"/><path d="M52 86.5 q12 3 24 0 l-1 3 q-11 2 -22 0z" fill="#fff"/>'
    + `${ring('#facc15')}`,

  // Kaido: the beast king — great curved horns, long black hair, fangs and a fierce glare.
  kaido: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#3b82f6"/><stop offset=".6" stop-color="#1e3a8a"/><stop offset="1" stop-color="#020617"/></radialGradient><radialGradient id="f-ID" cx=".45" cy=".35" r=".85"><stop offset="0" stop-color="#e7c9a9"/><stop offset="1" stop-color="#b08463"/></radialGradient><linearGradient id="hn-ID" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#d6d3d1"/><stop offset="1" stop-color="#fafaf9"/></linearGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + `<g clip-path="url(#c-${u})" fill="none" stroke="#60a5fa" stroke-width="3" opacity=".35"><path d="M-6 96 c20 -16 40 8 60 -6 s40 -20 80 4"/><path d="M-6 112 c20 -16 40 8 60 -6 s40 -20 80 4"/></g>`
    + '<path d="M26 54 c-8 30 -4 56 8 74 h60 c12 -18 16 -44 8 -74 c-8 -20 -56 -20 -76 0z" fill="#0f172a" stroke="#000" stroke-width="2"/>'
    + `<path d="M46 44 c-18 -6 -28 -20 -24 -40 c6 14 16 22 30 30z" fill="url(#hn-${u})" ${OL}/><path d="M82 44 c18 -6 28 -20 24 -40 c-6 14 -16 22 -30 30z" fill="url(#hn-${u})" ${OL}/>`
    + `<ellipse cx="64" cy="72" rx="25" ry="27" fill="url(#f-${u})" ${OL}/>`
    + '<path d="M38 56 c8 -12 44 -12 52 0 c-6 -2 -14 -2 -18 2 c-4 -4 -12 -4 -16 0 c-4 -4 -12 -4 -18 -2z" fill="#0f172a"/>'
    + '<g stroke="#0f172a" stroke-width="4.5" stroke-linecap="round"><path d="M44 61 l14 5"/><path d="M84 61 l-14 5"/></g>'
    + '<g fill="#fde047" stroke="#1c1917" stroke-width="1.5"><path d="M48 68 q5 -4 10 0 q-5 3 -10 0z"/><path d="M70 68 q5 -4 10 0 q-5 3 -10 0z"/></g><circle cx="53" cy="68" r="1.6" fill="#1c1917"/><circle cx="75" cy="68" r="1.6" fill="#1c1917"/>'
    + '<path d="M50 84 q14 -4 28 0 q-2 8 -14 8 q-12 0 -14 -8z" fill="#450a0a" stroke="#1c1917" stroke-width="2"/><path d="M53 85 l3 5 3 -5z M75 85 l-3 5 -3 -5z" fill="#fff"/>'
    + '<path d="M54 94 c4 10 4 20 10 26 c6 -6 6 -16 10 -26 c-6 4 -14 4 -20 0z" fill="#0f172a"/>'
    + `${ring('#60a5fa')}`,

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

  // Usopp: the great captain of the sea — long nose, big curly hair, goggles, a sling.
  usopp: (u) => defs(u, `<radialGradient id="g-ID" cx=".5" cy=".45" r=".85"><stop offset="0" stop-color="#fef08a"/><stop offset=".6" stop-color="#f59e0b"/><stop offset="1" stop-color="#7c2d12"/></radialGradient><radialGradient id="f-ID" cx=".45" cy=".35" r=".85"><stop offset="0" stop-color="#d6a07a"/><stop offset="1" stop-color="#9a6a45"/></radialGradient><radialGradient id="l-ID" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fed7aa"/><stop offset=".5" stop-color="#fb923c"/><stop offset="1" stop-color="#c2410c"/></radialGradient>${clip(u)}`)
    + `<circle cx="64" cy="64" r="62" fill="url(#g-${u})"/>`
    + '<g fill="#18181b" stroke="#000" stroke-width="1.5"><circle cx="30" cy="62" r="14"/><circle cx="36" cy="42" r="14"/><circle cx="52" cy="28" r="14"/><circle cx="74" cy="27" r="14"/><circle cx="92" cy="40" r="14"/><circle cx="98" cy="60" r="14"/><circle cx="28" cy="80" r="10"/><circle cx="100" cy="78" r="10"/></g>'
    + '<g fill="#52525b" opacity=".7"><circle cx="34" cy="38" r="4"/><circle cx="50" cy="24" r="4"/><circle cx="72" cy="22" r="4"/><circle cx="90" cy="35" r="4"/></g>'
    + `<ellipse cx="64" cy="72" rx="25" ry="27" fill="url(#f-${u})" ${OL}/>`
    + `<g ${OL}><rect x="36" y="46" width="56" height="7" rx="3.5" fill="#78350f"/><circle cx="52" cy="49" r="9.5" fill="url(#l-${u})"/><circle cx="76" cy="49" r="9.5" fill="url(#l-${u})"/></g><circle cx="49" cy="46" r="3" fill="#fff" opacity=".85"/><circle cx="73" cy="46" r="3" fill="#fff" opacity=".85"/>`
    + '<g fill="#1c1917"><ellipse cx="53" cy="67" rx="3.4" ry="4.4"/><ellipse cx="75" cy="67" rx="3.4" ry="4.4"/></g><circle cx="54" cy="65.5" r="1.2" fill="#fff"/><circle cx="76" cy="65.5" r="1.2" fill="#fff"/>'
    + `<path d="M62 72 h44 c5 0 7 7 0 8 h-44z" fill="url(#f-${u})" ${OL}/>`
    + '<path d="M48 88 q16 12 32 0" stroke="#7c2d12" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M50 88 q14 9 28 0" stroke="#fde68a" stroke-width="2" fill="none" stroke-linecap="round"/>'
    + `${ring('#78350f')}`,
};

let uid = 0;
/**
 * Your own pictures for skins (optional): assets/skins/images.json maps a skin id to an
 * image file in assets/skins. A skin with a picture shows it (cut round) instead of the drawing.
 */
export const SKIN_IMAGES = {};
export async function loadSkinImages() {
  try {
    const res = await fetch('assets/skins/images.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const map = await res.json();
    for (const [id, file] of Object.entries(map || {})) {
      if (typeof file === 'string' && /^[\w.-]+\.(png|webp|jpe?g)$/i.test(file)) SKIN_IMAGES[id] = `assets/skins/${file}`;
    }
  } catch (e) { /* no pictures: the drawings are used */ }
}
/** The picture of a skin, if one was added (used by the game canvas). */
export const skinImageUrl = (id) => SKIN_IMAGES[id] || null;

/** SVG markup for a skin (falls back to the fly for unknown ids). */
export function skinSVG(id, size = 128) {
  const u = `s${++uid}`;
  const pic = SKIN_IMAGES[id];
  const body = pic
    ? `<defs>${clip(u)}</defs><image href="${pic}" x="1" y="1" width="126" height="126" preserveAspectRatio="xMidYMid slice" clip-path="url(#c-${u})"/>${ring('rgba(255,255,255,.85)', 4)}`
    : (ART[id] || ART.fly)(u);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

/** Rarities, weakest to strongest: common, rare, legendary, mythic (ملحمي — the top). */
export const RARITY = {
  common: { ar: 'عادي', color: '#94a3b8', rank: 1 },
  rare: { ar: 'نادر', color: '#38bdf8', rank: 2 },
  legendary: { ar: 'أسطوري', color: '#fbbf24', rank: 3 },
  mythic: { ar: 'ملحمي', color: '#ff3b6b', rank: 4 },
};
