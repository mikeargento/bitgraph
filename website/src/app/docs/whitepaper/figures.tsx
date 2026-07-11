/**
 * Whitepaper figures, drawn as a single SVG figure system.
 *
 * Shared visual grammar across all seven figures:
 *   - Brand-blue container = the atomic execution boundary (the invention).
 *   - Trust-green stroke   = authenticated durable state / valid successor.
 *   - Dashed grey stroke   = candidate / unauthenticated / free state.
 *   - Dashed red + cross   = structurally unreachable path.
 *   - Mono chips           = verification material (H, N, sigma).
 *
 * Wide figures set a minWidth and scroll horizontally on small screens,
 * matching how the site handles wide tables. Captions live in the section
 * files, not here.
 */

const C = {
  ink: "#111827",
  body: "#1f2937",
  mut: "#6b7280",
  line: "#d0d5dd",
  faint: "#9ca3af",
  white: "#ffffff",
  brand: "#0065A4",
  brandTint: "rgba(0,101,164,0.045)",
  green: "#10b981",
  greenTint: "rgba(16,185,129,0.07)",
  red: "#dc2626",
  redTint: "rgba(220,38,38,0.05)",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/* ── primitives ─────────────────────────────────────────────────────── */

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={`${id}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill={C.mut} />
      </marker>
      <marker id={`${id}-ab`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill={C.brand} />
      </marker>
      <marker id={`${id}-ar`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill={C.red} />
      </marker>
    </defs>
  );
}

function Box({
  x, y, w, h, title, sub, stroke = C.line, fill = C.white, dash, sw = 1, titleFill = C.body, mono, titleSize = 12.5,
}: {
  x: number; y: number; w: number; h: number; title: string; sub?: string | string[];
  stroke?: string; fill?: string; dash?: string; sw?: number; titleFill?: string; mono?: boolean; titleSize?: number;
}) {
  const subs = sub === undefined ? [] : Array.isArray(sub) ? sub : [sub];
  const cx = x + w / 2;
  const lineH = 12;
  const blockH = titleSize + 4 + subs.length * lineH;
  const ty = y + h / 2 - blockH / 2 + titleSize;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
      <text x={cx} y={ty} textAnchor="middle" fontSize={titleSize} fontWeight={600} fill={titleFill} fontFamily={mono ? MONO : undefined}>
        {title}
      </text>
      {subs.map((s, i) => (
        <text key={i} x={cx} y={ty + 13 + i * lineH} textAnchor="middle" fontSize={10} fill={C.mut}>
          {s}
        </text>
      ))}
    </g>
  );
}

function Chip({ x, y, w, h, label, sub }: { x: number; y: number; w: number; h: number; label: string; sub?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={C.white} stroke={C.line} strokeWidth={1} />
      <text x={x + w / 2} y={y + h / 2 + (sub ? -1 : 3.5)} textAnchor="middle" fontSize={10.5} fontFamily={MONO} fill={C.brand}>
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" fontSize={9} fill={C.mut}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Boundary({
  x, y, w, h, label = "ATOMIC EXECUTION BOUNDARY",
}: { x: number; y: number; w: number; h: number; label?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={C.brandTint} stroke={C.brand} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + 16} textAnchor="middle" fontSize={9} fontWeight={700} letterSpacing="0.09em" fill={C.brand}>
        {label}
      </text>
    </g>
  );
}

function Arrow({
  d, id, label, lx, ly, red, brand, dash, labelSize = 9.5,
}: { d: string; id: string; label?: string; lx?: number; ly?: number; red?: boolean; brand?: boolean; dash?: string; labelSize?: number }) {
  const stroke = red ? C.red : brand ? C.brand : C.mut;
  const marker = red ? `${id}-ar` : brand ? `${id}-ab` : `${id}-a`;
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray={dash} markerEnd={`url(#${marker})`} />
      {label && (
        <text x={lx} y={ly} textAnchor="middle" fontSize={labelSize} fill={red ? C.red : C.mut} letterSpacing="0.04em">
          {label}
        </text>
      )}
    </g>
  );
}

function ColTitle({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={11} fontWeight={700} letterSpacing="0.06em" fill={C.ink}>
      {text}
    </text>
  );
}

function Cross({ x, y, r = 5.5 }: { x: number; y: number; r?: number }) {
  return (
    <g stroke={C.red} strokeWidth={1.6} strokeLinecap="round">
      <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} />
      <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} />
    </g>
  );
}

