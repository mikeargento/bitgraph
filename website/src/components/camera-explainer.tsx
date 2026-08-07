/* ── A Camera for Bits — the film/BitGraph explainer diagram ──
   Six paired stages (film photography left, BitGraph right; the comparison
   IS the adjacency), opening /docs/overview under "The frame exists first."
   The film row keeps its warm browns on purpose: the analog-vs-digital
   contrast is the piece's device.

   Layout: each pair is ONE grid with two rows. Row one is the two glyphs
   with the "=" between them, so the equals sign centers on the artwork
   exactly, by construction (it used to hang off a magic -40px offset tuned
   for a smaller scale, and drifted whenever the size moved). Row two is the
   captions. Glyphs are capped at 264px: full-bleed (~334px) was tried
   2026-08-06 and read huge, with 4px strokes and blown-up in-glyph labels;
   264 keeps the enlarged presence at drawing-scale line weights. */

const S = {
  filmFrame: (
    <svg viewBox="0 0 220 130">
      <line x1="14" y1="39" x2="206" y2="39" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
      <line x1="14" y1="91" x2="206" y2="91" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
      <rect x="20" y="48" width="52" height="34" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
      <path d="M26 78 L38 60 L46 70 L52 63 L62 78 Z" fill="#8F5F2F"></path>
      <circle cx="58" cy="56" r="4" fill="#8F5F2F"></circle>
      <rect x="84" y="48" width="52" height="34" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2" strokeDasharray="6 5"></rect>
      <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
      <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#8F5F2F">UNEXPOSED</text>
    </svg>
  ),
  bitFrame: (
    <svg viewBox="0 0 220 130">
      <line x1="72" y1="65" x2="84" y2="65" stroke="#0065A4" strokeWidth="2"></line>
      <line x1="136" y1="65" x2="148" y2="65" stroke="#d0d5dd" strokeWidth="2"></line>
      <rect x="20" y="48" width="52" height="34" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
      <text x="46" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#0065A4">#8a2f</text>
      <rect x="84" y="48" width="52" height="34" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2" strokeDasharray="6 5"></rect>
      <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
      <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#0065A4">UNEXPOSED</text>
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 220 130">
      <circle cx="110" cy="65" r="20" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></circle>
      <g stroke="#8F5F2F" strokeWidth="2.5" strokeLinecap="round">
        <line x1="140" y1="65" x2="154" y2="65"></line><line x1="80" y1="65" x2="66" y2="65"></line>
        <line x1="110" y1="35" x2="110" y2="21"></line><line x1="110" y1="95" x2="110" y2="109"></line>
        <line x1="131" y1="86" x2="141" y2="96"></line><line x1="131" y1="44" x2="141" y2="34"></line>
        <line x1="89" y1="86" x2="79" y2="96"></line><line x1="89" y1="44" x2="79" y2="34"></line>
      </g>
    </svg>
  ),
  bits: (
    <svg viewBox="0 0 220 130">
      <g fontFamily="IBM Plex Mono, monospace" fill="#0065A4" fontWeight="500" transform="translate(0,-5)">
        <text x="62" y="42" fontSize="20">1</text><text x="96" y="30" fontSize="15" opacity="0.55">0</text>
        <text x="128" y="48" fontSize="22">0</text><text x="158" y="34" fontSize="14" opacity="0.45">1</text>
        <text x="46" y="76" fontSize="15" opacity="0.5">0</text><text x="84" y="70" fontSize="18">1</text>
        <text x="116" y="82" fontSize="14" opacity="0.5">1</text><text x="148" y="72" fontSize="20">0</text>
        <text x="66" y="106" fontSize="14" opacity="0.45">1</text><text x="100" y="112" fontSize="19">0</text>
        <text x="134" y="104" fontSize="15" opacity="0.55">1</text><text x="164" y="110" fontSize="16" opacity="0.7">0</text>
      </g>
    </svg>
  ),
  lens: (
    <svg viewBox="0 0 220 130">
      <g stroke="#8F5F2F" strokeWidth="2" strokeLinecap="round">
        <line x1="25" y1="40" x2="97" y2="40"></line><line x1="25" y1="65" x2="97" y2="65"></line><line x1="25" y1="90" x2="97" y2="90"></line>
        <line x1="123" y1="40" x2="178" y2="64"></line><line x1="123" y1="65" x2="178" y2="65"></line><line x1="123" y1="90" x2="178" y2="66"></line>
      </g>
      <path d="M110 22 C124 44 124 86 110 108 C96 86 96 44 110 22 Z" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></path>
      <circle cx="182" cy="65" r="4.5" fill="#8F5F2F"></circle>
    </svg>
  ),
  file: (
    <svg viewBox="0 0 220 130">
      <path d="M77 14 L121 14 L143 36 L143 112 L77 112 Z" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2.5" strokeLinejoin="round"></path>
      <path d="M121 14 L121 36 L143 36" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2.5" strokeLinejoin="round"></path>
      <g stroke="#9CBCD6" strokeWidth="2.5" strokeLinecap="round">
        <line x1="89" y1="52" x2="131" y2="52"></line><line x1="89" y1="64" x2="131" y2="64"></line><line x1="89" y1="76" x2="119" y2="76"></line>
      </g>
      <text x="110" y="100" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="13" fontWeight="600" fill="#0065A4">#3f9c…</text>
    </svg>
  ),
  darkChamber: (
    <svg viewBox="0 0 220 130">
      <line x1="2" y1="73" x2="12" y2="73" stroke="#8F5F2F" strokeWidth="2" strokeLinecap="round"></line>
      <path d="M11 67.5 L20 73 L11 78.5 Z" fill="#8F5F2F"></path>
      <rect x="30" y="40" width="160" height="66" rx="10" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2.5"></rect>
      <rect x="96" y="28" width="28" height="14" rx="4" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></rect>
      <ellipse cx="30" cy="73" rx="5" ry="11" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></ellipse>
      <line x1="40" y1="51" x2="180" y2="51" stroke="#DCCDB8" strokeWidth="4" strokeDasharray="5 9"></line>
      <line x1="40" y1="95" x2="180" y2="95" stroke="#DCCDB8" strokeWidth="4" strokeDasharray="5 9"></line>
      <rect x="48" y="60" width="36" height="26" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
      <path d="M52 82 L59 69 L64 75 L68 71 L75 82 Z" fill="#8F5F2F"></path>
      <circle cx="75" cy="66.5" r="2.5" fill="#8F5F2F"></circle>
      <rect x="92" y="60" width="36" height="26" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2" strokeDasharray="5 4"></rect>
      <rect x="136" y="60" width="36" height="26" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
    </svg>
  ),
  sealedBox: (
    <svg viewBox="0 0 220 130">
      <line x1="2" y1="73" x2="12" y2="73" stroke="#0065A4" strokeWidth="2" strokeLinecap="round"></line>
      <path d="M11 67.5 L20 73 L11 78.5 Z" fill="#0065A4"></path>
      <rect x="30" y="40" width="160" height="66" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2.5"></rect>
      <path d="M102 26 L102 18 A8 8 0 0 1 118 18 L118 26" fill="none" stroke="#0065A4" strokeWidth="2.5"></path>
      <rect x="95" y="26" width="30" height="18" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2.5"></rect>
      <circle cx="110" cy="35" r="2.5" fill="#0065A4"></circle>
      <rect x="25" y="62" width="10" height="22" rx="3" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
      <line x1="84" y1="73" x2="92" y2="73" stroke="#0065A4" strokeWidth="2"></line>
      <line x1="128" y1="73" x2="136" y2="73" stroke="#d0d5dd" strokeWidth="2"></line>
      <rect x="48" y="60" width="36" height="26" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
      <text x="66" y="77" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9.5" fontWeight="600" fill="#0065A4">#8a2f</text>
      <rect x="92" y="60" width="36" height="26" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2" strokeDasharray="5 4"></rect>
      <rect x="136" y="60" width="36" height="26" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
    </svg>
  ),
  exposedFilm: (
    <svg viewBox="0 0 220 130">
      <line x1="95" y1="21" x2="134" y2="21" stroke="#8F5F2F" strokeWidth="2" strokeLinecap="round"></line>
      <path d="M133 15.5 L142 21 L133 26.5 Z" fill="#8F5F2F"></path>
      <line x1="14" y1="39" x2="206" y2="39" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
      <line x1="14" y1="91" x2="206" y2="91" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
      <rect x="20" y="48" width="52" height="34" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
      <path d="M26 78 L38 60 L46 70 L52 63 L62 78 Z" fill="#8F5F2F"></path>
      <circle cx="58" cy="56" r="4" fill="#8F5F2F"></circle>
      <rect x="84" y="48" width="52" height="34" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
      <path d="M90 78 L102 60 L110 70 L116 63 L126 78 Z" fill="#8F5F2F"></path>
      <circle cx="122" cy="56" r="4" fill="#8F5F2F"></circle>
      <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
      <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#8F5F2F">EXPOSED</text>
    </svg>
  ),
  exposedChain: (
    <svg viewBox="0 0 220 130">
      <line x1="95" y1="33" x2="134" y2="33" stroke="#0065A4" strokeWidth="2" strokeLinecap="round"></line>
      <path d="M133 27.5 L142 33 L133 38.5 Z" fill="#0065A4"></path>
      <line x1="72" y1="65" x2="84" y2="65" stroke="#0065A4" strokeWidth="2"></line>
      <line x1="136" y1="65" x2="148" y2="65" stroke="#d0d5dd" strokeWidth="2"></line>
      <rect x="20" y="48" width="52" height="34" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
      <text x="46" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#0065A4">#8a2f</text>
      <rect x="84" y="48" width="52" height="34" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
      <text x="110" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#0065A4">#3f9c</text>
      <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
      <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#0065A4">EXPOSED</text>
    </svg>
  ),
  photograph: (
    <svg viewBox="0 0 220 130">
      <rect x="58" y="18" width="104" height="94" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2.5"></rect>
      <rect x="68" y="28" width="84" height="58" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
      <path d="M76 86 L96 58 L108 72 L116 63 L130 86 Z" fill="#8F5F2F"></path>
      <circle cx="138" cy="42" r="6" fill="#8F5F2F"></circle>
    </svg>
  ),
  bitgraph: (
    <svg viewBox="0 0 220 130">
      <rect x="58" y="18" width="104" height="94" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2.5"></rect>
      <rect x="68" y="28" width="84" height="58" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
      <circle cx="138" cy="42" r="6" fill="#0065A4"></circle>
      <path d="M135.2 42.2 L137.3 44.3 L141 39.8" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"></path>
      <text x="100" y="50" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9.5" letterSpacing="0.08em" fill="#0065A4" opacity="0.5">10110010</text>
      <text x="110" y="71" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="14" fontWeight="600" fill="#0065A4">#3f9c…</text>
    </svg>
  ),
};

