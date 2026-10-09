/**
 * bitgraph-art/14 (2026-10-08): version 13 with anatomical ears. The same person as bitgraph-art/11, /12 and /13 for
 * the same code (planV14 is planV11: the same stream, the same draws, the same integers), square, 2400 x 2400
 * recorded, the code carried as versions 8 to 13 carry it. Everything but the ear is version 13's. The ear (operator:
 * a flat oval pill stuck to the side of the head with a thick outline, reading as a thumb or a shell) is now:
 *  - Shaped: a template outline (EAR_R, a polar table round the template's centre) wider at the top and tapering to
 *    a lobe, 1.7 to 2 times as tall as wide (the plan's ear depth sets the width), its front edge attached to the
 *    head just behind the jaw hinge, its top halfway from the plan's ear top to the brow line, its height the plan's
 *    length x 1.15 (to about the nose base), tilted back 10 to 20 degrees (salt bits), standing off the head toward
 *    the back at 12 to 32 degrees (the plan's flare). A child's is smaller and rounder, an old person's a little
 *    larger with a longer lobe. The plan is unchanged.
 *  - Modelled: in the field, a relief over the template (the helix rim raised, the scapha a groove, the concha a
 *    bowl, the lobe thicker), so the light finds the ridges.
 *  - Drawn from its geometry at the output's resolution, as the eyes are (ear() in contours()): the outer rim heavy
 *    along the top and back, the lobe light, the front edge lost but for the tragus; the helix's inner edge (the
 *    rim's curl), the crus of the helix, the antihelix (the concha's rim in front, the scapha's behind, the
 *    triangular fossa between its crura), the tragus and the antitragus. Each line takes the light on the ear under
 *    it (lost and found) and swells as a burin line. The tone is engraved in curves that follow the ear's own rings
 *    (the outline's rings for the rim, scapha, fossa and lobe; the concha's own round the bowl), denser where darker:
 *    the concha darkest toward the canal, the scapha under the rim, the fossa light, the lobe lighter. Lines are
 *    added between lines as the tone deepens and dropped where the turn of the ear packs them closer than a hatch.
 *    The field's hatching never enters the ear.
 *  - Viewed from the head's pose, nothing by case: the ear's lateral face turned from the viewer (a frontal head)
 *    shows it edge-on, a narrow shape with its rim; the inner structure fades in as that face turns toward the
 *    viewer (three-quarter heads show the bowl and ridges, near-profile heads the whole ear). Hair in front of it
 *    hides it and cuts its lines where the hair's edge crosses (a depth test on the field at each point).
 *  - Standing off: short curves on the head or hair just behind the ear's back edge, darkest nearest it (the
 *    shadow in the gap).
 * The field's outline of the ear is drawn only where something else is nearer (hair over it, a cheek in front of a
 * turned head's far ear); the ear's own contour is the analytic one. A long fall's tuck follows the new ear.
 *
 * Ponytails (operator: "ponytails get effed up sometimes": a thin tube with a hard dark outline down the side of the
 * neck from behind the ear to the shoulder, ending in a knot, in front of the jaw line):
 *  - Each tail follows its own path (ponyPath()) and shows only behind the head and neck, but where it truly comes
 *    forward: a high tail rises over the crown and hangs behind the head and neck; a low one hangs against the back of
 *    the neck (a frontal head hides it); one over a shoulder passes behind the neck's base and the torso's top, comes
 *    over the near shoulder clear of the neck and lies on the chest below the collarbone.
 *  - The tail's edge is the hair's soft outline (lighter and lost in places), not a hard line; the strands carry the
 *    form; it tapers to a fine point and ends in loose strands, never a blunt end. A single braid over the shoulder
 *    takes the same way.
 *
 * The neck (operator: "kind of a wide neck", a straight column nearly as wide as the jaw, the head on a pillar): its
 * radius is set at draw time (neckRe in makeModel), the plan's thickness placing it at 0.62 to 0.75 of the face's
 * half-width at the jaw angle for an adult (0.6 to 0.68 for the youngest child), never over 0.8; it narrows a little
 * under the jaw and widens toward the shoulders on gentle curves (neckAt). The fillet, the collars and the turtleneck
 * follow the narrower neck, and the tails hang against its back. The jaw's underside shades the neck in a band just
 * under it, deeper on the shadow side; on a turned head a light line on the shadow side runs from behind the ear toward
 * the collarbone (the sternocleidomastoid).
 *
 * From bitgraph-art/13 (2026-10-08), engraved portraits, smoothed. Version 12's engraving is the base; version 13
 * changes:
 *  - The shadow edge on skin fades in with lines, the engraver's way: each stroke of the first two layers starts at
 *    its own threshold, and over a ramp of tone past it the spacing closes from 2.2 times to 1 and the width grows
 *    from a hairline, so the terminator is a gradual fade, not a band. (A hedcut stipple of the skin was sketched
 *    and built first the same day; the operator preferred the line: dots beside engraved hair read as two
 *    techniques, and stippled faces washed out at phone size.)
 *  - Outlines: every silhouette, region boundary and depth step is traced as chains (see outlines()): each node
 *    sits at the sub-pixel crossing of a smoothed side indicator between its two field pixels, the chains are
 *    smoothed along their length (ten passes of [1 2 1] / 4) and cut once by Chaikin, then drawn as burin lines.
 *    No outline is stepped on the field's pixels. A depth step is a jump against the slope on either side, not a
 *    steep slope.
 *  - The neck runs into the shoulders on a fillet (filletOf()); the chest rises to the neck's front at its base, so
 *    the neck never stands in front of a sunken chest; collars swell off the neck with a top edge that runs round it,
 *    and no garment region is an axis-aligned rectangle.
 *  - Hair: a long fall's front edge tucks behind the ear; the edge taper measures across the hairline (a steep side
 *    boundary lies flat on the cheek); the side hairline is a monotone cubic through its knots; the fall hangs from
 *    the skull's widest slice blended in over a band (it stepped out at the ear); short hair follows the head at the
 *    nape. The splat fills along a stretched surface between grid neighbours, so no crack opens down a turned head.
 *  - Eyes, drawn 1.3 x the plan's size (opening, ball, iris and pupil together; less where the face is narrow, a low
 *    brow rising up to 0.035 to make room) and in detail from their geometry at the output's resolution (eyes()): the
 *    iris as 72 radial fibres with a collarette, a limbal ring and crypts, darker under the lid; the pupil always one
 *    disc (the field's few pupil pixels had left small or lid-dropped eyes empty, and a catchlight near the pupil
 *    had made it a square speck); a crisp paper catchlight, a tiny second one on some draws; a gaze the lids or the
 *    nose would hide turned toward the opening's centre until 60% of the iris and the whole pupil show. The lids:
 *    the lash line with a second close line for the margin, fine curved lashes over its outer two thirds (fewer on
 *    a squarer jaw, a beard, a child), a few faint lower lashes, the lower margin a light line with one gap, the
 *    caruncle at the inner corner, a little shading in the white's corners, the crease kept between the lid and the
 *    brow, a soft line under the lower lid. A child's iris is larger for the opening.
 *  - Stray marks: no dark disc at the mouth's corners (with the line's end it read as a teardrop); nostrils smaller,
 *    bean-shaped and without a ring; specks and slivers of outline under a few field pixels are dropped; a shirt
 *    collar's top edge is a light broken line with no dark band under it (it read as a choker).
 * The face-tone rule is version 11's: the lit face is paper; the mouth zone and the lenses never toned.
 *
 * From version 12 (the engraving this is drawn over):
 *  - Density: the hatch spacing is version 11's divided by 1.75, the occupancy grid is 32 raster units, and the
 *    widths are scaled so the tone at arm's length matches version 11's.
 *  - The engraver's swelling line: every hatch stroke and every feature line thins to a hairline at both ends and
 *    swells through the middle (see swell()).
 *  - Lost and found edges: an outline takes its weight from the light on the surface on its inner side, falling
 *    toward a hairline where that surface faces the key light, breaking in places on the brightest silhouettes.
 *  - The eye: the sclera is never hatched; the iris keeps version 11's ring spacing; the pupil is one round disc.
 * Version 12's detail pass, kept:
 *  - Eyes: a crease above every eye past childhood (weight by age and the lid's weight); the iris as 32
 *    radial lines and two rings, swelling toward the rim, cut by the lids, the pupil and the catchlight;
 *    the pupil one round disc; the lower lid a light broken line; the upper lid heavier on its outer third.
 *  - Nose: the nostrils as small shaped darks on their pixels' principal axes, a lighter wing line, the tip's
 *    highlight paper.
 *  - Mouth: the upper lip in one layer of shadow tone, the lower lip paper with a short shadow under it.
 *  - Ears: the bowl in shadow.
 *  - Hair: a lighter band across the locks along an iso-light band of the shade, broken by a lattice noise;
 *    darker between locks; a few loose single hairs leave the silhouette.
 *  - Clothing: two to four fold lines at the shoulders and from the neckline; a darker band under the collar.
 *  - Plane switching (on the engraved surfaces): the core shadow's second layer runs at a fixed angle to its plane
 *    (the normal snapped to eighths of a turn), so the crossing switches where the plane does.
 * *  - Ground: a soft hatched vignette toward the plate's edges, darker on the shadow side, where the ground is
 *    bare; on a quarter of the draws (salt bits) a faint cast shadow of the figure away from the light.
 *  *
 * Everything is integer, as in version 11 (fixed point, the SIN table, isqrt, exp and ln tables). The
 * composition is version 11's in raster units (1/32 of a version 11 pixel), rasterised at 2 x 2 samples a
 * pixel at RS = 2 times the version 11 size for the recorded file, or at 2 S times for print.
 *
 * The code: a hidden grid of 16 x 16 tiles of 142 x 142 px; tile k (row-major) carries bit k, most
 * significant bit of byte 0 first, in its reading pixel (64 + 142c + 71, 64 + 142r + 71), never tinted,
 * never grained: the palette index covering most of its 2 x 2 samples (paper on a tie), drawn in that
 * colour's twin when the bit is 1. The centre snap rewrites the four samples under each reading pixel to
 * that majority index before the downsample, so the reading pixel is never a visible dot. decodeV14
 * reads the 256 pixels back.
 */
import { FRAME_V6 as FRAME, SIN_V6 as SIN, idiv } from "./commitment-art-v6.ts";
import { planV11, HAIR_NAMES_V11, EXPRESSION_NAMES_V11, AGE_BAND_NAMES_V11, GARMENT_NAMES_V11, ageBandV11, type V11Plan } from "./commitment-art-v11.ts";

type RGB = readonly [number, number, number];
/** The recorded scale: version 11's composition drawn twice the size. */
const RS = 2;
export const V14_WIDTH = 1200 * RS, V14_HEIGHT = 1200 * RS;
const OFF = 32, AW = 1136, AH = 1136, TW = 71, TH = 71, RX = 35, RY = 35;
/** Raster units a pixel (strokes, stamps, the plate mark), and the field at half resolution. */
const U = 32, AWU = AW * U, AHU = AH * U, FS = 2, FW = AW / FS, FH = AH / FS;
const Q = 65536;
const q = (x: number): number => Math.round(x * Q);
/** Every decimal constant of the drawing, q(x) once at load (the same integers as q(x) at each use). */
const QN_0_02 = q(-0.02);
const QN_0_04 = q(-0.04);
const QN_0_05 = q(-0.05);
const QN_0_08 = q(-0.08);
const QN_0_1 = q(-0.1);
const QN_0_15 = q(-0.15);
const QN_0_3 = q(-0.3);
const QN_0_35 = q(-0.35);
const QN_0_4 = q(-0.4);
const QN_0_45 = q(-0.45);
const QN_0_496 = q(-0.496);
const QN_0_5 = q(-0.5);
const QN_0_55 = q(-0.55);
const QN_0_6 = q(-0.6);
const Q_0_003 = q(0.003);
const Q_0_004 = q(0.004);
const Q_0_005 = q(0.005);
const Q_0_006 = q(0.006);
const Q_0_01 = q(0.01);
const Q_0_012 = q(0.012);
const Q_0_014 = q(0.014);
const Q_0_015 = q(0.015);
const Q_0_02 = q(0.02);
const Q_0_025 = q(0.025);
const Q_0_03 = q(0.03);
const Q_0_034 = q(0.034);
const Q_0_035 = q(0.035);
const Q_0_04 = q(0.04);
const Q_0_045 = q(0.045);
const Q_0_05 = q(0.05);
const Q_0_055 = q(0.055);
const Q_0_06 = q(0.06);
const Q_0_07 = q(0.07);
const Q_0_075 = q(0.075);
const Q_0_08 = q(0.08);
const Q_0_085 = q(0.085);
const Q_0_09 = q(0.09);
const Q_0_1 = q(0.1);
const Q_0_11 = q(0.11);
const Q_0_12 = q(0.12);
const Q_0_135 = q(0.135);
const Q_0_14 = q(0.14);
const Q_0_15 = q(0.15);
const Q_0_16 = q(0.16);
const Q_0_17 = q(0.17);
const Q_0_18 = q(0.18);
const Q_0_2 = q(0.2);
const Q_0_22 = q(0.22);
const Q_0_24 = q(0.24);
const Q_0_25 = q(0.25);
const Q_0_26 = q(0.26);
const Q_0_27 = q(0.27);
const Q_0_28 = q(0.28);
const Q_0_3 = q(0.3);
const Q_0_32 = q(0.32);
const Q_0_35 = q(0.35);
const Q_0_38 = q(0.38);
const Q_0_4 = q(0.4);
const Q_0_42 = q(0.42);
const Q_0_45 = q(0.45);
const Q_0_47 = q(0.47);
const Q_0_5 = q(0.5);
const Q_0_55 = q(0.55);
const Q_0_56 = q(0.56);
const Q_0_6 = q(0.6);
const Q_0_62 = q(0.62);
const Q_0_65 = q(0.65);
const Q_0_6927 = q(0.6927);
const Q_0_7 = q(0.7);
const Q_0_72 = q(0.72);
const Q_0_75 = q(0.75);
const Q_0_8 = q(0.8);
const Q_0_82 = q(0.82);
const Q_0_85 = q(0.85);
const Q_0_868 = q(0.868);
const Q_0_9 = q(0.9);
const Q_0_92 = q(0.92);
const Q_0_94 = q(0.94);
const Q_0_95 = q(0.95);
const Q_0_97 = q(0.97);
const Q_0_98 = q(0.98);
const Q_10_47721 = q(10.47721);
const Q_11_38827 = q(11.38827);
const Q_12 = q(12);
const Q_15 = q(15);
const Q_16 = q(16);
const Q_1_02 = q(1.02);
const Q_1_05 = q(1.05);
const Q_1_06 = q(1.06);
const Q_1_07 = q(1.07);
const Q_1_1 = q(1.1);
const Q_1_12 = q(1.12);
const Q_1_15 = q(1.15);
const Q_1_2 = q(1.2);
const Q_1_25 = q(1.25);
const Q_1_3 = q(1.3);
const Q_1_35 = q(1.35);
const Q_1_4 = q(1.4);
const Q_1_5 = q(1.5);
const Q_1_55 = q(1.55);
const Q_1_6 = q(1.6);
const Q_1_8 = q(1.8);
const Q_2 = q(2);
const Q_22 = q(22);
const Q_28 = q(28);
const Q_2_2 = q(2.2);
const Q_2_4 = q(2.4);
const Q_3 = q(3);
const Q_4 = q(4);
const Q_4_5 = q(4.5);
const Q_50 = q(50);
const Q_6 = q(6);
const Q_60 = q(60);
const Q_6_283185307179586 = q(6.283185307179586);
const Q_8 = q(8);
const Q_9_1106 = q(9.1106);
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** [paper, ink] and the grain (amplitude and mottle in 1/256 level, mottle cell in eighths of a px). Never reorder or edit. */
const PALS: ReadonlyArray<{ name: string; paper: string; ink: string; inv: number; amp: number; mot: number; cell: number }> = [
  { name: "ink on cream", paper: "#f2ebdc", ink: "#1b1813", inv: 0, amp: 614, mot: 666, cell: 2400 },
  { name: "sepia on buff", paper: "#e8d8b6", ink: "#4b2f1a", inv: 0, amp: 666, mot: 768, cell: 2240 },
  { name: "sanguine", paper: "#e3d2b8", ink: "#9c3f28", inv: 0, amp: 666, mot: 768, cell: 2560 },
  { name: "nightline", paper: "#1a191b", ink: "#e7dfcd", inv: 1, amp: 410, mot: 410, cell: 2400 },
];
export const PALETTES_V14: readonly (readonly RGB[])[] = PALS.map((p) => [hex(p.paper), hex(p.ink)]);
export const PALETTE_NAMES_V14: readonly string[] = PALS.map((p) => p.name);
const twin = (c: RGB): RGB => [c[0] < 128 ? c[0] + 1 : c[0] - 1, c[1] < 128 ? c[1] + 1 : c[1] - 1, c[2] < 128 ? c[2] + 1 : c[2] - 1];
export const TWINS_V14: readonly (readonly RGB[])[] = PALETTES_V14.map((p) => p.map(twin));
/** The person is version 11's: the same plan, the same names. */
export type V14Plan = V11Plan;
export const planV14 = (commitment: Uint8Array): V14Plan => planV11(commitment);
export const HAIR_NAMES_V14: readonly string[] = HAIR_NAMES_V11;
export const EXPRESSION_NAMES_V14: readonly string[] = EXPRESSION_NAMES_V11;
export const AGE_BAND_NAMES_V14: readonly string[] = AGE_BAND_NAMES_V11;
export const GARMENT_NAMES_V14: readonly string[] = GARMENT_NAMES_V11;
export const ageBandV14 = (age: number): number => ageBandV11(age);
/** Tint level 0..15 to a pigment nudge in levels; a stroke's tint is 6..9, the paper's 8. */
const TINTS: readonly number[] = [-7, -6, -5, -4, -3, -2, -1, 0, 0, 1, 2, 3, 4, 5, 6, 7];
const slot = (idx: number, tint: number) => idx * 16 + tint;

/* ── Integer arithmetic ──────────────────────────────────────────────────────────────────────────── */

function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}
const cdiv = (p: number, d: number): number => idiv(p + d - 1, d);
/** Q16 x Q16 -> Q16 (floor; the product is under 2^53, the division by 2^16 exact). */
const mq = (a: number, b: number): number => Math.floor((a * b) / Q);
/** Q16 / Q16 -> Q16. */
const dq = (a: number, b: number): number => idiv(a * Q, b);
const clampQ = (v: number): number => (v < 0 ? 0 : v > Q ? Q : v);
const clampI = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** smoothstep of a Q16 value, clamped. */
const smQ = (t: number): number => { t = clampQ(t); return mq(mq(t, t), 3 * Q - 2 * t); };
const lerpQ = (a: number, b: number, t: number): number => a + mq(b - a, t);
/** sqrt of a Q16 value, Q16. */
const sqrtQ = (x: number): number => (x <= 0 ? 0 : isqrt(x * Q));
const absI = (v: number): number => (v < 0 ? -v : v);
const sgn = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);

const EXPN: readonly number[] = [65536,64520,63520,62535,61565,60611,59671,58746,57835,56939,56056,55187,54331,53489,52660,51843,51039,50248,49469,48702,47947,47204,46472,45752,45042,44344,43656,42980,42313,41657,41011,40376,39750,39133,38527,37929,37341,36762,36192,35631,35079,34535,34000,33473,32954,32443,31940,31445,30957,30477,30005,29539,29081,28631,28187,27750,27319,26896,26479,26068,25664,25266,24875,24489,24109,23736,23368,23005,22649,22298,21952,21611,21276,20947,20622,20302,19987,19677,19372,19072,18776,18485,18199,17917,17639,17365,17096,16831,16570,16313,16060,15811,15566,15325,15087,14853,14623,14396,14173,13953,13737,13524,13314,13108,12905,12705,12508,12314,12123,11935,11750,11568,11388,11212,11038,10867,10698,10533,10369,10209,10050,9894,9741,9590,9441,9295,9151,9009,8869,8732,8596,8463,8332,8203,8076,7950,7827,7706,7586,7469,7353,7239,7127,7016,6907,6800,6695,6591,6489,6388,6289,6192,6096,6001,5908,5817,5726,5638,5550,5464,5380,5296,5214,5133,5054,4975,4898,4822,4747,4674,4601,4530,4460,4391,4323,4256,4190,4125,4061,3998,3936,3875,3815,3756,3697,3640,3584,3528,3473,3419,3366,3314,3263,3212,3162,3113,3065,3018,2971,2925,2879,2835,2791,2748,2705,2663,2622,2581,2541,2502,2463,2425,2387,2350,2314,2278,2243,2208,2174,2140,2107,2074,2042,2010,1979,1948,1918,1888,1859,1830,1802,1774,1746,1719,1693,1666,1641,1615,1590,1566,1541,1517,1494,1471,1448,1425,1403,1382,1360,1339,1318,1298,1278,1258,1238,1219,1200,1182,1163,1145,1128,1110,1093,1076,1059,1043,1027,1011,995,980,964,950,935,920,906,892,878,865,851,838,825,812,800,787,775,763,751,740,728,717,706,695,684,673,663,653,642,633,623,613,604,594,585,576,567,558,550,541,533,524,516,508,500,493,485,477,470,463,456,449,442,435,428,421,415,408,402,396,390,384,378,372,366,360,355,349,344,339,333,328,323,318,313,308,303,299,294,290,285,281,276,272,268,264,260,256,252,248,244,240,236,233,229,226,222,219,215,212,209,205,202,199,196,193,190,187,184,181,178,176,173,170,168,165,162,160,157,155,153,150,148,146,143,141,139,137,135,133,131,129,127,125,123,121,119,117,115,113,112,110,108,107,105,103,102,100,99,97,95,94,93,91,90,88,87,86,84,83,82,80,79,78,77,76,74,73,72,71,70,69,68,67,66,65,64,63,62,61,60,59,58,57,56,55,54,54,53,52,51,50,50,49,48,47,47,46,45,44,44,43,42,42,41,40,40,39,39,38,37,37,36,36,35,35,34,34,33,32,32,31,31,31,30,30,29,29,28,28,27,27,27,26,26,25,25,25,24,24,23,23,23,22,22,22,21,21,21,20,20,20,19,19,19,19,18,18,18,17,17,17,17,16,16,16,16,15,15,15,15,14,14,14,14,14,13,13,13,13,13,12,12,12,12,12,11,11,11,11,11,11,10,10,10,10,10,10,9,9,9,9,9,9,9,8,8,8,8,8,8,8,8,7,7,7,7,7,7,7,7,7,6,6,6,6,6,6,6,6,6,6,6,5,5,5,5,5,5,5,5,5,5,5,5,5,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const LN: readonly number[] = [-454261,-454261,-408835,-382262,-363409,-348785,-336836,-326734,-317983,-310264,-303359,-297112,-291410,-286164,-281308,-276786,-272557,-268583,-264838,-261294,-257933,-254735,-251686,-248773,-245984,-243309,-240738,-238265,-235882,-233582,-231360,-229211,-227130,-225114,-223157,-221258,-219411,-217616,-215868,-214166,-212507,-210888,-209309,-207767,-206260,-204788,-203347,-201938,-200558,-199207,-197883,-196585,-195312,-194064,-192839,-191636,-190455,-189296,-188156,-187035,-185934,-184851,-183785,-182736,-181704,-180688,-179688,-178702,-177731,-176775,-175832,-174902,-173985,-173081,-172190,-171310,-170442,-169585,-168740,-167905,-167080,-166266,-165462,-164668,-163883,-163107,-162341,-161583,-160834,-160094,-159361,-158637,-157921,-157212,-156512,-155818,-155132,-154453,-153781,-153115,-152457,-151804,-151159,-150519,-149886,-149259,-148638,-148022,-147413,-146809,-146210,-145617,-145029,-144447,-143869,-143297,-142730,-142167,-141609,-141056,-140508,-139964,-139425,-138890,-138359,-137833,-137310,-136792,-136278,-135768,-135262,-134760,-134262,-133767,-133276,-132789,-132305,-131825,-131348,-130875,-130405,-129939,-129476,-129016,-128559,-128106,-127655,-127208,-126764,-126322,-125884,-125448,-125016,-124586,-124159,-123735,-123314,-122895,-122479,-122065,-121654,-121246,-120840,-120437,-120036,-119638,-119242,-118848,-118457,-118068,-117681,-117297,-116915,-116535,-116157,-115782,-115408,-115037,-114668,-114300,-113935,-113572,-113211,-112852,-112495,-112140,-111786,-111435,-111085,-110738,-110392,-110048,-109706,-109365,-109027,-108690,-108354,-108021,-107689,-107359,-107030,-106704,-106378,-106055,-105733,-105412,-105093,-104776,-104460,-104146,-103833,-103522,-103212,-102903,-102596,-102291,-101987,-101684,-101383,-101083,-100784,-100487,-100191,-99897,-99603,-99311,-99021,-98731,-98443,-98157,-97871,-97587,-97304,-97022,-96741,-96462,-96183,-95906,-95630,-95355,-95082,-94809,-94538,-94268,-93999,-93730,-93464,-93198,-92933,-92669,-92406,-92145,-91884,-91625,-91366,-91109,-90852,-90597,-90342,-90089,-89836,-89585,-89334,-89084,-88836,-88588,-88341,-88095,-87850,-87606,-87363,-87120,-86879,-86639,-86399,-86160,-85922,-85685,-85449,-85214,-84979,-84746,-84513,-84281,-84050,-83819,-83590,-83361,-83133,-82906,-82680,-82454,-82229,-82005,-81782,-81559,-81338,-81117,-80896,-80677,-80458,-80240,-80022,-79806,-79590,-79375,-79160,-78946,-78733,-78521,-78309,-78098,-77887,-77678,-77469,-77260,-77053,-76846,-76639,-76433,-76228,-76024,-75820,-75617,-75414,-75212,-75011,-74810,-74610,-74410,-74212,-74013,-73816,-73619,-73422,-73226,-73031,-72836,-72642,-72448,-72255,-72063,-71871,-71679,-71489,-71298,-71109,-70920,-70731,-70543,-70355,-70168,-69982,-69796,-69611,-69426,-69241,-69058,-68874,-68692,-68509,-68327,-68146,-67965,-67785,-67605,-67426,-67247,-67069,-66891,-66714,-66537,-66360,-66184,-66009,-65834,-65659,-65485,-65312,-65139,-64966,-64794,-64622,-64451,-64280,-64109,-63939,-63770,-63600,-63432,-63264,-63096,-62928,-62761,-62595,-62429,-62263,-62098,-61933,-61768,-61604,-61441,-61277,-61115,-60952,-60790,-60629,-60467,-60307,-60146,-59986,-59826,-59667,-59508,-59350,-59192,-59034,-58877,-58720,-58563,-58407,-58251,-58095,-57940,-57786,-57631,-57477,-57324,-57170,-57017,-56865,-56712,-56561,-56409,-56258,-56107,-55957,-55806,-55657,-55507,-55358,-55209,-55061,-54913,-54765,-54618,-54470,-54324,-54177,-54031,-53885,-53740,-53595,-53450,-53305,-53161,-53017,-52874,-52730,-52588,-52445,-52303,-52161,-52019,-51877,-51736,-51596,-51455,-51315,-51175,-51035,-50896,-50757,-50618,-50480,-50342,-50204,-50067,-49929,-49792,-49656,-49519,-49383,-49247,-49112,-48977,-48842,-48707,-48572,-48438,-48304,-48171,-48037,-47904,-47772,-47639,-47507,-47375,-47243,-47112,-46980,-46849,-46719,-46588,-46458,-46328,-46199,-46069,-45940,-45811,-45683,-45554,-45426,-45298,-45171,-45043,-44916,-44789,-44663,-44536,-44410,-44284,-44158,-44033,-43908,-43783,-43658,-43534,-43409,-43285,-43162,-43038,-42915,-42792,-42669,-42546,-42424,-42302,-42180,-42058,-41937,-41815,-41694,-41574,-41453,-41333,-41212,-41093,-40973,-40853,-40734,-40615,-40496,-40378,-40259,-40141,-40023,-39905,-39788,-39670,-39553,-39436,-39320,-39203,-39087,-38971,-38855,-38739,-38624,-38508,-38393,-38278,-38164,-38049,-37935,-37821,-37707,-37593,-37480,-37367,-37254,-37141,-37028,-36915,-36803,-36691,-36579,-36467,-36356,-36244,-36133,-36022,-35911,-35801,-35690,-35580,-35470,-35360,-35251,-35141,-35032,-34923,-34814,-34705,-34596,-34488,-34380,-34272,-34164,-34056,-33948,-33841,-33734,-33627,-33520,-33413,-33307,-33201,-33095,-32989,-32883,-32777,-32672,-32566,-32461,-32356,-32252,-32147,-32043,-31938,-31834,-31730,-31627,-31523,-31419,-31316,-31213,-31110,-31007,-30905,-30802,-30700,-30598,-30496,-30394,-30292,-30191,-30089,-29988,-29887,-29786,-29685,-29585,-29484,-29384,-29284,-29184,-29084,-28984,-28885,-28786,-28686,-28587,-28488,-28390,-28291,-28192,-28094,-27996,-27898,-27800,-27702,-27605,-27507,-27410,-27313,-27216,-27119,-27022,-26926,-26829,-26733,-26637,-26541,-26445,-26349,-26253,-26158,-26063,-25967,-25872,-25777,-25683,-25588,-25493,-25399,-25305,-25211,-25117,-25023,-24929,-24836,-24742,-24649,-24556,-24463,-24370,-24277,-24185,-24092,-24000,-23907,-23815,-23723,-23632,-23540,-23448,-23357,-23265,-23174,-23083,-22992,-22901,-22811,-22720,-22630,-22539,-22449,-22359,-22269,-22179,-22089,-22000,-21910,-21821,-21732,-21643,-21554,-21465,-21376,-21288,-21199,-21111,-21022,-20934,-20846,-20758,-20670,-20583,-20495,-20408,-20320,-20233,-20146,-20059,-19972,-19886,-19799,-19712,-19626,-19540,-19454,-19368,-19282,-19196,-19110,-19024,-18939,-18854,-18768,-18683,-18598,-18513,-18428,-18344,-18259,-18174,-18090,-18006,-17922,-17837,-17753,-17670,-17586,-17502,-17419,-17335,-17252,-17169,-17086,-17003,-16920,-16837,-16754,-16672,-16589,-16507,-16424,-16342,-16260,-16178,-16096,-16015,-15933,-15851,-15770,-15689,-15607,-15526,-15445,-15364,-15283,-15202,-15122,-15041,-14961,-14880,-14800,-14720,-14640,-14560,-14480,-14400,-14321,-14241,-14162,-14082,-14003,-13924,-13845,-13766,-13687,-13608,-13529,-13451,-13372,-13294,-13215,-13137,-13059,-12981,-12903,-12825,-12747,-12669,-12592,-12514,-12437,-12360,-12282,-12205,-12128,-12051,-11974,-11897,-11821,-11744,-11668,-11591,-11515,-11439,-11362,-11286,-11210,-11135,-11059,-10983,-10907,-10832,-10756,-10681,-10606,-10530,-10455,-10380,-10305,-10231,-10156,-10081,-10006,-9932,-9858,-9783,-9709,-9635,-9561,-9487,-9413,-9339,-9265,-9191,-9118,-9044,-8971,-8898,-8824,-8751,-8678,-8605,-8532,-8459,-8386,-8314,-8241,-8169,-8096,-8024,-7951,-7879,-7807,-7735,-7663,-7591,-7519,-7448,-7376,-7304,-7233,-7161,-7090,-7019,-6948,-6876,-6805,-6734,-6664,-6593,-6522,-6451,-6381,-6310,-6240,-6169,-6099,-6029,-5959,-5889,-5819,-5749,-5679,-5609,-5540,-5470,-5401,-5331,-5262,-5192,-5123,-5054,-4985,-4916,-4847,-4778,-4709,-4640,-4572,-4503,-4435,-4366,-4298,-4230,-4161,-4093,-4025,-3957,-3889,-3821,-3753,-3686,-3618,-3550,-3483,-3415,-3348,-3281,-3214,-3146,-3079,-3012,-2945,-2878,-2811,-2745,-2678,-2611,-2545,-2478,-2412,-2345,-2279,-2213,-2147,-2081,-2015,-1949,-1883,-1817,-1751,-1685,-1620,-1554,-1489,-1423,-1358,-1293,-1227,-1162,-1097,-1032,-967,-902,-837,-773,-708,-643,-579,-514,-450,-385,-321,-257,-192,-128,-64,0];
/** exp(u) for u <= 0, Q16 in and out. */
function expQ(u: number): number {
  const t = -u;
  if (t <= 0) return Q;
  if (t >= 1048576) return 0;
  const i = t >> 10, f = t & 1023;
  return EXPN[i]! + (((EXPN[i + 1]! - EXPN[i]!) * f) >> 10);
}
/** ln(x) for x in (0, 1], Q16 in and out (clamped at ln(1/1024) below). */
function lnQ(x: number): number {
  if (x >= Q) return 0;
  if (x < 64) return LN[1]!;
  const i = x >> 6, f = x & 63;
  return LN[i]! + (((LN[i + 1]! - LN[i]!) * f) >> 6);
}
/** x^n for x in [0, 1], n > 0, Q16 throughout. */
function powQ(x: number, n: number): number {
  if (x <= 0) return 0;
  if (x >= Q) return Q;
  return expQ(mq(lnQ(x), n));
}
/** exp(-x^2), x Q16. */
const gexp = (x: number): number => expQ(-mq(x, x));
/** exp(-(du/su)^2 - (dv/sv)^2), all Q16. */
const g2 = (du: number, dv: number, su: number, sv: number): number => { const a = dq(du, su), b = dq(dv, sv); return expQ(-(mq(a, a) + mq(b, b))); };

/* Angles: the model works in 1/16 of a SIN step (A16 = 16384 a turn, PI16 = 8192); the hatching in whole steps (1024 a turn). */
const A16 = 16384, PI16 = 8192, HALFPI16 = 4096;
const TAUQ = Q_6_283185307179586;
/** sin of an angle in 1/16 steps, Q14, linear between table entries. */
function sinF(a: number): number { const i = (a >> 4) & 1023, f = a & 15; const s0 = SIN[i]!; return s0 + (((SIN[(i + 1) & 1023]! - s0) * f) >> 4); }
const cosF = (a: number): number => sinF(a + HALFPI16);
const COS = (a: number) => SIN[(a + 256) & 1023]!;
/** Radians (Q16) of an angle in 1/16 steps, and back. */
const radQ = (a: number): number => idiv(a * 102944, 4096);
const a16Of = (radQ16: number): number => idiv(radQ16 * 4096, 102944);
/** sin(pi t) for t in [0, 1] Q16, Q14. */
const sinPi = (t: number): number => sinF(idiv(t * PI16, Q));
/** asin(x) for x in [-1, 1] Q16, in 1/16 steps: the largest a with sin a <= x. */
function asin16(x: number): number {
  const x14 = x >> 2, neg = x14 < 0, ax = neg ? -x14 : x14;
  let lo = 0, hi = HALFPI16;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sinF(mid) <= ax) lo = mid; else hi = mid - 1; }
  return neg ? -lo : lo;
}
/** Angle (whole steps, 0 along +x, 256 along +y) of (dx, dy): a binary search over the SIN table. */
function atan2i(dy: number, dx: number): number {
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  if (ax === 0 && ay === 0) return 0;
  const ratio = (num: number, den: number): number => {
    let lo = 0, hi = 128;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (SIN[mid]! * den <= COS(mid) * num) lo = mid; else hi = mid - 1; }
    return lo;
  };
  let a = ay <= ax ? ratio(ay, ax) : 256 - ratio(ax, ay);
  if (dx < 0) a = 512 - a;
  if (dy < 0) a = -a;
  return a & 1023;
}
/** Wrap an angle in 1/16 steps to [-PI16, PI16). */
const wrapPi16 = (a: number): number => ((((a + PI16) % A16) + A16) % A16) - PI16;

