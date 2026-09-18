import { Arrow, Chip, Fig, Svg, T } from "./fig";

/**
 * Carrying the position inside the bytes. A new file is built from the
 * original plus a 32-byte commitment to the slot record; its fingerprint is
 * what gets committed. The original is never modified.
 */
export function FusedFigure() {
  const caption = (
    <>
      The commitment is SHA-256 over a fixed label, the hash of the signed slot record and the slot&rsquo;s nonce. It is derived on your device and only the commitment enters the new file, never the nonce. For formats whose decoders ignore trailing bytes (JPEG, PNG, GIF, TIFF, BMP, WebP) the commitment rides in a 48-byte trailer; for everything else the original is wrapped, unchanged, in a small tar container. Either way the original plus the proof rebuilds the new file byte for byte, so the new file need not be kept.
    </>
  );

  /* Two rows across the whole canvas (Mike, 2026-09-17: "its not using space right";
     the first drawing hugged the left, floated its note and left the right fifth empty).
     Row one is the sum, edge to edge: original + commitment = new file. Row two sits
     under it in the same columns: the note under the two inputs, the fingerprint chain
     under the result. */
  const wide = (
    <Svg w={960} h={216} title="Across the top: the original file's bytes, plus a 32-byte commitment derived from slot 4,201's record, equals the new file, the original followed by the commitment. Below the new file, its SHA-256 fingerprint, which is committed under the same slot. Below the two inputs: built on your device.">
      <rect className="box" x={0} y={50} width={300} height={54} />
      <T x={150} y={73} anchor="middle" cls="lbl-ink">original file</T>
      <T x={150} y={90} anchor="middle" cls="lbl" size={11}>unchanged, any age</T>

      <T x={330} y={84} anchor="middle" cls="lbl-ink" size={20}>+</T>

      <Chip cx={480} cy={20} text="slot #4,201" tone="w" />
      <Arrow d="M 480 31 L 480 48" tone="w" />
      <rect className="box" x={360} y={50} width={240} height={54} style={{ fill: "var(--tone-yellow)", stroke: "none" }} />
      <T x={480} y={73} anchor="middle" cls="lbl-ink">commitment</T>
      <T x={480} y={90} anchor="middle" cls="lbl" size={11}>32 bytes, from the slot record</T>

      <T x={630} y={84} anchor="middle" cls="lbl-ink" size={20}>=</T>

      <rect className="box" x={660} y={50} width={300} height={54} />
      <rect x={910} y={51} width={49} height={52} style={{ fill: "var(--tone-yellow)", stroke: "none" }} />
      <line x1={910} y1={50} x2={910} y2={104} style={{ stroke: "var(--line)" }} />
      <T x={785} y={73} anchor="middle" cls="lbl-ink">the new file</T>
      <T x={785} y={90} anchor="middle" cls="lbl" size={11}>original, then the commitment</T>
      <T x={935} y={81} anchor="middle" cls="lbl" size={10}>48 B</T>

      <T x={0} y={146} cls="lbl" size={12}>Built on your device. The new bytes could not have been finished before</T>
      <T x={0} y={164} cls="lbl" size={12}>the slot existed, because they contain a value derived from it.</T>

      <Arrow d="M 810 106 L 810 128" />
      <Chip cx={810} cy={142} text="SHA-256 fingerprint of the new file" />
      <Arrow d="M 810 154 L 810 176" />
      <T x={810} y={192} anchor="middle" cls="lbl-ink" size={11.5}>committed under slot #4,201,</T>
      <T x={810} y={208} anchor="middle" cls="lbl-ink" size={11.5}>the slot the commitment names</T>
    </Svg>
  );

  const narrow = (
    <Svg w={360} h={414} title="Stacked: the original file, plus a 32-byte commitment to the slot record, equals the new file, whose fingerprint is committed under the same slot.">
      <rect className="box" x={20} y={16} width={320} height={54} />
      <T x={180} y={39} anchor="middle" cls="lbl-ink">original file</T>
      <T x={180} y={56} anchor="middle" cls="lbl" size={11}>unchanged, any age</T>
      <T x={180} y={100} anchor="middle" cls="lbl-ink" size={20}>+</T>
      <rect className="box" x={20} y={116} width={320} height={54} style={{ fill: "var(--tone-yellow)", stroke: "none" }} />
      <T x={180} y={139} anchor="middle" cls="lbl-ink">commitment to slot #4,201</T>
      <T x={180} y={156} anchor="middle" cls="lbl" size={11}>32 bytes, derived here from the slot record</T>
      <T x={180} y={200} anchor="middle" cls="lbl-ink" size={20}>=</T>
      <rect className="box" x={20} y={216} width={320} height={54} />
      <rect x={290} y={217} width={49} height={52} style={{ fill: "var(--tone-yellow)", stroke: "none" }} />
      <line x1={290} y1={216} x2={290} y2={270} style={{ stroke: "var(--line)" }} />
      <T x={155} y={239} anchor="middle" cls="lbl-ink">the new file</T>
      <T x={155} y={256} anchor="middle" cls="lbl" size={11}>original, then the commitment</T>
      <T x={314} y={247} anchor="middle" cls="lbl" size={10}>48 B</T>
      <Arrow d="M 180 272 L 180 306" />
      <Chip cx={180} cy={324} text="SHA-256 fingerprint of the new file" />
      <Arrow d="M 180 336 L 180 366" />
      <T x={180} y={386} anchor="middle" cls="lbl-ink" size={11.5}>committed under slot #4,201</T>
      <T x={180} y={404} anchor="middle" cls="lbl" size={11}>the slot the commitment names</T>
    </Svg>
  );

  return <Fig wide={wide} narrow={narrow} caption={caption} label="A new file that carries a commitment to its slot" />;
}