interface Half { n: string; title: string; text: string; art: React.ReactNode }

const PAIRS: Array<{ film: Half; bit: Half }> = [
  {
    film: { n: "1 · ", title: "The unused frame", text: "A blank frame is loaded in the gate. It exists before any light reaches it.", art: S.filmFrame },
    bit: { n: "1 · ", title: "The unused frame", text: "A blank digital frame is created, one of a kind. It exists before any file is bound to it.", art: S.bitFrame },
  },
  {
    film: { n: "2 · ", title: "Light", text: "Light fills the world, unrecorded.", art: S.sun },
    bit: { n: "2 · ", title: "Bits", text: "Ones and zeros are everywhere, unwitnessed.", art: S.bits },
  },
  {
    film: { n: "3 · ", title: "Lens", text: "The lens gathers it toward a single point.", art: S.lens },
    bit: { n: "3 · ", title: "The file", text: "A file gathers them into one exact arrangement, condensed to a short code: its fingerprint.", art: S.file },
  },
  {
    film: { n: "4 · ", title: "The dark chamber", text: "The sealed space where exposure happens. Light enters only through the lens.", art: S.darkChamber },
    bit: { n: "4 · ", title: "The sealed box", text: "The sealed process where capture happens. Only the fingerprint enters, along one defined path.", art: S.sealedBox },
  },
  {
    film: { n: "5 · ", title: "The exposed frame", text: "Light strikes the waiting frame once. The film advances. There is no going back.", art: S.exposedFilm },
    bit: { n: "5 · ", title: "The exposed frame", text: "The fingerprint exposes the waiting frame once. The chain advances. There is no going back.", art: S.exposedChain },
  },
  {
    film: { n: "= ", title: "A photograph", text: "This scene, in this frame, at this moment.", art: S.photograph },
    bit: { n: "= ", title: "A BitGraph", text: "This file, in this frame, at this moment.", art: S.bitgraph },
  },
];