/** Portable 32-bit hash of (x, y, salt). */
function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ Math.imul(s | 0, 0xc2b2ae3d);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
const sm15 = (t: number): number => (((t * t) >> 15) * (98304 - 2 * t)) >> 15;
const NOISE_ONE = 8192;
/** Lattice value noise in [-8192, 8191] at (x, y) over cells of the given size (any shared unit). */
function vnoise(x: number, y: number, cell: number, salt: number): number {
  const x0 = idiv(x, cell), y0 = idiv(y, cell);
  const tx = sm15(idiv((x - x0 * cell) * 32768, cell)), ty = sm15(idiv((y - y0 * cell) * 32768, cell));
  const v00 = (hash2(x0, y0, salt) >>> 19) - 4096, v10 = (hash2(x0 + 1, y0, salt) >>> 19) - 4096;
  const v01 = (hash2(x0, y0 + 1, salt) >>> 19) - 4096, v11 = (hash2(x0 + 1, y0 + 1, salt) >>> 19) - 4096;
  const a = v00 + (((v10 - v00) * tx) >> 15), b = v01 + (((v11 - v01) * tx) >> 15);
  return 2 * (a + (((b - a) * ty) >> 15));
}
function fbm2(x: number, y: number, cell: number, salt: number): number {
  return idiv(2 * vnoise(x, y, cell, salt) + vnoise(x, y, cell >> 1, salt + 31), 3);
}
/** Noise as a Q16 value in [-1, 1]. */
const nq = (x: number, y: number, cell: number, salt: number): number => vnoise(x, y, cell, salt) * 8;

/* ── Regions and names ───────────────────────────────────────────────────────────────────────────── */

const BG = 0, SKIN = 1, HAIR = 2, WHITE = 3, IRIS = 4, PUPIL = 5, HILITE = 6, BROW = 7, LIPU = 8, LIPL = 9, NOSTRIL = 10, EAR = 11, GARM = 12, GARM2 = 13, SHIRT = 14, BEARD = 15, MOUTH = 16, WRAP = 17;
const H_SHORT = 1, H_PARTED = 2, H_TEXTURED = 3, H_BOB = 4, H_LONG = 5, H_CURLY = 6, H_BRAIDS = 7, H_TIED = 8, H_BALD = 9, H_LONG_LOOSE = 10, H_LONG_SWEPT = 11, H_BRAID_ONE = 12, H_BUN_HIGH = 13, H_BUN_LOW = 14, H_PULLED_BACK = 15, H_CURLS_OUT = 16, H_PIXIE = 17, H_WRAP = 18, H_PONY_HIGH = 19, H_PONY_LOW = 20, H_PONY_SHOULDER = 21;
const G_CREW = 0, G_VEE = 1, G_COLLAR = 2, G_TURTLE = 3, G_LAPEL = 4, G_SCOOP = 5, G_BOAT = 6, G_BLOUSE = 7, G_WRAP = 8, G_SHAWL = 9, G_HIGH = 10;
const B_NONE = 0, B_FULL = 1, B_GOATEE = 2, B_STUBBLE = 4;
const isFall = (h: number): boolean => h === H_LONG || h === H_BOB || h === H_BRAIDS || h === H_CURLY || h === H_LONG_LOOSE || h === H_LONG_SWEPT || h === H_CURLS_OUT;
const isPony = (h: number): boolean => h === H_PONY_HIGH || h === H_PONY_LOW || h === H_PONY_SHOULDER;
const isCap = (h: number): boolean => h === H_TIED || h === H_BRAIDS || h === H_PULLED_BACK || h === H_BRAID_ONE || h === H_BUN_HIGH || h === H_BUN_LOW || isPony(h);
const hasBun = (h: number): boolean => h === H_TIED || h === H_BRAIDS || h === H_PULLED_BACK || h === H_BUN_HIGH || h === H_BUN_LOW;
const hasParting = (h: number): boolean => h === H_PARTED || h === H_PULLED_BACK;

const degA = (degQ: number): number => idiv(degQ * A16, 360 * Q);

/* ── Version 14: the ear's template. Q16, in ear heights: x back from the attachment, y down from the top. ──────
 * The outline and the helix's inner edge, the antihelix's back edge (the scapha's rim) and the concha are kept as
 * polar tables (64 angles, phi from +x toward +y) round EAR_C (the concha's round EAR_CC), -1 where a curve has no
 * point at that angle; the drawn lines as control points of open Catmull-Rom curves. The tables were sampled from
 * those same curves (and the outline's closed curve through 21 points), so a line and the tone it bounds agree. */
const EAR_C = [17695, 29491], EAR_CC = [13107, 29491];
const EAR_R = [18005, 17541, 17197, 16974, 16815, 16728, 16752, 16925, 17307, 17928, 18772, 19988, 22019, 25767, 29922, 33081, 35166, 35619, 34925, 32785, 28653, 25181, 23157, 21820, 21154, 20803, 20296, 19672, 19073, 18493, 17775, 16979, 16487, 16358, 16475, 16790, 17292, 17977, 18836, 19982, 21425, 23004, 24610, 26289, 27591, 28393, 29003, 29461, 29627, 29520, 29273, 28905, 28391, 27705, 26816, 25755, 24696, 23703, 22757, 21795, 20858, 20000, 19255, 18583];
const EAR_RH = [13488, 13145, 12904, 12762, 12706, 12721, 12821, 13020, 13341, 13815, 14477, 15333, 16444, 17928, 20042, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 21355, 22874, 24081, 24502, 24641, 24660, 24585, 24468, 24336, 24105, 23641, 22969, 22149, 21167, 20096, 19019, 17937, 16884, 15942, 15145, 14488, 13935];
const EAR_RS = [10619, 10451, 10342, 10297, 10319, 10412, 10577, 10823, 11157, 11588, 12126, 12756, 13508, 14436, 15605, 17116, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 23287, 22657, 21523, 20136, 18734, 17350, 16032, 14866, 13877, 13061, 12409, 11885, 11462, 11117, 10839];
const EAR_RC = [9794, 9639, 9538, 9497, 9521, 9613, 9778, 10020, 10347, 10764, 11281, 11951, 12785, 13749, 14668, 14893, 14070, 13230, 13021, 13775, 15006, 15109, 14515, 13803, 12975, 10598, 9037, 8522, 8262, 8175, 8234, 8498, 9196, 10116, 10715, 11094, 11472, 11905, 12422, 13031, 13693, 14297, 14629, 14564, 14177, 13577, 12934, 12428, 12124, 12035, 12102, 12282, 12524, 12781, 13108, 13278, 13059, 12586, 12037, 11505, 11029, 10620, 10280, 10006];
/** The helix's inner edge (the rim's curl), from its root at the front over the top and down the back into the lobe. */
const EAR_L_HELIX = [5243, 13107, 8520, 7209, 15729, 4915, 24248, 6226, 29819, 10813, 32440, 17695, 32113, 25559, 29819, 33423, 26214, 40632, 22610, 47186, 20316, 51773];
/** The crus of the helix: from the root down and back into the concha. */
const EAR_L_CRUS = [4915, 13763, 6226, 19661, 9830, 22938, 15401, 23921];
/** The antihelix's front edge, the concha's rim: from the antitragus up the stem and forward under the inferior crus. */
const EAR_L_CONCHA = [15401, 44237, 19661, 38339, 22610, 30802, 23265, 24248, 21955, 19661, 18350, 18022, 13107, 17367, 7864, 16384];
/** The antihelix's back edge, the scapha's rim: up the stem and along the superior crus. */
const EAR_L_SCAPHA = [18350, 47841, 24576, 39322, 28180, 30147, 28508, 21627, 26870, 13763, 22938, 7864, 17695, 5571];
/** The triangular fossa between the crura: the inferior crus's top edge, round the apex, the superior crus's front. */
const EAR_L_FOSSA = [8192, 12124, 12452, 12911, 17695, 13894, 21299, 14746, 21955, 12452, 19661, 9503, 15073, 8192];
/** The concha's front, from the antitragus's foot up behind the tragus to the crus (the far side of the concha's curves). */
const EAR_L_CFRONT = [11469, 43581, 7864, 42271, 5571, 39322, 5898, 34734, 5243, 30147, 4260, 24904, 4915, 19661, 7864, 16384];
/** The tragus's back edge, over the canal. */
const EAR_L_TRAGUS = [1966, 28180, 4915, 30802, 5571, 34734, 3932, 38666, 2294, 40632];
/** The antitragus's top edge. */
const EAR_L_ANTI = [7537, 43909, 10813, 42271, 14090, 42926, 16056, 44892];
/** A polar table at phi (1/16 steps): periodic Catmull-Rom over its 64 entries; -1 where the curve has no point. */
function polarAt(T: readonly number[], phi: number): number {
  const a = phi & (A16 - 1), i = a >> 8, t = (a & 255) << 8;
  const p1 = T[i]!, p2 = T[(i + 1) & 63]!;
  if (p1 < 0 || p2 < 0) return -1;
  let p0 = T[(i + 63) & 63]!, p3 = T[(i + 2) & 63]!;
  if (p0 < 0) p0 = p1;
  if (p3 < 0) p3 = p2;
  const t2 = mq(t, t), t3 = mq(t2, t);
  return (2 * p1 + mq(p2 - p0, t) + mq(2 * p0 - 5 * p1 + 4 * p2 - p3, t2) + mq(3 * p1 - 3 * p2 + p3 - p0, t3)) >> 1;
}
let crX = 0, crY = 0;
/** A point at t (Q16, 0 to 1 over the whole curve) on the open Catmull-Rom curve through flat control points c: crX, crY. */
function crOpen(c: readonly number[], t: number): void {
  const n = c.length >> 1, s = t * (n - 1);
  let i = Math.floor(s / 65536);
  if (i > n - 2) i = n - 2;
  if (i < 0) i = 0;
  const f = s - i * 65536, f2 = mq(f, f), f3 = mq(f2, f);
  const g = (k: number, o: number): number => c[2 * (k < 0 ? 0 : k > n - 1 ? n - 1 : k) + o]!;
  const cr = (o: number): number => { const p0 = g(i - 1, o), p1 = g(i, o), p2 = g(i + 1, o), p3 = g(i + 2, o); return (2 * p1 + mq(p2 - p0, f) + mq(2 * p0 - 5 * p1 + 4 * p2 - p3, f2) + mq(3 * p1 - 3 * p2 + p3 - p0, f3)) >> 1; };
  crX = cr(0); crY = cr(1);
}

/* ── The model: head-local geometry in Q16 (the cranium half-width is 1; v runs down, z toward the viewer) ── */

/** Monotone cubic (Fritsch-Carlson, no overshoot) through (xs, ys), Q16. */
function monoSpline(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d[i] = dq(ys[i + 1]! - ys[i]!, xs[i + 1]! - xs[i]!);
  m[0] = d[0]!; m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1]! * d[i]! <= 0) { m[i] = 0; continue; }
    const h0 = xs[i]! - xs[i - 1]!, h1 = xs[i + 1]! - xs[i]!;
    const den = dq(2 * h1 + h0, d[i - 1]!) + dq(h1 + 2 * h0, d[i]!);
    m[i] = den === 0 ? 0 : dq(3 * (h0 + h1), den);
  }
  return (x: number): number => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (xs[i + 1]! < x) i++;
    const h = xs[i + 1]! - xs[i]!, t = dq(x - xs[i]!, h), t2 = mq(t, t), t3 = mq(t2, t);
    return mq(2 * t3 - 3 * t2 + Q, ys[i]!) + mq(mq(t3 - 2 * t2 + t, h), m[i]!) + mq(-2 * t3 + 3 * t2, ys[i + 1]!) + mq(mq(t3 - t2, h), m[i + 1]!);
  };
}

interface Row { v: number; w: number; dF: number; dB: number; n: number; invN: number; zs: number }
type V3 = [number, number, number];
const rotY3 = (p: V3, a: number): V3 => { const c = cosF(a), s = sinF(a); return [Math.floor((p[0] * c + p[2] * s) / 16384), p[1], Math.floor((-p[0] * s + p[2] * c) / 16384)]; };
const norm3 = (p: V3): V3 => { const L = isqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) || 1; return [idiv(p[0] * Q, L), idiv(p[1] * Q, L), idiv(p[2] * Q, L)]; };
/** Q14 x Q14 -> Q16. */
const m14 = (a: number, b: number): number => (a * b) >> 12;
const A105 = a16Of(Q_1_05), A075 = a16Of(Q_0_75), A1 = a16Of(Q), A22 = degA(Q_22), A8 = degA(Q_8);

// features() reports through these, so the splat loops allocate nothing
let fDz = 0, fReg = 0, fDir = 0, fDu = 0, fDv = 0, fEx = 0;
// version 14: the ear's plane (earPlane) and head-space points (earPt) report through these
let eX = 0, eY = 0, eU = 0, eV = 0, eZ = 0;
/** Version 14: what ear() drew for each ear, collected only for earsV14 (the ear test). */
export interface EarInfo { side: number; facing: number; outline: number[]; axis: number[]; visible: number; lines: Record<string, number> }
let earLog: EarInfo[] | null = null;
/** Version 14: set while ponyV14 (the ponytail test) builds a field. */
let ponyLog = false;

function lightDir(P: V14Plan): V3 {
  const sa = sinF(P.az), ca = cosF(P.az), se = sinF(P.el), ce = cosF(P.el);
  return [-P.lightSide * m14(sa, ce), -se * 4, m14(ca, ce)];
}

