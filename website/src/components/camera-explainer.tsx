/* ── A Camera for Bits — the film/BitGraph explainer diagram ──
   One source of truth for the six paired stages (film photography above,
   BitGraph below, the comparison IS the adjacency), rendered on the home
   page below the camera and on /camera as a standalone shareable page.
   Ported from the design-tool export; film row keeps its warm browns on
   purpose (the analog-vs-digital contrast is the piece's device). */

export function CameraExplainer() {
  return (
    <section className="bgx">
      <style>{`
        .bgx .cell { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; position: relative; z-index: 1; }
        .bgx .cell h3 { font-size: 18px; font-weight: 700; margin: 0; }
        .bgx .cell p { font-size: 15px; line-height: 1.5; color: #374151; max-width: 100%; text-wrap: balance; margin: 0; }
        .bgx .cell p strong { color: #111827; }
        .bgx .film h3 .n { color: #8F5F2F; }
        .bgx .bit h3 .n { color: #0065A4; }
        .bgx .pair { display: grid; grid-template-columns: 1fr 44px 1fr; align-items: start; padding: 26px 0; }
        .bgx .mid { align-self: center; height: 2px; background: #d0d5dd; margin-top: -40px; }
        .bgx .icon { height: auto; min-height: 96px; display: flex; align-items: center; justify-content: center; }
        .bgx .icon svg { width: 100%; max-width: 200px; height: auto; }
        .bgx .key-stage { background: #e8eef4; margin: 0 -16px; padding: 26px 16px; }
      `}</style>
      <div className="pairs">
            <div className="key-stage">
              <div className="pair" style={{ padding: 0 }}>
                <div className="cell film">
                  <div className="icon">
                    <svg viewBox="0 0 220 130">
                      <rect x="8" y="33" width="204" height="64" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2.5"></rect>
                      <line x1="16" y1="41" x2="206" y2="41" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
                      <line x1="16" y1="89" x2="206" y2="89" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
                      <rect x="20" y="48" width="52" height="34" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
                      <path d="M26 78 L38 60 L46 70 L52 63 L62 78 Z" fill="#8F5F2F"></path>
                      <circle cx="58" cy="56" r="4" fill="#8F5F2F"></circle>
                      <rect x="84" y="48" width="52" height="34" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2" strokeDasharray="6 5"></rect>
                      <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
                      <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#8F5F2F">BLANK · IN THE GATE</text>
                    </svg>
                  </div>
                  <h3><span className="n">1 · </span>The unused frame</h3>
                  <p>A blank frame is loaded in the gate. <strong>It exists before any light reaches it.</strong></p>
                </div>
                <div className="mid"></div>
                <div className="cell bit">
                  <div className="icon">
                    <svg viewBox="0 0 220 130">
                      <line x1="72" y1="65" x2="84" y2="65" stroke="#0065A4" strokeWidth="2"></line>
                      <line x1="136" y1="65" x2="148" y2="65" stroke="#d0d5dd" strokeWidth="2"></line>
                      <rect x="20" y="48" width="52" height="34" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
                      <text x="46" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#0065A4">#8a2f</text>
                      <rect x="84" y="48" width="52" height="34" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2" strokeDasharray="6 5"></rect>
                      <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2"></rect>
                      <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#0065A4">UNUSED · t₀</text>
                    </svg>
                  </div>
                  <h3><span className="n">1 · </span>The unused frame</h3>
                  <p>A blank digital frame is created, one of a kind. <strong>It exists before any file is bound to it.</strong></p>
                </div>
              </div>
            </div>

            <div className="pair">
              <div className="cell film">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <circle cx="110" cy="65" r="20" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></circle>
                    <g stroke="#8F5F2F" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="140" y1="65" x2="154" y2="65"></line><line x1="80" y1="65" x2="66" y2="65"></line>
                      <line x1="110" y1="35" x2="110" y2="21"></line><line x1="110" y1="95" x2="110" y2="109"></line>
                      <line x1="131" y1="86" x2="141" y2="96"></line><line x1="131" y1="44" x2="141" y2="34"></line>
                      <line x1="89" y1="86" x2="79" y2="96"></line><line x1="89" y1="44" x2="79" y2="34"></line>
                    </g>
                  </svg>
                </div>
                <h3><span className="n">2 · </span>Light</h3>
                <p>Light fills the world, unrecorded.</p>
              </div>
              <div className="mid"></div>
              <div className="cell bit">
                <div className="icon">
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
                </div>
                <h3><span className="n">2 · </span>Bits</h3>
                <p>Ones and zeros are everywhere, unwitnessed.</p>
              </div>
            </div>

            <div className="pair">
              <div className="cell film">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <g stroke="#8F5F2F" strokeWidth="2" strokeLinecap="round">
                      <line x1="25" y1="40" x2="97" y2="40"></line><line x1="25" y1="65" x2="97" y2="65"></line><line x1="25" y1="90" x2="97" y2="90"></line>
                      <line x1="123" y1="40" x2="178" y2="64"></line><line x1="123" y1="65" x2="178" y2="65"></line><line x1="123" y1="90" x2="178" y2="66"></line>
                    </g>
                    <path d="M110 22 C124 44 124 86 110 108 C96 86 96 44 110 22 Z" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></path>
                    <circle cx="182" cy="65" r="4.5" fill="#8F5F2F"></circle>
                  </svg>
                </div>
                <h3><span className="n">3 · </span>Lens</h3>
                <p>The lens gathers it toward a single point.</p>
              </div>
              <div className="mid"></div>
              <div className="cell bit">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <path d="M77 14 L121 14 L143 36 L143 112 L77 112 Z" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2.5" strokeLinejoin="round"></path>
                    <path d="M121 14 L121 36 L143 36" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2.5" strokeLinejoin="round"></path>
                    <g stroke="#9CBCD6" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="89" y1="52" x2="131" y2="52"></line><line x1="89" y1="64" x2="131" y2="64"></line><line x1="89" y1="76" x2="119" y2="76"></line>
                    </g>
                    <text x="110" y="100" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="13" fontWeight="600" fill="#0065A4">#3f9c…</text>
                  </svg>
                </div>
                <h3><span className="n">3 · </span>The file</h3>
                <p>A file gathers them into one exact arrangement, condensed to a short code: its fingerprint.</p>
              </div>
            </div>

            <div className="pair">
              <div className="cell film">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <rect x="48" y="42" width="124" height="62" rx="10" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2.5"></rect>
                    <rect x="93" y="30" width="34" height="14" rx="4" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></rect>
                    <circle cx="110" cy="73" r="17" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2.5"></circle>
                    <circle cx="110" cy="73" r="7" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2"></circle>
                    <line x1="2" y1="73" x2="76" y2="73" stroke="#8F5F2F" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round"></line>
                    <path d="M78 67.5 L87 73 L78 78.5 Z" fill="#8F5F2F"></path>
                  </svg>
                </div>
                <h3><span className="n">4 · </span>The dark chamber</h3>
                <p>The sealed space where exposure happens. Light enters only through the lens.</p>
              </div>
              <div className="mid"></div>
              <div className="cell bit">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <rect x="48" y="52" width="124" height="52" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2.5"></rect>
                    <path d="M100 44 L100 34 A10 10 0 0 1 120 34 L120 44" fill="none" stroke="#0065A4" strokeWidth="2.5"></path>
                    <rect x="92" y="44" width="36" height="26" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2.5"></rect>
                    <circle cx="110" cy="56" r="3.5" fill="#0065A4"></circle>
                    <line x1="2" y1="78" x2="76" y2="78" stroke="#0065A4" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round"></line>
                    <path d="M78 72.5 L87 78 L78 83.5 Z" fill="#0065A4"></path>
                  </svg>
                </div>
                <h3><span className="n">4 · </span>The sealed box</h3>
                <p>The sealed process where capture happens. Only the fingerprint enters, along one defined path.</p>
              </div>
            </div>

            <div className="pair">
              <div className="cell film">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <line x1="95" y1="18" x2="134" y2="18" stroke="#8F5F2F" strokeWidth="2" strokeLinecap="round"></line>
                    <path d="M133 12.5 L142 18 L133 23.5 Z" fill="#8F5F2F"></path>
                    <rect x="8" y="33" width="204" height="64" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2.5"></rect>
                    <line x1="16" y1="41" x2="206" y2="41" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
                    <line x1="16" y1="89" x2="206" y2="89" stroke="#DCCDB8" strokeWidth="5" strokeDasharray="6 11"></line>
                    <rect x="20" y="48" width="52" height="34" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
                    <path d="M26 78 L38 60 L46 70 L52 63 L62 78 Z" fill="#8F5F2F"></path>
                    <rect x="84" y="48" width="52" height="34" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="3"></rect>
                    <path d="M90 78 L102 60 L110 70 L116 63 L126 78 Z" fill="#8F5F2F"></path>
                    <circle cx="122" cy="56" r="4" fill="#8F5F2F"></circle>
                    <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2" strokeDasharray="6 5"></rect>
                    <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#8F5F2F">EXPOSED</text>
                  </svg>
                </div>
                <h3><span className="n">5 · </span>The exposed frame</h3>
                <p>Light strikes the waiting frame once. The film advances. There is no going back.</p>
              </div>
              <div className="mid"></div>
              <div className="cell bit">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <line x1="95" y1="33" x2="134" y2="33" stroke="#0065A4" strokeWidth="2" strokeLinecap="round"></line>
                    <path d="M133 27.5 L142 33 L133 38.5 Z" fill="#0065A4"></path>
                    <line x1="72" y1="65" x2="84" y2="65" stroke="#0065A4" strokeWidth="2"></line>
                    <line x1="136" y1="65" x2="148" y2="65" stroke="#0065A4" strokeWidth="2"></line>
                    <rect x="20" y="48" width="52" height="34" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
                    <text x="46" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#0065A4">#8a2f</text>
                    <rect x="84" y="48" width="52" height="34" fill="#D9E7F2" stroke="#0065A4" strokeWidth="3"></rect>
                    <text x="110" y="70" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#0065A4">#3f9c</text>
                    <rect x="148" y="48" width="52" height="34" fill="#FFFFFF" stroke="#d0d5dd" strokeWidth="2" strokeDasharray="6 5"></rect>
                    <text x="110" y="118" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="0.14em" fill="#0065A4">EXPOSED · t₁</text>
                  </svg>
                </div>
                <h3><span className="n">5 · </span>The exposed frame</h3>
                <p>The fingerprint exposes the waiting frame once. The chain advances. There is no going back.</p>
              </div>
            </div>

            <div className="pair">
              <div className="cell film">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <rect x="58" y="18" width="104" height="94" fill="#FFFFFF" stroke="#8F5F2F" strokeWidth="2.5"></rect>
                    <rect x="68" y="28" width="84" height="58" fill="#F2E7D8" stroke="#8F5F2F" strokeWidth="2"></rect>
                    <path d="M76 86 L96 58 L108 72 L116 63 L130 86 Z" fill="#8F5F2F"></path>
                    <circle cx="138" cy="42" r="6" fill="#8F5F2F"></circle>
                  </svg>
                </div>
                <h3><span className="n">= </span>A photograph</h3>
                <p>This scene, in this frame, at this moment.</p>
              </div>
              <div className="mid"></div>
              <div className="cell bit">
                <div className="icon">
                  <svg viewBox="0 0 220 130">
                    <rect x="58" y="18" width="104" height="94" fill="#FFFFFF" stroke="#0065A4" strokeWidth="2.5"></rect>
                    <rect x="68" y="28" width="84" height="58" fill="#D9E7F2" stroke="#0065A4" strokeWidth="2"></rect>
                    <circle cx="138" cy="42" r="6" fill="#0065A4"></circle>
                    <path d="M135.2 42.2 L137.3 44.3 L141 39.8" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"></path>
                    <text x="100" y="50" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9.5" letterSpacing="0.08em" fill="#0065A4" opacity="0.5">10110010</text>
                    <text x="110" y="71" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="14" fontWeight="600" fill="#0065A4">#3f9c…</text>
                  </svg>
                </div>
                <h3><span className="n">= </span>A BitGraph</h3>
                <p>This file, in this frame, at this moment.</p>
              </div>
            </div>
          </div>
    </section>
  );
}