export function CameraExplainer() {
  return (
    <section className="bgx">
      <style>{`
        .bgx .pair { display: grid; grid-template-columns: 1fr 44px 1fr; padding: 22px 0; }
        .bgx .glyph { display: flex; align-items: center; justify-content: center; min-height: 96px; }
        .bgx .glyph svg { width: min(100%, 264px); height: auto; display: block; }
        .bgx .mid { align-self: center; text-align: center; color: #c9ced6; font-size: 22px; font-weight: 600; line-height: 1; }
        .bgx .mid::after { content: "="; }
        .bgx .cap { margin-top: 10px; text-align: center; }
        .bgx .cap h3 { font-size: 17px; font-weight: 700; margin: 0 0 6px; color: #111827; }
        .bgx .cap p { font-size: 14px; line-height: 1.55; color: #374151; text-wrap: balance; margin: 0; }
        .bgx .film h3 .n { color: #8F5F2F; }
        .bgx .bit h3 .n { color: #0065A4; }
        @media (max-width: 560px) {
          .bgx .pair { grid-template-columns: 1fr 24px 1fr; }
          .bgx .cap h3 { font-size: min(17px, calc((45vw - 12px) / 11.2)); white-space: nowrap; }
          .bgx .cap p { font-size: 13px; }
        }
      `}</style>
      {PAIRS.map((p, i) => (
        <div className="pair" key={i} style={i === 0 ? { paddingTop: 0 } : undefined}>
          <div className="glyph">{p.film.art}</div>
          <div className="mid"></div>
          <div className="glyph">{p.bit.art}</div>
          <div className="cap film"><h3><span className="n">{p.film.n}</span>{p.film.title}</h3><p>{p.film.text}</p></div>
          <div></div>
          <div className="cap bit"><h3><span className="n">{p.bit.n}</span>{p.bit.title}</h3><p>{p.bit.text}</p></div>
        </div>
      ))}
    </section>
  );
}