function makeModel(P: V14Plan) {
  const vCap = QN_0_3, capA = P.craniumH + vCap;
  const xs = [vCap, P.e - Q_0_08, P.e + Q_0_22, P.jawV, P.chin - Q_0_1, P.chin - Q_0_03, P.chin + Q_0_02, P.chin + Q_0_05];
  for (let i = 1; i < xs.length; i++) if (xs[i]! <= xs[i - 1]!) xs[i] = xs[i - 1]! + 1; // the knots stay in order whatever the draw
  const wSpl = monoSpline(xs, [Q, P.templeW, P.cheekW, P.jawW, P.chinW, mq(P.chinW, Q_0_75), mq(P.chinW, Q_0_3), 0]);
  const bL = P.beardLen, bW = P.beard === B_GOATEE ? Q_0_3 : mq(P.chinW, Q_0_95) + Q_0_1;
  const beardW = (v: number): number => {
    if (bL <= 0 || v <= P.chin - Q_0_12 || v >= P.chin + bL) return 0;
    const t = dq(v - (P.chin - Q_0_12), bL + Q_0_12);
    return mq(bW, sqrtQ(Q - mq(t, t)));
  };
  /** sqrt(max(0, 1 - ((v - vCap) / a)^2)). */
  const capF = (v: number, a: number): number => { const t = dq(v - vCap, a); return sqrtQ(Q - mq(t, t)); };
  const width = (v: number): number => { const w0 = v < vCap ? capF(v, capA) : wSpl(v), w = w0 < 0 ? 0 : w0, b = beardW(v); return w > b ? w : b; };
  const dFront = (v: number): number => {
    let d = v < vCap ? mq(P.capDepth, capF(v, capA)) : lerpQ(P.capDepth, P.chinDepth, smQ(dq(v - vCap, P.chin - vCap)));
    d = mq(d, Q - mq(mq(Q_0_6, P.slopeF), clampQ(dq(P.browV - v, P.craniumH + P.browV))));
    d += mq(P.chinProj, smQ(dq(v - P.mouth, P.chin - P.mouth)));
    return d < 0 ? 0 : d;
  };
  const dBack = (v: number): number => mq(P.backDepth, capF(v, v < vCap ? capA : P.napeA));
  const nAt = (v: number): number => (v < vCap ? 2 * Q : 2 * Q + mq(P.nFace - 2 * Q, smQ(dq(v - vCap, Q_0_4))));
  /** The jaw line: the side of a slice moves forward from the jaw angle to the chin. */
  const zSide = (v: number): number => mq(Q_0_55, smQ(dq(v - P.jawV, P.chin + Q_0_02 - P.jawV)));
  const rowOf = (v: number): Row => { const n = nAt(v); return { v, w: width(v), dF: dFront(v), dB: dBack(v), n, invN: dq(Q, n), zs: zSide(v) }; };
  /** Front base depth at u on a slice, by inverting the superellipse. */
  const sliceZ = (u: number, row: Row): number => {
    if (row.w <= 0) return 0;
    const S = clampQ(dq(absI(u), row.w));
    return mq(row.dF, powQ(Q - powQ(S, row.n), row.invN));
  };
  // eyes: the opening scaled to the face's width at the eye line, the spacing kept inside the temple
  const rowE = rowOf(P.e), wE = rowE.w;
  // version 13: the eye drawn 1.3 x the plan's size (the opening, the ball, the iris and the pupil together; the plan
  // is unchanged), less where the face is narrow: the inner corners keep 0.1 from the midline and the outer 0.12 from
  // the face's edge, so the eyes never touch or reach the temple
  const ew0 = mq(P.ew, Math.min(Q, dq(wE, Q_0_97)));
  // and the upper lid keeps clear of the brow (its lower edge, with room for the crease): a low brow rises up to
  // 0.035 to make the room, and past that the eye stays nearer its own size
  const uh0 = mq(mq(P.uh, P.gaze === 2 ? Q_0_7 : Q), P.expr === 2 ? Q_0_92 : Q), room0 = P.e - P.browV - mq(P.browT, Q_0_6) - q(0.035);
  const bLift = clampI(mq(uh0, q(1.3)) - room0, 0, Q_0_035), browVE = P.browV - bLift, room = room0 + bLift;
  let kE = q(1.3);
  while (kE > Q && (2 * mq(ew0, kE) > wE - q(0.22) || mq(uh0, kE) > room)) kE -= Q_0_05;
  const ew = mq(ew0, kE), eyeU = Math.min(Math.max(P.eyeU, Q_0_1 + ew), wE - ew - Q_0_12);
  const eyeR = mq(Q_0_2, kE), eyeR2 = mq(eyeR, eyeR), eyeC = cosF(P.cant) * 4, eyeS = sinF(P.cant) * 4;
  const kp = dq(lnQ(Q_0_5), lnQ(P.tp));
  const upF = (t: number): number => { const tk = powQ(t, kp); return powQ(clampQ(4 * mq(tk, Q - tk)), Q_0_75); };
  const loF = (t: number): number => powQ(clampQ(4 * mq(t, Q - t)), Q_1_2);
  const uh = mq(uh0, kE), lh = mq(P.lh, kE);
  // a child's iris is larger for the opening
  const sinIris = clampI(mq(dq(mq(P.irisFrac, uh + lh), 2 * eyeR), Q + mq(q(0.12), Q - P.ageT)), Q_0_05, Q_0_9);
  const irisA = asin16(sinIris), pupilA = idiv(irisA * P.pupilFrac, Q);
  const cosIris = cosF(irisA) * 4, cosPupil = cosF(pupilA) * 4, cosHi = cosF(idiv(irisA * 22, 100)) * 4;
  // gaze in head-local: toward the camera (rotated back by the yaw) with a per-person jitter, aside, or down
  let G: V3;
  if (P.gaze === 0) G = rotY3([sinF(P.gazeJx) * 4, sinF(P.gazeJy) * 4, cosF(P.gazeJx) * 4], -P.yaw);
  else if (P.gaze === 1) G = [sinF(A22) * 4 * P.gazeSide, 0, cosF(A22) * 4];
  else G = [sinF(A8) * 4 * P.gazeSide, sinF(A22) * 4, cosF(A22) * 4];
  G = norm3(G);
  const baseBumps = (u: number, v: number): number => {
    const au = absI(u);
    let dz = mq(P.browRidge, g2(u, v - browVE, Q_0_8, Q_0_08));
    dz -= mq(P.socket, g2(au - eyeU, v - P.e, mq(Q_0_27, kE), mq(Q_0_17, kE)));
    dz += mq(P.cheekBone, g2(au - P.cheekU, v - (P.e + P.cheekV), Q_0_22, Q_0_14));
    dz -= mq(P.hollow, g2(au - Q_0_6, v - (P.e + Q_0_5), Q_0_2, Q_0_15));
    dz += mq(P.chinBump, g2(u, v - (P.chin - Q_0_15), Q_0_3, Q_0_15));
    return dz;
  };
  const zcEye = sliceZ(eyeU, rowE) + baseBumps(eyeU, P.e) - mq(Q_0_135, kE);
  // the reserved highlight: the gaze pulled a little toward the half vector of view and light
  const Lw = lightDir(P);
  const Vl: V3 = [-sinF(P.yaw) * 4, 0, cosF(P.yaw) * 4], Ll = rotY3(Lw, -P.yaw);
  const Hh = norm3([Vl[0] + Ll[0], Vl[1] + Ll[1], Vl[2] + Ll[2]]);
  const hiOf = (g: V3, f = Q_0_2): V3 => norm3([mq(g[0], Q - f) + mq(Hh[0], f), mq(g[1], Q - f) + mq(Hh[1], f) - mq(Q_0_06, dq(f, Q_0_2)), mq(g[2], Q - f) + mq(Hh[2], f)]);
  /** Version 13: inside the lid opening, in the eye's own frame (du = |u| - eyeU, dv = v - e). */
  const inOpen = (du: number, dv: number): boolean => {
    if (mq(du, du) + mq(dv, dv) >= eyeR2) return false;
    const dur = mq(du, eyeC) + mq(dv, eyeS), dvr = mq(dv, eyeC) - mq(du, eyeS), t = (dq(dur, ew) + Q) >> 1;
    if (t <= 0 || t >= Q) return false;
    return dvr > -mq(uh, upF(t)) && dvr < mq(lh, loF(t));
  };
  /** The upper lid's shadow on the ball at (du, dv), Q16 (1 at the lid's edge). */
  const lidShade = (du: number, dv: number): number => {
    const dur = mq(du, eyeC) + mq(dv, eyeS), dvr = mq(dv, eyeC) - mq(du, eyeS), t = clampQ((dq(dur, ew) + Q) >> 1);
    return gexp(dq(dvr + mq(uh, upF(t)), mq(Q_0_045, kE)));
  };
  /** Two unit vectors across a direction g (head space). */
  const basisOf = (g: V3): [V3, V3] => { const e1 = norm3([-g[2], 0, g[0]]); return [e1, [mq(g[1], e1[2]), mq(g[2], e1[0]) - mq(g[0], e1[2]), -mq(g[1], e1[0])]]; };
  /** The direction from the ball's centre at angle a (1/16 steps) from g, around it at phi (whole steps). */
  const capDir = (g: V3, b: [V3, V3], a: number, phi: number): V3 => {
    const ca = cosF(a) * 4, sa = sinF(a) * 4, cp = mq(COS(phi & 1023) * 4, sa), sp = mq(SIN[phi & 1023]! * 4, sa);
    return [mq(g[0], ca) + mq(b[0][0], cp) + mq(b[1][0], sp), mq(g[1], ca) + mq(b[0][1], cp) + mq(b[1][1], sp), mq(g[2], ca) + mq(b[0][2], cp) + mq(b[1][2], sp)];
  };
  const openAt = (side: number, d: V3): boolean => inOpen(side * mq(eyeR, d[0]), mq(eyeR, d[1]));
  // Version 13: never lose the eye. Where the gaze (down, aside) and the lids would leave under 60% of the iris in
  // the opening, or cut the pupil, the gaze turns toward the opening's centre in eighths until neither happens.
  /** The direction from the ball's centre to the opening's centre. */
  const centreOf = (side: number): V3 => { const dvc = (lh - uh) >> 1, X = side * -mq(dvc, eyeS), Y = mq(dvc, eyeC); return norm3([X, Y, sqrtQ(Math.max(0, eyeR2 - mq(X, X) - mq(Y, Y)))]); };
  const gazeOf = (side: number): V3 => {
    const Gc = centreOf(side);
    let g = G;
    for (let k = 0; k <= 8; k++) {
      g = k === 0 ? G : norm3([G[0] * (8 - k) + Gc[0] * k, G[1] * (8 - k) + Gc[1] * k, G[2] * (8 - k) + Gc[2] * k]);
      const b = basisOf(g);
      let vis = 0, all = 0, pupilIn = true;
      for (let r = 1; r <= 4; r++) for (let j = 0; j < 12; j++) { all += r; if (openAt(side, capDir(g, b, idiv(irisA * r, 4), j * 85))) vis += r; }
      for (let j = 0; j < 12 && pupilIn; j++) if (!openAt(side, capDir(g, b, idiv(pupilA * 23, 20), j * 85))) pupilIn = false;
      if (pupilIn && vis * 100 >= all * 60) break;
    }
    return g;
  };
  const GL = gazeOf(-1), GR = gazeOf(1), HL = hiOf(GL), HR = hiOf(GR);
  const smileEff = mq(P.smile, Math.min(Q, dq(Q_0_27, P.lipW))); // wide mouths get less corner lift: never a grin
  const vm = (u: number): number => { const r = dq(u, P.lipW); return P.mouth + mq(smileEff, mq(QN_0_04, mq(r, r))); };
  const bridgeV = P.e - Q_0_03, tipV = P.noseBase - Q_0_07;
  /** Features at a front point (u, v) with superellipse factor C: fDz, fReg, fDir/fDu/fDv (a head-local tangent), fEx. */
  function features(u: number, v: number, C: number, row: Row): void {
    const au = absI(u), side = u < 0 ? -1 : 1;
    let dz = baseBumps(u, v), region = SKIN, extra = 0, extraRim = 0;
    fDir = 0;
    const fade = clampQ(mq(C, Q_1_6));
    // nose: a ridge from the bridge to the tip with an optional hump, nostril wings, nostril openings
    {
      let A: number, su: number;
      if (v < bridgeV) { A = mq(P.bridgeH, gexp(dq(v - bridgeV, Q_0_12))); su = Q_0_08; }
      else if (v <= tipV) { const t = dq(v - bridgeV, tipV - bridgeV); A = lerpQ(P.bridgeH, P.tipH, powQ(t, Q_1_3)) + mq(P.hump, sinPi(t) * 4); su = lerpQ(Q_0_08, P.tipW, t); }
      else { A = mq(P.tipH, gexp(dq(v - tipV, Q_0_06))); su = P.tipW; }
      dz += mq(A, gexp(dq(u, su)));
      dz += mq(mq(P.tipH, Q_0_55), g2(au - P.nostrilU, v - (P.noseBase - Q_0_05), Q_0_07, Q_0_055));
      if (g2(au - mq(P.nostrilU, Q_0_62), v - (P.noseBase - Q_0_005), Q_0_034, Q_0_014) > Q_0_45) region = NOSTRIL;
      // stage two: the nose's side planes are hatched along the bridge (a head-local tangent straight down)
      if (region === SKIN && v > bridgeV && v < tipV && au > mq(su, q(0.35)) && au < mq(su, q(1.9))) { fDir = 1; fDu = 0; fDv = Q; }
      // the tip's highlight is paper: a small ellipse on the tip, pulled toward the light
      if (region === SKIN) { const hu = dq(u - mq(mq(P.tipW, q(0.45)), Ll[0]), mq(P.tipW, q(0.55))), hv = dq(v - tipV - q(0.012), q(0.04)); if (mq(hu, hu) + mq(hv, hv) < Q) extra = -Q; }
    }
    // lips: an upper roll with a cupid's bow, a lower roll, the mouth line between them
    {
      const m = vm(u), ru = dq(u, P.lipW);
      if (absI(ru) < Q) {
        const ru2 = mq(ru, ru), r95 = dq(ru, Q_0_95);
        const fU = mq(powQ(Q - ru2, Q_0_7), Q - mq(Q_0_2, gexp(dq(u, Q_0_045))));
        const fL = powQ(clampQ(Q - mq(r95, r95)), Q_0_8);
        const topU = m - mq(P.lipU, fU), botL = m + mq(P.lipL, fL);
        if (v >= topU && v < m - Q_0_006) region = LIPU;
        else if (v >= m - Q_0_006 && v <= m + Q_0_006) region = MOUTH;
        else if (v > m + Q_0_006 && v <= botL) region = LIPL;
        const eR = expQ(-mq(ru2, Q_0_8));
        dz += mq(mq(mq(P.lipU, Q_0_6), gexp(dq(v - (m - mq(P.lipU, Q_0_5)), mq(P.lipU, Q_0_55)))), eR);
        dz += mq(mq(mq(P.lipL, Q_0_8), gexp(dq(v - (m + mq(P.lipL, Q_0_5)), mq(P.lipL, Q_0_55)))), eR);
        if (region === LIPU || region === LIPL) { fDir = 1; fDu = Q; fDv = Q_0_12 * side; }
        dz -= mq(Q_0_015, g2(au - P.lipW, v - m, Q_0_05, Q_0_04));
      }
      dz -= mq(mq(mq(Q_0_012, gexp(dq(u, Q_0_05))), smQ(dq(v - P.noseBase, Q_0_04))), smQ(dq(m - v, Q_0_04)));
      if (region === SKIN && au < P.lipW + Q_0_09 && v > P.noseBase + Q_0_02 && v < m + P.lipL + Q_0_09) extra = -Q; // the mouth zone: never hatched
    }
    // round each eye the skin carries no hatching and no terminator ramp (an ellipse 1.6 x the opening's width and 2.2 x
    // its height), so the eyes read on every draw, in heavy shadow too; only the lid, brow and iris lines sit there
    if (region === SKIN) {
      const eu = dq(au - eyeU, mq(ew, Q_1_6)), ev = dq(v - P.e, mq(uh + lh, Q_1_1));
      if (mq(eu, eu) + mq(ev, ev) < Q) extra = -Q;
    }
    // behind a lens the skin carries no hatching and no terminator ramp: the eye reads exactly as without
    if (P.glasses && region === SKIN) {
      const rr = ew + Q_0_07, lu = dq(au - eyeU, mq(rr, Q_1_15)), lv = dq(v - P.e - Q_0_01, mq(rr, Q_0_85));
      if (mq(lu, lu) + mq(lv, lv) < Q) extra = -Q;
    }
    // brow: a band along an arch
    {
      const t = dq(au - (eyeU - ew - P.browIn), 2 * ew + P.browIn + P.browOut);
      if (t > 0 && t < Q) {
        const arch = mq(P.browArch, sinPi(powQ(t, Q_0_8)) * 4);
        const bv = browVE - arch + mq(Q_0_04, t - Q_0_5) * (P.cant > 0 ? -1 : 1);
        const th = mq(P.browT, Q_0_6 + mq(Q_0_6, Q - t));
        if (absI(v - bv) < th >> 1) { region = BROW; fDir = 1; fDu = side * Q; fDv = QN_0_55; }
      }
    }
    // facial hair as a region on the lower face with a small bump; a full beard extends the chin
    if (P.beard !== B_NONE && region === SKIN) {
      const m = vm(u);
      let inB = false;
      if (P.beard === B_FULL || P.beard === B_STUBBLE) inB = v > m + mq(P.lipL, Q_1_2) + Q_0_03 || (v > P.mouth - Q_0_02 && au > P.lipW + Q_0_14) || (au > Q_0_82 && v > P.e + Q_0_42);
      else if (P.beard === B_GOATEE) inB = v > m + mq(P.lipL, Q_1_2) + Q_0_03 && au < Q_0_3;
      if (bL > 0 && v > P.chin - Q_0_12) inB = true;
      // the moustache is a shaped band, not a box (Mike, 2026-10-08): its top arcs down toward the corners, its lower
      // edge follows the mouth and droops past it, the ends round off, a small notch at the philtrum; strands sweep out and down
      let mo = false;
      if (P.beard !== B_GOATEE) {
        const w = P.lipW + Q_0_1, r = dq(au, w);
        if (r < Q && au > Q_0_02) {
          const top = P.noseBase + Q_0_045 + mq(Q_0_06, sq(r)) + (au < Q_0_05 ? Q_0_012 : 0), bot = m - Q_0_012 + mq(Q_0_06, powQ(r, Q_3));
          const end = mq(bot - top, sqrtQ(clampQ(Q - powQ(r, Q_4))));
          if (v > top && v < top + end) { inB = true; mo = !(bL > 0 && v > P.chin - Q_0_12); }
        }
      }
      if (inB) { region = BEARD; dz += mq(P.beardT, fade); fDir = 1; if (mo) { fDu = side * Q_0_85; fDv = Q_0_55; } else { fDu = side * Q_0_3; fDv = Q; } }
    }
    // eyes: inside the opening the surface is the eyeball; outside it the lid skin wraps the ball
    {
      const du = au - eyeU, dv = v - P.e;
      const d2 = mq(du, du) + mq(dv, dv);
      if (d2 < eyeR2) {
        const dur = mq(du, eyeC) + mq(dv, eyeS), dvr = mq(dv, eyeC) - mq(du, eyeS);
        const h = sqrtQ(eyeR2 - d2), zEye = zcEye + h;
        const t = (dq(dur, ew) + Q) >> 1;
        const tc = clampQ(t), vUp = -mq(uh, upF(tc)), vLo = mq(lh, loF(tc));
        if (t > 0 && t < Q && dvr > vUp && dvr < vLo) {
          dz = zEye - sliceZ(u, row);
          const nx = dq(du * side, eyeR), ny = dq(dv, eyeR), nz = dq(h, eyeR);
          const Ge = side < 0 ? GL : GR, He = side < 0 ? HL : HR;
          const dG = mq(nx, Ge[0]) + mq(ny, Ge[1]) + mq(nz, Ge[2]), dH = mq(nx, He[0]) + mq(ny, He[1]) + mq(nz, He[2]);
          region = dG > cosPupil ? PUPIL : dG > cosIris ? IRIS : WHITE;
          if (dH > cosHi && region !== WHITE) region = HILITE;
          extra = mq(Q_0_6, gexp(dq(dvr - vUp, mq(Q_0_045, kE)))); // the lid's shadow on the ball
          extraRim = region === IRIS ? clampQ(sqrtQ(dq(Q - dG, Q - cosIris))) : 0;
          fDir = 1;
          if (region === IRIS) { fDu = -dv; fDv = du * side; } else { fDu = Q; fDv = 0; } // iris: concentric rings read as tone
        } else {
          const lid = zEye + Q_0_014 - (sliceZ(u, row) + dz);
          if (lid > 0) dz += lid;
        }
      }
    }
    fDz = mq(dz, region === SKIN || region === BEARD || region === NOSTRIL ? fade : Q);
    fReg = region;
    fEx = region === IRIS ? extra + 2 * extraRim : extra;
  }
  // base point on a slice: bX, bZ, bC (the superellipse factor, |cos| at the back)
  let bX = 0, bZ = 0, bC = 0;
  function basePoint(th: number, row: Row): void {
    const a = absI(th), s = sinF(th) * 4, c = cosF(th) * 4;
    if (a > HALFPI16) {
      const wb = mq(row.w, powQ(clampQ(dq(row.dB, P.backDepth)), Q_0_35));
      bX = mq(wb, s); bZ = row.zs - mq(row.dB, absI(c)); bC = absI(c);
      return;
    }
    // the front is sampled uniformly in u (sin theta) and z comes from |u/w|^n + |z/d|^n = 1
    const C = powQ(Q - powQ(absI(s), row.n), row.invN);
    bX = mq(row.w, s); bZ = row.zs + mq(row.dF - row.zs, C); bC = C;
  }
  /** Head surface point: bX, bZ (+ features), fReg, fDir/fDu/fDv, fEx. */
  function headPoint(th: number, row: Row): void {
    basePoint(th, row);
    if (absI(th) > HALFPI16) { fReg = SKIN; fDir = 0; fEx = 0; return; }
    features(bX, row.v, bC, row);
    bZ += fDz;
  }
  const frontZ = (u: number, row: Row): number => {
    const wmax = row.w < 66 ? 66 : row.w;
    const C = clampQ(powQ(Q - powQ(clampQ(dq(absI(u), wmax)), row.n), row.invN));
    features(u, row.v, C, row);
    return row.zs + mq(row.dF - row.zs, C) + fDz;
  };
  // the scalp boundary over |theta| (hair above v < scalpV)
  const cos13 = (am: number): number => Q - cosF(idiv(am * 13, 10)) * 4;
  const hairLine = (th: number): number => {
    const a = absI(th), am = a < A105 ? a : A105, amR = radQ(am);
    let vH = P.hairV + mq(Q_0_04, mq(amR, amR)) + mq(Q_0_11, cos13(am)) - mq(mq(P.recede, Q_0_3), gexp(dq(radQ(a) - Q_0_62, Q_0_22))) + mq(mq(P.peak, Q_0_05), gexp(dq(radQ(th), Q_0_12)));
    if (P.fringe) vH = P.browV - Q_0_07 + mq(Q_0_02, nq(mq(radQ(th), 12 * Q) + 50 * Q, 0, Q, P.salt + 9)) + mq(Q_0_05, cos13(am));
    return vH;
  };
  /** The wrap's front edge sits just above the brows, the hairline hidden. */
  const wrapLine = (th: number): number => { const a = absI(th), am = a < A105 ? a : A105; return P.browV - Q_0_1 + mq(Q_0_02, nq(mq(radQ(th), 10 * Q), 0, Q, P.salt + 9)) + mq(Q_0_03, cos13(am)); };
  const sideburn = P.sideburn + (P.beard !== B_NONE ? Q_0_2 : 0);
  const napeV = P.e + Q_0_62;
  const sideKnotsX = [A105, 3390, 3703, 4563, 5085, 6258, 8218];
  const sideKnotsY = P.hair === H_WRAP
    ? [wrapLine(A105), P.e + Q_0_35, P.e + Q_0_4, P.e + Q_0_45, P.e + Q_0_55, napeV + Q_0_05, napeV + Q_0_05]
    : isCap(P.hair) // pulled back: the hair lies above and behind the ear, no fall over the cheek (Mike, 2026-10-08)
      ? [hairLine(A105), P.e - Q_0_16, P.e - Q_0_24, P.e - Q_0_22, P.e + Q_0_12, napeV - Q_0_04, napeV - Q_0_04]
      : [hairLine(A105), P.e + sideburn, P.e - Q_0_12, P.e - Q_0_1, P.e + Q_0_28, napeV, napeV];
  /** Where the fall of a long style begins, in 1/16 steps from the front. */
  // version 13: the side hairline is a monotone cubic through the knots (a smoothstep between each pair stood flat at
  // every knot, so the edge went level, then dropped, then went level: the hard drop at the ear)
  const sideSpl = monoSpline(sideKnotsX, sideKnotsY);
  const sideStart = P.hair === H_LONG_LOOSE ? a16Of(Q_0_95) : P.hair === H_LONG_SWEPT ? a16Of(Q_0_85) : P.hair === H_CURLS_OUT ? a16Of(Q_0_9) : A105;
  const fall = isFall(P.hair);
  const scalpV = (th: number): number => {
    const a = absI(th);
    if (fall && a >= sideStart) return P.longV;
    if (a < A105) return P.hair === H_WRAP ? wrapLine(th) : hairLine(th);
    return sideSpl(a);
  };
  const hairAt = (th: number, v: number): boolean => {
    if (P.hair === H_BALD) { const a = absI(th); return a > A075 && v > P.crownV + mq(Q_0_5, Q - powQ(dq(a, PI16), Q_0_7)) && v < scalpV(th); }
    if (v >= scalpV(th)) return false;
    if (P.hair === H_SHORT && P.recede > Q_0_85 && v < P.crownV - mq(Q_0_12, cosF(th) * 4) - Q_0_1) return false; // bald crown
    return true;
  };
  /** The fold phase of a wrap's cloth, radians Q16. */
  const foldPhase = (th: number, v: number): number => mq(radQ(th), 4 * Q) + 7 * v;
  /** The hair's thickness; ed, when given, is the distance to the hair's edge across it (version 13: a steep
   *  side boundary is measured across, not straight down, so the hair lies flat against the cheek at its edge). */
  const hairThick = (th: number, v: number, ed = -1): number => {
    let h = P.ht;
    const edge = smQ(dq(ed >= 0 ? ed : scalpV(th) - v, Q_0_28));
    if (P.hair === H_WRAP) {
      h = mq(h, Q + mq(Q_0_3, sinF(a16Of(foldPhase(th, v))) * 4));
      return Q_0_004 + mq(h, Q_0_85 + mq(Q_0_15, edge));
    }
    if (P.hair === H_BALD) h = mq(h, Q_0_35); // version 13: the fringe of a bald head is close-cropped, not a shell
    const topness = smQ(dq(QN_0_1 - v, Q_0_6));
    h = mq(h, lerpQ(P.sideFactor, Q, topness));
    h = mq(h, Q + mq(P.sweep, sinF(th) * 4));
    if (P.quiff) h = mq(h, Q + mq(mq(mq(P.quiff, gexp(dq(radQ(th - (P.partTh >> 1)), Q_0_7))), smQ(dq(v - (-P.craniumH - Q_0_1), Q_0_25))), smQ(dq(QN_0_45 - v, Q_0_35))));
    const thR = radQ(th);
    if (P.hair === H_CURLY) h = mq(h, Q + mq(mq(Q_0_3, nq(mq(thR, 40 * Q) + 100 * Q, 40 * v, 7 * Q, P.salt)), smQ(dq(v + Q_0_75, Q_0_35) + Q_0_3)));
    if (P.hair === H_CURLS_OUT) h = mq(h, Q + mq(mq(Q_0_35, nq(mq(thR, 24 * Q) + 100 * Q, 24 * v, 7 * Q, P.salt)), smQ(dq(v + Q_0_75, Q_0_35) + Q_0_3)));
    if (P.hair === H_TEXTURED || P.hair === H_PIXIE) h = mq(h, Q + mq(mq(Q_0_22, nq(mq(thR, 60 * Q) + 200 * Q, 60 * v, 7 * Q, P.salt + 17)), smQ(dq(v + Q_0_75, Q_0_35) + Q_0_3))); // damped to zero over the crown, no scribble
    if (P.hair === H_BRAIDS && v > P.e + Q_0_1) h = mq(h, Q + mq(Q_0_35, sinF(a16Of(28 * v + 2 * thR)) * 4));
    if ((P.hair === H_LONG || P.hair === H_LONG_LOOSE || P.hair === H_LONG_SWEPT) && v > P.e) h = mq(h, Q + mq(Q_0_3, smQ(v - P.e)));
    return Q_0_004 + mq(h, Q_0_06 + mq(Q_0_94, edge));
  };
  // ---- version 14: the neck's radius at draw time (operator: "kind of a wide neck", a pillar as wide as the jaw). The
  // plan's thickness sets where it falls in a range of the face's half-width at the jaw angle: 0.62 to 0.75 for an
  // adult, 0.6 to 0.68 for the youngest child, never over 0.8 (the plan is unchanged)
  const jawHalf = width(P.jawV);
  const tNeck = clampQ(P.ageT < Q ? dq(P.neckR - q(0.38), q(0.16)) : dq(P.neckR - q(0.42), q(0.38)));
  const kNeck = Math.min(q(0.8), lerpQ(q(0.6) + mq(q(0.08), tNeck), q(0.62) + mq(q(0.13), tNeck), P.ageT));
  const neckRe = mq(jawHalf, kNeck);
  /** The neck's radius at v: a little in under the jaw, widening toward the shoulders (its sides gentle curves). */
  const neckAt = (v: number): number => mq(neckRe, Q - mq(Q_0_05, gexp(dq(v - P.chin - Q_0_06, Q_0_12))) + mq(q(0.14), smQ(dq(v - P.chin, q(0.65)))));
  // ---- version 14: the ear, from the template (EAR_*) and the plan's ear parameters (the plan is unchanged)
  const youth = clampQ(Q - P.ageT); // 1 for the youngest child, 0 from adulthood
  /** The ear's height: the plan's length x 1.15, a child's smaller. */
  const earH = mq(mq(P.earLen, q(1.15)), Q - mq(q(0.14), youth));
  /** The width over the template's: 1.7 to 2 times as tall as wide from the plan's depth; a child's rounder. */
  const earKx = mq(q(0.89) + mq(dq(clampI(P.earD - Q_0_1, 0, Q_0_04), Q_0_04), Q_0_15), Q + mq(Q_0_12, youth));
  /** An old person's lobe longer (up to 6% of the ear's height). */
  const earLobe = mq(Q_0_06, P.oldT);
  /** The top halfway from the plan's ear top to the brow line. */
  const earTop = (P.earV0 + P.browV) >> 1, earBot = earTop + earH + mq(earLobe, earH);
  // tilted back 10 to 20 degrees (salt bits), standing off the head toward the back at 12 to 32 degrees (the flare)
  const tau = degA(q(10)) + idiv(((P.salt >>> 25) & 15) * degA(q(10)), 15), cT = cosF(tau) * 4, sT = sinF(tau) * 4;
  const psi = degA(q(12)) + idiv(clampI(P.earFlare - Q_0_1, 0, Q_0_5) * degA(q(20)), Q_0_5), cPsi = cosF(psi) * 4, sPsi = sinF(psi) * 4;
  /** The front edge's depth: just behind the jaw hinge. */
  const earZF = QN_0_08 + mq(P.earD, Q_0_6);
  const earXc = mq(mq(EAR_C[0]!, earKx), earH), earYc = earTop + mq(EAR_C[1]!, earH);
  /** The ear is rigid: its plane stands on the head's width at its centre (following the width down the ear sheared it). */
  const earW = width(earYc);
  /** The template's point (x, y) on the ear's plane: eX back from the attachment, eY the head's v. */
  const earPlane = (x: number, y: number): void => {
    const yw = y + mq(earLobe, smQ(dq(y - q(0.62), q(0.38))));
    const dx = mq(mq(x - EAR_C[0]!, earKx), earH), dy = mq(yw - EAR_C[1]!, earH);
    eX = earXc + mq(dx, cT) - mq(dy, sT); eY = earYc + mq(dx, sT) + mq(dy, cT);
  };
  /** The template's point (x, y) raised h (head units) off the ear's plane, head space: eU, eV, eZ. */
  const earPt = (side: number, x: number, y: number, h: number): void => {
    earPlane(x, y);
    eU = side * (earW + Q_0_02 + mq(eX, sPsi) + mq(h, cPsi)); eV = eY; eZ = earZF - mq(eX, cPsi) + mq(h, sPsi);
  };
  /** Polar coordinates in the concha round EAR_CC: the fraction of the way to its rim (Q16; over 1 outside). */
  const conchaRho = (x: number, y: number): number => {
    const cx = x - EAR_CC[0]!, cy = y - EAR_CC[1]!, R = polarAt(EAR_RC, atan2i(cy, cx) * 16);
    return dq(isqrt(cx * cx + cy * cy), R > 0 ? R : 1);
  };
  /** The distance from (x, y) to the crus of the helix (its control polygon, close enough for a ridge's width). */
  const crusDist = (x: number, y: number): number => {
    let best = 1 << 30;
    for (let k = 0; k + 3 < EAR_L_CRUS.length; k += 2) {
      const ax = EAR_L_CRUS[k]!, ay = EAR_L_CRUS[k + 1]!, bx = EAR_L_CRUS[k + 2]!, by = EAR_L_CRUS[k + 3]!, vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy, t = clampI(idiv((x - ax) * vx + (y - ay) * vy, (L2 >> 16) || 1), 0, Q);
      const px = ax + mq(vx, t) - x, py = ay + mq(vy, t) - y, d = isqrt(px * px + py * py);
      if (d < best) best = d;
    }
    return best;
  };
  /** The relief off the ear's plane at a template point whose polar coordinates round EAR_C are (phi, r), head units:
   *  the helix rim raised, the scapha a groove, the concha a bowl (deepest toward the canal), the lobe thicker. */
  const earRelief = (x: number, y: number, phi: number, r: number): number => {
    const R = polarAt(EAR_R, phi), Rh = polarAt(EAR_RH, phi), Rs = polarAt(EAR_RS, phi);
    let h = 0;
    if (Rh > 0 && r > Rh) h += mq(q(0.035), sinPi(clampQ(dq(r - Rh, Math.max(R - Rh, 64)))) * 4);
    else if (Rh > 0 && Rs > 0 && r > Rs) h -= mq(q(0.012), sinPi(clampQ(dq(r - Rs, Math.max(Rh - Rs, 64)))) * 4);
    const rc = r > mq(R, Q_0_92) ? Q : conchaRho(x, y); // the concha lies inside 0.92 of the rim
    if (rc < Q) h -= mq(q(0.03), Q - mq(rc, rc));
    if (y > q(0.72)) h += mq(mq(q(0.02), smQ(dq(y - q(0.72), q(0.12)))), Q - powQ(clampQ(dq(r, R)), Q_6));
    return mq(h, earH);
  };
  /** The ear's own tone at a template point (Q16), apart from the light: the concha dark and darkest toward the
   *  canal (lighter on the crus's ridge), the scapha under the rim, the triangular fossa light; the rim, the antihelix
   *  and the lobe none. */
  const earTone = (x: number, y: number, phi: number, r: number): number => {
    const rc = conchaRho(x, y);
    if (rc < Q) {
      const dC = hypotQ(x - q(0.1), y - q(0.5));
      const t = q(0.4) + mq(q(0.32), gexp(dq(dC, q(0.09)))) + mq(q(0.1), gexp(dq(Q - rc, q(0.15))));
      return mq(t, Q - mq(q(0.85), gexp(dq(crusDist(x, y), q(0.025)))));
    }
    const Rh = polarAt(EAR_RH, phi), Rs = polarAt(EAR_RS, phi);
    if (Rh > 0 && r >= Rh) return 0;
    if (Rh > 0 && Rs > 0 && r > Rs) return mq(q(0.28) + mq(q(0.14), dq(r - Rs, Math.max(Rh - Rs, 64))), Q - smQ(dq(y - q(0.6), q(0.14)))); // fading out above the lobe
    return mq(q(0.26), g2(x - q(0.27), y - q(0.18), q(0.075), q(0.035)));
  };
  return { vCap, capA, width, dFront, dBack, rowOf, sliceZ, features, basePoint: (th: number, row: Row) => basePoint(th, row), headPoint, frontZ, hairLine, scalpV, hairAt, hairThick, foldPhase, vm, Lw, browV: browVE, eyeU, ew, uh, lh, kE, eyeR, zcEye, irisA, pupilA, inOpen, lidShade, basisOf, capDir, openAt, gEye: (side: number, k = 0): V3 => { const g = side < 0 ? GL : GR, c = centreOf(side); return k === 0 ? g : norm3([g[0] * (8 - k) + c[0] * k, g[1] * (8 - k) + c[1] * k, g[2] * (8 - k) + c[2] * k]); }, hiOf, upF, loF, eyeC, eyeS, napeV, sideStart, jawHalf, neckRe, neckAt, earH, earTop, earBot, earPlane, earPt, earRelief, earTone, conchaRho, earN: (side: number): V3 => [side * cPsi, 0, sPsi], earPsiS: sPsi, get bX() { return bX; }, get bZ() { return bZ; }, get bC() { return bC; } };
}
type Model = ReturnType<typeof makeModel>;

/* ── The field: every surface splatted at half resolution (depth, normal, region, strand direction) ── */

const NODIR = 0xffff, ZFAR = -(1 << 30);
class Field {
  readonly z = new Int32Array(FW * FH).fill(ZFAR);
  readonly reg = new Uint8Array(FW * FH);
  readonly nx = new Int16Array(FW * FH);
  readonly ny = new Int16Array(FW * FH);
  readonly nz = new Int16Array(FW * FH);
  readonly dir = new Uint16Array(FW * FH).fill(NODIR);
  readonly extra = new Int32Array(FW * FH);
  /** Shade Q16, tone (mark density) Q12, the doubled hatch angle in whole steps. */
  readonly shade = new Int32Array(FW * FH);
  readonly tone = new Int32Array(FW * FH);
  readonly hd2 = new Uint16Array(FW * FH);
  /** Stage two: the plane's crossing direction (whole steps, undirected 0..511) for the core shadow's second layer. */
  readonly pd = new Uint16Array(FW * FH);
  /** Version 14: which surface is nearest: 1 a ponytail's hanging mass (its edge is the hair's soft outline), 2 the neck, 3 the head. */
  readonly tail = new Uint8Array(FW * FH);
  /** Version 14, for the ponytail test only: the nearest neck or lower-face (jaw) depth at each pixel, whatever is in front of it. */
  zNJ: Int32Array | null = null;
}
/** The composition: the cranium half-width R in raster units, the head's centre. */
const RU = idiv(AHU, 5);
const STEPS_OF = (radQ16: number): number => idiv(radQ16 * 1024, TAUQ);

// a splatted point reports through these
let sX = 0, sY = 0, sZ = 0, sReg = 0, sDir = 0, sD0 = 0, sD1 = 0, sEx = 0, sNJ = 0;

/**
 * Splat a parametric grid: fn(i, j) fills sX, sY (raster units), sZ (depth, Q16 head units), sReg, sDir
 * with sD0/sD1 (a Q14 direction in grid steps), sEx, or returns false to skip. Normals come from the
 * grid neighbours (one cross product of integer differences, normalised by isqrt, viewer-facing); the
 * z-buffer keeps the nearest.
 */
function splat(F: Field, nA: number, nB: number, fn: (i: number, j: number) => boolean, wrapA: boolean, tail = 0): void {
  const N = nA * nB, X = new Int32Array(N), Y = new Int32Array(N), Z = new Int32Array(N), R = new Uint8Array(N), D0 = new Int16Array(N), D1 = new Int16Array(N), HD = new Uint8Array(N), EX = new Int32Array(N), OK = new Uint8Array(N);
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
    sNJ = 0;
    if (!fn(i, j)) continue;
    const k = j * nA + i;
    if (F.zNJ && sNJ) { const px = idiv(sX + 32, 64), py = idiv(sY + 32, 64); if (px >= 0 && py >= 0 && px < FW && py < FH && sZ > F.zNJ[py * FW + px]!) F.zNJ[py * FW + px] = sZ; }
    OK[k] = 1; X[k] = sX; Y[k] = sY; Z[k] = sZ; R[k] = sReg; HD[k] = sDir; D0[k] = sD0; D1[k] = sD1; EX[k] = sEx;
  }
  const RU8 = RU * 8;
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
    const k = j * nA + i;
    if (!OK[k]) continue;
    // the depth test first: a hidden point needs no normal (the same field, less work)
    const px = idiv(X[k]! + 32, 64), py = idiv(Y[k]! + 32, 64);
    if (px < 0 || py < 0 || px >= FW || py >= FH) continue;
    const q0 = py * FW + px, hidden = Z[k]! <= F.z[q0]!;
    const ia = wrapA ? (i + 1) % nA : Math.min(nA - 1, i + 1), ib = wrapA ? (i + nA - 1) % nA : Math.max(0, i - 1);
    const ja = Math.min(nB - 1, j + 1), jb = Math.max(0, j - 1);
    const ka = j * nA + ia, kb = j * nA + ib, kc = ja * nA + i, kd = jb * nA + i;
    let sA = false, sC = false;
    if (ka !== k && OK[ka]) { const ddx = absI(X[ka]! - X[k]!), ddy = absI(Y[ka]! - Y[k]!), m = ddx > ddy ? ddx : ddy; sA = m > 64 && m <= 1024; }
    if (kc !== k && OK[kc]) { const ddx = absI(X[kc]! - X[k]!), ddy = absI(Y[kc]! - Y[k]!), m = ddx > ddy ? ddx : ddy; sC = m > 64 && m <= 1024; }
    if (hidden && !sA && !sC) continue;
    const xa = OK[ka] ? ka : k, xb = OK[kb] ? kb : k, xc = OK[kc] ? kc : k, xd = OK[kd] ? kd : k;
    const ax = (X[xa]! - X[xb]!) * 8, ay = (Y[xa]! - Y[xb]!) * 8, azp = mq(Z[xa]! - Z[xb]!, RU8);
    const bx = (X[xc]! - X[xd]!) * 8, by = (Y[xc]! - Y[xd]!) * 8, bzp = mq(Z[xc]! - Z[xd]!, RU8);
    let nx = ay * bzp - azp * by, ny = azp * bx - ax * bzp, nz = ax * by - ay * bx;
    const L = isqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx = idiv(nx * 16384, L); ny = idiv(ny * 16384, L); nz = idiv(nz * 16384, L);
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const dir = HD[k] ? atan2i(ay * D0[k]! + by * D1[k]!, ax * D0[k]! + bx * D1[k]!) : NODIR;
    if (!hidden) { F.z[q0] = Z[k]!; F.reg[q0] = R[k]!; F.nx[q0] = nx; F.ny[q0] = ny; F.nz[q0] = nz; F.extra[q0] = EX[k]!; F.dir[q0] = dir; F.tail[q0] = tail; }
    // version 13: where the surface stretches past a field pixel between grid neighbours (the side of a superellipse
    // turns fast in depth), the gap is filled along the segment, so no crack opens down a turned head or its hair
    for (let e2 = 0; e2 < 2; e2++) {
      if (!(e2 ? sC : sA)) continue;
      const kn = e2 ? kc : ka, ddx = X[kn]! - X[k]!, ddy = Y[kn]! - Y[k]!, m = absI(ddx) > absI(ddy) ? absI(ddx) : absI(ddy);
      const n = idiv(m + 47, 48);
      for (let s2 = 1; s2 < n; s2++) {
        const qx = idiv(X[k]! + idiv(ddx * s2, n) + 32, 64), qy = idiv(Y[k]! + idiv(ddy * s2, n) + 32, 64);
        if (qx < 0 || qy < 0 || qx >= FW || qy >= FH) continue;
        const q1 = qy * FW + qx, zz = Z[k]! + idiv((Z[kn]! - Z[k]!) * s2, n);
        if (zz <= F.z[q1]!) continue;
        F.z[q1] = zz; F.reg[q1] = R[k]!; F.nx[q1] = nx; F.ny[q1] = ny; F.nz[q1] = nz; F.extra[q1] = EX[k]!; F.dir[q1] = dir; F.tail[q1] = tail;
      }
    }
  }
}

function setDir(d0: number, d1: number): void { const L = isqrt(d0 * d0 + d1 * d1) || 1; sDir = 1; sD0 = idiv(d0 * 16384, L); sD1 = idiv(d1 * 16384, L); }
const sq = (x: number): number => mq(x, x);
const hypotQ = (a: number, b: number): number => isqrt(a * a + b * b);

/**
 * Version 14: a ponytail's path, a Catmull-Rom curve through control points (head space, or body space for the tail
 * over one shoulder), so that it shows only behind the head and neck except where it truly comes forward:
 *  - High: from the tie up and back above the crown (the mass shows over the head's top), then down behind the head
 *    and the neck.
 *  - Low: from the tie at the nape straight down behind the neck (a frontal head hides it but for the tie's tuft).
 *  - Over one shoulder (body space): from the tie behind the neck's base, behind the torso's top, over the shoulder
 *    clear of the neck's fillet, and down onto the chest below the collarbone; the near shoulder, the side it is tied
 *    on (version 13 tied it on the near side and hung it over the far one, where a turned body shows only its edge). (Version 13 brought it forward beside
 *    the neck: a strap down the side of the neck, in front of the jaw.)
 * len is the curve's length, roughly, for the splat's density.
 */