function Check({ x, y, color = C.green }: { x: number; y: number; color?: string }) {
  return (
    <path d={`M ${x - 5.5} ${y} l 4 4.5 l 7.5 -9`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  );
}

function Wrap({ minWidth, children, label }: { minWidth: number; children: React.ReactNode; label: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth }} role="img" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/* ── Figure 1: Token–Nonce duality ──────────────────────────────────── */

function DualityColumn({
  id, x, title, source, sourceSub, step1, artifactNote,
}: { id: string; x: number; title: string; source: string; sourceSub: string[]; step1: string; artifactNote: string }) {
  const cx = x + 115;
  return (
    <g>
      <ColTitle x={cx} y={34} text={title} />
      <Box x={x + 15} y={48} w={200} h={52} title={source} sub={sourceSub} />
      <Arrow id={id} d={`M ${cx} 100 L ${cx} 122`} />
      <Boundary x={x} y={126} w={230} h={196} />
      <Box x={x + 40} y={150} w={150} h={34} title={step1} stroke={C.brand} />
      <Arrow id={id} d={`M ${cx} 184 L ${cx} 200`} brand />
      <Box x={x + 40} y={204} w={150} h={34} title={title.startsWith("TOTA") ? "Bind (H, Tₖ)" : "Bind (H, N)"} stroke={C.brand} />
      <Arrow id={id} d={`M ${cx} 238 L ${cx} 254`} brand />
      <Box x={x + 40} y={258} w={150} h={34} title="Commit" stroke={C.brand} />
      <text x={cx} y={312} textAnchor="middle" fontSize={9} fill={C.brand} letterSpacing="0.05em">
        one indivisible transition
      </text>
      <Arrow id={id} d={`M ${cx} 322 L ${cx} 344`} />
      <Box x={x + 15} y={348} w={200} h={46} title="Authenticated Artifact" stroke={C.green} sw={1.5} />
      <Check x={x + 32} y={371} />
      <text x={cx} y={412} textAnchor="middle" fontSize={10} fill={C.mut}>
        {artifactNote}
      </text>
    </g>
  );
}

export function Figure1() {
  const id = "f1";
  return (
    <Wrap minWidth={560} label="Token–nonce duality: TOTA token consumption and BitGraph boundary-fresh generation enforce the same injective genesis">
      <svg viewBox="0 0 680 430" width="100%" style={{ display: "block" }}>
        <Defs id={id} />
        <DualityColumn
          id={id} x={20} title="TOTA: TOKEN CONSUMPTION"
          source="Token Pool" sourceSub={["T₁, T₂, … Tₙ", "finite pool, depleted by use"]}
          step1="Consume Tₖ" artifactNote="1 token → 1 artifact"
        />
        <DualityColumn
          id={id} x={430} title="BITGRAPH: BOUNDARY-FRESH"
          source="Freshness Source" sourceSub={["CSPRNG", "inexhaustible, consumed on generation"]}
          step1="Generate N" artifactNote="1 nonce → 1 artifact"
        />
        <text x={340} y={224} textAnchor="middle" fontSize={30} fontWeight={300} fill={C.mut}>{"≡"}</text>
        <text x={340} y={244} textAnchor="middle" fontSize={9.5} fill={C.mut}>same injective</text>
        <text x={340} y={256} textAnchor="middle" fontSize={9.5} fill={C.mut}>genesis (Def. 7.5)</text>
      </svg>
    </Wrap>
  );
}

/* ── Figure 2: Atomic Causality vs separated steps ──────────────────── */

export function Figure2() {
  const id = "f2";
  const lx = 30, lw = 250, lcx = lx + lw / 2;
  const rcx = 530;
  return (
    <Wrap minWidth={560} label="Atomic causality: authorize, bind, and commit fused in one boundary versus separated steps with observable gaps">
      <svg viewBox="0 0 680 400" width="100%" style={{ display: "block" }}>
        <Defs id={id} />

        {/* Left: atomic */}
        <ColTitle x={lcx} y={34} text="BITGRAPH: ATOMIC CAUSALITY" />
        <Boundary x={lx} y={48} w={lw} h={252} />
        <Box x={lx + 50} y={78} w={150} h={38} title="1. Authorize" stroke={C.brand} />
        <Arrow id={id} d={`M ${lcx} 116 L ${lcx} 138`} brand />
        <Box x={lx + 50} y={142} w={150} h={38} title="2. Bind" stroke={C.brand} />
        <Arrow id={id} d={`M ${lcx} 180 L ${lcx} 202`} brand />
        <Box x={lx + 50} y={206} w={150} h={38} title="3. Commit" stroke={C.brand} />
        {/* atomic bracket */}
        <path d={`M ${lx + 222} 78 L ${lx + 232} 78 L ${lx + 232} 244 L ${lx + 222} 244`} fill="none" stroke={C.brand} strokeWidth={1} />
        <text x={lx + 240} y={155} fontSize={9} fill={C.brand} transform={`rotate(90 ${lx + 240} 155)`} textAnchor="middle" letterSpacing="0.04em">
          no observable intermediate state
        </text>
        <text x={lcx} y={286} textAnchor="middle" fontSize={9.5} fill={C.mut}>
          partial completion yields nothing (fail-closed)
        </text>
        <Check x={lcx - 72} y={330} />
        <text x={lcx + 8} y={334} textAnchor="middle" fontSize={10.5} fill={C.body} fontWeight={600}>
          single atomic operation
        </text>

        {/* Right: separated */}
        <ColTitle x={rcx} y={34} text="NON-BITGRAPH: SEPARATED STEPS" />
        <Box x={rcx - 75} y={60} w={150} h={38} title="1. Authorize" />
        <Arrow id={id} d={`M ${rcx} 98 L ${rcx} 136`} />
        <Box x={rcx - 75} y={140} w={150} h={38} title="2. Bind" />
        <Arrow id={id} d={`M ${rcx} 178 L ${rcx} 216`} />
        <Box x={rcx - 75} y={220} w={150} h={38} title="3. Commit" />
        {/* gap annotations with adversary probes */}
        <Arrow id={id} d={`M 648 117 L 588 117`} red dash="4 3" />
        <text x={655} y={106} textAnchor="end" fontSize={9} fill={C.red}>observable gap</text>
        <text x={655} y={128} textAnchor="end" fontSize={9} fill={C.red}>(TOCTOU)</text>
        <Arrow id={id} d={`M 648 197 L 588 197`} red dash="4 3" />
        <text x={655} y={186} textAnchor="end" fontSize={9} fill={C.red}>observable gap</text>
        <text x={655} y={208} textAnchor="end" fontSize={9} fill={C.red}>(TOCTOU)</text>
        <Cross x={rcx - 52} y={330} />
        <text x={rcx + 10} y={334} textAnchor="middle" fontSize={10.5} fill={C.mut} fontWeight={600}>
          gaps allow bypass
        </text>
        <text x={rcx} y={286} textAnchor="middle" fontSize={9.5} fill={C.mut}>
          separate API calls, externally observable
        </text>
      </svg>
    </Wrap>
  );
}

/* ── Figure 3: State transition model ───────────────────────────────── */

export function Figure3() {
  const id = "f3";
  return (
    <Wrap minWidth={560} label="State transition model: candidate state reaches authenticated durable state only through the protected commit interface; the direct path does not exist">
      <svg viewBox="0 0 680 262" width="100%" style={{ display: "block" }}>
        <Defs id={id} />
        <Box x={30} y={72} w={160} h={66} title="Candidate Digital State" sub={["created freely", "may be adversarial"]} dash="5 4" stroke={C.faint} />
        <Arrow id={id} d={`M 190 105 L 252 105`} label="submit" lx={221} ly={96} />
        <Boundary x={256} y={44} w={190} h={124} />
        <Box x={276} y={94} w={150} h={52} title="Protected Commit" sub="Interface" stroke={C.brand} />
        <Arrow id={id} d={`M 446 105 L 508 105`} label="finalize" lx={477} ly={96} />
        <Box x={512} y={72} w={148} h={66} title="Authenticated" sub={["Durable State", "carries verification material"]} stroke={C.green} sw={1.5} />
        <Check x={528} y={82} />
        {/* blocked direct path */}
        <path d="M 110 142 C 150 230, 530 230, 584 142" fill="none" stroke={C.red} strokeWidth={1.25} strokeDasharray="5 4" markerEnd={`url(#${id}-ar)`} />
        <Cross x={347} y={208} />
        <text x={347} y={236} textAnchor="middle" fontSize={9.5} fill={C.red}>
          no direct path: constructor completeness (Inv. 7.3)
        </text>
      </svg>
    </Wrap>
  );
}

/* ── Figure 4: Verification independence ────────────────────────────── */

export function Figure4() {
  const id = "f4";
  return (
    <Wrap minWidth={600} label="Verification independence from proof transport: portable proof and reference lookup both validate against the same trust anchors">
      <svg viewBox="0 0 680 330" width="100%" style={{ display: "block" }}>
        <Defs id={id} />
        <Boundary x={20} y={30} w={170} h={74} label="BITGRAPH BOUNDARY" />
        <Box x={40} y={52} w={130} h={38} title="Genesis" stroke={C.brand} />
        <Arrow id={id} d={`M 190 67 L 250 67`} label="finalize" lx={220} ly={58} />
        <Box x={254} y={40} w={130} h={54} title="Artifact" sub="content bytes" />
        <Arrow id={id} d={`M 105 104 L 105 176`} label="store proof" lx={105} ly={144} labelSize={9} />
        <rect x={20} y={180} width={170} height={70} fill={C.white} stroke={C.line} />
        <text x={105} y={203} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={C.body}>Reference Point</text>
        <Chip x={45} y={214} w={120} h={24} label="(H, N, σ)" />
        {/* distribution fan */}
        <Arrow id={id} d={`M 384 55 L 460 34`} label="distribute" lx={420} ly={30} labelSize={9} />
        <Arrow id={id} d={`M 384 80 L 460 112`} />
        <Box x={464} y={12} w={140} h={44} title="Copy (with proof)" titleSize={11.5} />
        <Box x={464} y={94} w={140} h={44} title="Copy (stripped)" sub="metadata removed" titleSize={11.5} />
        {/* converge to verifier */}
        <Arrow id={id} d={`M 534 56 L 534 68 L 622 68 L 622 177`} label="portable proof" lx={650} ly={128} labelSize={9} />
        <Arrow id={id} d={`M 534 138 L 534 176`} label="content hash" lx={492} ly={162} labelSize={9} />
        <Box x={464} y={180} w={190} h={70} title="Verifier" sub={["validates under the same", "accepted trust anchors"]} stroke={C.green} sw={1.5} />
        {/* reference lookup round trip */}
        <Arrow id={id} d={`M 464 224 L 200 224`} dash="4 3" label="lookup by H" lx={330} ly={215} labelSize={9} />
        <Arrow id={id} d={`M 200 238 L 464 238`} dash="4 3" label="(H, N, σ)" lx={330} ly={252} labelSize={9} />
        <text x={340} y={306} textAnchor="middle" fontSize={9.5} fill={C.mut}>
          both paths run identical checks; the reference point plays no role in enforcement
        </text>
      </svg>
    </Wrap>
  );
}

/* ── Figure 5: Verification structure ───────────────────────────────── */

export function Figure5() {
  const id = "f5";
  const rows = [
    { label: "H = hash(content)", to: 2 },
    { label: "N = boundary-fresh value", to: null },
    { label: "boundary_id, epoch, policy", to: 4 },
    { label: "σ = Sign_sk(H, N, metadata)", to: 3 },
  ];
  const steps = [
    "1. Recompute hash of content",
    "2. Verify H matches recomputed hash",
    "3. Validate signature under trusted key",
    "4. Check policy constraints",
  ];
  const rowY = (i: number) => 130 + i * 30;
  const stepY = (i: number) => 62 + i * 42;
  return (
    <Wrap minWidth={600} label="Verification structure: artifact fields feed specific verifier checks, ending in accept or reject">
      <svg viewBox="0 0 680 340" width="100%" style={{ display: "block" }}>
        <Defs id={id} />
        {/* left stack */}
        <rect x={30} y={30} width={250} height={26} fill={C.brandTint} stroke={C.line} />
        <text x={155} y={47} textAnchor="middle" fontSize={9.5} fontWeight={700} letterSpacing="0.08em" fill={C.mut}>AUTHENTICATED ARTIFACT</text>
        <Box x={30} y={56} w={250} h={30} title="content bytes" titleSize={11} />
        <rect x={30} y={100} width={250} height={26} fill={C.brandTint} stroke={C.line} />
        <text x={155} y={117} textAnchor="middle" fontSize={9.5} fontWeight={700} letterSpacing="0.08em" fill={C.mut}>VERIFICATION MATERIAL</text>
        {rows.map((r, i) => (
          <g key={i}>
            <rect x={30} y={rowY(i)} width={250} height={30} fill={C.white} stroke={C.line} />
            <text x={42} y={rowY(i) + 19} fontSize={10.5} fontFamily={MONO} fill={C.brand}>{r.label}</text>
          </g>
        ))}
        {/* field-to-check mappings */}
        <Arrow id={id} d={`M 280 71 C 340 71, 340 ${stepY(0) + 17}, 396 ${stepY(0) + 17}`} brand dash="2 3" />
        <Arrow id={id} d={`M 280 ${rowY(0) + 15} C 344 ${rowY(0) + 15}, 344 ${stepY(1) + 17}, 396 ${stepY(1) + 17}`} brand dash="2 3" />
        <Arrow id={id} d={`M 280 ${rowY(3) + 15} C 352 ${rowY(3) + 15}, 352 ${stepY(2) + 17}, 396 ${stepY(2) + 17}`} brand dash="2 3" />
        <Arrow id={id} d={`M 280 ${rowY(2) + 15} C 348 ${rowY(2) + 15}, 348 ${stepY(3) + 17}, 396 ${stepY(3) + 17}`} brand dash="2 3" />
        {/* verifier pipeline */}
        <text x={520} y={47} textAnchor="middle" fontSize={9.5} fontWeight={700} letterSpacing="0.08em" fill={C.mut}>VERIFIER</text>
        {steps.map((s, i) => (
          <g key={i}>
            <Box x={400} y={stepY(i)} w={240} h={34} title={s} titleSize={11} />
            {i < 3 && <Arrow id={id} d={`M 520 ${stepY(i) + 34} L 520 ${stepY(i) + 40}`} />}
          </g>
        ))}
        <Arrow id={id} d={`M 520 ${stepY(3) + 34} L 520 ${stepY(3) + 56}`} />
        {/* verdict */}
        <rect x={400} y={286} width={120} height={40} fill={C.greenTint} stroke={C.green} strokeWidth={1.5} />
        <Check x={438} y={306} />
        <text x={472} y={310} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={C.body}>Accept</text>
        <rect x={520} y={286} width={120} height={40} fill={C.white} stroke={C.line} />
        <Cross x={558} y={306} r={4.5} />
        <text x={592} y={310} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={C.mut}>Reject</text>
        <text x={155} y={306} textAnchor="middle" fontSize={9.5} fill={C.mut}>
          dotted lines: which field each check consumes
        </text>
      </svg>
    </Wrap>
  );
}

/* ── Figure 6: Enforced provenance chains ───────────────────────────── */

function ChainBoundary({ id, x, name, action, tuple, origin }: { id: string; x: number; name: string; action: string; tuple: string; origin: string }) {
  const cx = x + 72;
  return (
    <g>
      <Boundary x={x} y={58} w={144} h={168} label={name} />
      <Box x={x + 22} y={82} w={100} h={34} title={action} stroke={C.brand} />
      <Arrow id={id} d={`M ${cx} 116 L ${cx} 138`} brand />
      <Chip x={x + 14} y={142} w={116} h={34} label={tuple} sub={origin} />
      <text x={cx} y={214} textAnchor="middle" fontSize={9} fill={C.brand} letterSpacing="0.05em">
        enforced finalization
      </text>
    </g>
  );
}

export function Figure6() {
  const id = "f6";
  return (
    <Wrap minWidth={680} label="Enforced provenance chain: pre-existing content traverses three boundaries, each adding independent verification material">
      <svg viewBox="0 0 760 262" width="100%" style={{ display: "block" }}>
        <Defs id={id} />
        <Box x={10} y={108} w={104} h={68} title="Pre-existing" sub={["content", "unauthenticated"]} dash="5 4" stroke={C.faint} titleSize={11.5} />
        <Arrow id={id} d={`M 114 142 L 138 142`} />
        <ChainBoundary id={id} x={142} name="BOUNDARY A" action="Ingest" tuple="(H, N₁, σ₁)" origin="origin₁" />
        <Arrow id={id} d={`M 286 142 L 310 142`} />
        <ChainBoundary id={id} x={314} name="BOUNDARY B" action="Process" tuple="(H′, N₂, σ₂)" origin="origin₂" />
        <Arrow id={id} d={`M 458 142 L 482 142`} />
        <ChainBoundary id={id} x={486} name="BOUNDARY C" action="Publish" tuple="(H″, N₃, σ₃)" origin="origin₃" />
        <Arrow id={id} d={`M 630 142 L 654 142`} />
        <Box x={658} y={108} w={94} h={68} title="Authenticated" sub={["artifact", "3 enforced origins"]} stroke={C.green} sw={1.5} titleSize={11.5} />
        <text x={380} y={250} textAnchor="middle" fontSize={9.5} fill={C.mut}>
          each link requires traversal of a protected commit interface; none can be attached after the fact
        </text>
      </svg>
    </Wrap>
  );
}

/* ── Figure 7: Detect-after vs birth–death ──────────────────────────── */

export function Figure7() {
  const id = "f7";
  const lcx = 165, rcx = 505;
  return (
    <Wrap minWidth={560} label="Detect-after model forks then reconciles; birth–death semantics consumes the parent authority atomically so the fork is structurally unreachable">
      <svg viewBox="0 0 680 402" width="100%" style={{ display: "block" }}>
        <Defs id={id} />

        {/* Left: detect-after */}
        <ColTitle x={lcx} y={34} text="DETECT-AFTER MODEL" />
        <Box x={lcx - 75} y={50} w={150} h={40} title="Authority S₀" />
        <Arrow id={id} d={`M ${lcx - 20} 90 L ${lcx - 62} 138`} />
        <Arrow id={id} d={`M ${lcx + 20} 90 L ${lcx + 62} 138`} />
        <Box x={lcx - 130} y={142} w={110} h={38} title="S₁" sub="valid" titleSize={12} />
        <Box x={lcx + 20} y={142} w={110} h={38} title="S₁′" sub="also valid" titleSize={12} />
        <Arrow id={id} d={`M ${lcx - 75} 180 L ${lcx - 30} 232`} />
        <Arrow id={id} d={`M ${lcx + 75} 180 L ${lcx + 30} 232`} />
        <Box x={lcx - 95} y={236} w={190} h={52} title="Conflict detected" sub={["retrospective resolution", "consensus / arbitration"]} dash="5 4" stroke={C.faint} titleSize={11.5} />
        <text x={lcx} y={318} textAnchor="middle" fontSize={10} fill={C.mut} fontWeight={600}>
          fork now, detect later
        </text>

        {/* divider */}
        <Arrow id={id} d={`M 310 196 L 366 196`} />
        <text x={338} y={182} textAnchor="middle" fontSize={9} fill={C.mut}>BitGraph</text>
        <text x={338} y={214} textAnchor="middle" fontSize={9} fill={C.mut}>enforces</text>

        {/* Right: birth-death */}
        <ColTitle x={rcx} y={34} text="BIRTH–DEATH SEMANTICS" />
        <Box x={rcx - 75} y={50} w={150} h={40} title="Authority S₀" />
        <Arrow id={id} d={`M ${rcx} 90 L ${rcx} 112`} />
        <Boundary x={rcx - 105} y={116} w={210} h={130} />
        <rect x={rcx - 80} y={140} width={160} height={32} fill={C.redTint} stroke={C.red} strokeOpacity={0.45} />
        <text x={rcx} y={160} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.body}>Death: S{"₀"} consumed</text>
        <Arrow id={id} d={`M ${rcx} 172 L ${rcx} 194`} brand />
        <rect x={rcx - 80} y={198} width={160} height={32} fill={C.greenTint} stroke={C.green} strokeOpacity={0.6} />
        <text x={rcx} y={218} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.body}>Birth: S{"₁"} committed</text>
        {/* successors */}
        <Arrow id={id} d={`M ${rcx - 45} 246 L ${rcx - 60} 284`} />
        <Arrow id={id} d={`M ${rcx + 45} 246 L ${rcx + 60} 284`} red dash="5 4" />
        <Cross x={rcx + 54} y={266} r={4.5} />
        <Box x={rcx - 118} y={288} w={110} h={38} title="S₁" sub="valid" stroke={C.green} sw={1.5} titleSize={12} />
        <Box x={rcx + 8} y={288} w={110} h={38} title="S₁′" sub="never produced" dash="5 4" stroke={C.faint} titleSize={12} />
        <text x={rcx} y={358} textAnchor="middle" fontSize={10} fill={C.mut} fontWeight={600}>
          fork structurally unreachable
        </text>
        <text x={rcx} y={376} textAnchor="middle" fontSize={9} fill={C.mut}>
          within the enforcing boundary&apos;s trust envelope
        </text>
      </svg>
    </Wrap>
  );
}
