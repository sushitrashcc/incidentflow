/* Flat product illustrations for the Cartora catalogue (viewBox 0 0 100 100). */
window.CARTORA_ART = (() => {
  const A = {
    // earbuds + case
    p101: (c, d) => `<rect x="22" y="52" width="56" height="30" rx="15" fill="${c}"/><rect x="22" y="52" width="56" height="10" rx="5" fill="${d}" opacity=".35"/><circle cx="50" cy="70" r="2.5" fill="#7CF29A"/>
      <path d="M32 22a9 9 0 0 1 9 9v6a5 5 0 0 1-5 5h-1v8h-6V31a9 9 0 0 1 3-9z" fill="#fff" stroke="${d}" stroke-width="2"/><path d="M68 22a9 9 0 0 0-9 9v6a5 5 0 0 0 5 5h1v8h6V31a9 9 0 0 0-3-9z" fill="#fff" stroke="${d}" stroke-width="2"/>`,
    // smartwatch
    p102: (c, d) => `<rect x="38" y="8" width="24" height="20" rx="4" fill="${d}"/><rect x="38" y="72" width="24" height="20" rx="4" fill="${d}"/><rect x="28" y="24" width="44" height="52" rx="12" fill="${c}"/><rect x="33" y="29" width="34" height="42" rx="8" fill="#0d1420"/>
      <path d="M38 52h6l3-8 5 14 3-6h7" fill="none" stroke="#7CF29A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="50" y="41" font-size="8" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">10:24</text><rect x="72" y="42" width="4" height="10" rx="2" fill="${d}"/>`,
    // power bank
    p103: (c, d) => `<rect x="30" y="12" width="40" height="76" rx="9" fill="${c}"/><rect x="30" y="12" width="40" height="76" rx="9" fill="none" stroke="${d}" stroke-width="2"/><rect x="44" y="8" width="12" height="6" rx="2" fill="${d}"/>
      <circle cx="42" cy="72" r="2.2" fill="#7CF29A"/><circle cx="48" cy="72" r="2.2" fill="#7CF29A"/><circle cx="54" cy="72" r="2.2" fill="#7CF29A"/><circle cx="60" cy="72" r="2.2" fill="#ffffff" opacity=".4"/><path d="M53 30l-9 14h7l-3 12 10-16h-7z" fill="#F5A524"/>`,
    // speaker
    p104: (c, d) => `<rect x="14" y="30" width="72" height="44" rx="22" fill="${c}"/><rect x="14" y="30" width="72" height="44" rx="22" fill="none" stroke="${d}" stroke-width="2"/><circle cx="36" cy="52" r="13" fill="${d}"/><circle cx="36" cy="52" r="6" fill="#000" opacity=".35"/><circle cx="64" cy="52" r="13" fill="${d}"/><circle cx="64" cy="52" r="6" fill="#000" opacity=".35"/><rect x="40" y="24" width="20" height="8" rx="3" fill="${d}"/>`,
    // shirt
    p201: (c, d) => `<path d="M34 14l-22 12 8 18 8-4v46h44V40l8 4 8-18-22-12c-2 6-8 10-16 10s-14-4-16-10z" fill="${c}" stroke="${d}" stroke-width="2" stroke-linejoin="round"/><path d="M42 14l8 12 8-12" fill="none" stroke="${d}" stroke-width="2"/><path d="M50 26v58" stroke="${d}" stroke-width="1.5" stroke-dasharray="1 7" stroke-linecap="round"/><rect x="58" y="40" width="10" height="10" rx="1.5" fill="none" stroke="${d}" stroke-width="1.5"/>`,
    // running shoe
    p202: (c, d) => `<path d="M10 66c0-10 4-20 10-28l14 8c6 3 12 0 16-6l8 6c8 6 20 8 30 10 4 1 6 4 6 8v4H10z" fill="${c}" stroke="${d}" stroke-width="2" stroke-linejoin="round"/><path d="M8 68h88v6c0 4-3 7-7 7H15c-4 0-7-3-7-7z" fill="${d}"/><path d="M38 48l6-4M44 52l6-4M50 56l6-4" stroke="${d}" stroke-width="2" stroke-linecap="round"/><path d="M60 62c10 0 20 0 30 2" stroke="#F5A524" stroke-width="3" stroke-linecap="round"/>`,
    // kurta
    p203: (c, d) => `<path d="M36 10l-16 8-8 30 10 3 6-20v59h44V31l6 20 10-3-8-30-16-8c-2 5-7 8-14 8s-12-3-14-8z" fill="${c}" stroke="${d}" stroke-width="2" stroke-linejoin="round"/><path d="M50 18v20" stroke="${d}" stroke-width="2"/>
      ${[[38, 48], [50, 48], [62, 48], [44, 60], [56, 60], [38, 72], [50, 72], [62, 72]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="none" stroke="${d}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="1" fill="${d}"/>`).join('')}`,
    // backpack
    p204: (c, d) => `<path d="M38 18a12 12 0 0 1 24 0" fill="none" stroke="${d}" stroke-width="4"/><rect x="24" y="18" width="52" height="70" rx="16" fill="${c}"/><rect x="32" y="52" width="36" height="28" rx="7" fill="${d}" opacity=".35"/><path d="M32 58h36" stroke="${d}" stroke-width="2"/><rect x="46" y="62" width="8" height="5" rx="2" fill="#F5A524"/><path d="M30 30h40" stroke="${d}" stroke-width="2" opacity=".4"/>`,
    // kadhai
    p301: (c, d) => `<path d="M14 46h72c0 18-16 30-36 30S14 64 14 46z" fill="${c}" stroke="${d}" stroke-width="2"/><ellipse cx="50" cy="46" rx="36" ry="7" fill="#fff" stroke="${d}" stroke-width="2"/><path d="M14 50c-6 0-8-6-4-8M86 50c6 0 8-6 4-8" fill="none" stroke="${d}" stroke-width="4" stroke-linecap="round"/>
      <path d="M40 32c0-5 4-5 4-10M50 32c0-5 4-5 4-10M60 32c0-5 4-5 4-10" fill="none" stroke="${d}" stroke-width="2" stroke-linecap="round" opacity=".55"/>`,
    // dinner set
    p302: (c, d) => `<ellipse cx="42" cy="60" rx="30" ry="22" fill="#fff" stroke="${d}" stroke-width="2"/><ellipse cx="42" cy="60" rx="19" ry="13" fill="${c}"/><path d="M62 32h26l-4 20H66z" fill="#fff" stroke="${d}" stroke-width="2" stroke-linejoin="round"/><path d="M64 40h22" stroke="${c}" stroke-width="4"/><path d="M80 66v22M76 66v8a4 4 0 0 0 8 0v-8" fill="none" stroke="${d}" stroke-width="2" stroke-linecap="round"/>`,
    // cold brew jar
    p303: (c, d) => `<rect x="30" y="20" width="40" height="66" rx="8" fill="#fff" opacity=".9" stroke="${d}" stroke-width="2"/><rect x="34" y="40" width="32" height="42" rx="5" fill="${c}"/><rect x="44" y="22" width="12" height="54" rx="4" fill="none" stroke="${d}" stroke-width="1.6" stroke-dasharray="2 2"/><rect x="28" y="12" width="44" height="10" rx="3" fill="${d}"/><path d="M70 34h6a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-6" fill="none" stroke="${d}" stroke-width="3"/>`,
    // bedsheet stack
    p304: (c, d) => `<rect x="16" y="58" width="68" height="18" rx="4" fill="${d}" opacity=".55"/><rect x="18" y="42" width="64" height="18" rx="4" fill="${c}" stroke="${d}" stroke-width="1.5"/><rect x="20" y="26" width="60" height="18" rx="4" fill="#fff" stroke="${d}" stroke-width="1.5"/>
      <path d="M26 35h48" stroke="${c}" stroke-width="3" stroke-dasharray="6 4"/><path d="M24 51h52" stroke="#fff" stroke-width="2" stroke-dasharray="2 4"/>`,
    // serum dropper
    p401: (c, d) => `<rect x="42" y="10" width="16" height="16" rx="8" fill="${d}"/><rect x="40" y="24" width="20" height="10" rx="2" fill="#3a2f22"/><rect x="30" y="34" width="40" height="54" rx="10" fill="${c}"/><rect x="30" y="34" width="40" height="54" rx="10" fill="none" stroke="${d}" stroke-width="2"/>
      <rect x="36" y="50" width="28" height="22" rx="3" fill="#fff"/><text x="50" y="64" font-size="9" text-anchor="middle" fill="${d}" font-family="sans-serif" font-weight="800">C 10%</text>`,
    // trimmer
    p402: (c, d) => `<rect x="36" y="22" width="28" height="68" rx="13" fill="${c}"/><rect x="34" y="10" width="32" height="14" rx="3" fill="#cfd3d6" stroke="${d}" stroke-width="1.5"/><path d="M36 10v-3M41 10v-3M46 10v-3M51 10v-3M56 10v-3M61 10v-3M64 10v-3" stroke="${d}" stroke-width="1.5"/>
      <circle cx="50" cy="44" r="5" fill="#F5A524"/><rect x="46" y="56" width="8" height="18" rx="4" fill="#fff" opacity=".25"/>`,
    // yoga mat
    p501: (c, d) => `<path d="M14 70V36a14 14 0 0 1 28 0v34z" fill="${c}"/><circle cx="28" cy="36" r="10" fill="${d}" opacity=".45"/><circle cx="28" cy="36" r="5" fill="${c}"/><rect x="28" y="56" width="62" height="14" rx="3" fill="${c}"/><path d="M28 70h62" stroke="${d}" stroke-width="2"/>
      <path d="M44 63h40" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 3" opacity=".7"/><path d="M30 24h-4v52h4" stroke="${d}" stroke-width="2" fill="none" opacity=".5"/>`,
    // dumbbells
    p502: (c, d) => `<g transform="rotate(-18 50 50)"><rect x="12" y="34" width="10" height="32" rx="3" fill="${c}"/><rect x="22" y="38" width="8" height="24" rx="2" fill="${c}"/><rect x="70" y="38" width="8" height="24" rx="2" fill="${c}"/><rect x="78" y="34" width="10" height="32" rx="3" fill="${c}"/><rect x="30" y="46" width="40" height="8" rx="2" fill="#cfd3d6" stroke="${d}" stroke-width="1"/></g>`,
    // books
    p601: (c, d) => `<rect x="22" y="14" width="56" height="74" rx="4" fill="${c}"/><rect x="22" y="14" width="9" height="74" fill="${d}" opacity=".5"/><path d="M40 34l-6 6 6 6M60 34l6 6-6 6M53 30l-6 20" fill="none" stroke="#F5A524" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="38" y="60" width="32" height="4" rx="2" fill="#fff"/><rect x="38" y="68" width="22" height="3" rx="1.5" fill="#fff" opacity=".6"/>`,
    p602: (c, d) => `<rect x="22" y="14" width="56" height="74" rx="4" fill="${c}"/><rect x="22" y="14" width="9" height="74" fill="${d}" opacity=".5"/><rect x="40" y="28" width="12" height="12" fill="none" stroke="#fff" stroke-width="2.5"/><rect x="56" y="28" width="12" height="12" fill="#F5A524"/><rect x="40" y="44" width="28" height="10" fill="none" stroke="#fff" stroke-width="2.5"/>
      <rect x="38" y="64" width="32" height="4" rx="2" fill="#fff"/><rect x="38" y="72" width="22" height="3" rx="1.5" fill="#fff" opacity=".6"/>`
  };
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
  };
  return (p) => {
    const draw = A[p.id];
    if (!draw) return null;
    const bg = shade(p.color, 0.82);
    return '<svg viewBox="0 0 100 100" aria-hidden="true" style="width:70%;height:70%;opacity:1">' + draw(p.color, shade(p.color, -0.45)) + '</svg>|' + bg + '|' + shade(p.color, -0.45);
  };
})();