interface PonyPath { pts: V3[]; body: boolean; braid: boolean; len: number; start: number; taper: number }
function ponyPath(P: V14Plan, M: Model): PonyPath | null {
  // a single braid over the shoulder takes the same way as a tail over one shoulder (version 13's lay across the front
  // of the narrower neck); down the back it stays version 13's
  const braid = P.hair === H_BRAID_ONE && !P.braidBack;
  if (!isPony(P.hair) && !braid) return null;
  const t: V3 = braid ? [nearSide(P) * Q_0_3, M.napeV - Q_0_1, QN_0_4] : tieOf(P, M), w = braid ? Q_0_1 : P.ponyW, side = braid || P.hair === H_PONY_SHOULDER ? nearSide(P) : absI(P.yaw) > degA(Q_15) ? sgn(P.yaw) : P.sweptSide, dN = P.backDepth;
  const shV = P.chin + P.neckLen, endV = braid ? shV + Q_1_3 : shV + Q_0_5 + mq(P.ponyLen, Q_0_9); // over a shoulder it hangs the length of the plan's tail
  let pts: V3[];
  // below the nape a hanging tail lies against the back of the neck (version 13 hung it a skull's depth behind: a gap of
  // ground between the neck and the tail on a turned head)
  const neckBack = QN_0_1 - Q_0_12 - mq(M.neckRe, Q_1_12);
  if (P.hair === H_PONY_HIGH) {
    const top = -P.craniumH - mq(P.ht, Q_0_5);
    pts = [t, [0, top + mq(w, Q_0_3), t[2] - Q_0_35], [side * Q_0_06, M.napeV - Q_0_1, -(dN + Q_0_3 + (w >> 1))], [side * Q_0_12, M.napeV + Q_0_35 + mq(P.ponyLen, Q_0_6), neckBack - mq(w, Q_0_7) - Q_0_08]];
  } else if (P.hair === H_PONY_LOW) {
    pts = [t, [0, t[1] + Q_0_3, neckBack - mq(w, Q_0_55)], [side * Q_0_08, t[1] + Q_0_3 + mq(P.ponyLen, Q_0_6), neckBack - mq(w, Q_0_6)]];
  } else {
    const fil = filletOf(P, shV, M.neckRe), uS = fil.u1 + mq(w, Q_0_9), vT = torsoTop(P, shV, uS), rN = fil.rb;
    const vC = shV + Q_0_4, uC = uS - mq(w, Q_0_2), uD = uS - mq(w, Q_0_45);
    const u2 = mq(uS, Q_0_8);
    // it comes round from behind under the shoulder's top edge (hidden there by the torso) and shows from the shoulder line
    // down, narrow where it comes into view (ponyG), on the chest below the collarbone
    const vB = vT + (w >> 1);
    pts = [t, [side * mq(rN, Q_0_25), shV - Q_0_1, QN_0_1 - rN - Q_0_15 - w], [side * u2, torsoTop(P, shV, u2) + w + Q_0_06, QN_0_45 - w], [side * uS, vB, torsoZ(P, shV, uS, vB) + mq(w, Q_0_3)],
      [side * uC, vC, torsoZ(P, shV, uC, vC) + mq(w, Q_0_6)], [side * uD, endV, torsoZ(P, shV, uD, endV) + mq(w, Q_0_6)]];
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!; len += isqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]) + (b[2] - a[2]) * (b[2] - a[2])); }
  const body = P.hair === H_PONY_SHOULDER || braid;
  return { pts, body, braid, len: len + Q_0_3, start: body ? q(0.6) : 0, taper: body ? q(0.8) : Q_0_15 };
}
/** A tail's radius along it (Q16 of the plan's width): gathered at the tie (or, over a shoulder, narrow where it comes
 *  into view at `start`), swelling, then from `taper` on narrowing to a fine point (version 13 ended it at a quarter of
 *  its width: a blunt end read as a knot). */
const ponyG = (pp: PonyPath, s: number): number => {
  if (s < pp.start) return Q_0_45;
  const s0 = s - pp.start, g0 = pp.body ? Q_0_5 : Q_0_45, r0 = pp.body ? Q_0_2 : Q_0_15;
  return s0 < r0 ? g0 + mq(Q - g0, smQ(dq(s0, r0))) : s < pp.taper ? Q : Q - mq(q(0.94), powQ(dq(s - pp.taper, Q - pp.taper), Q_2_2));
};
let pX = 0, pY = 0, pZ = 0;
const pT: V3 = [0, 0, 0], pN1: V3 = [0, 0, 0], pN2: V3 = [0, 0, 0];
/** The point at s (Q16 along the whole path) on a tail's path: pX, pY, pZ; its tangent pT and two unit normals pN1, pN2. */
function ponyAt(pp: PonyPath, s: number): void {
  const c = pp.pts, n = c.length, u = s * (n - 1);
  let i = Math.floor(u / Q);
  if (i > n - 2) i = n - 2;
  const f = u - i * Q, f2 = mq(f, f), f3 = mq(f2, f), g = (k: number): V3 => c[k < 0 ? 0 : k > n - 1 ? n - 1 : k]!;
  const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2), d: number[] = [];
  const at = (o: number): number => (2 * p1[o]! + mq(p2[o]! - p0[o]!, f) + mq(2 * p0[o]! - 5 * p1[o]! + 4 * p2[o]! - p3[o]!, f2) + mq(3 * p1[o]! - 3 * p2[o]! + p3[o]! - p0[o]!, f3)) >> 1;
  for (let o = 0; o < 3; o++) d.push((p2[o]! - p0[o]! + mq(2 * (2 * p0[o]! - 5 * p1[o]! + 4 * p2[o]! - p3[o]!), f) + mq(3 * (3 * p1[o]! - 3 * p2[o]! + p3[o]! - p0[o]!), f2)) >> 1);
  pX = at(0); pY = at(1); pZ = at(2);
  const T = norm3([d[0]!, d[1]!, d[2]!]), ref: V3 = absI(T[2]) < Q_0_9 ? [0, 0, Q] : [Q, 0, 0];
  const n1 = norm3([mq(T[1], ref[2]) - mq(T[2], ref[1]), mq(T[2], ref[0]) - mq(T[0], ref[2]), mq(T[0], ref[1]) - mq(T[1], ref[0])]);
  pT[0] = T[0]; pT[1] = T[1]; pT[2] = T[2]; pN1[0] = n1[0]; pN1[1] = n1[1]; pN1[2] = n1[2];
  pN2[0] = mq(T[1], n1[2]) - mq(T[2], n1[1]); pN2[1] = mq(T[2], n1[0]) - mq(T[0], n1[2]); pN2[2] = mq(T[0], n1[1]) - mq(T[1], n1[0]);
}
/** Where a ponytail is tied, head space. */
function tieOf(P: V14Plan, M: Model): V3 {
  if (P.hair === H_PONY_HIGH) { const v = -P.craniumH + Q_0_35; return [0, v, -(M.dBack(v) + Q_0_02)]; }
  if (P.hair === H_PONY_LOW) { const v = M.napeV - Q_0_05; return [0, v, -(M.dBack(v) + Q_0_03)]; }
  return [nearSide(P) * Q_0_2, M.napeV - Q_0_05, QN_0_35];
}
/** The side of the picture a tail or braid comes over: the near side when the head is turned, else the stream's. */
const nearSide = (P: V14Plan): number => (absI(P.yaw) > degA(Q_15) ? -sgn(P.yaw) : P.sweptSide);

interface Pose { cx: number; cy: number; xf: (x: number, y: number, z: number) => void; xfBody: (x: number, y: number, z: number) => void }
let tX = 0, tY = 0, tZ = 0;
function makePose(P: V14Plan): Pose {
  const faceDir = sgn(P.yaw) || 1, turned = absI(P.yaw) > degA(Q_12);
  const cx = idiv(AWU * (50 - (turned ? faceDir * 5 : faceDir * 2)), 100), cy = idiv(AHU * (P.hair === H_BUN_HIGH ? 49 : 42), 100); // a high bun needs headroom
  const cyw = cosF(P.yaw), syw = sinF(P.yaw), cp = cosF(P.pitch), sp = sinF(P.pitch), cr = cosF(P.roll), sr = sinF(P.roll);
  const xf = (x0: number, y0: number, z0: number): void => {
    const x = Math.floor((x0 * cyw + z0 * syw) / 16384), z = Math.floor((-x0 * syw + z0 * cyw) / 16384);
    const y2 = Math.floor((y0 * cp + z * sp) / 16384), z2 = Math.floor((-y0 * sp + z * cp) / 16384);
    tX = cx + mq(Math.floor((x * cr - y2 * sr) / 16384), RU); tY = cy + mq(Math.floor((x * sr + y2 * cr) / 16384), RU); tZ = z2;
  };
  const byaw = idiv(P.yaw * 45, 100), cb = cosF(byaw), sb = sinF(byaw), rb = idiv(P.roll * 30, 100), cbr = cosF(rb), sbr = sinF(rb);
  const xfBody = (x0: number, y0: number, z0: number): void => {
    const x = Math.floor((x0 * cb + z0 * sb) / 16384), z = Math.floor((-x0 * sb + z0 * cb) / 16384);
    tX = cx + mq(Math.floor((x * cbr - y0 * sbr) / 16384), RU); tY = cy + mq(Math.floor((x * sbr + y0 * cbr) / 16384), RU); tZ = z;
  };
  return { cx, cy, xf, xfBody };
}

/** The neckline in body (u, v): skin above it; ZFAR for none. */
function necklineOf(P: V14Plan, shV: number): (u: number) => number {
  const g = P.garment;
  return (u: number): number => {
    const au = absI(u);
    if (g === G_CREW) return au < Q_0_75 ? shV + Q_0_1 + mq(Q_0_14, Q - sq(dq(u, Q_0_75))) : ZFAR;
    if (g === G_SCOOP) return au < Q_0_9 ? shV + Q_0_1 + mq(Q_0_5, Q - sq(dq(u, Q_0_9))) : ZFAR;
    if (g === G_VEE) return au < Q_0_6 ? shV + Q_0_05 + mq(Q_0_75, Q - dq(au, Q_0_6)) : ZFAR;
    if (g === G_COLLAR) return au < Q_0_4 ? shV + Q_0_05 + mq(Q_0_5, Q - dq(au, Q_0_4)) : ZFAR;
    if (g === G_LAPEL) return au < Q_0_6 ? shV + Q_0_02 + mq(Q_1_15, Q - dq(au, Q_0_6)) : ZFAR;
    if (g === G_BOAT) return au < Q_1_25 ? shV + Q_0_02 + mq(Q_0_12, Q - sq(dq(u, Q_1_25))) : ZFAR;
    if (g === G_BLOUSE) return au < Q_0_5 ? shV + Q_0_04 + mq(Q_0_55, Q - powQ(dq(au, Q_0_5), Q_1_5)) : ZFAR;
    if (g === G_WRAP) return au < Q_0_65 ? shV + Q_0_03 + mq(Q_0_85, Q - dq(au, Q_0_65)) : ZFAR;
    if (g === G_SHAWL) return au < Q_0_8 ? shV + Q_0_08 + mq(Q_0_2, Q - sq(dq(u, Q_0_8))) : ZFAR;
    return ZFAR; // turtleneck, high collar: no skin
  };
}

function buildField(P: V14Plan, M: Model, pose: Pose): Field {
  const F = new Field();
  if (ponyLog) F.zNJ = new Int32Array(FW * FH).fill(ZFAR);
  const { xf, xfBody } = pose;
  const C145 = 145, hair = P.hair;
  // ---- head
  {
    const vTop = -P.craniumH, vBot = P.chin + Q_0_05 + P.beardLen, span = vBot - vTop;
    const nTh = cdiv(mq(Q_10_47721, RU), 64), nV = cdiv(mq(span, RU) * C145, 6400); // 1.45 samples a field px around 1.15 R, and down the head
    const dTh = idiv(TAUQ, nTh), dV = idiv(span, nV - 1);
    let row: Row = M.rowOf(vTop), rowJ = -1;
    splat(F, nTh, nV, (i, j) => {
      if (j !== rowJ) { rowJ = j; row = M.rowOf(vTop + idiv(span * j, nV - 1)); }
      const th = -PI16 + idiv(A16 * i, nTh);
      M.headPoint(th, row);
      xf(M.bX, row.v, M.bZ);
      sX = tX; sY = tY; sZ = tZ; sReg = fReg; sEx = fEx; sDir = 0; sNJ = row.v >= P.noseBase && absI(th) <= degA(q(110)) ? 1 : 0; // the jaw region (the ponytail test)
      if (fDir) { // head-local tangent [du, dv] -> grid steps
        const c = absI(cosF(th) * 4), w = mq(row.w < Q_0_05 ? Q_0_05 : row.w, c < Q_0_15 ? Q_0_15 : c);
        setDir(mq(dq(fDu, w), dTh) * 256, mq(fDv, dV) * 256);
      }
      return true;
    }, true, 3);
  }
  // ---- hair (an offset surface), the fall of the long styles, buns, a single braid; or a wrap
  {
    const vTop = -P.craniumH, vBotL = isFall(hair) ? P.longV : 0, vBot = Math.max(P.chin + Q_0_05, vBotL), span = vBot - vTop;
    const nTh = cdiv(mq(Q_11_38827, RU), 64), nV = cdiv(mq(span, RU) * C145 * 11, 64000);
    const thCol = new Int32Array(nTh), hlCol = new Int32Array(nTh);
    for (let i = 0; i < nTh; i++) { thCol[i] = -PI16 + idiv(A16 * i, nTh); hlCol[i] = M.hairLine(thCol[i]!); }
    const vp = -P.craniumH + Q_0_1, vRef = P.e + Q_0_1, rowRef = M.rowOf(vRef);
    const scalpCol = new Int32Array(nTh);
    for (let i = 0; i < nTh; i++) scalpCol[i] = M.scalpV(thCol[i]!);
    // version 13: the hairline's slope per column (v per radian), so the edge taper measures across the boundary
    const corr = new Int32Array(nTh);
    for (let i = 0; i < nTh; i++) { const dTh2 = radQ((((thCol[(i + 1) % nTh]! - thCol[(i + nTh - 1) % nTh]!) % A16) + A16) % A16) || 1, sl = dq(scalpCol[(i + 1) % nTh]! - scalpCol[(i + nTh - 1) % nTh]!, dTh2), s2 = mq(sl, sl); corr[i] = s2 > 400 * Q ? Q : dq(Q, sqrtQ(Q + s2)); } // a jump (a fall beside the cap) is no slope
    // version 13: a long fall's front edge tucks behind the ear: from the temple it sweeps back past the ear
    // (about 109 degrees from the front at the ear's height), then eases forward a little below the lobe
    const tuckA = hair === H_LONG || hair === H_LONG_LOOSE || hair === H_LONG_SWEPT ? Math.max(0, a16Of(q(1.72)) - M.sideStart) : 0, earTop = M.earTop, earBot = M.earBot; // version 14: the new ear
    const hlT = M.hairLine(M.sideStart), tuck = (v: number): number => mq(tuckA, mq(smQ(dq(v - hlT, Math.max(Q_0_1, earTop + Q_0_05 - hlT))), Q - mq(Q_0_7, smQ(dq(v - earBot, Q_0_6)))));
    const fall = isFall(hair), wk = hair === H_BOB ? QN_0_1 : hair === H_BRAIDS ? QN_0_04 : hair === H_LONG_LOOSE ? Q_0_08 : Q_0_06;
    let row: Row = rowRef, rowJ = -1;
    splat(F, nTh, nV, (i, j) => {
      const th = thCol[i]!, v = vTop + idiv(span * j, nV - 1);
      if (j === 0 || v >= scalpCol[i]!) return false;
      if (!M.hairAt(th, v)) return false;
      const a = absI(th), thR = radQ(th);
      // the distance to the hair's edge, across it (version 13): for a fall the hair is the cap (above the hairline)
      // united with the fall (behind its front edge), and the union's distance is the larger of the two
      let ed = mq(scalpCol[i]! - v, corr[i]!);
      if (fall) {
        const nz1 = nq(6 * v + 40 * Q, th > 0 ? Q : 2 * Q, Q, P.salt + 13);
        const shift = hair === H_LONG_LOOSE ? mq(QN_0_1, smQ(v - P.e)) + mq(Q_0_08, nz1) : hair === H_LONG_SWEPT ? mq(QN_0_15, smQ(v - P.e)) + mq(Q_0_08, nz1) : hair === H_CURLS_OUT ? mq(Q_0_15, nz1) : mq(Q_0_35, smQ(dq(v - P.e, Q_1_1))) + mq(Q_0_12, nz1);
        const sh16 = a16Of(shift), tk = tuck(v), aE = M.sideStart + (tk > sh16 ? tk : sh16), dC = hlCol[i]! - v;
        if (a >= M.sideStart) {
          if (hair === H_BRAIDS && v > vRef + Q_0_15) return false; // the two braids are tubes below (drawn after the cap)
          if (hair === H_LONG_SWEPT && sgn(th) !== P.sweptSide && v > vRef + Q_0_15) return false; // the other side is swept over
          if (a < aE && dC <= 0) return false; // the fall's front edge, uneven, behind the ear (above the hairline the cap stays whole)
          if (v > P.longV - Q_0_12 - mq(Q_0_15, nq(mq(thR, 10 * Q) + 300 * Q, 0, Q, P.salt + 11))) return false; // ragged ends
        }
        const dA = radQ(a - aE);
        ed = dA > dC ? dA : dC;
        if (ed < 0) ed = 0;
      }
      const h = M.hairThick(th, v, ed);
      let px: number, pz: number;
      if (j !== rowJ) { rowJ = j; row = M.rowOf(v); }
      // version 13: the fall hangs from the skull's widest slice, blended in over a band (down the head and round
      // from the face), so the hair beside the face never steps out where the hanging begins
      const wH0 = mq(smQ(dq(v - (vRef - Q_0_5), Q_0_6)), smQ(dq(a - mq(A1, Q_0_75), mq(A1, Q_0_5)))), wH1 = smQ(dq(v - (vRef + Q_0_3), Q_0_4)), wH = !fall ? 0 : wH0 > wH1 ? wH0 : wH1; // short hair follows the head at the nape, it does not hang out from the skull's widest slice
      if (wH < Q) { M.basePoint(th, row); px = M.bX; pz = M.bZ; } else { px = 0; pz = 0; }
      if (wH > 0) {
        M.basePoint(th, rowRef);
        const dvr = v > vRef ? v - vRef : 0;
        let hx = mq(M.bX, Q + mq(wk, dvr)), hz = mq(M.bZ, Q + mq(Q_0_03, dvr));
        if (hair === H_LONG_LOOSE || hair === H_CURLS_OUT) hz += mq(Q_0_25, smQ(dq(dvr, Q_0_6))); // in front of the shoulders
        if (hair === H_LONG_SWEPT) { hx -= P.sweptSide * mq(Q_0_3, smQ(dq(dvr - Q_0_4, Q_0_8))); hz += mq(Q_0_35, smQ(dq(dvr - Q_0_3, Q_0_6))); }
        px = wH >= Q ? hx : px + mq(hx - px, wH); pz = wH >= Q ? hz : pz + mq(hz - pz, wH);
      }
      // radial offset from the cranium centre
      const dx = px, dy = mq((v < vRef ? v : vRef) - M.vCap, Q_0_6), dz = pz, L = isqrt(dx * dx + dy * dy + dz * dz) || 1;
      xf(px + idiv(h * dx, L), v + idiv(h * dy, L), pz + idiv(h * dz, L));
      sX = tX; sY = tY; sZ = tZ;
      if (hair === H_WRAP) { sReg = WRAP; sEx = mq(Q_0_2, sinF(a16Of(M.foldPhase(th, v))) * 4); setDir(Q_0_868, QN_0_496); return true; }
      sReg = HAIR; sEx = Q - smQ(dq(scalpCol[i]! - v, Q_0_14));
      // strand direction in parameter space
      let d0 = mq(radQ(wrapPi16(th - P.partTh)), Q_0_6), d1 = v - vp + Q_0_35;
      if (v > vRef) d0 = mq(d0, Q_0_2);
      if (hair === H_CURLY || hair === H_CURLS_OUT) {
        const f = hair === H_CURLY ? 30 : 18, amp = hair === H_CURLY ? Q_0_85 : Q_0_95;
        const an = (atan2i(d1, d0) + STEPS_OF(mq(mq(amp, nq(mq(thR, f * Q), f * v, 5 * Q, P.salt + 3)), smQ(dq(v + Q_0_8, Q_0_4) + Q_0_25)))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hair === H_TEXTURED || hair === H_PIXIE) {
        if (hair === H_PIXIE) { d0 = -sgn(th) * Q_0_7; d1 = Q_0_5; }
        const an = (atan2i(d1, d0) + STEPS_OF(mq(mq(Q_0_5, nq(mq(thR, 50 * Q), 50 * v, 4 * Q, P.salt + 19)), smQ(dq(v + Q_0_8, Q_0_4) + Q_0_25)))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hair === H_LONG || hair === H_BOB || hair === H_LONG_LOOSE || hair === H_LONG_SWEPT) {
        const an = (atan2i(d1, d0) + STEPS_OF(mq(Q_0_25, nq(mq(thR, 20 * Q), 20 * v, 6 * Q, P.salt + 5)))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hair === H_BRAIDS && v > vRef + Q_0_15) {
        const an = (256 + 98 * sgn(sinF(a16Of(28 * v + 2 * thR)))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hasParting(hair)) {
        const dd = wrapPi16(th - P.partTh);
        d0 = sgn(dd) * mq(Q_0_9, smQ(dq(QN_0_3 - v, Q_0_6))) + mq(d0, Q_0_3);
      } else if (hair === H_TIED || hair === H_BUN_HIGH || hair === H_BUN_LOW || hair === H_BRAID_ONE || isPony(hair)) { // combed toward the bun, the nape or the tie
        const target = hair === H_BRAID_ONE ? M.napeV : isPony(hair) ? tieOf(P, M)[1] : P.bunV, dv = clampI(target - v, -Q, Q);
        d0 = sgn(th) * Q_0_8; d1 = mq(dv, Q_0_8);
        if (d0 === 0) d0 = Q_0_1;
      }
      setDir(d0, d1);
      return true;
    }, true);
    if (hasBun(hair)) {
      const rb = P.bunR, bunV = P.bunV;
      const bc: V3 = hair === H_BUN_HIGH ? [0, -P.craniumH - mq(rb, Q_0_55) + Q_0_1, QN_0_3] : [0, bunV, -(M.dBack(bunV) + mq(rb, hair === H_BUN_LOW ? Q_0_5 : Q_0_55))];
      // buns are loose masses of loops: the radius lumps with three lobed waves and the hatching swirls round it
      const loose = bunLoose(hair), sy = hair === H_BUN_HIGH ? Q_0_82 : Q, ph = P.salt & (A16 - 1);
      const n = cdiv(mq(mq(Q_9_1106, loose ? mq(rb, Q_1_3) : rb), RU), 64) + 8, nb = n >> 1;
      splat(F, n, nb, (i, j) => {
        const a = idiv(A16 * i, n), b = idiv(PI16 * j, nb - 1), sb = sinF(b) * 4, r = loose ? bunRad(P, a, b, loose) : rb;
        xf(bc[0] + mq(mq(r, sb), cosF(a) * 4), bc[1] + mq(mq(r, cosF(b) * 4), sy), bc[2] + mq(mq(r, sb), sinF(a) * 4));
        sX = tX; sY = tY; sZ = tZ; sReg = HAIR; sEx = 0;
        if (loose) setDir(Q, mq(Q_0_9, sinF(2 * a + 3 * b + ph) * 4)); else setDir(Q, 0);
        return true;
      }, true);
    }
    // braids: tubes along a curve with a chevron texture; one down the back or over a shoulder, or two from
    // behind the ears down the front of the shoulders
    const braids: Array<[V3, V3, V3]> = [];
    const shV0 = P.chin + P.neckLen, nV0 = M.napeV;
    if (hair === H_BRAID_ONE && P.braidBack) braids.push([[0, nV0 - Q_0_15, QN_0_45], [0, nV0 + Q_0_6, QN_0_55], [0, nV0 + Q_1_4, QN_0_6]]); // over the shoulder: ponyPath()
    if (hair === H_BRAIDS) for (const side of [-1, 1]) braids.push([[side * Q_0_95, P.e + Q_0_2, QN_0_15], [side * Q_0_95, P.chin + Q_0_25, Q_0_3], [side * Q_0_7, P.chin + Q_1_3, Q_0_75]]);
    for (const [p0, p1, p2] of braids) { // braids as version 13 (the ponytails are drawn along their own paths below)
      const r = hair === H_BRAIDS ? Q_0_085 : Q_0_1;
      const nA = cdiv(mq(mq(Q_9_1106, r), RU), 64) + 6, nB = cdiv(mq(Q_1_6, RU) * C145, 6400);
      splat(F, nA, nB, (i, j) => {
        const a = idiv(A16 * i, nA), s = idiv(Q * j, nB - 1), s1 = Q - s, w0 = sq(s1), w1 = 2 * mq(s1, s), w2 = sq(s);
        const cx0 = mq(w0, p0[0]) + mq(w1, p1[0]) + mq(w2, p2[0]), cy0 = mq(w0, p0[1]) + mq(w1, p1[1]) + mq(w2, p2[1]), cz0 = mq(w0, p0[2]) + mq(w1, p1[2]) + mq(w2, p2[2]);
        const ph = sinF(a16Of(mq(s, 40 * Q))) * 4, rr = mq(r, Q + mq(Q_0_15, ph));
        const ca = cosF(a) * 4;
        xf(cx0 + mq(rr, ca), cy0, cz0 + mq(rr, sinF(a) * 4));
        sX = tX; sY = tY; sZ = tZ; sReg = HAIR; sEx = 0;
        setDir(sgn(ca) * sgn(ph) * Q_0_7, Q);
        return true;
      }, true);
    }
    // version 14: a ponytail along its path (ponyPath()), its cross-section square to the path, marked as a tail so its
    // edge takes the hair's soft outline
    const pp = ponyPath(P, M);
    if (pp) {
      const r = pp.braid ? Q_0_1 : P.ponyW, nA = cdiv(mq(mq(Q_9_1106, r), RU), 64) + 6, nB = cdiv(mq(pp.len, RU) * C145, 6400) + 2;
      let rowJ = -1, rr = 0, ph = 0;
      splat(F, nA, nB, (i, j) => {
        const a = idiv(A16 * i, nA), s = idiv(Q * j, nB - 1);
        if (j !== rowJ) { // the path's point and frame once a row
          rowJ = j; ph = sinF(a16Of(mq(s, 40 * Q))) * 4;
          rr = pp.braid ? mq(r, (s < pp.start ? Q_0_6 : Q) + mq(Q_0_15, ph)) : mq(r, ponyG(pp, s)) + Q_0_01;
          ponyAt(pp, s);
          if (pp.body && s >= pp.start - Q_0_05) { const zMin = torsoZ(P, shV0, pX, pY) + mq(rr, Q_0_8); if (pZ < zMin) pZ = zMin; } // on the chest, never into it
        }
        const ca = cosF(a) * 4, sa = sinF(a) * 4;
        (pp.body ? xfBody : xf)(pX + mq(rr, mq(pN1[0], ca) + mq(pN2[0], sa)), pY + mq(rr, mq(pN1[1], ca) + mq(pN2[1], sa)), pZ + mq(rr, mq(pN1[2], ca) + mq(pN2[2], sa)));
        sX = tX; sY = tY; sZ = tZ; sReg = HAIR; sEx = 0;
        if (pp.braid) setDir(sgn(ca) * sgn(ph) * Q_0_7, Q);
        else setDir(mq(Q_0_18, nq(mq(s, 24 * Q), mq(radQ(a), 3 * Q), 4 * Q, P.salt + 7)), Q);
        return true;
      }, true, pp.braid ? 0 : 1);
    }
  }
  // ---- ears
  // version 14: the template's outline in polar rings (rho a fraction of the way to the rim at each angle), raised by
  // the relief; the field's hatching never enters the ear on paper (ear() in contours() engraves it); on the dark ground
  // it runs round the rings
  {
    const nA = cdiv(mq(mq(M.earH, Q_4_5), RU), 64), nB = cdiv(mq(mq(M.earH, Q_0_8), RU), 64); // about 1.4 samples a field pixel round the rim, 1.6 across
    const cR = new Int32Array(nA), cC = new Int32Array(nA), cS = new Int32Array(nA);
    for (let i = 0; i < nA; i++) { const ph = idiv(A16 * i, nA); cR[i] = polarAt(EAR_R, ph); cC[i] = cosF(ph) * 4; cS[i] = sinF(ph) * 4; }
    for (const side of [-1, 1]) {
      splat(F, nA, nB, (i, j) => {
        const ph = idiv(A16 * i, nA), r = mq(idiv(Q * (j + 1), nB), cR[i]!), x = EAR_C[0]! + mq(r, cC[i]!), y = EAR_C[1]! + mq(r, cS[i]!);
        M.earPt(side, x, y, M.earRelief(x, y, ph, r));
        xf(eU, eV, eZ);
        sX = tX; sY = tY; sZ = tZ; sReg = EAR; sEx = 0; setDir(Q, 0);
        return true;
      }, true);
    }
  }
  // ---- neck
  // Version 13: the neck runs into the shoulders on a fillet (the torso's top edge leaves the neck's side upright and
  // curves out to the shoulder line), so there is no straight seam and no right angle; the neck stops on that edge;
  // a collar swells a little off the neck and its top edge runs round it (lower in front), never a level block.
  const shV = P.chin + P.neckLen, gar = P.garment, neckline = necklineOf(P, shV), fil = filletOf(P, shV, M.neckRe);
  {
    const v0 = P.e + Q_0_45, v1 = shV + Q_0_7, zc0 = QN_0_1;
    const nA = cdiv(mq(mq(Q_9_1106, M.neckRe), RU), 64), nB = cdiv(mq(v1 - v0, RU) * C145, 6400);
    const turtleV = P.chin + Q_0_1, highV = P.chin + Q_0_22;
    splat(F, nA, nB, (i, j) => {
      const a = idiv(A16 * i, nA), v = v0 + idiv((v1 - v0) * j, nB - 1), ca = cosF(a) * 4, sa = sinF(a) * 4;
      const r0 = M.neckAt(v), zc = zc0 - mq(Q_0_12, smQ(dq(v - P.chin, Q_0_8)));
      let region = SKIN, off = 0;
      if (gar === G_TURTLE) { const t0 = turtleV + mq(Q_0_05, ca); if (v > t0) { region = GARM; off = mq(Q_0_06, smQ(dq(v - t0, Q_0_08))); } }
      else if (gar === G_HIGH) { const t0 = highV + mq(Q_0_08, ca); if (v > t0) { region = GARM2; off = mq(Q_0_04, smQ(dq(v - t0, Q_0_06))); } }
      else {
        const nl = neckline(mq(r0, sa));
        if (v > nl) region = gar === G_LAPEL ? SHIRT : gar === G_COLLAR || gar === G_BLOUSE ? GARM2 : GARM;
        const t0 = shV - Q_0_05 + mq(Q_0_07, ca);
        if (gar === G_COLLAR && v > t0 && v < nl) { region = GARM2; off = mq(Q_0_03, smQ(dq(v - t0, Q_0_06))); }
      }
      const px = mq(r0 + off, sa), pz = zc + mq(r0 + off, ca);
      // below the shoulder line the torso is the surface: the neck's sides and back stop on the fillet
      if (v > fil.top(absI(px)) + Q_0_02) return false;
      xfBody(px, v, pz);
      sX = tX; sY = tY; sZ = tZ; sReg = region; sEx = 0; sDir = 0; sNJ = 1;
      return true;
    }, true, 2);
  }
  // ---- torso: an elliptical cylinder whose top edge is the shoulder line, rounded into the neck on the fillet
  {
    const shW = P.shW, vEnd = shV + Q_4_5;
    const nA = cdiv(mq(2 * shW, RU) * C145, 6400), nB = cdiv(mq(Q_4_5, RU) * C145, 6400);
    const cu = new Int32Array(nA), cvT = new Int32Array(nA), cr = new Int32Array(nA), cband = new Int32Array(nA), cnl = new Int32Array(nA);
    for (let i = 0; i < nA; i++) {
      const u = -shW + idiv(2 * shW * i, nA - 1), au = absI(u), a = dq(au, shW);
      cu[i] = u;
      cvT[i] = fil.top(au);
      cr[i] = sqrtQ(Q - sq(dq(u, shW)));
      cband[i] = Q_0_22 + mq(Q_0_7, powQ(a, Q_1_5));
      cnl[i] = neckline(u);
    }
    const lapelW = Q_0_6927;
    splat(F, nA, nB, (i, j) => {
      const u = cu[i]!, au = absI(u), vT = cvT[i]!, t = idiv(Q * j, nB - 1), v = vT + mq(vEnd - shV, sq(t));
      const f = powQ(smQ(dq(v - vT, cband[i]!)), Q_0_7);
      let z = QN_0_5 + mq(mq(Q_1_1, cr[i]!), Q_0_15 + mq(Q_0_85, f));
      // version 13: round the neck's base the chest rises to the neck's front, then eases into the chest's own roll
      // (the neck used to stand in front of a sunken chest top: a block where the collar met the neck)
      { // the neck's own radius and axis at this height (as the neck's splat has them), a hair in front of it
        const rN = M.neckAt(v);
        if (au < rN) { const zb = QN_0_1 - mq(Q_0_12, smQ(dq(v - P.chin, Q_0_8))) + sqrtQ(sq(rN) - sq(u)) + Q_0_01, bl = Q - smQ(dq(v - vT, Q_0_4)); if (zb > z && bl > 0) z += mq(zb - z, bl); }
      }
      let region = GARM;
      const nl = cnl[i]!;
      if (v < nl) region = gar === G_LAPEL ? SHIRT : SKIN;
      if (gar === G_COLLAR) {
        const edge = au < Q_0_4 ? absI(v - nl) : hypotQ(au - Q_0_4, Math.max(0, v - (shV + Q_0_05)));
        if (v >= nl && edge < Q_0_15 && v < shV + Q_0_65) region = GARM2;
        if (au < Q_0_6 && v < vT + mq(Q_0_08, Q - sq(dq(au, Q_0_6)))) region = GARM2; // the collar's foot follows the shoulder line and tapers out
      } else if (gar === G_LAPEL) {
        if (v >= nl && au < Q && v - nl < lapelW && v < shV + Q_1_6) region = GARM2;
        if (au < Q_0_6 && v < vT + mq(Q_0_08, Q - sq(dq(au, Q_0_6)))) region = SHIRT;
      } else if (gar === G_TURTLE) region = GARM;
      else if (gar === G_HIGH) { if (au < fil.u1 && v < vT + mq(Q_0_12, Q - sq(dq(au, fil.u1)))) region = GARM2; } // the collar's foot, tapering out round the neck
      else if (gar === G_BLOUSE) { if (v >= nl && v - nl < Q_0_16 && v < shV + Q_0_6) region = GARM2; }
      else if (gar === G_WRAP) { // the overlapping panel's edge continues the near side's diagonal across the chest
        const uw = u * P.wrapSide;
        if (uw < 0 && v >= nl && v < shV + Q_1_6 && absI(v - (shV + Q_0_03 + mq(Q_0_85, Q - dq(uw, Q_0_65)))) < Q_0_08) region = GARM2;
      } else if (gar === G_SHAWL) { if (au > Q_0_85 - mq(Q_0_45, smQ(dq(v - shV, Q_1_8))) && region !== SKIN) region = GARM2; }
      xfBody(u, v, z);
      sX = tX; sY = tY; sZ = tZ; sReg = region; sEx = 0; sDir = 0;
      return true;
    }, false);
  }
  // ---- hole fill: isolated background pixels inside a surface take their nearest neighbour
  {
    const z = F.z, reg = F.reg, fill: number[] = [];
    const offs = [-1, 1, -FW, FW, -FW - 1, -FW + 1, FW - 1, FW + 1];
    for (let y = 1; y < FH - 1; y++) for (let x = 1; x < FW - 1; x++) {
      const q0 = y * FW + x;
      if (reg[q0] !== BG) continue;
      let n = 0, best = -1, bz = ZFAR;
      for (const o of offs) { const r = q0 + o; if (reg[r] !== BG) { n++; if (z[r]! > bz) { bz = z[r]!; best = r; } } }
      if (n >= 6) fill.push(q0, best);
    }
    for (let i = 0; i < fill.length; i += 2) {
      const q0 = fill[i]!, r = fill[i + 1]!;
      z[q0] = z[r]!; reg[q0] = reg[r]!; F.nx[q0] = F.nx[r]!; F.ny[q0] = F.ny[r]!; F.nz[q0] = F.nz[r]!; F.dir[q0] = F.dir[r]!; F.extra[q0] = F.extra[r]!; F.tail[q0] = F.tail[r]!;
    }
    // despeckle (two passes, so pairs go too): a covered pixel whose depth agrees with at most one of six or
    // more covered neighbours is a pinhole (a nearer surface missed it, or a farther one shows through); it
    // takes the neighbour most of the others agree with, so no depth-step stamp fires on a speck
    const near = Q_0_09;
    for (let pass = 0; pass < 2; pass++) {
    fill.length = 0;
    for (let y = 1; y < FH - 1; y++) for (let x = 1; x < FW - 1; x++) {
      const q0 = y * FW + x;
      if (reg[q0] === BG) continue;
      let n = 0, agree = 0;
      for (const o of offs) { const r = q0 + o; if (reg[r] !== BG) { n++; if (absI(z[r]! - z[q0]!) <= near) agree++; } }
      if (n < 6 || agree > 1) continue;
      let best = -1, bestN = -1;
      for (const o of offs) {
        const r = q0 + o;
        if (reg[r] === BG) continue;
        let m = 0;
        for (const o2 of offs) { const r2 = q0 + o2; if (r2 !== r && reg[r2] !== BG && absI(z[r2]! - z[r]!) <= near) m++; }
        if (m > bestN) { bestN = m; best = r; }
      }
      if (best >= 0 && bestN >= 3) fill.push(q0, best);
    }
    for (let i = 0; i < fill.length; i += 2) {
      const q0 = fill[i]!, r = fill[i + 1]!;
      z[q0] = z[r]!; reg[q0] = reg[r]!; F.nx[q0] = F.nx[r]!; F.ny[q0] = F.ny[r]!; F.nz[q0] = F.nz[r]!; F.dir[q0] = F.dir[r]!; F.extra[q0] = F.extra[r]!; F.tail[q0] = F.tail[r]!;
    }
    }
  }
  return F;
}

/* ── Light and tone ──────────────────────────────────────────────────────────────────────────────── */

function shadeField(P: V14Plan, F: Field, pose: Pose): void {
  const L = lightDir(P), inv = PALS[P.palette]!.inv === 1;
  // 3 field px a step toward the light, the ray's depth rising with the light's z
  const lx = (L[0] * 3 * 256) >> 16, ly = (L[1] * 3 * 256) >> 16, lz = idiv(L[2] * 192, RU);
  const raw = new Int32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const q0 = y * FW + x;
    if (F.reg[q0] === BG) continue;
    const d = (F.nx[q0]! * L[0] + F.ny[q0]! * L[1] + F.nz[q0]! * L[2]) >> 14; // Q16
    let sh = P.ambient + mq(Q - P.ambient, powQ(clampQ(dq(d + Q_0_35, Q_1_35)), Q_1_3)); // a wide wrap: the terminator is a gradient
    let px = (x << 8) + 128, py = (y << 8) + 128, pz = F.z[q0]! + Q_0_02;
    for (let i = 0; i < 50; i++) {
      px += lx; py += ly; pz += lz;
      const ix = px >> 8, iy = py >> 8;
      if (ix < 0 || iy < 0 || ix >= FW || iy >= FH) break;
      const r = iy * FW + ix;
      if (F.reg[r] === BG) continue;
      if (F.z[r]! > pz + Q_0_035) { sh = mq(sh, Q_0_55); break; } // in a cast shadow
    }
    raw[q0] = sh;
  }
  // 3 x 3 blur within the same region
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const q0 = y * FW + x, r0 = F.reg[q0];
    if (r0 === BG) continue;
    let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 0 || yy < 0 || xx >= FW || yy >= FH) continue;
      const r = yy * FW + xx;
      if (F.reg[r] === r0) { s += raw[r]!; n++; }
    }
    F.shade[q0] = idiv(s, n);
  }
  // tone (mark density, Q16 here, stored Q12) per region. THE FACE TONE RULE: the lit face is paper; above
  // the light threshold no hatch at all; on the shadow side one layer that starts at zero at a wandering
  // terminator; two layers only in the core shadow; the mouth zone (extra < 0) never. Children: a higher
  // threshold and never a second layer.
  const browDark = clampQ(P.hairDark + Q_0_15);
  const child = P.ageT < Q, lightT = child ? Q_0_47 : Q_0_56, coreT = Q_0_25;
  const faceTone = (sh: number, ex: number, ear: boolean, wob: number): number => {
    if (ex < 0) return 0;
    const lt = lightT + wob;
    if (sh >= lt) return 0;
    if (sh >= coreT) return mq(mq(Q_0_38, powQ(dq(lt - sh, lt - coreT), Q_0_85)), ear ? Q_0_8 : Q);
    if (child) return Q_0_38;
    return Q_0_4 + mq(Q_0_22, clampQ(dq(coreT - sh, coreT)));
  };
  const faceToneInv = (sh: number, ex: number, wob: number): number => { // dark ground: the lit face is ONE layer of lines at the lowest density, the shadow side and the core are ground
    if (ex < 0) return 0;
    const shadowT = (child ? Q_0_5 : Q_0_42) + wob;
    return sh <= shadowT ? 0 : Q_0_18;
  };
  const lipLTone = P.lipDark ? Q_0_3 : 0;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const q0 = y * FW + x, r = F.reg[q0], sh = inv ? Q_0_28 + mq(Q_0_72, F.shade[q0]!) : F.shade[q0]!, dk = Q - sh, ex = F.extra[q0]!;
    let t = 0;
    if (r === BG) {
      if (P.bg !== 0) {
        const X = x * FS * U, Y = y * FS * U; // units
        const sx = P.lightSide > 0 ? idiv(X * Q, AWU) : Q - idiv(X * Q, AWU); // 0 at the lit edge, 1 at the shadow edge
        if (P.bg === 1) t = mq(mq(P.bgTone, powQ(smQ(dq(sx - Q_0_05, Q_0_95)), Q_1_6)), Q_0_75 + mq(Q_0_25, smQ(idiv(Y * Q, AHU))));
        else { const d = idiv(hypotQ(X - pose.cx, Y - pose.cy) * Q, RU); t = mq(mq(mq(Q_0_75, P.bgTone), Q_0_5 + mq(Q_0_5, smQ(dq(d - Q_0_9, Q_1_4)))), Q_0_7 + mq(Q_0_3, sx)); }
        if (inv) t = mq(t, Q_0_25);
      }
      F.tone[q0] = clampQ(t) >> 4;
      continue;
    }
    if (!inv) {
      switch (r) {
        case SKIN: t = faceTone(sh, ex, false, mq(Q_0_05, nq(x * FS, y * FS, 26, P.salt + 23))); break;
        case EAR: { const ft = faceTone(sh, ex, true, mq(Q_0_05, nq(x * FS, y * FS, 26, P.salt + 23))); t = ft > ex ? ft : ex; break; }
        case HAIR: {
          // stage two: locks with a lighter band across each. The band follows the head's curvature (an iso-light
          // band of the shade), broken into locks by a lattice noise stretched along nothing but its own cells;
          // darker beneath (the shade) and between locks
          const base = mq(Math.min(Q_0_7, mq(P.hairDark, Q_0_5 + mq(Q_0_5, dk)) + Q_0_05), Q - mq(Q_0_55, ex));
          const lock = nq(x * FS, y * FS, 18, P.salt + 71), band = gexp(dq(sh - q(0.78), q(0.1)));
          const sheen = mq(band, q(0.55) + mq(q(0.45), clampQ(Q_0_5 + lock)));
          t = mq(base, Q - mq(q(0.5), sheen) + mq(q(0.12), clampQ(-lock)));
          break;
        }
        case WRAP: t = mq(P.wrapTone, Q_0_6 + mq(Q_0_4, dk)) + mq(Q_0_08, dk) + ex; break;
        case WHITE: t = mq(Q_0_08, dk) + mq(ex, Q_0_8); break;
        case IRIS: { const rim = Math.min(Q, Math.max(0, ex - Q_0_6) >> 1), lid = Math.min(Q_0_6, ex - 2 * rim); t = mq(mq(Math.max(Q_0_42, P.irisDark), Q_0_62 + mq(Q_0_38, sq(rim))), Q_0_9 + mq(Q_0_1, dk)) + mq(lid, Q_0_8); break; }
        case PUPIL: t = Q; break;
        case HILITE: t = 0; break;
        case BROW: t = Math.min(Q_0_62, mq(browDark, Q_0_6 + mq(Q_0_4, dk))); break;
        case LIPU: t = q(0.3) + mq(q(0.08), dk); break; // stage two: the upper lip faces down, one layer along the lip
        case LIPL: t = lipLTone; break; // a darker lower lip on some adults: one layer along the lip, never across
        case MOUTH: t = Q; break;
        case NOSTRIL: t = 0; break; // stage two: the nostrils are filled darks (contours), not hatched
        case GARM: t = mq(P.gTone, Q_0_6 + mq(Q_0_4, dk)) + mq(Q_0_08, dk); break;
        case GARM2: t = mq(P.gTone2, Q_0_6 + mq(Q_0_4, dk)) + mq(Q_0_08, dk); break;
        case SHIRT: t = mq(Q_0_12, dk); break;
        case BEARD: t = mq(P.beardDark, Q_0_45 + mq(Q_0_45, dk)); break;
      }
    } else {
      switch (r) {
        case SKIN: case EAR: t = faceToneInv(sh, ex, mq(Q_0_05, nq(x * FS, y * FS, 26, P.salt + 23))); break;
        case HAIR: t = mq(mq(mq(Q_1_05 - P.hairDark, sh), Q_0_9), Q - mq(Q_0_5, ex)); break;
        case WRAP: t = mq(mq(Q - P.wrapTone, Q_0_8), sh) + ex; break;
        case WHITE: t = mq(mq(Q_0_85, sh), Q - ex); break;
        case IRIS: { const rim = Math.min(Q, Math.max(0, ex - Q_0_6) >> 1); t = mq(mq(mq(Q - mq(P.irisDark, Q_0_8), Q_0_7), sh), Q - mq(Q_0_6, sq(rim))); break; }
        case PUPIL: t = 0; break;
        case HILITE: t = Q; break;
        case BROW: t = mq(mq(Q - browDark, Q_0_7), sh); break;
        case LIPU: case LIPL: t = 0; break;
        case MOUTH: t = 0; break;
        case NOSTRIL: t = Q_0_05; break;
        case GARM: t = mq(mq(Q - P.gTone, Q_0_8), sh); break;
        case GARM2: t = mq(mq(Q - P.gTone2, Q_0_8), sh); break;
        case SHIRT: t = mq(Q_0_85, sh); break;
        case BEARD: t = mq(mq(Q - P.beardDark, Q_0_6), sh); break;
      }
    }
    F.tone[q0] = clampQ(t) >> 4;
  }
  // stage two: a darker band under the collar (the first field pixels of a garment below skin or a shirt), a soft
  // vignette on the shadow side where the ground is bare, and on a quarter of the draws (salt bits) a faint
  // cast shadow of the figure on the ground, away from the light
  if (!inv) {
    for (let x = 0; x < FW; x++) {
      let run = -1;
      for (let y = 1; y < FH; y++) {
        const q0 = y * FW + x, r = F.reg[q0], ra = F.reg[q0 - FW];
        if ((r === GARM || r === GARM2) && (ra === SKIN || ra === SHIRT) && !(P.garment === G_COLLAR && r === GARM2)) run = 0; // version 13: not under a shirt collar's top (a dark ring read as a choker)
        else if (run >= 0 && (r === GARM || r === GARM2)) run++;
        else run = -1;
        if (run >= 0 && run < 16) F.tone[q0] = Math.min(4095, F.tone[q0]! + idiv((16 - run) * 1500, 16));
      }
    }
    // version 14: the jaw's shadow on the neck, a darker band just under the jaw line and following it (the first field
    // pixels of neck below the head in each column), deeper on the shadow side; it is what parts the head from the neck
    for (let x = 0; x < FW; x++) {
      let run = -1;
      for (let y = 1; y < FH; y++) {
        const q0 = y * FW + x, ra = F.reg[q0 - FW];
        if (F.tail[q0] === 2 && F.reg[q0] === SKIN && F.tail[q0 - FW] !== 2 && (ra === SKIN || ra === BEARD)) run = 0;
        else if (run >= 0 && F.tail[q0] === 2 && F.reg[q0] === SKIN) run++;
        else run = -1;
        if (run >= 0 && run < 14) F.tone[q0] = Math.min(4095, F.tone[q0]! + idiv(idiv((14 - run) * 1230, 14) * (Q_0_55 + mq(Q_0_45, Q - F.shade[q0]!)), Q));
      }
    }
    const cast = ((P.salt >>> 20) & 3) === 0, L = lightDir(P), Lh = hypotQ(L[0], L[1]) || 1;
    const cdx = idiv(-L[0] * 30, Lh), cdy = idiv(-L[1] * 30, Lh) + 6;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const q0 = y * FW + x;
      if (F.reg[q0] !== BG) continue;
      let t = F.tone[q0]!;
      if (P.bg === 0) {
        // toward the plate's edges (a superellipse, |dx|^4 + |dy|^4, so it hugs the frame and never rings the head),
        // from a centre pulled toward the light, darker on the shadow side
        const sx = P.lightSide > 0 ? idiv(x * Q, FW) : Q - idiv(x * Q, FW), ddx = idiv((x - (FW >> 1) + P.lightSide * idiv(FW, 10)) * Q, FW >> 1), ddy = idiv((y - idiv(FH * 45, 100)) * Q, FH >> 1);
        const dx2 = mq(ddx, ddx), dy2 = mq(ddy, ddy), d4 = sqrtQ(sqrtQ(mq(dx2, dx2) + mq(dy2, dy2)));
        const v = mq(mq(q(0.13), smQ(dq(d4 - q(0.72), q(0.45)))), q(0.35) + mq(q(0.65), sx));
        const vt = v >> 4;
        if (vt > t) t = vt;
      }
      if (cast) {
        let hit = 0;
        for (const f of [80, 100, 120]) { const xx = x - idiv(cdx * f, 100), yy = y - idiv(cdy * f, 100); if (xx >= 0 && yy >= 0 && xx < FW && yy < FH && F.reg[yy * FW + xx] !== BG) hit++; }
        if (hit) t += idiv(hit * 440, 3);
      }
      F.tone[q0] = Math.min(4095, t);
    }
  }
  // hatch direction per pixel (an undirected angle, stored doubled). Form rule: perpendicular to the projected
  // normal, blended with the diagonal by how much the normal tilts; the normals box-blurred 7 x 7 so the lines
  // are long arcs, not whorls; overrides from the splat (hair, brows, eyes, lips, beard, ears, the wrap's folds).
  const diag2 = (2 * (P.hatchAngle >> 4)) & 1023;
  const sxA = new Int32Array(FW * FH), syA = new Int32Array(FW * FH);
  {
    const txA = new Int32Array(FW * FH), tyA = new Int32Array(FW * FH);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const q0 = y * FW + x;
      if (F.reg[q0] === BG) continue;
      let ax = 0, ay = 0, n = 0;
      for (let i = -3; i <= 3; i++) { const xx = x + i; if (xx < 0 || xx >= FW) continue; const r = y * FW + xx; if (F.reg[r] !== BG) { ax += F.nx[r]!; ay += F.ny[r]!; n++; } }
      txA[q0] = idiv(ax, n); tyA[q0] = idiv(ay, n);
    }
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const q0 = y * FW + x;
      if (F.reg[q0] === BG) continue;
      let ax = 0, ay = 0, n = 0;
      for (let j = -3; j <= 3; j++) { const yy = y + j; if (yy < 0 || yy >= FH) continue; const r = yy * FW + x; if (F.reg[r] !== BG) { ax += txA[r]!; ay += tyA[r]!; n++; } }
      sxA[q0] = idiv(ax, n); syA[q0] = idiv(ay, n);
    }
  }
  const bg2 = (2 * (P.bgAngle >> 4)) & 1023;
  for (let q0 = 0; q0 < FW * FH; q0++) {
    const r = F.reg[q0];
    if (r === BG) { F.hd2[q0] = bg2; continue; }
    const d = F.dir[q0]!;
    if (d !== NODIR && (r === HAIR || r === BROW || r === IRIS || r === WHITE || r === LIPU || r === LIPL || r === BEARD || r === EAR || r === WRAP || r === SKIN)) { F.hd2[q0] = (2 * d) & 1023; F.pd[q0] = (d + 160) & 511; continue; }
    const nx = sxA[q0]!, ny = syA[q0]!, t = isqrt(nx * nx + ny * ny) * 4; // Q16 tilt
    // stage two, plane switching: the core shadow's second layer runs at a fixed angle to its plane, the normal's
    // direction snapped to eighths of a turn, so a cheekbone, a brow, a jaw each keep one crossing direction and
    // the direction switches where the plane does
    { const an = atan2i(ny, nx), aq = ((an + 64) >> 7) << 7; F.pd[q0] = t < q(0.12) ? ((P.hatchAngle >> 4) + 176) & 511 : (aq + 256 + 160) & 511; }
    const form2 = (2 * (atan2i(ny, nx) + 256)) & 1023;
    const wgt = mq(Q_0_6, powQ(clampQ(mq(t, Q_1_3)), Q_0_9));
    const c = mq(wgt, COS(form2) * 4) + mq(Q - wgt, COS(diag2) * 4), s = mq(wgt, SIN[form2]! * 4) + mq(Q - wgt, SIN[diag2]! * 4);
    F.hd2[q0] = atan2i(s, c);
  }
}

/* ── Hatching: streamlines along the direction field, four layers at tone thresholds ───────────────── */

interface Stroke { pts: number[]; hw: number[]; c: number }
interface Prims { strokes: Stroke[]; discs: number[]; segs: number[]; fills: number[][]; rects: number[]; lines: number[][]; pupils: number[]; stats: V14Stats }
export interface V14Stats { strokes: number; stamps: number; curves: number }
/** Q16 px of the 960-px reference frame to raster units (every length scales with the art height). */
const kU = (pxQ16: number): number => idiv(pxQ16 * AHU, 960 * Q);
interface Style { sp: number; off: readonly number[]; len0: number; len1: number }
const STYLE: ReadonlyArray<Style | null> = [
  /* BG */ { sp: 115, off: [0, 199, -199, 256], len0: 80, len1: 320 },
  /* SKIN */ { sp: 100, off: [0, 176, -165, 256], len0: 40, len1: 150 },
  /* HAIR */ { sp: 70, off: [0, 26, -26, 11], len0: 40, len1: 220 },
  /* WHITE */ { sp: 80, off: [0, 171, -171, 256], len0: 8, len1: 30 },
  /* IRIS */ { sp: 34, off: [0, 256, 0, 256], len0: 4, len1: 40 },
  /* PUPIL */ { sp: 50, off: [0, 256, 128, -128], len0: 6, len1: 30 },
  /* HILITE */ null,
  /* BROW */ { sp: 55, off: [0, 34, -34, 17], len0: 8, len1: 22 },
  /* LIPU */ { sp: 100, off: [0, 0, 0, 0], len0: 10, len1: 40 },
  /* LIPL */ { sp: 100, off: [0, 0, 0, 0], len0: 10, len1: 40 },
  /* NOSTRIL */ { sp: 50, off: [0, 256, 128, -128], len0: 4, len1: 20 },
  /* EAR */ { sp: 90, off: [0, 176, -165, 256], len0: 14, len1: 40 },
  /* GARM */ { sp: 105, off: [0, 176, -165, 256], len0: 40, len1: 170 },
  /* GARM2 */ { sp: 100, off: [0, 176, -165, 256], len0: 30, len1: 120 },
  /* SHIRT */ { sp: 110, off: [0, 176, -165, 256], len0: 30, len1: 120 },
  /* BEARD */ { sp: 60, off: [0, 57, -57, 28], len0: 8, len1: 30 },
  /* MOUTH */ { sp: 50, off: [0, 256, 128, -128], len0: 4, len1: 30 },
  /* WRAP */ { sp: 95, off: [0, 176, -165, 256], len0: 20, len1: 90 },
];
/** The layer thresholds, Q12 (0.10, 0.40, 0.64, 0.86). */
const THRESH12: readonly number[] = [410, 1638, 2621, 3523];
const INK = slot(1, 8);

/** Tone (Q12) at a raster point, bilinear over the field. */
function toneAt(F: Field, x: number, y: number): number {
  const gx = clampI(x * 4 - 128, 0, (FW - 1) * 256 - 1), gy = clampI(y * 4 - 128, 0, (FH - 1) * 256 - 1);
  const x0 = gx >> 8, y0 = gy >> 8, tx = gx & 255, ty = gy & 255, q0 = y0 * FW + x0, T = F.tone;
  return ((T[q0]! * (256 - tx) + T[q0 + 1]! * tx) * (256 - ty) + (T[q0 + FW]! * (256 - tx) + T[q0 + FW + 1]! * tx) * ty) >> 16;
}
const regAt = (F: Field, x: number, y: number): number => F.reg[clampI(y >> 6, 0, FH - 1) * FW + clampI(x >> 6, 0, FW - 1)]!;
/** The undirected hatch direction at a raster point, whole steps 0..511: doubled angles blended bilinearly. */
function dirAt(F: Field, x: number, y: number): number {
  const gx = clampI(x * 4 - 128, 0, (FW - 1) * 256 - 1), gy = clampI(y * 4 - 128, 0, (FH - 1) * 256 - 1);
  const x0 = gx >> 8, y0 = gy >> 8, tx = gx & 255, ty = gy & 255, q0 = y0 * FW + x0, H = F.hd2;
  const w00 = (256 - tx) * (256 - ty), w10 = tx * (256 - ty), w01 = (256 - tx) * ty, w11 = tx * ty;
  const a = H[q0]!, b = H[q0 + 1]!, c = H[q0 + FW]!, d = H[q0 + FW + 1]!;
  const cs = w00 * COS(a) + w10 * COS(b) + w01 * COS(c) + w11 * COS(d), sn = w00 * SIN[a]! + w10 * SIN[b]! + w01 * SIN[c]! + w11 * SIN[d]!;
  return atan2i(sn, cs) >> 1;
}

/**
 * The engraver's swelling line (a burin line): half-widths along a stroke from the widths asked for at
 * each vertex (wMid, the tone's or the feature's), thinned to a hairline at both ends and swelling
 * through the middle: w(t) = hair + (wMid - hair) * a * sin(pi s)^0.6, t = i / (n - 1) along the stroke,
 * s = t + k t (1 - t), with a in [0.9, 1.1] and k in [-0.25, 0.25] from the stroke's hash h (so no two
 * strokes swell alike and the fattest point drifts a little off the middle). Integer throughout.
 */
function swell(mid: number[], hair: number, h: number, skew = 0): number[] {
  const n = mid.length, a = Q_0_9 + idiv((h & 255) * Q_0_2, 255), k = skew || idiv((((h >>> 8) & 255) - 128) * Q_0_25, 128), out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? idiv(i * Q, n - 1) : Q_0_5, s = clampQ(t + mq(k, mq(t, Q - t)));
    const p = mq(powQ(sinPi(s) * 4, Q_0_6), a), w = mid[i]!;
    out.push(w > hair ? hair + mq(w - hair, p) : w);
  }
  return out;
}
/** Outline smoothing: passes of [1 2 1] / 4 along each chain (variance 5 nodes squared), before one Chaikin cut. */
const OUTLINE_PASSES = 10;
/** Version 12's density over version 11's: the hatch spacing divided by 1.75 (7 / 4). */
const DENS_NUM = 7, DENS_DEN = 4;
/** The stroke widths over version 11's, so the tone at arm's length matches version 11's (measured: see the commit). */
const WIDTH_F = Q_0_6;

function hatch(P: V14Plan, F: Field, prims: Prims, inv: boolean): void {
  const S11 = kU(Q_6), S0 = idiv(S11 * DENS_DEN, DENS_NUM), h = kU(Q_2), h8 = h * 8;
  const CELL = 32, GW = cdiv(AWU, CELL), GH = cdiv(AHU, CELL);
  const wmin = mq(kU(Q_0_5), WIDTH_F), hairH = kU(Q_0_14);
  const fwd: number[] = [], back: number[] = [], mids: number[] = [];
  for (let layer = 0; layer < 4; layer++) {
    const T = THRESH12[layer]!, wmax = mq(kU(layer === 0 ? Q_1_25 : Q_1_05), WIDTH_F);
    const occ = new Uint8Array(GW * GH);
    const isOcc = (x: number, y: number): boolean => { const gx = x >> 5, gy = y >> 5; if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return true; return occ[gy * GW + gx] === 1; };
    const mark = (x: number, y: number, r: number): void => {
      const gx0 = Math.max(0, (x - r) >> 5), gx1 = Math.min(GW - 1, (x + r) >> 5), gy0 = Math.max(0, (y - r) >> 5), gy1 = Math.min(GH - 1, (y + r) >> 5), r2 = r * r;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { const dx = gx * 32 + 16 - x, dy = gy * 32 + 16 - y; if (dx * dx + dy * dy <= r2) occ[gy * GW + gx] = 1; }
    };
    const gstep = idiv(S0 * 55, 100), nx = cdiv(AWU, gstep), ny = cdiv(AHU, gstep);
    for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
      const hsh = hash2(gx, gy, P.salt + layer * 977);
      const x0 = gx * gstep + (((hsh & 1023) * gstep) >> 10), y0 = gy * gstep + ((((hsh >>> 10) & 1023) * gstep) >> 10);
      if (x0 >= AWU || y0 >= AHU) continue;
      const reg = regAt(F, x0, y0), st = STYLE[reg];
      if (!st || reg === HILITE || reg === WHITE) continue; // the white of the eye is never hatched, in any light
      if ((reg === PUPIL || reg === NOSTRIL || reg === IRIS) && !inv) continue; // stage two: the iris is drawn in irises()
      if (reg === EAR && !inv) continue; // version 14: the ear is engraved from its geometry (ear() in contours())
      const t0 = toneAt(F, x0, y0);
      const skinish = reg === SKIN || reg === EAR, b16 = (hsh >>> 16) & 255;
      // version 13, the engraver's soft shadow edge: on skin the first layer (the terminator) and the second (the core
      // shadow's edge) fade in with lines, not a band. Each stroke starts at its own threshold (0.45 to 1.65 of the
      // layer's for the first, 0.85 to 1.2 for the second); over a ramp of tone past it (0.25 and 0.15) the spacing
      // closes from 2.2 times to 1 and the width grows from a hairline to the tone's own (a child never takes a second
      // layer). The ground's wash as before.
      const soft = skinish && (layer === 0 || (layer === 1 && P.ageT >= Q)), rampW = layer === 0 ? 1024 : 614;
      const Teff = soft ? (layer === 0 ? idiv(T * (11475 + 120 * b16), 25500) : idiv(T * (21675 + 35 * b16), 25500)) : reg === BG ? idiv(T * (7650 + 140 * b16), 25500) : T;
      if (t0 < Teff) continue;
      const nearT = soft ? clampQ(idiv((t0 - Teff) * Q, rampW)) : reg === BG ? clampQ(idiv((t0 - T) * Q, 1024)) : Q;
      const rel = clampQ(idiv((t0 - T) * Q, 4096 - T));
      const spF = soft || reg === BG ? Q_2_2 - mq(Q_1_2, nearT) : Q - mq(Q_0_25, rel);
      // the iris keeps version 11's ring spacing and widths: its tone, not a finer texture
      const iris = reg === IRIS, sp = mq(idiv((iris ? S11 : S0) * st.sp, 100), spF), rad = idiv(sp * 42, 100), r6 = idiv(rad * 6, 10);
      if (isOcc(x0, y0)) continue;
      const offA = st.off[layer]! + idiv((((hsh >>> 20) & 255) - 128) * 9, 256);
      const l0 = kU(q(st.len0)), l1 = kU(q(st.len1));
      const maxLen = mq(l0 + idiv(((hsh >>> 12) & 255) * (l1 - l0), 255), Q_0_3 + mq(Q_0_7, nearT)), half = maxLen >> 1;
      const plane = layer === 1 && reg === SKIN;
      let total = 0;
      for (const sg of [1, -1]) {
        const arr = sg > 0 ? fwd : back;
        arr.length = 0;
        let x8 = x0 * 8, y8 = y0 * 8, prevA = 0, hasPrev = false, L = 0;
        while (L < half) {
          let a = plane ? F.pd[clampI(y8 >> 9, 0, FH - 1) * FW + clampI(x8 >> 9, 0, FW - 1)]! + ((offA - st.off[1]!) >> 1) : dirAt(F, x8 >> 3, y8 >> 3) + offA;
          if (hasPrev) { const d = ((a - prevA + 256) & 511) - 256; a = prevA + d; }
          prevA = a; hasPrev = true;
          const ca = COS(a & 1023) * sg, sa = SIN[a & 1023]! * sg;
          const nx8 = x8 + ((ca * h8) >> 14), ny8 = y8 + ((sa * h8) >> 14), nxu = nx8 >> 3, nyu = ny8 >> 3;
          if (nxu < 0 || nyu < 0 || nxu >= AWU || nyu >= AHU) break;
          if (regAt(F, nxu, nyu) !== reg) break;
          if (toneAt(F, nxu, nyu) < Teff) break;
          const px = -sa, py = ca;
          if (isOcc(nxu + ((ca * r6) >> 14), nyu + ((sa * r6) >> 14)) || isOcc(nxu + ((px * rad) >> 14), nyu + ((py * rad) >> 14)) || isOcc(nxu - ((px * rad) >> 14), nyu - ((py * rad) >> 14))) break;
          x8 = nx8; y8 = ny8; L += h;
          arr.push(nxu, nyu);
        }
        total += L;
      }
      const minLen = reg === HAIR || reg === BG ? idiv(sp * 25, 10) : iris ? idiv(sp * 8, 10) : idiv(sp * 16, 10);
      if (total < minLen) continue;
      const pts: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) pts.push(back[i]!, back[i + 1]!);
      pts.push(x0, y0);
      for (let i = 0; i < fwd.length; i++) pts.push(fwd[i]!);
      const n = pts.length >> 1, w0 = iris ? kU(Q_0_5) : wmin, w1 = iris ? kU(Q_1_05) : wmax;
      mids.length = 0;
      for (let i = 0; i < n; i++) {
        const tn = toneAt(F, pts[2 * i]!, pts[2 * i + 1]!), tt = clampQ(idiv((tn - T) * Q, 4096 - T)), w = w0 + mq(w1 - w0, tt);
        mids.push(soft ? hairH + mq(w - hairH, smQ(idiv((tn - Teff) * Q, rampW))) : w); // on the ramp, from a hairline
      }
      const mr = idiv(sp * 4, 10);
      for (let i = 0; i < n; i++) mark(pts[2 * i]!, pts[2 * i + 1]!, mr);
      prims.strokes.push({ pts, hw: swell(mids, hairH, hash2(gx, gy, P.salt + layer * 977 + 1)), c: INK + ((hsh >>> 28) & 3) - 1 + ((hsh >>> 26) & 1 ? 0 : -1) });
      prims.stats.strokes++;
    }
  }
}

/* ── Contours: stamps from the field, feature lines projected from head space, the rare details ───── */

/**
 * Version 13: the fillet between the neck and the shoulders: the torso's top edge, a quarter circle of radius rf
 * centred at (u1, vJ - rf), u1 = the neck's base half-width rb + rf and vJ the shoulder line there. It leaves the
 * neck's side upright at rb and meets the shoulder line level at u1, so the neck's side and the shoulder are one
 * curve; inside rb it is the shoulder line (behind the neck), outside u1 the shoulder line itself.
 */
function filletOf(P: V14Plan, shV: number, neckR: number): { rb: number; u1: number; top: (au: number) => number } {
  const rf = Q_0_35, rb = mq(neckR, Q_1_12), u1 = rb + rf, vJ = torsoTop(P, shV, u1), vc = vJ - rf, rf2 = mq(rf, rf);
  const top = (au: number): number => { const t0 = torsoTop(P, shV, au); if (au >= u1) return t0; const c = au <= rb ? vc : vc + sqrtQ(rf2 - sq(au - u1)); return c > t0 ? c : t0; };
  return { rb, u1, top };
}
/** The shoulder line and the torso's depth in body space (shared by the splat and the necklace). */
function torsoTop(P: V14Plan, shV: number, u: number): number {
  const a = dq(absI(u), P.shW), over = a - Q_0_8;
  return shV - mq(P.trap, gexp(dq(u, Q_0_5))) + mq(P.shDrop, powQ(a, Q_1_4)) + mq(Q_1_2, over > 0 ? sq(dq(over, Q_0_2)) : 0);
}
function torsoZ(P: V14Plan, shV: number, u: number, v: number): number {
  const a = dq(absI(u), P.shW), r = sqrtQ(Q - sq(dq(u, P.shW))), band = Q_0_22 + mq(Q_0_7, powQ(a, Q_1_5));
  const f = powQ(smQ(dq(v - torsoTop(P, shV, u), band)), Q_0_7);
  return QN_0_5 + mq(mq(Q_1_1, r), Q_0_15 + mq(Q_0_85, f));
}
/** How loose a bun is drawn: the high bun fully, the bun and the low bun a little, others not at all. */
function bunLoose(h: number): number { return h === H_BUN_HIGH ? Q : h === H_BUN_LOW || h === H_TIED ? Q_0_45 : 0; }
/** A loose bun's radius at (a, b): three lobed waves, phases from salt bits. */
function bunRad(P: V14Plan, a: number, b: number, loose: number): number {
  const ph1 = (P.salt >>> 3) & (A16 - 1), ph2 = (P.salt >>> 9) & (A16 - 1), sb = sinF(b) * 4;
  const lump = mq(Q_0_16, mq(sinF(3 * a + ph1) * 4, sb)) + mq(Q_0_1, sinF(5 * a + 2 * b + ph2) * 4) + mq(Q_0_06, sinF(9 * a - 3 * b + ph1) * 4);
  return P.bunR + mq(P.bunR, mq(lump, loose));
}
function bunCentre(P: V14Plan, M: Model): V3 {
  const rb = P.bunR, bunV = P.bunV;
  return P.hair === H_BUN_HIGH ? [0, -P.craniumH - mq(rb, Q_0_55) + Q_0_1, QN_0_3] : [0, bunV, -(M.dBack(bunV) + mq(rb, P.hair === H_BUN_LOW ? Q_0_5 : Q_0_55))];
}

let cU = 0, cV = 0;
function contours(P: V14Plan, F: Field, M: Model, pose: Pose, prims: Prims, inv: boolean): void {
  const wm = inv ? Q_0_7 : Q, bob = P.hair === H_BOB;
  const shirtCollar = P.garment === G_COLLAR;
  const edgeW = (a: number, b: number): number => {
    const has = (x: number): boolean => a === x || b === x;
    if (has(BG)) return has(HAIR) ? (bob ? Q_0_4 : Q_0_5) : has(WRAP) ? Q_0_8 : Q;
    if (has(HAIR)) return bob ? Q_0_5 : Q_0_35;
    if (has(MOUTH) || has(LIPU) || has(LIPL) || has(HILITE) || has(BROW)) return 0;
    if (has(IRIS) && has(PUPIL)) return 0;
    if (has(NOSTRIL)) return 0; // version 13: the nostril is its shaped dark alone, no ring
    if (has(WHITE) && has(SKIN)) return 0; // the lids are drawn as curves
    if (has(BEARD) && has(SKIN)) return 0;
    if (has(WRAP)) return has(SKIN) || has(EAR) ? Q_0_55 : Q_0_5;
    if (shirtCollar && has(GARM2) && has(SKIN)) return Q_0_3; // version 13: a shirt collar's top edge is a light line, broken below
    if ((has(GARM) || has(GARM2) || has(SHIRT)) && has(SKIN)) return Q_0_6;
    if (has(GARM2)) return Q_0_5;
    if (has(SHIRT)) return Q_0_45;
    if (has(EAR)) return Q_0_45;
    return 0;
  };
  // version 13: the iris, the pupil and the catchlights are drawn from the eye's geometry (eyes()), not the field
  if (!inv) nostrils(F, prims);
  eyes(P, F, M, pose, prims, inv);
  // Lost and found edges. Region edges and depth steps take their weight from the light on the near (inner)
  // side: found = base x (0.6 + 1.0 (1 - shade)), heavier where the surface turns away; lit = smoothstep of
  // (shade - 0.55) / 0.35; the half-width is hair + (found - hair)(1 - 0.92 lit), so where the surface faces
  // the key light the edge falls to a hairline, and on a silhouette against the ground it breaks where
  // lit > 0.7 and a lattice noise (cells of 14 field px) is over 0.2: lost in places, never along its length.
  const EH = new Int32Array(FW * FH), EV = new Int32Array(FW * FH), hairC = kU(Q_0_17);
  for (let y = 0; y < FH - 1; y++) for (let x = 0; x < FW - 1; x++) {
    const q0 = y * FW + x;
    for (const o of [1, FW]) {
      const r = q0 + o, ra = F.reg[q0]!, rb = F.reg[r]!;
      let w = 0;
      if (ra !== rb) w = edgeW(ra, rb);
      else if (ra !== BG && absI(F.z[q0]! - F.z[r]!) > (ra === HAIR ? Q_0_3 : Q_0_09)) {
        // version 13: a step, not a slope: the jump must stand out from the slope on either side (a steep but
        // continuous surface, the torso rolling over the shoulders, drew a box of false edges)
        const zl = q0 - o >= 0 && F.reg[q0 - o] === ra ? F.z[q0]! - F.z[q0 - o]! : 0, zr = r + o < FW * FH && F.reg[r + o] === ra ? F.z[r + o]! - F.z[r]! : 0;
        const d = F.z[r]! - F.z[q0]!, slope = idiv(zl + zr, 2);
        if (absI(d - slope) > (ra === HAIR ? Q_0_3 : Q_0_09)) w = Q_0_75;
      }
      if (!w) continue;
      if (F.tail[q0] === 1 || F.tail[r] === 1) { if (nq(x, y, 9, P.salt + 73) > QN_0_1) continue; w = mq(w, Q_0_45); } // version 14: a tail's edge is the hair's soft outline, lost in places
      const near = F.z[q0]! > F.z[r]! ? q0 : r, sh = F.reg[near] === BG ? Q_0_5 : F.shade[near]!;
      if (F.reg[near] === EAR && (ra === EAR) !== (rb === EAR)) continue; // version 14: the ear's own contour is drawn from its geometry (ear())
      const found = mq(kU(mq(w, wm)), Q_0_6 + (Q - sh)), lit = smQ(dq(sh - Q_0_55, Q_0_35));
      if (lit > Q_0_7 && (ra === BG || rb === BG) && nq(x, y, 14, P.salt + 61) > Q_0_2) continue;
      if (shirtCollar && ((ra === GARM2 && rb === SKIN) || (ra === SKIN && rb === GARM2)) && nq(x, y, 10, P.salt + 67) > QN_0_1) continue; // broken: lost in places, as a fold is
      const hw = found > hairC ? hairC + mq(found - hairC, Q - mq(Q_0_92, lit)) : found;
      if (o === 1) EH[q0] = hw; else EV[q0] = hw;
    }
  }
  outlines(F, EH, EV, prims);
  /**
   * A run of projected points with a depth test, drawn as a burin line; fn(t) sets cU, cV (head space) or
   * returns false. Each point's width is the curve's (hw0 to hw1) times the light on the surface under it:
   * (0.65 + 0.7 (1 - shade)) (1 - 0.55 lit), never under `floor` of the curve's own width (the upper lid
   * keeps 0.8); swell() then thins each visible run to a hairline at both ends.
   */
  let run: number[] = [], runW: number[] = [];
  const hairF = kU(Q_0_12);
  let skewC = 0;
  const flush = (): void => { if (run.length >= 6) { prims.strokes.push({ pts: run, hw: swell(runW, hairF, hash2(run[0]!, run[1]!, P.salt + 977), skewC), c: INK }); prims.stats.curves++; } run = []; runW = []; };
  const lightW = (w: number, floor: number): number => {
    const gx = clampI(tX >> 6, 0, FW - 1), gy = clampI(tY >> 6, 0, FH - 1), q0 = gy * FW + gx, sh = F.reg[q0] === BG ? Q_0_5 : F.shade[q0]!;
    const f = mq(Q_0_65 + mq(Q_0_7, Q - sh), Q - mq(Q_0_55, smQ(dq(sh - Q_0_55, Q_0_35))));
    return mq(w, f > floor ? f : floor);
  };
  const drawCurve = (fn: (t: number) => boolean, n: number, hw0: number, hw1: number, lift = Q_0_03, floor = 0, wfn: ((t: number) => number) | null = null): void => {
    for (let i = 0; i <= n; i++) {
      const t = idiv(i * Q, n);
      if (!fn(t)) { flush(); continue; }
      const z = M.frontZ(cU, M.rowOf(cV)) + lift;
      pose.xf(cU, cV, z);
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) { flush(); continue; }
      const q0 = gy * FW + gx;
      if (F.reg[q0] === BG || F.z[q0]! > tZ + Q_0_05) { flush(); continue; }
      run.push(tX, tY); runW.push(lightW(kU(mq(wm, wfn ? wfn(t) : lerpQ(hw0, hw1, t))), floor));
    }
    flush();
  };
  /** A run of points already placed by fn (which sets tX, tY, tZ and says whether the point is visible). */
  const drawPlaced = (fn: (t: number) => boolean, n: number, hw0: number, hw1: number, floor = 0): void => {
    for (let i = 0; i <= n; i++) {
      const t = idiv(i * Q, n);
      if (!fn(t)) { flush(); continue; }
      run.push(tX, tY); runW.push(lightW(kU(mq(wm, lerpQ(hw0, hw1, t))), floor));
    }
    flush();
  };
  const visibleAt = (okRegion: (r: number) => boolean, slack: number): boolean => {
    const gx = tX >> 6, gy = tY >> 6;
    if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
    const q0 = gy * FW + gx;
    return okRegion(F.reg[q0]!) || F.z[q0]! <= tZ + slack;
  };
  /**
   * Version 14: the ear, drawn from its geometry at the output's resolution (see the header). A template point is
   * placed on the ear (raised by the relief and a hair more) and shows when nothing in the field is in front of it:
   * the ear itself within the relief's sampling, the head or hair only behind it.
   */
  const wHatch0 = mq(kU(Q_0_5), WIDTH_F), wHatch1 = mq(kU(Q_1_05), WIDTH_F), hairEar = kU(Q_0_14), sMin = idiv(idiv(kU(Q_6) * DENS_DEN, DENS_NUM) * 60, 100);
  const ltEar = P.ageT < Q ? Q_0_47 : Q_0_56, soft = Q - mq(Q_0_22, clampQ(Q - P.ageT)); // a child's lines softer
  const ear = (side: number): void => {
    const nrm = M.earN(side);
    pose.xf(nrm[0], nrm[1], nrm[2]);
    const facing = tZ, detail = smQ(dq(facing - q(0.2), q(0.6)));
    const info: EarInfo | null = earLog ? { side, facing, outline: [], axis: [], visible: 0, lines: {} } : null;
    if (info) for (const [x, y] of [[q(0.24), 0], [q(0.25), q(0.99)]]) { M.earPt(side, x!, y!, 0); pose.xf(eU, eV, eZ); info.axis.push(tX, tY); } // the ear's own top and the lobe's foot
    let ph = 0, rr = 0;
    const polarC = (x: number, y: number): void => { ph = atan2i(y - EAR_C[1]!, x - EAR_C[0]!) * 16; rr = hypotQ(x - EAR_C[0]!, y - EAR_C[1]!); };
    /** Place the template point (x, y) (tX, tY, tZ) and say whether it shows. */
    const at = (x: number, y: number): boolean => {
      polarC(x, y);
      M.earPt(side, x, y, M.earRelief(x, y, ph, rr) + Q_0_004);
      pose.xf(eU, eV, eZ);
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx, r = F.reg[q0];
      return F.z[q0]! <= tZ + (r === EAR ? Q_0_04 : r === HAIR ? Q_0_01 : Q_0_02);
    };
    const shadeHere = (): number => { const gx = clampI(tX >> 6, 0, FW - 1), gy = clampI(tY >> 6, 0, FH - 1), q0 = gy * FW + gx; return F.reg[q0] === EAR ? F.shade[q0]! : Q_0_6; };
    /** The light's tone on the ear (the face's rule, as version 13 hatched the ear). */
    const lightTone = (sh: number): number => {
      if (sh >= ltEar) return 0;
      if (sh >= Q_0_25) return mq(mq(Q_0_38, powQ(dq(ltEar - sh, ltEar - Q_0_25), Q_0_85)), Q_0_8);
      return P.ageT < Q ? Q_0_38 : Q_0_4 + mq(Q_0_22, clampQ(dq(Q_0_25 - sh, Q_0_25)));
    };
    const count = (name: string, n: number): void => { if (info) info.lines[name] = (info.lines[name] ?? 0) + n; };
    /** A drawn line through control points: wfn(t) its half-width (ref px, Q16) before the light. */
    const line = (name: string, ctrl: readonly number[], n: number, wfn: (t: number) => number): void => {
      let k = 0;
      for (let i = 0; i <= n; i++) {
        const t = idiv(i * Q, n), w = wfn(t);
        crOpen(ctrl, t);
        if (w <= 0 || !at(crX, crY)) { flush(); continue; }
        run.push(tX, tY); runW.push(lightW(kU(mq(mq(wm, soft), w)), 0)); k++;
      }
      flush();
      count(name, k);
    };
    // the outer contour, by angle round the template's centre: heavy along the top and back, the lobe light, the
    // front lost above the tragus; its weight from the light on the ear just inside it, lost in places where a lit
    // rim meets the ground
    {
      const pt = (a: number, f: number): void => { const R = mq(polarAt(EAR_R, a), f); crX = EAR_C[0]! + mq(R, cosF(a) * 4); crY = EAR_C[1]! + mq(R, sinF(a) * 4); };
      const N = 132, a0 = degA(q(-128));
      let k = 0;
      for (let i = 0; i <= N; i++) {
        const a = a0 + idiv(i * A16, N), d = wrapPi16(a); // d: 0 at the back, PI16 / 2 down, -PI16 / 2 up
        let w: number;
        if (d >= degA(q(-128)) && d <= degA(q(68))) w = q(0.52) + mq(q(0.3), clampQ(cosF(d + degA(q(40))) * 4)); // the helix's rim
        else if (d > degA(q(68)) && d <= degA(q(125))) w = q(0.38); // the lobe
        else if (d > degA(q(125)) || d <= degA(q(-178))) w = q(0.3); // the intertragic notch and the tragus's front
        else w = nq(i * 9, side * 40 + 5, 40, P.salt + 2207) > q(0.1) ? q(0.13) : 0; // the attachment above the tragus: lost, a broken hairline
        pt(a, q(0.9));
        at(crX, crY);
        const sh = shadeHere();
        pt(a, Q);
        const vis = at(crX, crY);
        if (info) { info.outline.push(tX, tY); if (vis) info.visible++; }
        const gx = clampI(tX >> 6, 0, FW - 1), gy = clampI(tY >> 6, 0, FH - 1), lit = smQ(dq(sh - Q_0_55, Q_0_35));
        if (!vis || w <= 0 || (F.reg[gy * FW + gx] === BG && lit > Q_0_9 && nq(gx, gy, 14, P.salt + 61) > Q_0_2)) { flush(); continue; }
        const f = mq(Q_0_65 + mq(Q_0_7, Q - sh), Q - mq(Q_0_55, lit));
        run.push(tX, tY); runW.push(mq(kU(mq(mq(wm, soft), w)), f > Q_0_55 ? f : Q_0_55)); k++; // the rim never fades to a hairline
      }
      flush();
      count("outline", k);
    }
    // the inner structure fades in as the ear's face turns toward the viewer; the rim's curl stays on an edge-on ear
    const dw = Q_0_55 + mq(Q_0_45, detail), sc = (w: number): number => mq(w, dw);
    line("helix", EAR_L_HELIX, 48, (t) => (detail > q(0.04) ? sc(q(0.24) + mq(q(0.16), sinPi(t) * 4)) : mq(q(0.26), Q - mq(t, t))));
    if (detail > Q_0_15) {
      line("crus", EAR_L_CRUS, 16, (t) => sc(lerpQ(q(0.34), q(0.12), t)));
      line("concha", EAR_L_CONCHA, 36, (t) => sc(q(0.24) + mq(q(0.14), sinPi(t) * 4)));
      line("scapha", EAR_L_SCAPHA, 32, () => sc(q(0.2)));
      line("fossa", EAR_L_FOSSA, 24, (t) => sc(q(0.1) + mq(q(0.08), sinPi(t) * 4)));
      line("tragus", EAR_L_TRAGUS, 16, () => sc(q(0.36)));
      line("antitragus", EAR_L_ANTI, 12, () => sc(q(0.28)));
    }
    // the tone in curves that follow the ear: rings of the outline (the rim, the scapha, the fossa, the lobe; the
    // concha left to its own rings) and rings of the concha round the bowl. Ring j joins at the tone of its level
    // (every fourth at the lightest, then every second, then all), each ring's threshold its own (a soft edge); a
    // ring is dropped where the turn of the ear packs its level's rings closer than 0.45 of a hatch
    const pts: number[] = [], mids: number[] = [];
    const endRing = (h: number): void => {
      if (pts.length >= 6) { prims.strokes.push({ pts: pts.slice(), hw: swell(mids, hairEar, h), c: INK }); prims.stats.strokes++; count("tone", 1); }
      pts.length = 0; mids.length = 0;
    };
    let fx = 0, fy = 0;
    for (const cn of [0, 1]) {
      if (cn === 1 && detail <= Q_0_15) break;
      // the outline's rings from halfway out (inside that the concha has its own); the concha's curves run from the
      // antitragus up to the crus, between its rim (the antihelix) and its front (the tragus), so they bow with the bowl
      const NR = cn ? 12 : 24, j0 = cn ? 1 : 12;
      const place = (j: number, s2: number, nS: number, a0: number): void => {
        if (cn) {
          const t = idiv(s2 * Q, nS), k = idiv(j * Q, NR);
          crOpen(EAR_L_CONCHA, t); const ax = crX, ay = crY;
          crOpen(EAR_L_CFRONT, t);
          fx = ax + mq(crX - ax, k); fy = ay + mq(crY - ay, k);
        } else {
          const a = a0 + idiv(A16 * s2, nS), R = mq(polarAt(EAR_R, a), idiv(j * Q, NR));
          fx = EAR_C[0]! + mq(R, cosF(a) * 4); fy = EAR_C[1]! + mq(R, sinF(a) * 4);
        }
      };
      for (let j = j0; j < NR; j++) {
        const lvl = j % 4 === 0 ? 0 : j % 2 === 0 ? 1 : 2, mul = lvl === 0 ? 4 : lvl === 1 ? 2 : 1;
        const hj = hash2(j, side * 31 + cn * 7, P.salt + 2203), thr = [q(0.05), q(0.22), q(0.45)][lvl]! + idiv(((hj & 255) - 128) * q(0.06), 128);
        const nS = cn ? 28 : 28 + idiv(j * 120, NR), a0 = ((hj >>> 8) & 1023) * 16;
        for (let s2 = 0; s2 <= nS; s2++) {
          // the next curve over, for the spacing on the page
          place(j + 1, s2, nS, a0);
          M.earPt(side, fx, fy, 0); pose.xf(eU, eV, eZ);
          const nx = tX, ny = tY;
          place(j, s2, nS, a0);
          const x = fx, y = fy;
          if (!cn && M.conchaRho(x, y) < Q) { endRing(hj); continue; }
          if (!at(x, y)) { endRing(hj); continue; }
          if (hypotQ(nx - tX, ny - tY) * mul < sMin) { endRing(hj); continue; }
          const tL = lightTone(shadeHere());
          if (y > q(0.72)) { endRing(hj); continue; } // the lobe soft and lighter: no rings (they nested in it as loops)
          const tS = M.earTone(x, y, ph, rr), t = mq(tS > tL ? tS : tL, q(0.35) + mq(q(0.65), detail)); // an edge-on ear lighter
          if (t < thr) { endRing(hj); continue; }
          pts.push(tX, tY); mids.push(wHatch0 + mq(wHatch1 - wHatch0, clampQ(dq(t - thr, q(0.35)))));
        }
        endRing(hj);
      }
    }
    // standing off: short curves on the head or hair just behind the ear's back edge, darkest nearest it
    if (detail > Q_0_15) {
      const gapK = Q_0_5 + dq(M.earPsiS, q(0.53));
      for (let k = 1; k <= 2; k++) {
        const rho = Q + k * q(0.035), tk = mq(mq(q(0.5) - k * q(0.12), gapK), detail), h = hash2(k, side * 17, P.salt + 2209);
        const N = 40, a0 = degA(q(-75)), a1 = degA(q(70));
        for (let i = 0; i <= N; i++) {
          const a = a0 + idiv(i * (a1 - a0), N), R = polarAt(EAR_R, a), x = EAR_C[0]! + mq(mq(rho, R), cosF(a) * 4), y = EAR_C[1]! + mq(mq(rho, R), sinF(a) * 4);
          M.earPt(side, x, y, 0); pose.xf(eU, eV, eZ);
          const gx = tX >> 6, gy = tY >> 6;
          if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) { endRing(h); continue; }
          const q0 = gy * FW + gx, r = F.reg[q0];
          const tt = mq(tk, sinPi(idiv(i * Q, N)) * 4);
          if ((r !== SKIN && r !== HAIR) || F.z[q0]! > tZ + Q_0_02 || tt < q(0.1)) { endRing(h); continue; }
          pts.push(tX, tY); mids.push(wHatch0 + mq(wHatch1 - wHatch0, clampQ(dq(tt, q(0.5)))));
        }
        endRing(h);
      }
    }
    // earrings: a stud as a dot at the lobe, a drop as a short line with a bead
    if (P.earring) {
      M.earPt(side, q(0.215), q(0.94), Q_0_02);
      pose.xf(eU, eV, eZ);
      if (visibleAt((r) => r === EAR || r === SKIN, Q_0_08)) {
        if (P.earring === 1) { prims.discs.push(tX, tY, kU(mq(Q_1_6, wm)), INK); prims.stats.stamps++; }
        else {
          const x0 = tX, y0 = tY, e0 = eV;
          pose.xf(eU, e0 + Q_0_1, eZ);
          prims.strokes.push({ pts: [x0, y0, (x0 + tX) >> 1, (y0 + tY) >> 1, tX, tY], hw: [kU(mq(Q_0_45, wm)), kU(mq(Q_0_45, wm)), kU(mq(Q_0_45, wm))], c: INK });
          prims.discs.push(tX, tY, kU(mq(Q_1_1, wm)), INK); prims.stats.curves++; prims.stats.stamps++;
        }
      }
    }
    if (info) earLog!.push(info);
  };
  const e = P.e, ew = M.ew, eyeU = M.eyeU;
  for (const side of [-1, 1]) {
    const ec = eyeU * side;
    const lidPt = (t: number, up: boolean, scale: number): void => {
      const dur = mq(2 * t - Q, ew), dvr = up ? -mq(mq(M.uh, M.upF(clampQ(t))), scale) : mq(mq(M.lh, M.loF(clampQ(t))), scale);
      cU = ec + side * (mq(dur, M.eyeC) - mq(dvr, M.eyeS)); cV = e + mq(dur, M.eyeS) + mq(dvr, M.eyeC);
    };
    // the upper lid (the lash line); stage two: heavier on its outer third, the swell's peak pushed outward
    skewC = q(0.3);
    drawCurve((t) => { lidPt(QN_0_02 + mq(Q_1_06, t), true, Q); return true; }, 40, 0, 0, Q_0_03, Q_0_8, (t) => mq(P.lidW, q(0.8) + mq(q(0.85), smQ(dq(t - q(0.55), q(0.3))))));
    skewC = 0;
    const kE = M.kE, far = side === -sgn(P.yaw) && absI(P.yaw) > degA(Q_28), child = P.ageT < Q;
    // version 13, the eye in detail (drawn 1.3 x the plan's size, see makeModel):
    // the lid's margin, a second close line inside the lash line (the lid's thickness), not on a turned head's far eye
    if (!far) drawCurve((t) => { lidPt(Q_0_08 + mq(q(0.84), t), true, Q); cV += mq(q(0.014), kE); return true; }, 30, q(0.3), q(0.4));
    // the lower lid's margin, a light line from corner to corner with one small gap
    const gapT = q(0.3) + ((hash2(side, 141, P.salt) & 1023) * q(0.4) >> 10);
    drawCurve((t) => { const tt = Q_0_04 + mq(q(0.96), t); lidPt(tt, false, Q); return absI(tt - gapT) > q(0.035); }, 40, q(0.22), q(0.3), Q_0_05);
    // the upper lashes: short curved strokes from the lash line over its outer two thirds, up and curling outward,
    // never into the opening; their number from the geometry (fewer on a squarer jaw and a lighter lid, fewer on a child)
    {
      let nL = 14 + idiv(8 * (P.lidW - Q), Q) - idiv(9 * P.jawSquare, Q) - (P.beard !== B_NONE ? 3 : 0);
      nL = clampI(child ? idiv(nL * 6, 10) : nL, 4, 18);
      if (far) nL = nL >> 1; // foreshortened on a turned head's far eye
      for (let k = 0; k < nL; k++) {
        const h = hash2(k, side * 7 + 300, P.salt), t0 = q(0.33) + idiv(k * q(0.64), nL) + ((h & 255) * idiv(q(0.6), nL) >> 8);
        lidPt(t0 + 64, true, Q); const ax = cU, ay = cV;
        lidPt(t0, true, Q);
        const bx = cU, by = cV, tx = ax - bx, ty = ay - by, L = isqrt(tx * tx + ty * ty) || 1, ux = idiv(tx * Q, L), uy = idiv(ty * Q, L);
        const nx = side * uy, ny = -side * ux; // the lash line's normal, up (head space)
        const len = mq(mq(q(0.02) + mq(q(0.017), sinPi(dq(t0 - q(0.3), q(0.72))) * 4), q(0.8) + (((h >>> 8) & 255) * q(0.4) >> 8)), mq(kE, child ? q(0.75) : Q));
        const lean = q(0.25) + mq(q(0.5), t0), curl = q(0.55) + (((h >>> 16) & 255) * q(0.3) >> 8);
        drawCurve((t) => {
          cU = bx + mq(len, mq(nx, t) + mq(mq(ux, lean), t) + mq(mq(ux, curl), mq(t, t)));
          cV = by + mq(len, mq(ny, t) + mq(mq(uy, lean), t) + mq(mq(uy, curl), mq(t, t)));
          return t === 0 || !M.inOpen(absI(cU) - eyeU, cV - e);
        }, 6, q(0.6), q(0.12), Q_0_03, Q);
      }
      // a few faint lower lashes, short, down and outward, on the outer half
      const nLo = child ? 2 : 3 + ((P.salt >>> (side > 0 ? 21 : 23)) & 1);
      for (let k = 0; k < nLo; k++) {
        const h = hash2(k, side * 7 + 400, P.salt), t0 = q(0.55) + idiv(k * q(0.36), nLo) + ((h & 255) * q(0.08) >> 8);
        lidPt(t0 + 64, false, Q); const ax = cU, ay = cV;
        lidPt(t0, false, Q);
        const bx = cU, by = cV, tx = ax - bx, ty = ay - by, L = isqrt(tx * tx + ty * ty) || 1, ux = idiv(tx * Q, L), uy = idiv(ty * Q, L);
        const nx = -side * uy, ny = side * ux, len = mq(q(0.018), kE);
        drawCurve((t) => { cU = bx + mq(len, mq(nx, t) + mq(mq(ux, q(0.5)), t)); cV = by + mq(len, mq(ny, t) + mq(mq(uy, q(0.5)), t)); return true; }, 4, q(0.2), q(0.06), Q_0_03);
      }
    }
    // the inner corner: the caruncle, the eye-side arc of a small lens inside the opening at the inner corner
    {
      const tC = q(0.075), vu = -mq(M.uh, M.upF(tC)), vl = mq(M.lh, M.loF(tC)), cy = (vu + vl) >> 1, ry = mq(vl - vu, q(0.34)), rx = mq(ew, q(0.07)), cxr = mq(ew, q(-0.86));
      drawCurve((t) => {
        const a = -HALFPI16 + idiv(t * PI16, Q), dur = cxr + mq(rx, cosF(a) * 4), dvr = cy + mq(ry, sinF(a) * 4); // the half toward the eye
        cU = ec + side * (mq(dur, M.eyeC) - mq(dvr, M.eyeS)); cV = e + mq(dur, M.eyeS) + mq(dvr, M.eyeC);
        return true;
      }, 12, q(0.14), q(0.18), Q_0_02);
    }
    // the sclera's roundness: a few fine arcs in each corner of the white, never across the middle or on the iris
    {
      const g = M.gEye(side), cosI = cosF(idiv(M.irisA * 21, 20)) * 4, R = M.eyeR;
      for (const cs of [-1, 1]) for (let j = 0; j < 3; j++) {
        const f = q(0.66) + j * q(0.09);
        drawCurve((t) => {
          const ft = f - mq(q(0.05), sinPi(t) * 4), tt = (Q + cs * ft) >> 1, vu = -mq(M.uh, M.upF(tt)), vl = mq(M.lh, M.loF(tt));
          const dur = cs * mq(ew, ft), dvr = vu + mq(vl - vu, q(0.15) + mq(q(0.7), t));
          const du = mq(dur, M.eyeC) - mq(dvr, M.eyeS), dv = mq(dur, M.eyeS) + mq(dvr, M.eyeC);
          cU = ec + side * du; cV = e + dv;
          if (!M.inOpen(du, dv)) return false;
          const X = side * du, h2 = R * R - X * X - dv * dv;
          if (h2 <= 0) return false;
          const dz = isqrt(h2);
          return idiv(X * g[0] + dv * g[1] + dz * g[2], R) < cosI; // off the iris
        }, 10, q(0.12), q(0.18), Q_0_02);
      }
    }
    // stage two: an upper-lid crease above every eye past childhood, its weight by age and the lid's weight (the
    // plan's crease bit keeps the deeper fold it drew in version 11); version 13: never over the brow
    const creaseTop = M.browV + mq(P.browT, Q_0_6) + q(0.02);
    const cS = Math.min(P.crease ? Q_1_55 : q(1.4), dq(e - Q_0_012 - creaseTop, M.uh)); // lowered as a whole under a low brow
    if (P.ageT > q(0.35) && cS >= q(1.15)) { const cw = mq(mq(q(0.16) + mq(q(0.14), P.oldT) + (P.crease ? q(0.06) : 0), P.lidW), P.ageT); drawCurve((t) => { lidPt(Q_0_05 + mq(Q_0_9, t), true, cS); cV -= Q_0_012; return true; }, 30, cw, mq(cw, q(1.15))); }
    // version 13: a soft shadow line under the lower lid on adults, broken; the bags past middle age kept light
    if (P.ageT > q(0.6)) drawCurve((t) => { lidPt(q(0.25) + mq(q(0.6), t), false, q(1.8)); cV += mq(q(0.012), kE); return nq(t >> 6, side * 64 + 9, 96, P.salt + 137) < q(0.35); }, 24, q(0.1), q(0.14), Q_0_02);
    if (P.oldT > Q_0_5) drawCurve((t) => { lidPt(Q_0_2 + mq(Q_0_75, t), false, Q_2_4); cV += Q_0_02; return true; }, 30, q(0.15), mq(q(0.18), P.oldT) + q(0.12));
    // nostril wing crease
    drawCurve((t) => { const a = -1229 + mq(7782, t); cU = side * (P.nostrilU + mq(Q_0_085, cosF(a) * 4)); cV = P.noseBase - Q_0_05 + mq(Q_0_075, sinF(a) * 4); return true; }, 24, q(0.22), q(0.32), Q_0_02); // lighter than version 11's
    // nasolabial fold
    if (P.oldT > Q_0_05 || P.smile > Q_0_4) {
      const d = clampQ(mq(P.oldT, Q_1_2) + Math.max(0, P.smile - Q_0_4));
      drawCurve((t) => { cU = side * (P.nostrilU + Q_0_06 + mq(P.lipW + Q_0_08 - P.nostrilU - Q_0_06, t) + mq(Q_0_08, sinPi(t) * 4)); cV = P.noseBase - Q_0_02 + mq(P.mouth + Q_0_08 - P.noseBase + Q_0_02, t); return true; }, 24, Q_0_25, Q_0_25 + mq(Q_0_5, d), Q_0_02);
    }
    ear(side);
  }
  // mouth line, lower-lip edge, upper-lip edge with the bow (only on mouths wide enough on screen), mentolabial
  drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, Q_1_02)); cV = M.vm(cU); return true; }, 40, Q_0_55, Q_0_55, Q_0_02);
  drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, Q_0_95)); const r95 = dq(dq(cU, P.lipW), Q_0_95); cV = M.vm(cU) + mq(P.lipL, powQ(clampQ(Q - sq(r95)), Q_0_8)) + Q_0_004; return true; }, 40, Q_0_25, Q_0_4, Q_0_02);
  { const cy = cosF(P.yaw) * 4; if (mq(mq(2 * P.lipW, RU), cy < Q_0_3 ? Q_0_3 : cy) >= kU(Q_60)) drawCurve((t) => { cU = mq(2 * t - Q, P.lipW); const ru = dq(cU, P.lipW); cV = M.vm(cU) - mq(mq(P.lipU, powQ(clampQ(Q - sq(ru)), Q_0_7)), Q - mq(Q_0_2, gexp(dq(cU, Q_0_045)))) - Q_0_003; return true; }, 40, Q_0_3, Q_0_3, Q_0_02); }
  // stage two: the lower lip left paper with a short shadow under it (version 13: no dark disc at the corners; with
  // the mouth line's end it read as a teardrop)
  drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, q(0.55))); const r = dq(cU, mq(P.lipW, q(0.55))); cV = M.vm(cU) + P.lipL + q(0.028) + mq(q(0.012), mq(r, r)); return true; }, 20, q(0.55), q(0.55), Q_0_02);
  if (P.oldT > Q_0_6) drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, Q_0_8)); cV = P.mouth + P.lipL + Q_0_07 + mq(Q_0_03, sq(dq(cU, P.lipW))); return true; }, 30, Q_0_2, Q_0_3 + mq(Q_0_2, P.oldT), Q_0_02);
  // forehead lines: one, two over 70
  if (P.oldT > Q_0_3) {
    const n = P.oldT > Q_0_7 ? 2 : 1;
    for (let i = 0; i < n; i++) { const vv = M.browV - Q_0_15 - i * Q_0_1; drawCurve((t) => { cU = mq(2 * t - Q, Q_0_4 + i * Q_0_1); cV = vv + mq(Q_0_015, cosF(a16Of(5 * cU + i * Q)) * 4) - mq(Q_0_03, sq(cU)); return true; }, 36, Q_0_3, Q_0_45 + mq(Q_0_2, P.oldT), Q_0_02); }
  }
  // the parting line on the hair surface
  if (hasParting(P.hair)) {
    const pth = P.partTh, vA = -P.craniumH + Q_0_03, vB = M.hairLine(pth) + Q_0_02;
    drawPlaced((t) => {
      const v = lerpQ(vA, vB, t), row = M.rowOf(v);
      M.basePoint(pth, row);
      const dx = M.bX, dy = mq(v - M.vCap, Q_0_6), dz = M.bZ, L = isqrt(dx * dx + dy * dy + dz * dz) || 1, h = M.hairThick(pth, v) + Q_0_02;
      pose.xf(dx + idiv(h * dx, L), v + idiv(h * dy, L), dz + idiv(h * dz, L));
      return visibleAt((r) => r === HAIR, -Q);
    }, 30, Q_0_45, Q_0_45);
  }
  // the base of the nose, and the ridge line on the shadow side (not in near-profile, where the silhouette does it)
  drawCurve((t) => { cU = mq(mq(P.nostrilU, Q_0_9), 2 * t - Q); cV = P.noseBase - Q_0_012 + mq(Q_0_01, cosF(idiv((2 * t - Q) * PI16, Q)) * 4); return true; }, 16, Q_0_3, Q_0_3, Q_0_02);
  { const sideS = absI(P.yaw) > degA(Q_50) ? 0 : -P.lightSide; if (sideS) drawCurve((t) => { const v = lerpQ(e + Q_0_02, P.noseBase - Q_0_08, t), tt = clampQ(dq(v - (e - Q_0_03), P.noseBase - Q_0_07 - (e - Q_0_03))); cU = sideS * lerpQ(Q_0_07, mq(P.tipW, Q_0_95), tt); cV = v; return true; }, 30, Q_0_2, Q_0_45, Q_0_02); }
  // glasses: a double contour around each eye, a bridge, the near temple arm
  if (P.glasses) {
    const rr = ew + Q_0_07, hwG = kU(mq(Q_0_22, wm)), rowE = M.rowOf(e); // thin frames
    for (const side of [-1, 1]) for (const sc of [Q, Q_1_07]) {
      const pts: number[] = [], ws: number[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = idiv(A16 * i, 48), u = eyeU * side + mq(mq(mq(rr, Q_1_15), sc), cosF(a) * 4), v = e + Q_0_01 + mq(mq(mq(rr, Q_0_85), sc), sinF(a) * 4);
        pose.xf(u, v, M.frontZ(u, M.rowOf(v)) + Q_0_12);
        pts.push(tX, tY); ws.push(hwG);
      }
      prims.strokes.push({ pts, hw: ws, c: INK }); prims.stats.curves++;
    }
    {
      const pts: number[] = [], ws: number[] = [], uA = eyeU - mq(rr, Q_1_15), vB = e - Q_0_02, rowB = M.rowOf(vB);
      for (let i = 0; i <= 8; i++) { const u = lerpQ(-uA, uA, idiv(i * Q, 8)); pose.xf(u, vB, M.frontZ(u, rowB) + Q_0_12); pts.push(tX, tY); ws.push(hwG); }
      prims.strokes.push({ pts, hw: ws, c: INK }); prims.stats.curves++;
    }
    {
      const side = sgn(P.yaw) || 1, pts: number[] = [], ws: number[] = [], wE = M.width(e), u0 = eyeU + mq(rr, Q_1_15);
      for (let i = 0; i <= 10; i++) {
        const t = idiv(i * Q, 10), u = u0 * side + mq(t, side * (wE - u0 + Q_0_02));
        const au = absI(u), uc = (au < mq(wE, Q_0_98) ? au : mq(wE, Q_0_98)) * sgn(u);
        const z = mq(M.frontZ(uc, rowE), Q - t) + mq(QN_0_05, t) + mq(Q_0_1, Q - t);
        pose.xf(u, e - Q_0_01 - mq(Q_0_01, t), z);
        const gx = tX >> 6, gy = tY >> 6;
        if (gx >= 0 && gy >= 0 && gx < FW && gy < FH && F.reg[gy * FW + gx] !== BG && F.z[gy * FW + gx]! > tZ + Q_0_08) break;
        pts.push(tX, tY); ws.push(idiv(hwG * 8, 10));
      }
      if (pts.length >= 4) { prims.strokes.push({ pts, hw: ws, c: INK }); prims.stats.curves++; }
    }
  }
  // a thin necklace following the collarbone, on skin only
  if (P.necklace) {
    const shV = P.chin + P.neckLen;
    drawPlaced((t) => {
      const u = mq(2 * t - Q, Q_0_55), v = shV + Q_0_06 + mq(Q_0_14, Q - sq(dq(u, Q_0_55)));
      pose.xfBody(u, v, torsoZ(P, shV, u, v) + Q_0_03);
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx;
      return F.reg[q0] === SKIN && F.z[q0]! <= tZ + Q_0_06;
    }, 36, Q_0_3, Q_0_3);
  }
  // a ribbon round a bun, or the tie of a ponytail
  if ((P.ribbon && hasBun(P.hair)) || isPony(P.hair)) {
    const bc = isPony(P.hair) ? tieOf(P, M) : bunCentre(P, M), rr = isPony(P.hair) ? mq(P.ponyW, Q_1_12) : mq(P.bunR, Q_1_02);
    drawPlaced((t) => {
      const a = idiv(A16 * t, Q);
      pose.xf(bc[0] + mq(rr, cosF(a) * 4), bc[1] + Q_0_01, bc[2] + mq(rr, sinF(a) * 4));
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx;
      return F.reg[q0] === HAIR && F.z[q0]! <= tZ + Q_0_05;
    }, 40, Q_0_45, Q_0_45);
  }
  // a loose bun sheds strands: short curls leaving its outline, and wisps at the temples (and the nape for a high
  // bun), all from salt bits so no stream draw moves (Mike, 2026-10-08, from a photograph of a messy topknot)
  const loose = bunLoose(P.hair);
  if (loose) {
    const high = P.hair === H_BUN_HIGH, bc = bunCentre(P, M), sy = high ? Q_0_82 : Q;
    const nS = high ? 16 + ((P.salt >>> 4) & 7) : 5 + ((P.salt >>> 4) & 3);
    for (let k = 0; k < nS; k++) {
      const h = hash2(k, 911, P.salt), h2 = hash2(k, 913, P.salt);
      const a0 = h & (A16 - 1), b0 = high ? idiv(PI16 * 35, 100) + ((h >>> 14) % idiv(PI16 * 65, 100)) : idiv(PI16 * 15, 100) + ((h >>> 14) % idiv(PI16 * 80, 100));
      const r0 = mq(bunRad(P, a0, b0, loose), Q_0_97), len = mq(P.bunR, Q_0_3 + (((h2 & 1023) * Q_0_4) >> 10));
      const ca = idiv((((h2 >>> 10) & 2047) - 1024) * 2000, 1024), cb = idiv((((h2 >>> 21) & 1023) - 512) * 1200, 512);
      drawPlaced((t) => {
        const r = r0 + mq(len, t), a = a0 + mq(ca, mq(t, t)), b = b0 + mq(cb, t), sb = sinF(b) * 4;
        pose.xf(bc[0] + mq(mq(r, sb), cosF(a) * 4), bc[1] + mq(mq(r, cosF(b) * 4), sy), bc[2] + mq(mq(r, sb), sinF(a) * 4));
        return visibleAt((rg) => rg === BG, Q_0_04);
      }, 16, Q_0_32, Q_0_1);
    }
    // wisps: hanging from just in front of the ear (temple) and, for a high bun, behind it (nape)
    const nT = high ? 2 + ((P.salt >>> 7) & 1) : 1, nN = high ? 2 : 0;
    for (let k = 0; k < nT + nN; k++) {
      const h = hash2(k, 917, P.salt), side = (k & 1) === 0 ? 1 : -1, nape = k >= nT;
      const th0 = side * (nape ? idiv(HALFPI16 * (118 + ((h >>> 3) & 15)), 100) : idiv(HALFPI16 * (66 + ((h >>> 3) & 15)), 100));
      const v0 = nape ? M.napeV - Q_0_14 : P.e - Q_0_26 + (((h >>> 8) & 255) * Q_0_12 >> 8), len = Q_0_22 + (((h >>> 16) & 255) * Q_0_28 >> 8);
      const wav = idiv(HALFPI16 * (6 + ((h >>> 24) & 7)), 100);
      drawPlaced((t) => {
        const v = v0 + mq(len, t), th = th0 + side * mq(HALFPI16 >> 3, t) + mq(wav, sinF(idiv(t * A16 * 3, 2 * Q)) * 4);
        M.basePoint(th, M.rowOf(v));
        const bx = M.bX, bz = M.bZ, L = hypotQ(bx, bz) || 1, off = Q_0_025;
        pose.xf(bx + idiv(off * bx, L), v, bz + idiv(off * bz, L));
        return visibleAt((rg) => rg === BG, Q_0_04);
      }, 16, Q_0_22, Q_0_07);
    }
  }
  if (!inv) strays(P, F, pose, drawPlaced);
  // version 14: on a turned head, the sternocleidomastoid's line on the neck's shadow side, a light line from behind the
  // ear down and forward toward the collarbone's inner end
  if (absI(P.yaw) > degA(Q_12)) {
    const side = -P.lightSide, shV = P.chin + P.neckLen;
    drawPlaced((t) => {
      const v = lerpQ(P.chin - Q_0_02, shV + Q_0_05, t), a = degA(lerpQ(q(100), q(18), t)), r = M.neckAt(v), zc = QN_0_1 - mq(Q_0_12, smQ(dq(v - P.chin, Q_0_8)));
      pose.xfBody(side * mq(r, sinF(a) * 4), v, zc + mq(r + Q_0_01, cosF(a) * 4));
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx;
      return F.reg[q0] === SKIN && F.tail[q0] === 2 && F.z[q0]! <= tZ + Q_0_03;
    }, 28, q(0.14), q(0.26));
  }
  // version 14: a ponytail ends in loose strands, fanning a little from the last fifth of it past its tip
  const pp = ponyPath(P, M);
  if (pp && !pp.braid) {
    for (let k = 0; k < 9; k++) {
      const h = hash2(k, 977, P.salt + 2213), s0 = Q - mq(Q - pp.taper, q(0.45)) + ((h & 255) * mq(Q - pp.taper, q(0.3)) >> 8), off = (((h >>> 8) & 255) - 128) * q(0.7) >> 7, a = ((h >>> 16) & 1023) * 16;
      const len = mq(P.ponyW, q(0.9) + (((h >>> 26) & 63) * q(0.9) >> 6)), curl = (((h >>> 20) & 63) - 32) * q(0.4) >> 5;
      ponyAt(pp, s0);
      if (pp.body) { const zMin = torsoZ(P, P.chin + P.neckLen, pX, pY) + mq(mq(P.ponyW, ponyG(pp, s0)), Q_0_8); if (pZ < zMin) pZ = zMin; }
      const r0 = mq(mq(P.ponyW, ponyG(pp, s0)), off), ca = cosF(a) * 4, sa = sinF(a) * 4;
      const bx = pX + mq(r0, mq(pN1[0], ca) + mq(pN2[0], sa)), by = pY + mq(r0, mq(pN1[1], ca) + mq(pN2[1], sa)), bz = pZ + mq(r0, mq(pN1[2], ca) + mq(pN2[2], sa));
      const T: V3 = [pT[0], pT[1], pT[2]], n1: V3 = [pN1[0], pN1[1], pN1[2]], L = mq(P.ponyW, Q - ponyG(pp, s0)) + len;
      drawPlaced((t) => {
        const d = mq(L, t), c = mq(mq(curl, mq(t, t)), P.ponyW);
        (pp.body ? pose.xfBody : pose.xf)(bx + mq(d, T[0]) + mq(c, n1[0]), by + mq(d, T[1]) + mq(c, n1[1]), bz + mq(d, T[2]) + mq(c, n1[2]));
        return visibleAt((rg) => rg === BG, Q_0_03);
      }, 14, q(0.3), q(0.08));
    }
  }
  if (!inv) folds(P, F, pose, drawPlaced);
}

/**
 * Stage two: a few loose single hairs leaving the silhouette. Points on the hair's edge against the ground are
 * picked by hash (about one in 260 edge pixels, at most nine), and from each a short curl runs outward, away
 * from the head's centre, turning a little by the hash.
 */
type Placer = (fn: (t: number) => boolean, n: number, hw0: number, hw1: number, floor?: number) => void;
function strays(P: V14Plan, F: Field, pose: Pose, drawPlaced: Placer): void {
  if (P.hair === H_WRAP || P.hair === H_BALD) return;
  let n = 0;
  for (let y = 1; y < FH - 1 && n < 9; y++) for (let x = 1; x < FW - 1 && n < 9; x++) {
    const q0 = y * FW + x;
    if (F.reg[q0] !== HAIR || (F.reg[q0 - 1] !== BG && F.reg[q0 + 1] !== BG && F.reg[q0 - FW] !== BG)) continue;
    const h = hash2(x, y, P.salt + 307);
    if (h % 260 !== 0) continue;
    n++;
    const X0 = x * 64 + 32, Y0 = y * 64 + 32, dx = X0 - pose.cx, dy = Y0 - pose.cy;
    const len = kU(q(22) + (((h >>> 9) & 255) * q(30) >> 8)), turn = idiv((((h >>> 17) & 255) - 128) * 3, 2);
    const a0 = atan2i(dy, dx);
    drawPlaced((t) => {
      const a = (a0 + mq(turn, mq(t, t))) & 1023, r = mq(len, t);
      tX = X0 + ((COS(a) * r) >> 14); tY = Y0 + ((SIN[a]! * r) >> 14); tZ = 0;
      return true;
    }, 12, q(0.42), q(0.12), q(0.8));
  }
}

/**
 * Stage two: two to four fold lines where the garment bends, at the shoulders and from the neckline, in body
 * space, and only where the garment shows; their number and lengths from salt bits (no stream draw moves).
 */
function folds(P: V14Plan, F: Field, pose: Pose, drawPlaced: Placer): void {
  const shV = P.chin + P.neckLen, nF = 2 + ((P.salt >>> 5) % 3);
  for (let k = 0; k < nF; k++) {
    const h = hash2(k, 509, P.salt), side = (k & 1) === 0 ? 1 : -1, shoulder = k < 2;
    const u0 = side * (shoulder ? mq(P.shW, q(0.62) + (((h & 255) * q(0.16)) >> 8)) : q(0.3) + (((h & 255) * q(0.25)) >> 8));
    const v0 = shoulder ? torsoTop(P, shV, u0) + q(0.12) : shV + q(0.32) + (((h >>> 8) & 255) * q(0.2) >> 8);
    const du = side * (shoulder ? QN_0_1 - (((h >>> 16) & 255) * q(0.15) >> 8) : q(0.18) + (((h >>> 16) & 255) * q(0.12) >> 8)), dv = q(0.5) + (((h >>> 24) & 255) * q(0.3) >> 8);
    drawPlaced((t) => {
      const u = u0 + mq(du, t), v = v0 + mq(dv, t) + mq(q(0.05), sinPi(t) * 4);
      pose.xfBody(u, v, torsoZ(P, shV, u, v) + q(0.03));
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx, r = F.reg[q0];
      return (r === GARM || r === GARM2) && F.z[q0]! <= tZ + q(0.08);
    }, 24, q(1.0), q(0.7), Q);
  }
}

/** The connected runs of one region (4-neighbour flood): for each, the pixel count, the centroid and the second moments, raster units. */
function blobs(F: Field, region: number, each: (n: number, cx: number, cy: number, vxx: number, vyy: number, vxy: number) => void): void {
  const seen = new Uint8Array(FW * FH), stack: number[] = [];
  for (let q0 = 0; q0 < FW * FH; q0++) {
    if (F.reg[q0] !== region || seen[q0]) continue;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    stack.push(q0); seen[q0] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % FW, y = (c - x) / FW, X = x * 64 + 32, Y = y * 64 + 32;
      n++; sx += X; sy += Y; sxx += X * X; syy += Y * Y; sxy += X * Y;
      if (x > 0 && !seen[c - 1] && F.reg[c - 1] === region) { seen[c - 1] = 1; stack.push(c - 1); }
      if (x < FW - 1 && !seen[c + 1] && F.reg[c + 1] === region) { seen[c + 1] = 1; stack.push(c + 1); }
      if (c >= FW && !seen[c - FW] && F.reg[c - FW] === region) { seen[c - FW] = 1; stack.push(c - FW); }
      if (c < FW * (FH - 1) && !seen[c + FW] && F.reg[c + FW] === region) { seen[c + FW] = 1; stack.push(c + FW); }
    }
    const cx = idiv(sx, n), cy = idiv(sy, n);
    each(n, cx, cy, idiv(sxx, n) - cx * cx, idiv(syy, n) - cy * cy, idiv(sxy, n) - cx * cy);
  }
}

/**
 * Each nostril as one small shaped dark on its pixels' principal axes (version 13: half-axes 1.1 x the standard
 * deviations, capped, flattened above so it reads as a nostril and not a blot; the long axis within 30 degrees of
 * level), sixteen-sided.
 */
function nostrils(F: Field, prims: Prims): void {
  blobs(F, NOSTRIL, (n, cx, cy, a, c, b) => {
    if (n < 2) return;
    const h = idiv(a - c, 2), r = isqrt(h * h + b * b), l1 = idiv(a + c, 2) + r, l2 = Math.max(0, idiv(a + c, 2) - r);
    // version 13: smaller (1.1 x the deviations, at most 4.5 by 2.5 px) and shaped like a bean, flat above, round below
    const r1 = clampI(idiv(isqrt(l1) * 11, 10) + 2, 24, 72), r2 = clampI(idiv(isqrt(l2) * 11, 10) + 2, 12, 40);
    let ang = b === 0 && h >= 0 ? 0 : atan2i(2 * b, a - c) >> 1; // the long axis, kept within 30 degrees of level
    if (ang > 256) ang -= 512;
    ang = clampI(ang, -85, 85) & 1023;
    const ca = COS(ang), sa = SIN[ang]!, poly: number[] = [];
    for (let k = 0; k < 16; k++) {
      const sk = SIN[k * 64]!, e1 = (r1 * COS(k * 64)) >> 14, e2 = ((sk < 0 ? idiv(r2 * 55, 100) : r2) * sk) >> 14;
      poly.push(cx + ((e1 * ca - e2 * sa) >> 14), cy + ((e1 * sa + e2 * ca) >> 14));
    }
    prims.fills.push(poly);
    prims.stats.stamps++;
  });
}

/**
 * Version 13: the eye's inside, drawn from its geometry at the output's resolution (the field's iris and pupil
 * regions were a few pixels on a small eye, and a lid could leave none). The ball (centre, radius) and each eye's
 * gaze come from the model (gazeOf there turns a gaze the lids would hide toward the opening); a point of the ball
 * in direction d shows when it lies in the lid opening and nothing in the field is in front of it.
 *  - The pupil: one filled disc, the projected circle of the pupil's cap (an ellipse under turn). Something in front
 *    of part of it (the nose, on a turned head's far eye) cuts it to what shows.
 *  - The catchlights: a crisp paper disc toward the light, inside the iris, and on a quarter of the draws (salt
 *    bits) a tiny second one across the pupil.
 *  - The iris: 72 fine radial fibres from the pupil to the rim, each its own start, end and weight (hashes), heavier
 *    under the upper lid's shadow, with 36 more there; a wavy collarette ring partway out; a dark limbal ring at the
 *    rim and a soft one inside it; three to six small dark crypts.
 * On the dark ground the pupil is the ground and the catchlight the light ink; the iris is the field's hatching.
 */
function eyes(P: V14Plan, F: Field, M: Model, pose: Pose, prims: Prims, inv: boolean): void {
  const R = M.eyeR, zc = M.zcEye, PAPER = slot(0, 8), hairE = kU(q(0.08)), ws: number[] = [];
  let pts: number[] = [];
  const flush = (h: number, even: boolean): void => {
    if (pts.length >= 4) { prims.strokes.push({ pts, hw: even ? ws.slice() : swell(ws, hairE, h), c: INK }); prims.stats.curves++; }
    pts = []; ws.length = 0;
  };
  for (const side of [-1, 1]) {
    const ec = side * M.eyeU, ra = dq(M.pupilA, M.irisA);
    /** Project the ball's point in direction d (tX, tY, tZ); true when it shows: in the opening, and the field there the eye itself or nothing nearer. */
    const at = (d: V3): boolean => {
      pose.xf(ec + mq(R, d[0]), P.e + mq(R, d[1]), zc + mq(R, d[2]));
      if (!M.openAt(side, d)) return false;
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx, r = F.reg[q0];
      return r === WHITE || r === IRIS || r === PUPIL || r === HILITE || F.z[q0]! <= tZ + Q_0_03;
    };
    // where something in front (the nose, on a turned head's far eye) hides part of the pupil, the gaze turns toward
    // the opening's centre in eighths until the whole pupil shows; an eye whose pupil never shows is hidden
    let g = M.gEye(side), b = M.basisOf(g), seen = false;
    for (let k = 0; k <= 8 && !seen; k++) {
      g = M.gEye(side, k); b = M.basisOf(g); seen = at(g);
      for (let j = 0; j < 12 && seen; j++) if (!at(M.capDir(g, b, M.pupilA, j * 85))) seen = false;
    }
    if (!seen) { g = M.gEye(side); b = M.basisOf(g); }
    const shadeAt = (d: V3): number => M.lidShade(side * mq(R, d[0]), mq(R, d[1]));
    const iris = (rho: number, phi: number): V3 => M.capDir(g, b, mq(M.irisA, rho), phi);
    if (!at(g)) continue; // this eye's iris centre does not show (the far eye behind the nose)
    const pcx = tX, pcy = tY;
    // the iris (on paper grounds)
    if (!inv) {
      const run = (n: number, fn: (t: number) => V3, w: (t: number, d: V3) => number, h: number, even = false): void => {
        for (let i = 0; i <= n; i++) {
          const t = idiv(i * Q, n), d = fn(t);
          const wt = at(d) ? w(t, d) : -1;
          if (wt < 0) { flush(h, even); continue; }
          pts.push(tX, tY); ws.push(kU(wt));
        }
        flush(h, even);
      };
      const NF = 72;
      for (let j = 0; j < NF + 36; j++) {
        const h = hash2(j, side + 5, P.salt + 1709), extra = j >= NF;
        const phi = idiv(extra ? (j - NF) * 2048 + 512 : j * 1024, NF) + (h & 15) - 8;
        const r0 = mq(ra, q(0.98)) + (((h >>> 4) & 255) * q(0.06) >> 8), r1 = q(0.84) + (((h >>> 12) & 255) * q(0.14) >> 8);
        const wf = q(0.1) + (((h >>> 20) & 255) * q(0.14) >> 8);
        run(6, (t) => iris(r0 + mq(r1 - r0, t), phi), (_t, d) => { const sh = shadeAt(d); return extra && sh < q(0.45) ? -1 : mq(wf, Q + mq(q(0.6), sh)); }, h);
      }
      // the collarette: a wavy ring a third of the way out from the pupil
      const rc = ra + mq(Q - ra, q(0.36)), ph = (P.salt >>> 5) & 1023;
      run(48, (t) => { const phi = idiv(t * 1024, Q); return iris(rc + mq(q(0.045), SIN[(7 * phi + ph) & 1023]! * 4), phi); }, (_t, d) => mq(q(0.36), Q + mq(q(0.6), shadeAt(d))), hash2(side, 77, P.salt), true);
      // the limbal ring at the rim, dark, and a soft ring inside it
      run(56, (t) => iris(q(0.985), idiv(t * 1024, Q)), (_t, d) => mq(q(0.5), Q + mq(q(0.4), shadeAt(d))), 0, true);
      run(48, (t) => iris(q(0.92), idiv(t * 1024, Q)), () => q(0.2), 0, true);
      // crypts: three to six small dark lenses between the collarette and the rim
      const nC = 3 + (((P.salt >>> 17) + (side > 0 ? 1 : 0)) & 3);
      for (let k = 0; k < nC; k++) {
        const h = hash2(k, side + 9, P.salt + 1801), phi = h & 1023, rr = rc + q(0.08) + ((((h >>> 10) & 255) * (q(0.78) - rc)) >> 8);
        run(5, (t) => iris(rr, phi + idiv((t - Q_0_5) * 22, Q)), () => q(0.62), h);
      }
    }
    // the pupil: one disc
    const NP = 28, rim: number[] = [];
    let full = true, rp = 0;
    for (let j = 0; j < NP; j++) {
      if (!at(M.capDir(g, b, M.pupilA, idiv(j * 1024, NP)))) full = false;
      rim.push(tX, tY); rp += isqrt((tX - pcx) * (tX - pcx) + (tY - pcy) * (tY - pcy));
    }
    rp = idiv(rp, NP);
    if (!full) { // cut to what shows: along each spoke, the farthest point that shows (eighths, by halving)
      rim.length = 0;
      for (let j = 0; j < NP; j++) {
        let lo = 0, hi = Q;
        for (let s = 0; s < 6; s++) { const mid = (lo + hi) >> 1; if (at(M.capDir(g, b, mq(M.pupilA, mid), idiv(j * 1024, NP)))) lo = mid; else hi = mid; }
        at(M.capDir(g, b, mq(M.pupilA, lo), idiv(j * 1024, NP)));
        rim.push(tX, tY);
      }
    }
    if (!inv) prims.fills.push(rim);
    prims.pupils.push(full ? 1 : 2);
    prims.stats.stamps++;
    // the catchlights, on top
    // toward the light by a seventh of the way to the half vector, nearer the pupil where the lid would hide it
    let hiOk = false;
    for (let f = q(0.14); f > 0 && !hiOk; f -= q(0.035)) hiOk = at(M.hiOf(g, f));
    if (hiOk) {
      const hx = tX, hy = tY, rc = Math.max(kU(q(0.9)), idiv(rp * 58, 100));
      prims.discs.push(hx, hy, rc, inv ? INK : PAPER); prims.stats.stamps++;
      if (full && ((P.salt >>> 13) & 3) === 0) { prims.discs.push(pcx + idiv((pcx - hx) * 55, 100), pcy + idiv((pcy - hy) * 55, 100), Math.max(kU(q(0.4)), idiv(rc * 38, 100)), inv ? INK : PAPER); prims.stats.stamps++; }
    }
  }
}

/**
 * Outlines: the marked field edges (EH between a pixel and its right neighbour, EV with the one below) as
 * chains. Each node sits on the line between its two pixels' centres at the crossing of a smoothed side
 * indicator (3 x 3 tent: 2 with the first pixel, 0 with the second, 1 neither), so a staircase of pixels
 * gives nodes along the true boundary; nodes are linked cell by cell over the dual grid (marching
 * squares); the chains are smoothed along their length and cut once by Chaikin, then drawn as burin lines.
 */
function outlines(F: Field, EH: Int32Array, EV: Int32Array, prims: Prims): void {
  const reg = F.reg, z = F.z, NN = 2 * FW * FH;
  const PX = new Int32Array(NN), PY = new Int32Array(NN), NB0 = new Int32Array(NN).fill(-1), NB1 = new Int32Array(NN).fill(-1), JN = new Int32Array(NN).fill(-1);
  const side = (p: number, a: number, b: number): number => {
    const rp = reg[p]!, ra = reg[a]!, rb = reg[b]!;
    if (ra !== rb) return rp === ra ? 2 : rp === rb ? 0 : 1;
    if (rp !== ra) return 1;
    const da = absI(z[p]! - z[a]!), db = absI(z[p]! - z[b]!);
    return da < db ? 2 : da > db ? 0 : 1;
  };
  const smoothSide = (c: number, a: number, b: number): number => {
    const cx = c % FW, cy = (c - cx) / FW;
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = clampI(cx + i, 0, FW - 1), yy = clampI(cy + j, 0, FH - 1);
      s += (2 - absI(i)) * (2 - absI(j)) * side(yy * FW + xx, a, b);
    }
    return s;
  };
  const cross = (a: number, b: number): number => {
    const sa = smoothSide(a, a, b), sb = smoothSide(b, a, b);
    if (sa <= sb) return 32;
    return clampI(idiv(64 * (sa - 16), sa - sb), 8, 56);
  };
  for (let y = 0; y < FH - 1; y++) for (let x = 0; x < FW - 1; x++) {
    const q0 = y * FW + x;
    if (EH[q0]) { PX[2 * q0] = x * 64 + 32 + cross(q0, q0 + 1); PY[2 * q0] = y * 64 + 32; }
    if (EV[q0]) { PX[2 * q0 + 1] = x * 64 + 32; PY[2 * q0 + 1] = y * 64 + 32 + cross(q0, q0 + FW); }
  }
  const link = (a: number, b: number): void => { if (NB0[a]! < 0) NB0[a] = b; else NB1[a] = b; if (NB0[b]! < 0) NB0[b] = a; else NB1[b] = a; };
  const d2 = (a: number, b: number): number => { const dx = PX[a]! - PX[b]!, dy = PY[a]! - PY[b]!; return dx * dx + dy * dy; };
  for (let y = 0; y < FH - 1; y++) for (let x = 0; x < FW - 1; x++) {
    const q0 = y * FW + x;
    const T = EH[q0] ? 2 * q0 : -1, B = EH[q0 + FW] ? 2 * (q0 + FW) : -1, Lf = EV[q0] ? 2 * q0 + 1 : -1, R = EV[q0 + 1] ? 2 * (q0 + 1) + 1 : -1;
    const n = (T >= 0 ? 1 : 0) + (B >= 0 ? 1 : 0) + (Lf >= 0 ? 1 : 0) + (R >= 0 ? 1 : 0);
    if (n < 2) continue;
    if (n === 2) { const ns = [T, B, Lf, R].filter((k) => k >= 0); link(ns[0]!, ns[1]!); continue; }
    if (n === 4) { if (d2(T, Lf) + d2(B, R) <= d2(T, R) + d2(B, Lf)) { link(T, Lf); link(B, R); } else { link(T, R); link(B, Lf); } continue; }
    // three: the opposite pair runs straight through, the third ends at the junction
    if (T >= 0 && B >= 0) { link(T, B); JN[Lf >= 0 ? Lf : R] = 2 * q0; } else { link(Lf, R); JN[T >= 0 ? T : B] = 2 * q0; }
  }
  const hwOf = (k: number): number => ((k & 1) ? EV : EH)[k >> 1]!;
  const seen = new Uint8Array(NN), lines: number[][] = [];
  const walk = (s: number, loop: boolean): void => {
    const ch: number[] = [];
    let prev = -1, cur = s;
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1; ch.push(cur);
      const nx = NB0[cur] !== prev ? NB0[cur]! : NB1[cur]!;
      prev = cur; cur = nx;
      if (nx < 0) break;
    }
    const n = ch.length;
    if (loop ? n < 24 : n < 6) return; // a speck or a sliver of a few field pixels is no outline
    let xs = ch.map((k) => PX[k]!), ys = ch.map((k) => PY[k]!), ws = ch.map(hwOf);
    if (!loop) {
      const j0 = JN[ch[0]!]!, j1 = JN[ch[n - 1]!]!;
      if (j0 >= 0) { const c = j0 >> 1, cx = c % FW, cy = (c - cx) / FW; xs.unshift(cx * 64 + 64); ys.unshift(cy * 64 + 64); ws.unshift(ws[0]!); }
      if (j1 >= 0) { const c = j1 >> 1, cx = c % FW, cy = (c - cx) / FW; xs.push(cx * 64 + 64); ys.push(cy * 64 + 64); ws.push(ws[ws.length - 1]!); }
    }
    const m = xs.length;
    for (let p = 0; p < OUTLINE_PASSES; p++) {
      const nx = xs.slice(), ny = ys.slice(), nw = ws.slice();
      for (let i = 0; i < m; i++) {
        let a = i - 1, b = i + 1;
        if (loop) { a = (a + m) % m; b = b % m; } else if (a < 0 || b >= m) continue;
        nx[i] = idiv(xs[a]! + 2 * xs[i]! + xs[b]! + 2, 4); ny[i] = idiv(ys[a]! + 2 * ys[i]! + ys[b]! + 2, 4);
        if (p < 3) nw[i] = idiv(ws[a]! + 2 * ws[i]! + ws[b]! + 2, 4);
      }
      xs = nx; ys = ny; ws = nw;
    }
    { // one Chaikin cut: each segment's quarter points, the ends of an open chain kept
      const ox: number[] = [], oy: number[] = [], ow: number[] = [], mm = xs.length;
      if (!loop) { ox.push(xs[0]!); oy.push(ys[0]!); ow.push(ws[0]!); }
      for (let i = 0; i < (loop ? mm : mm - 1); i++) {
        const j = (i + 1) % mm;
        ox.push(idiv(3 * xs[i]! + xs[j]! + 2, 4), idiv(xs[i]! + 3 * xs[j]! + 2, 4)); oy.push(idiv(3 * ys[i]! + ys[j]! + 2, 4), idiv(ys[i]! + 3 * ys[j]! + 2, 4)); ow.push(idiv(3 * ws[i]! + ws[j]! + 2, 4), idiv(ws[i]! + 3 * ws[j]! + 2, 4));
      }
      if (!loop) { ox.push(xs[mm - 1]!); oy.push(ys[mm - 1]!); ow.push(ws[mm - 1]!); }
      xs = ox; ys = oy; ws = ow;
    }
    const k = xs.length, pts: number[] = [], hw: number[] = [];
    for (let i = 0; i < k; i++) {
      pts.push(xs[i]!, ys[i]!);
      const e = loop ? 4 : Math.min(i, k - 1 - i), w = ws[i]!;
      hw.push(e >= 4 ? w : idiv(w * (e + 2), 6));
    }
    if (loop) { pts.push(xs[0]!, ys[0]!); hw.push(hw[0]!); }
    prims.strokes.push({ pts, hw, c: INK }); prims.stats.curves++;
    lines.push(pts);
  };
  for (let k = 0; k < NN; k++) if (!seen[k] && hwOf(k) && (NB0[k]! < 0 || NB1[k]! < 0) && NB0[k]! >= 0) walk(k, false);
  for (let k = 0; k < NN; k++) if (!seen[k] && hwOf(k) && NB0[k]! >= 0 && NB1[k]! >= 0) walk(k, true);
  prims.lines = lines;
}

/** Everything that is drawn, in raster units at the recorded size, from the plan alone. */
function compose(P: V14Plan, hatched = true): Prims {
  const M = makeModel(P), pose = makePose(P), inv = PALS[P.palette]!.inv === 1;
  const F = buildField(P, M, pose);
  shadeField(P, F, pose);
  const prims: Prims = { strokes: [], discs: [], segs: [], fills: [], rects: [], lines: [], pupils: [], stats: { strokes: 0, stamps: 0, curves: 0 } };
  if (hatched) hatch(P, F, prims, inv);
  contours(P, F, M, pose, prims, inv);
  // the plate mark: a half-pixel line inset 16 (reference) px
  const m = kU(Q_16), w = U >> 1;
  prims.rects.push(m, m, AWU - m, m + w, m, AHU - m - w, AWU - m, AHU - m, m, m, m + w, AHU - m, AWU - m - w, m, AWU - m, AHU - m);
  return prims;
}
/** Stroke, stamp and feature-line counts for a plan (for review sheets). */
export function statsV14(plan: V14Plan): V14Stats { return compose(plan).stats; }
/** Every traced outline as a polyline in raster units at the recorded size (1/64 of a recorded pixel; a field pixel is 64), for the staircase test. */
export function outlinesV14(plan: V14Plan): number[][] { return compose(plan).lines; }
/** Version 14: each ear as drawn (for the ear test): the facing of its lateral side toward the viewer (Q16), its whole
 *  outer contour projected (raster units, every point whether it shows or not), its own axis projected (the top of
 *  the helix to the foot of the lobe, raster units), how many of the contour's points show, and
 *  how many points of each structure line were drawn ("tone" counts the engraved curves). */
export function earsV14(plan: V14Plan): EarInfo[] {
  earLog = [];
  try { compose(plan, false); return earLog; } finally { earLog = null; } // the field's hatching does not touch the ears
}
/** Version 14: a ponytail against the neck and jaw (for the ponytail test). Counts the field pixels where the tail is the
 *  nearest surface (tail), and of those the ones in front of the neck or the lower face (below the nose base, from the
 *  front round to the sides) by more than 0.03 of the head's half-width (bad), except, over one shoulder, those below the collarbone (allowed). */
export function ponyV14(plan: V14Plan): { tail: number; bad: number; allowed: number } {
  if (!isPony(plan.hair)) return { tail: 0, bad: 0, allowed: 0 };
  const M = makeModel(plan), pose = makePose(plan);
  ponyLog = true;
  let F: Field;
  try { F = buildField(plan, M, pose); } finally { ponyLog = false; }
  // the collarbone on the page: per field column, the lowest y of the body's line v = shoulder line + 0.12
  const shV = plan.chin + plan.neckLen, collar = new Int32Array(FW).fill(-1);
  for (let i = 0; i <= 400; i++) {
    const u = -plan.shW + idiv(2 * plan.shW * i, 400), v = torsoTop(plan, shV, u) + Q_0_12;
    pose.xfBody(u, v, torsoZ(plan, shV, u, v));
    const gx = tX >> 6;
    if (gx >= 0 && gx < FW && (tY >> 6) > collar[gx]!) collar[gx] = tY >> 6;
  }
  let tail = 0, bad = 0, allowed = 0;
  for (let q0 = 0; q0 < FW * FH; q0++) {
    if (F.tail[q0] !== 1 || F.reg[q0] !== HAIR) continue;
    tail++;
    if (F.zNJ![q0]! <= ZFAR || F.z[q0]! <= F.zNJ![q0]! + Q_0_03) continue; // nothing of the neck or jaw here, or the tail is not in front of it (a grazing silhouette's sampling)
    const x = q0 % FW, y = (q0 - x) / FW;
    if (plan.hair === H_PONY_SHOULDER && collar[x]! >= 0 && y > collar[x]!) allowed++;
    else bad++;
  }
  return { tail, bad, allowed };
}
/** Version 14: the neck against the face (for the neck test), on the page: the neck's width in the six field rows just
 *  below the chin (their median; the run of neck pixels through the neck's axis) over the head's width in the row of the jaw's angle (the
 *  run of head pixels through the face's midline; hair, a beard or a collar over the neck's sides shortens it), and the
 *  same ratio in the model (the neck's diameter just below the chin over the face's width at the jaw angle), and
 *  version 13's model ratio for the same plan. */
export function neckV14(plan: V14Plan): { page: number; model: number; v13: number } {
  const M = makeModel(plan), pose = makePose(plan), F = buildField(plan, M, pose);
  /** The run in row y of pixels marked `mark` (or `also`, a speck of the chin in the neck's row) through the pixel
   *  marked `mark` nearest x0 (within 8). */
  const run = (y: number, x0: number, mark: number, also: number): number => {
    if (y < 0 || y >= FH) return 0;
    let c = -1;
    for (let d = 0; d <= 8 && c < 0; d++) for (const x of [x0 - d, x0 + d]) if (c < 0 && x >= 0 && x < FW && F.tail[y * FW + x] === mark) c = x;
    if (c < 0) return 0;
    const ok = (x: number): boolean => { const m = F.tail[y * FW + x]; return m === mark || m === also; };
    let a = c, b = c;
    while (a > 0 && ok(a - 1)) a--;
    while (b < FW - 1 && ok(b + 1)) b++;
    return b - a + 1;
  };
  pose.xf(0, plan.chin + Q_0_02, M.dFront(plan.chin)); const yChin = tY >> 6;
  pose.xfBody(0, plan.chin + Q_0_1, QN_0_1); const xNeck = tX >> 6;
  pose.xf(-M.jawHalf, plan.jawV, 0); const ya = tY; pose.xf(M.jawHalf, plan.jawV, 0);
  pose.xf(0, plan.jawV, M.dFront(plan.jawV)); const xMid = tX >> 6;
  const yJaw = ((ya + tY) >> 1) >> 6;
  let yN = yChin;
  while (yN < Math.min(FH - 6, yChin + 24) && run(yN, xNeck, 2, 3) === 0) yN++; // the first row of neck below the chin
  const rows: number[] = [];
  for (let y = yN; y < yN + 6; y++) rows.push(run(y, xNeck, 2, 3));
  rows.sort((a, b) => a - b);
  const neck = rows[3]!, face = run(yJaw, xMid, 3, 3); // the median of six rows (a collar or hair may cut one)
  return { page: face ? neck / face : 0, model: dq(M.neckAt(plan.chin + Q_0_06), M.jawHalf) / Q, v13: dq(mq(plan.neckR, Q + mq(Q_0_12, smQ(dq(Q_0_06, Q_0_6)))), M.jawHalf) / Q };
}
/** The pupils drawn for a plan, one entry for each eye that shows: 1 a whole disc, 2 a disc cut by something in front of it (for the eye test). */
export function pupilsV14(plan: V14Plan): number[] {
  const M = makeModel(plan), pose = makePose(plan), F = buildField(plan, M, pose);
  const prims: Prims = { strokes: [], discs: [], segs: [], fills: [], rects: [], lines: [], pupils: [], stats: { strokes: 0, stamps: 0, curves: 0 } };
  eyes(plan, F, M, pose, prims, PALS[plan.palette]!.inv === 1); // the field's depth is all the eyes read (the same pupils compose() draws)
  return prims.pupils;
}

/* ── Drawing: the slot map at 2 x 2 samples a pixel, then the colours ──────────────────────────────
 * Raster units are 1/32 of a pixel; sample (X, Y) is the point (16X + 8, 16Y + 8). A span [xa, xb) covers
 * the samples X with 16X + 8 in it, [idiv(xa + 7, 16), idiv(xb + 7, 16)); a point at or past a rational
 * crossing N / D (D > 0) is the first X with (16X + 8) D >= N, idiv(N + 8D - 1, 16D). */

class Slots {
  readonly w: number;
  readonly h: number;
  readonly idx: Uint8Array;
  private readonly exa: number[] = []; private readonly eya: number[] = []; private readonly exb: number[] = []; private readonly eyb: number[] = [];
  private readonly edir: number[] = []; private readonly ey0: number[] = []; private readonly ey1: number[] = []; private readonly cx: number[] = []; private readonly cd: number[] = [];
  constructor(S: number) { this.w = 2 * AW * S; this.h = 2 * AH * S; this.idx = new Uint8Array(this.w * this.h); }
  span(Y: number, X0: number, X1: number, c: number): void {
    if (Y < 0 || Y >= this.h) return;
    if (X0 < 0) X0 = 0;
    if (X1 > this.w) X1 = this.w;
    if (X0 < X1) this.idx.fill(c, Y * this.w + X0, Y * this.w + X1);
  }
  /** Scanline fill, nonzero winding; pts flat [x, y, ...] in raster units. */
  poly(pts: number[], c: number): void {
    const n = pts.length >> 1;
    const { exa, eya, exb, eyb, edir, ey0, ey1, cx, cd } = this; // reused between calls (the same fill, no garbage)
    exa.length = 0; eya.length = 0; exb.length = 0; eyb.length = 0; edir.length = 0; ey0.length = 0; ey1.length = 0;
    let ymin = this.h, ymax = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      let xa = pts[2 * j]!, ya = pts[2 * j + 1]!, xb = pts[2 * i]!, yb = pts[2 * i + 1]!, dir = 1;
      if (ya === yb) continue;
      if (ya > yb) { const tx = xa, ty = ya; xa = xb; ya = yb; xb = tx; yb = ty; dir = -1; }
      const y0 = Math.max(0, idiv(ya + 7, 16)), y1 = Math.min(this.h, idiv(yb + 7, 16));
      if (y1 <= y0) continue;
      exa.push(xa); eya.push(ya); exb.push(xb); eyb.push(yb); edir.push(dir); ey0.push(y0); ey1.push(y1);
      if (y0 < ymin) ymin = y0;
      if (y1 > ymax) ymax = y1;
    }
    const m = exa.length;
    if (m < 2) return;
    for (let Y = ymin; Y < ymax; Y++) {
      const y = 16 * Y + 8;
      cx.length = 0; cd.length = 0;
      for (let i = 0; i < m; i++) {
        if (Y < ey0[i]! || Y >= ey1[i]!) continue;
        const D = eyb[i]! - eya[i]!, N = exa[i]! * D + (y - eya[i]!) * (exb[i]! - exa[i]!);
        const X = idiv(N + 8 * D - 1, 16 * D), d = edir[i]!;
        let k = cx.length;
        cx.push(X); cd.push(d);
        while (k > 0 && cx[k - 1]! > X) { cx[k] = cx[k - 1]!; cd[k] = cd[k - 1]!; k--; }
        cx[k] = X; cd[k] = d;
      }
      let wind = 0;
      for (let k = 0; k + 1 < cx.length; k++) {
        wind += cd[k]!;
        if (wind !== 0) this.span(Y, cx[k]!, cx[k + 1]!, c);
      }
    }
  }
  disc(cx: number, cy: number, r: number, c: number): void {
    const Y0 = Math.max(0, idiv(cy - r + 7, 16)), Y1 = Math.min(this.h, idiv(cy + r + 7, 16)), r2 = r * r;
    for (let Y = Y0; Y < Y1; Y++) {
      const dy = 16 * Y + 8 - cy, h2 = r2 - dy * dy;
      if (h2 <= 0) continue;
      const h = isqrt(h2);
      this.span(Y, idiv(cx - h + 7, 16), idiv(cx + h + 7, 16), c);
    }
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const X0 = idiv(x0 + 7, 16), X1 = idiv(x1 + 7, 16), Y0 = Math.max(0, idiv(y0 + 7, 16)), Y1 = Math.min(this.h, idiv(y1 + 7, 16));
    for (let Y = Y0; Y < Y1; Y++) this.span(Y, X0, X1, c);
  }
  /** A segment from (x0, y0) to (x1, y1) with half-widths w0 and w1 (the round ends are the stamps' discs). */
  seg(x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, c: number): void {
    const dx = x1 - x0, dy = y1 - y0, L = isqrt(dx * dx + dy * dy);
    if (!L) return;
    const ax = idiv(-dy * w0, L), ay = idiv(dx * w0, L), bx = idiv(-dy * w1, L), by = idiv(dx * w1, L);
    this.poly([x0 + ax, y0 + ay, x1 + bx, y1 + by, x1 - bx, y1 - by, x0 - ax, y0 - ay], c);
  }
  /** A polyline with per-vertex half-widths, as chunked offset polygons. */
  stroke(pts: number[], hw: number[], c: number, S: number): void {
    const n = pts.length >> 1;
    if (n < 2) return;
    const CH = 12;
    for (let a = 0; a < n - 1; a += CH) {
      const b = Math.min(n - 1, a + CH), poly: number[] = [], right: number[] = [];
      for (let i = a; i <= b; i++) {
        const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
        const dx = pts[2 * inx]! - pts[2 * ip]!, dy = pts[2 * inx + 1]! - pts[2 * ip + 1]!, L = isqrt(dx * dx + dy * dy) || 1;
        const h = hw[i]! * S, nx = idiv(-dy * h, L), ny = idiv(dx * h, L), x = pts[2 * i]! * S, y = pts[2 * i + 1]! * S;
        poly.push(x + nx, y + ny); right.push(x - nx, y - ny);
      }
      for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i]!, right[i + 1]!);
      this.poly(poly, c);
    }
  }
}

/** The paper's grain, in 1/256 of a level per pixel: a per-pixel hash and a slow mottle, fixed for all time. */
const grainCache = new Map<number, Int16Array>();
function grainTable(palette: number): Int16Array {
  const have = grainCache.get(palette);
  if (have) return have;
  const { amp, mot, cell } = PALS[palette]!, out = new Int16Array(AW * AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    out[y * AW + x] = idiv(((hash2(x, y, 7) >>> 16) - 32768) * amp, 32768) + idiv(fbm2(x * 8, y * 8, cell, 107) * mot, NOISE_ONE);
  }
  grainCache.set(palette, out);
  return out;
}

/** The recorded tile grid in output pixels: the frame, the tile, the reading pixel's offset in its tile. */
const OFFR = OFF * RS, TWR = TW * RS, THR = TH * RS, RXR = RX * RS + 1, RYR = RY * RS + 1;

/** Draw at S times version 11's size: S = RS is the recorded file (the reading pixels written), any other S a redrawing. */
function draw(plan: V14Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = 1200 * S, H = 1200 * S, AWs = AW * S, AHs = AH * S, recorded = S === RS;
  const pal = PALETTES_V14[plan.palette]!, tw = TWINS_V14[plan.palette]!;
  const prims = compose(plan);
  const cv = new Slots(S);
  cv.idx.fill(slot(0, 8));
  for (const g of prims.strokes) cv.stroke(g.pts, g.hw, g.c, S);
  for (const f of prims.fills) cv.poly(f.map((v) => v * S), INK);
  const sg = prims.segs;
  for (let i = 0; i < sg.length; i += 7) cv.seg(sg[i]! * S, sg[i + 1]! * S, sg[i + 2]! * S, sg[i + 3]! * S, sg[i + 4]! * S, sg[i + 5]! * S, sg[i + 6]!);
  const d = prims.discs;
  for (let i = 0; i < d.length; i += 4) cv.disc(d[i]! * S, d[i + 1]! * S, d[i + 2]! * S, d[i + 3]!);
  const r = prims.rects;
  for (let i = 0; i < r.length; i += 4) cv.rect(r[i]! * S, r[i + 1]! * S, r[i + 2]! * S, r[i + 3]! * S, INK);
  const idx = cv.idx, sw = cv.w, counts = new Int32Array(pal.length);
  // the centre snap: the four samples under each reading pixel take their majority index (paper on a tie)
  if (recorded) {
    for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 16; tx++) {
      const x = tx * TWR + RXR, y = ty * THR + RYR, a = 2 * y * sw + 2 * x, b = a + sw;
      counts.fill(0);
      counts[idx[a]! >> 4]!++; counts[idx[a + 1]! >> 4]!++; counts[idx[b]! >> 4]!++; counts[idx[b + 1]! >> 4]!++;
      let best = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
      const c = slot(best, 8);
      idx[a] = c; idx[a + 1] = c; idx[b] = c; idx[b + 1] = c;
    }
  }
  // the colours: the mean of the four samples' tinted colours plus the grain (one grain cell per version 11 pixel); a reading pixel is exact
  const nslot = pal.length * 16, pr = new Int32Array(nslot), pg = new Int32Array(nslot), pb = new Int32Array(nslot);
  for (let k = 0; k < pal.length; k++) for (let t = 0; t < 16; t++) {
    const o = TINTS[t]!, p = pal[k]!;
    pr[k * 16 + t] = Math.min(255, Math.max(0, p[0] + o)); pg[k * 16 + t] = Math.min(255, Math.max(0, p[1] + o)); pb[k * 16 + t] = Math.min(255, Math.max(0, p[2] + o));
  }
  const grain = grainTable(plan.palette);
  const px = new Uint8Array(W * H * 4);
  px[0] = FRAME[0]; px[1] = FRAME[1]; px[2] = FRAME[2]; px[3] = 255;
  for (let n = 4; n < px.length; n *= 2) px.copyWithin(n, 0, Math.min(n, px.length - n)); // the frame colour everywhere, doubling
  const bitAt = (x: number, y: number): number => { const k = (idiv(y, THR) << 4) + idiv(x, TWR); return (commitment[k >> 3]! >> (7 - (k & 7))) & 1; };
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < AHs; y++) {
    const readingRow = recorded && y % THR === RYR, r0 = 2 * y * sw, r1 = r0 + sw, o = (OFF * S + y) * W + OFF * S, gy = idiv(y, S) * AW;
    for (let x = 0; x < AWs; x++) {
      const a = r0 + 2 * x, b = r1 + 2 * x, k0 = idx[a]!, k1 = idx[a + 1]!, k2 = idx[b]!, k3 = idx[b + 1]!;
      const i = (o + x) * 4;
      if (readingRow && x % TWR === RXR) {
        counts.fill(0);
        counts[k0 >> 4]!++; counts[k1 >> 4]!++; counts[k2 >> 4]!++; counts[k3 >> 4]!++;
        let best = 0;
        for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
        const col = (bitAt(x, y) ? tw : pal)[best]!;
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
        continue;
      }
      const g = grain[gy + ((x / S) | 0)]!; // x >= 0: the same as idiv(x, S)
      if (k0 === k1 && k0 === k2 && k0 === k3) { // the four samples agree: the mean is the slot's colour itself
        px[i] = clamp((pr[k0]! * 256 + g + 128) >> 8); px[i + 1] = clamp((pg[k0]! * 256 + g + 128) >> 8); px[i + 2] = clamp((pb[k0]! * 256 + g + 128) >> 8);
        continue;
      }
      px[i] = clamp((((pr[k0]! + pr[k1]! + pr[k2]! + pr[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
      px[i + 1] = clamp((((pg[k0]! + pg[k1]! + pg[k2]! + pg[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
      px[i + 2] = clamp((((pb[k0]! + pb[k1]! + pb[k2]! + pb[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
    }
  }
  return px;
}

/** The recorded picture, 2400 x 2400. */
export function renderV14(plan: V14Plan, commitment: Uint8Array): Uint8Array { return draw(plan, commitment, RS); }
/** The same picture at S times version 11's 1200 x 1200 (S = 2 is the recorded size), for print: a redrawing, not the recorded file. */
export function renderV14At(plan: V14Plan, commitment: Uint8Array, S: number): Uint8Array { return draw(plan, commitment, S); }

/** Read the code from the art alone: the 256 reading pixels, their palette, and whether each is a twin. */
export function decodeV14(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== V14_WIDTH || height !== V14_HEIGHT || px.length !== width * height * 4) return null;
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFFR + TWR * (k & 15) + RXR, y = OFFR + THR * (k >> 4) + RYR;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  for (let p = 0; p < PALETTES_V14.length; p++) {
    const out = new Uint8Array(32);
    let ok = true;
    for (let k = 0; k < 256 && ok; k++) {
      if (TWINS_V14[p]!.some((c) => same(c, read[k]!))) out[k >> 3]! |= 1 << (7 - (k & 7));
      else if (!PALETTES_V14[p]!.some((c) => same(c, read[k]!))) ok = false;
    }
    if (ok) return out;
  }
  return null;
}
