/**
 * bitgraph-art/11 (2026-10-08): ink portraits. Square, 1200 x 1200 with the plain 32 px frame (art
 * 1136 x 1136), the code carried as versions 8, 9 and 10 carry it.
 *
 * The picture is one person: a parametric head (an ellipsoidal cranium over superelliptic face slices
 * whose half-widths follow a monotone cubic through temple, cheekbone, jaw and chin; features as bumps
 * with region ids: brow ridge, sockets, cheekbones, nose, lips, brows, eyeballs with iris, pupil and a
 * reserved highlight; ears; hair as an offset surface in nineteen silhouettes, from cropped to a wrap;
 * neck, shoulders and one of eleven necklines), posed by yaw, pitch and roll, splatted into a
 * half-resolution field (depth, normal, region, strand direction), lit by one key light with
 * screen-space shadow rays, and drawn as etching: layers of hatch streamlines that follow the form
 * (the direction perpendicular to the projected normal, blended with one diagonal), silhouettes and
 * depth steps stamped from the field, and feature lines projected from head space with a depth test.
 * THE LIT FACE IS PAPER: skin above the light threshold carries no hatching; the shadow side one layer
 * that starts sparse at a wandering terminator; the core shadow two; the mouth zone none. Four
 * palettes of two colours (ink on cream, sepia on buff, sanguine on toned paper, and nightline, a
 * white line on a dark ground with the tone mapping inverted), paper grain and a mottle, a plate mark.
 * The geometry is continuous and centred on the human middle: no sex label, no preset; the stream
 * ("bitgraph-art/11") picks every range, silhouette, neckline, expression, gaze, light and detail.
 *
 * Everything is integer. Head units are 16.16 fixed point (Q = 65536), angles are 1/16 of a step of
 * version 6's 1024-step SIN table (16384 a turn) for the model and whole steps for the hatching, exp()
 * and ln() are two 1,025-entry tables read with linear interpolation (so pow(x, n) = exp(n ln x) for
 * x in [0, 1]; no Math.exp, Math.pow, Math.sin or Math.sqrt anywhere in plan or draw), roots are isqrt,
 * atan2 is a binary search over the SIN table, lattice value noise is version 10's. Decimal constants
 * are written as q(0.17) = Math.round(0.17 x 65536): a power-of-two scaling of a literal, exact and the
 * same on every machine. The plan is a few dozen integers (the person); the drawing derives the field,
 * the strokes (positions in 1/32 of a pixel) and the stamps from them, then rasterises at S times the
 * size for print, every length times S.
 *
 * The code: a hidden grid of 16 x 16 tiles of 71 x 71 px; tile k (row-major) carries bit k, most
 * significant bit of byte 0 first, in its reading pixel (71c + 35, 71r + 35), never tinted, never
 * grained: the palette index covering most of its 2 x 2 samples (paper on a tie, so a centre reads ink
 * only when 3 or 4 samples are under a stroke), drawn in that colour's twin (one level away on each
 * channel) when the bit is 1. Before the downsample the four samples under each centre are rewritten
 * to that majority index (the centre snap), so the painted mean equals the reading colour and the
 * reading pixel is never a visible dot. decodeV11 reads the 256 pixels back.
 */
import { sha256 } from "@noble/hashes/sha256";
import { FRAME_V6 as FRAME, SIN_V6 as SIN, idiv } from "./commitment-art-v6.ts";

type RGB = readonly [number, number, number];
const LABEL = "bitgraph-art/11";
export const V11_WIDTH = 1200, V11_HEIGHT = 1200;
const OFF = 32, AW = 1136, AH = 1136, TW = 71, TH = 71, RX = 35, RY = 35;
/** Raster units a pixel (strokes, stamps, the plate mark), and the field at half resolution. */
const U = 32, AWU = AW * U, AHU = AH * U, FS = 2, FW = AW / FS, FH = AH / FS;
const Q = 65536;
const q = (x: number): number => Math.round(x * Q);
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** [paper, ink] and the grain (amplitude and mottle in 1/256 level, mottle cell in eighths of a px). Never reorder or edit. */
const PALS: ReadonlyArray<{ name: string; paper: string; ink: string; inv: number; amp: number; mot: number; cell: number }> = [
  { name: "ink on cream", paper: "#f2ebdc", ink: "#1b1813", inv: 0, amp: 614, mot: 666, cell: 2400 },
  { name: "sepia on buff", paper: "#e8d8b6", ink: "#4b2f1a", inv: 0, amp: 666, mot: 768, cell: 2240 },
  { name: "sanguine", paper: "#e3d2b8", ink: "#9c3f28", inv: 0, amp: 666, mot: 768, cell: 2560 },
  { name: "nightline", paper: "#1a191b", ink: "#e7dfcd", inv: 1, amp: 410, mot: 410, cell: 2400 },
];
export const PALETTES_V11: readonly (readonly RGB[])[] = PALS.map((p) => [hex(p.paper), hex(p.ink)]);
export const PALETTE_NAMES_V11: readonly string[] = PALS.map((p) => p.name);
const twin = (c: RGB): RGB => [c[0] < 128 ? c[0] + 1 : c[0] - 1, c[1] < 128 ? c[1] + 1 : c[1] - 1, c[2] < 128 ? c[2] + 1 : c[2] - 1];
export const TWINS_V11: readonly (readonly RGB[])[] = PALETTES_V11.map((p) => p.map(twin));
/** The hair silhouettes, by plan.hair. */
export const HAIR_NAMES_V11: readonly string[] = ["cropped", "short", "side part", "textured short", "bob", "long", "curly", "two braids", "bun", "bald", "long loose", "long over one shoulder", "one braid", "high bun", "low bun", "pulled back", "curls out", "pixie", "hair wrap"];
export const EXPRESSION_NAMES_V11: readonly string[] = ["neutral", "slight smile", "serious"];
export const AGE_BAND_NAMES_V11: readonly string[] = ["child", "teen", "twenties to thirties", "forties to fifties", "elderly"];
export const GARMENT_NAMES_V11: readonly string[] = ["crew neck", "V neck", "shirt collar", "turtleneck", "lapels", "scoop neck", "boat neck", "blouse collar", "wrap", "shawl", "high collar"];
export const ageBandV11 = (age: number): number => (age < 13 ? 0 : age < 20 ? 1 : age < 36 ? 2 : age < 56 ? 3 : 4);
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
const TAUQ = q(6.283185307179586);
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

/* ── The stream ─────────────────────────────────────────────────────────────────────────────────── */

class Stream {
  private buf: Uint8Array = new Uint8Array(0);
  private at = 0;
  private k = 0;
  private readonly prefix: Uint8Array;
  constructor(commitment: Uint8Array) {
    const te = new TextEncoder();
    const label = te.encode(LABEL), purpose = te.encode("draw");
    this.prefix = new Uint8Array(label.length + 1 + purpose.length + 1 + 32);
    this.prefix.set(label, 0);
    this.prefix.set(purpose, label.length + 1);
    this.prefix.set(commitment, label.length + 1 + purpose.length + 1);
  }
  u32(): number {
    if (this.at + 4 > this.buf.length) {
      const input = new Uint8Array(this.prefix.length + 4);
      input.set(this.prefix, 0);
      const k = this.k++;
      input.set([(k >>> 24) & 0xff, (k >>> 16) & 0xff, (k >>> 8) & 0xff, k & 0xff], this.prefix.length);
      this.buf = sha256(input);
      this.at = 0;
    }
    const b = this.buf, i = this.at;
    this.at += 4;
    return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  }
  pick(n: number): number { return Math.floor((this.u32() * n) / 4294967296); }
  /** A Q16 number in [a, b) from one draw. */
  range(a: number, b: number): number { const lo = q(a), hi = q(b); return lo + Math.floor((this.u32() * (hi - lo)) / 4294967296); }
  sign(): number { return this.pick(2) ? 1 : -1; }
  /** An index by weights (integers, any scale). */
  weighted(w: readonly number[]): number { let tot = 0; for (const x of w) tot += x; let r = this.pick(tot); for (let k = 0; k < w.length; k++) { r -= w[k]!; if (r < 0) return k; } return w.length - 1; }
}

/* ── Regions and names ───────────────────────────────────────────────────────────────────────────── */

const BG = 0, SKIN = 1, HAIR = 2, WHITE = 3, IRIS = 4, PUPIL = 5, HILITE = 6, BROW = 7, LIPU = 8, LIPL = 9, NOSTRIL = 10, EAR = 11, GARM = 12, GARM2 = 13, SHIRT = 14, BEARD = 15, MOUTH = 16, WRAP = 17;
const H_CROPPED = 0, H_SHORT = 1, H_PARTED = 2, H_TEXTURED = 3, H_BOB = 4, H_LONG = 5, H_CURLY = 6, H_BRAIDS = 7, H_TIED = 8, H_BALD = 9, H_LONG_LOOSE = 10, H_LONG_SWEPT = 11, H_BRAID_ONE = 12, H_BUN_HIGH = 13, H_BUN_LOW = 14, H_PULLED_BACK = 15, H_CURLS_OUT = 16, H_PIXIE = 17, H_WRAP = 18;
const G_CREW = 0, G_VEE = 1, G_COLLAR = 2, G_TURTLE = 3, G_LAPEL = 4, G_SCOOP = 5, G_BOAT = 6, G_BLOUSE = 7, G_WRAP = 8, G_SHAWL = 9, G_HIGH = 10;
const B_NONE = 0, B_FULL = 1, B_GOATEE = 2, B_MOUSTACHE = 3, B_STUBBLE = 4;
const isFall = (h: number): boolean => h === H_LONG || h === H_BOB || h === H_BRAIDS || h === H_CURLY || h === H_LONG_LOOSE || h === H_LONG_SWEPT || h === H_CURLS_OUT;
const isCap = (h: number): boolean => h === H_TIED || h === H_BRAIDS || h === H_PULLED_BACK || h === H_BRAID_ONE || h === H_BUN_HIGH || h === H_BUN_LOW;
const hasBun = (h: number): boolean => h === H_TIED || h === H_BRAIDS || h === H_PULLED_BACK || h === H_BUN_HIGH || h === H_BUN_LOW;
const hasParting = (h: number): boolean => h === H_PARTED || h === H_PULLED_BACK;

/* ── The plan: the person, every number an integer (Q16 head units, 1/16-step angles, ids) ──────── */

export interface V11Plan {
  palette: number; salt: number;
  /** Years, and the growth and ageing blends (Q16). */
  age: number; ageT: number; oldT: number;
  /** The pose, 1/16 steps (16384 a turn). */
  yaw: number; roll: number; pitch: number;
  craniumH: number; e: number; noseLen: number; noseBase: number; mouth: number; chin: number;
  templeW: number; cheekW: number; cheekV: number; jawSquare: number; jawW: number; jawV: number; jowl: number; chinW: number;
  nFace: number; slopeF: number; capDepth: number; chinDepth: number; backDepth: number; napeA: number; chinProj: number; chinBump: number;
  browRidge: number; socket: number; cheekU: number; cheekBone: number; hollow: number;
  eyeU: number; ew: number; uh: number; lh: number; cant: number; tp: number; irisFrac: number; gazeJx: number; gazeJy: number; pupilFrac: number; irisDark: number;
  /** The upper lid's line weight, Q16 of the base. */
  lidW: number;
  /** 0 neutral, 1 slight smile, 2 serious. */
  expr: number; browLift: number; browV: number; browT: number; browArch: number; browOut: number; browIn: number; crease: number;
  bridgeH: number; tipH: number; tipW: number; nostrilU: number; hump: number;
  lipW: number; lipU: number; lipL: number; smile: number;
  earLen: number; earD: number; earFlare: number; earV0: number; neckR: number; neckLen: number; shW: number; shDrop: number; trap: number;
  /** HAIR_NAMES_V11 index and its parameters. */
  hair: number; hairV: number; recede: number; peak: number; fringe: number; longV: number; ht: number; sideFactor: number; sweep: number; partTh: number; quiff: number; crownV: number; hairDark: number; bunV: number; bunR: number;
  /** Which shoulder a swept fall or a single braid comes over (1 right of the picture), and 1 when the braid goes down the back. */
  sweptSide: number; braidBack: number; sideburn: number; wrapTone: number;
  /** 0 none, 1 full, 2 goatee, 3 moustache, 4 stubble. */
  beard: number; beardT: number; beardDark: number; beardLen: number;
  glasses: number;
  /** 0 viewer, 1 aside, 2 down. */
  gaze: number; gazeSide: number;
  lightSide: number; az: number; el: number; ambient: number;
  /** 0 none, 1 shadow-side wash, 2 full wash. */
  bg: number; bgTone: number; bgAngle: number;
  /** GARMENT_NAMES_V11 index. */
  garment: number; wrapSide: number; gTone: number; gTone2: number;
  /** Rare details: earring 0 none, 1 stud, 2 drop; necklace, ribbon, lipDark 0 or 1. */
  earring: number; necklace: number; ribbon: number; lipDark: number;
  /** The hatch diagonal, 1/16 steps. */
  hatchAngle: number;
}

const degA = (degQ: number): number => idiv(degQ * A16, 360 * Q);

export function planV11(commitment: Uint8Array): V11Plan {
  const s = new Stream(commitment);
  const salt = s.u32() >>> 8;
  const band = s.pick(100);
  const age = band < 12 ? 6 + s.pick(7) : band < 22 ? 13 + s.pick(7) : band < 50 ? 20 + s.pick(16) : band < 78 ? 36 + s.pick(20) : 56 + s.pick(30);
  const ageT = clampQ(idiv((age - 6) * Q, 24)), oldT = clampQ(idiv((age - 35) * Q, 50)), adult = age > 18, child = age < 13;
  const yb = s.pick(100), ya = yb < 22 ? s.range(0, 10) : yb < 72 ? s.range(12, 45) : s.range(45, 72);
  const yaw = degA(ya) * s.sign(), roll = degA(s.range(-8, 8)), pitch = degA(s.range(-5, 5));
  // the skull: ranges centred on the human middle, the ends equally likely
  let craniumH = s.range(1.0, 1.4) + mq(q(0.08), Q - ageT);
  const e = q(0.17) - mq(q(0.12), ageT) + s.range(-0.06, 0.06);
  const noseLen = q(0.28) + mq(q(0.16), ageT) + mq(q(0.08), oldT) + s.range(-0.08, 0.1);
  const noseBase = e + noseLen;
  const mouth = noseBase + q(0.14) + mq(q(0.05), ageT) + s.range(0, 0.09);
  const chin = mouth + q(0.26) + mq(q(0.12), ageT) + s.range(-0.05, 0.14);
  const templeW = s.range(0.86, 1.02), cheekW = s.range(0.84, 1.12) - mq(q(0.03), Q - ageT), cheekV = s.range(0.14, 0.3);
  const jawSquare = mq(s.range(0, 1), q(0.5) + mq(q(0.5), ageT));
  const jawW = mq(mq(mq(cheekW, lerpQ(q(0.52), q(0.98), jawSquare)), q(0.88) + mq(q(0.12), ageT)), s.range(0.94, 1.06));
  // the jaw angle sits from half a head-width below the eyes to below the mouth: never up at the cheek knot,
  // where a narrow jaw made a ledge across the face (the child of seed 13 in the review)
  const jawTop = Math.min(e + q(0.5), mouth + q(0.05));
  const jawV = lerpQ(jawTop, mouth + q(0.1), jawSquare);
  const jowl = mq(s.range(0, 1), oldT);
  const chinW = mq(jawW, s.range(0.45, 0.85)) + mq(q(0.06), jowl);
  const nFace = s.range(1.9, 3.0);
  const slopeF = s.range(0, 0.5), capDepth = s.range(0.95, 1.08), chinDepth = s.range(0.7, 0.85), backDepth = s.range(1.1, 1.3), napeA = s.range(0.95, 1.15);
  const chinProj = s.range(-0.12, 0.12), chinBump = s.range(0.02, 0.1);
  const browRidge = mq(s.range(0, 0.1), ageT) + mq(q(0.02), oldT), socket = s.range(0.05, 0.14) + mq(q(0.03), oldT);
  const cheekU = s.range(0.5, 0.78), cheekBoneR = s.range(0, 0.1), cheekBone = ageT < q(0.6) ? 0 : mq(cheekBoneR, ageT);
  const hollow = mq(mq(s.range(0, 0.09), q(0.3) + mq(q(0.7), oldT)), ageT);
  // eyes
  const eyeU = s.range(0.3, 0.5), ew = s.range(0.16, 0.24) + mq(q(0.02), Q - ageT) - mq(q(0.02), oldT), uh = s.range(0.055, 0.1) - mq(q(0.02), oldT), lh = s.range(0.035, 0.06);
  const cant = degA(s.range(-7, 8)), tp = s.range(0.42, 0.6);
  const irisFrac = s.range(0.54, 0.62) + mq(q(0.04), Q - ageT), gazeJx = degA(s.range(-3, 3)), gazeJy = degA(s.range(-2, 5)), pupilFrac = s.range(0.26, 0.34), irisDark = s.range(0.55, 1);
  const lidW = s.range(0.7, 1.45);
  // expression
  const ex = s.pick(100), expr = ex < 45 ? 0 : ex < 70 ? 1 : 2;
  const browLift = expr === 2 ? s.range(-0.035, -0.01) : expr === 1 ? s.range(0, 0.03) : s.range(-0.015, 0.02);
  const browV = e - s.range(0.12, 0.21) + browLift, browT = s.range(0.025, 0.08), browArch = s.range(0, 0.08), browOut = s.range(0.06, 0.12), browIn = s.range(-0.02, 0.05);
  const crease = s.pick(100) < 70 ? 1 : 0;
  // nose
  const bridgeH = s.range(0, 0.14), tipH = s.range(0.1, 0.34) + mq(q(0.03), oldT), tipW = s.range(0.08, 0.2), nostrilU = s.range(0.1, 0.22), hump = s.range(-0.02, 0.07);
  // mouth
  const lipW = mq(s.range(0.18, 0.36), q(0.85) + mq(q(0.15), ageT)), lipU = mq(s.range(0.02, 0.1), Q - mq(q(0.3), oldT)), lipL = mq(s.range(0.03, 0.14), Q - mq(q(0.3), oldT));
  const smile = expr === 1 ? s.range(0.3, 0.6) : expr === 2 ? s.range(-0.4, -0.1) : s.range(-0.05, 0.15);
  // ears, neck, shoulders
  const earLen = s.range(0.36, 0.5) + mq(q(0.08), oldT), earD = s.range(0.1, 0.14), earFlare = s.range(0.1, 0.6), earV0 = e - q(0.08) + s.range(-0.03, 0.03);
  const neckR = ageT < Q ? s.range(0.38, 0.54) : s.range(0.42, 0.8), neckLen = s.range(0.18, 0.55);
  const shW = mq(s.range(1.6, 2.8), q(0.75) + mq(q(0.25), ageT)), shDrop = s.range(0.5, 0.9), trap = s.range(0.05, 0.2);
  // hair: nineteen silhouettes by weight (the table in HAIR_NAMES_V11 order); bald only on adults, with age
  const hairW = [6, 9, 7, 6, 8, 5, 4, 3, 5, adult ? 2 + idiv(6 * oldT, Q) : 0, 8, 6, 4, 4, 4, 5, 4, 6, 4];
  let hair = s.weighted(hairW);
  const frontalBob = s.pick(3); // drawn whatever the style, so the stream stays aligned
  if (hair === H_BOB && absI(yaw) < degA(q(15))) hair = frontalBob === 0 ? H_PARTED : frontalBob === 1 ? H_TIED : H_PULLED_BACK; // a frontal bob is a helmet
  const hairV = e - s.range(0.48, 0.7);
  const recedeR = s.range(-0.3, 1.0), recedeOn = s.pick(100) < 45;
  const recede = adult && recedeOn && !isCap(hair) && hair !== H_WRAP ? mq(recedeR < 0 ? 0 : recedeR, q(0.3) + mq(q(0.7), oldT)) : 0;
  const peakR = s.range(0.3, 1), peak = s.pick(100) < 30 ? peakR : 0;
  const fringeOk = hair === H_SHORT || hair === H_BOB || hair === H_LONG || hair === H_CURLY || hair === H_PIXIE || hair === H_LONG_LOOSE || hair === H_CURLS_OUT || hair === H_BRAID_ONE;
  const fringeP = hair === H_PIXIE ? q(0.6) : hair === H_BOB ? q(0.4) : hair === H_LONG || hair === H_LONG_LOOSE ? q(0.14) : hair === H_BRAID_ONE ? q(0.15) : q(0.25);
  const fringe = fringeOk && s.pick(Q) < mq(fringeP, Q - mq(q(0.7), oldT)) ? 1 : 0;
  const longV = hair === H_BOB ? chin + s.range(-0.2, 0.1) : hair === H_CURLS_OUT ? chin + s.range(0, 0.5) : chin + s.range(0.1, 1.1);
  const htR = [s.range(0.03, 0.045), s.range(0.07, 0.2), s.range(0.09, 0.2), s.range(0.08, 0.15), s.range(0.07, 0.15), s.range(0.14, 0.26), s.range(0.035, 0.055), s.range(0.26, 0.42), s.range(0.05, 0.1), s.range(0.1, 0.15)];
  const ht = hair === H_CROPPED ? htR[0]! : hair === H_SHORT || hair === H_PARTED ? htR[1]! : hair === H_TEXTURED ? htR[2]! : hair === H_BOB ? htR[3]! : hair === H_LONG || hair === H_LONG_LOOSE || hair === H_LONG_SWEPT ? htR[4]! : hair === H_CURLY ? htR[5]! : hair === H_BRAIDS ? q(0.06) : isCap(hair) ? htR[6]! : hair === H_CURLS_OUT ? htR[7]! : hair === H_PIXIE ? htR[8]! : hair === H_WRAP ? htR[9]! : q(0.03);
  const sideFactor = hair === H_PIXIE ? s.range(0.35, 0.7) : s.range(0.25, 1), sweep = s.range(-0.6, 0.6), partTh = a16Of(s.range(-0.7, 0.7));
  const quiffR = s.range(0.4, 1.0), quiff = s.pick(100) < 35 && !fringe && !isCap(hair) && hair !== H_WRAP ? quiffR : 0;
  craniumH += s.range(-0.08, 0.08);
  const crownV = q(-0.35) + s.range(-0.1, 0.15);
  let hairDark = s.range(0.3, 1);
  const greyR = s.range(0.25, 0.45); if (oldT > q(0.5) && s.pick(Q) < oldT) hairDark = greyR;
  const bunV = hair === H_BUN_HIGH ? -craniumH + q(0.15) + s.range(-0.1, 0.1) : hair === H_BUN_LOW ? e + q(0.5) + s.range(0, 0.1) : s.range(-0.8, 0.2);
  const bunR = hair === H_PULLED_BACK || hair === H_BUN_LOW ? s.range(0.18, 0.3) : s.range(0.25, 0.4);
  const sweptSide = s.sign(), braidBack = s.pick(100) < 35 ? 1 : 0;
  const sideburn = adult ? s.range(0.02, 0.12) : q(0.05), wrapTone = s.range(0.2, 0.6);
  // facial hair on at most a fifth of adults, never on children; glasses; gaze
  const fb = s.pick(100);
  const beard = adult && fb < 20 ? (fb < 7 ? B_FULL : fb < 11 ? B_GOATEE : fb < 15 ? B_MOUSTACHE : B_STUBBLE) : B_NONE;
  const beardTR = s.range(0.02, 0.07), beardDarkA = s.range(0.25, 0.45), beardDarkB = s.range(0.4, 0.75), beardLenA = s.range(0.08, 0.3), beardLenB = s.range(0.05, 0.15);
  const beardT = beard === B_STUBBLE || beard === B_NONE ? 0 : beardTR, beardDark = beard === B_STUBBLE ? beardDarkA : beardDarkB, beardLen = beard === B_FULL ? beardLenA : beard === B_GOATEE ? beardLenB : 0;
  const glasses = s.pick(100) < 8 ? 1 : 0;
  const gz = s.pick(100), gaze = gz < 50 ? 0 : gz < 80 ? 1 : 2, gazeSide = s.sign();
  // light, background, garment, palette
  let lightSide = s.sign();
  if (absI(yaw) > degA(q(55))) lightSide = -sgn(yaw);
  const az = degA(s.range(25, 80)), el = degA(s.range(15, 55)), ambient = s.range(0.18, 0.32);
  const bgm = s.pick(100), bg = bgm < 45 ? 0 : bgm < 80 ? 1 : 2, bgTone = s.range(0.14, 0.3), bgAngle = degA(s.range(30, 60)) * s.sign();
  const garment = s.weighted([12, 10, 9, 8, 9, 10, 9, 9, 8, 8, 8]), wrapSide = s.sign();
  const gTone = s.range(0.12, 0.75), gTone2 = s.range(0.1, 0.5);
  const pr = s.pick(100), palette = pr < 40 ? 0 : pr < 65 ? 1 : pr < 85 ? 2 : 3;
  const hatchAngle = degA(s.range(30, 60)) * s.sign();
  // rare details, one or two a draw, never on children
  const er = s.pick(100), nr = s.pick(100), rr = s.pick(100), lr = s.pick(100);
  let earring = !child && er < 28 ? (er < 16 ? 1 : 2) : 0;
  let necklace = !child && nr < 22 ? 1 : 0;
  const ribbon = !child && hasBun(hair) && rr < 40 ? 1 : 0;
  const lipDark = !child && lr < 25 ? 1 : 0;
  if (earring && necklace && (ribbon || lipDark)) necklace = 0;
  if (ribbon && lipDark && earring) earring = 0;
  return {
    palette, salt, age, ageT, oldT, yaw, roll, pitch, craniumH, e, noseLen, noseBase, mouth, chin, templeW, cheekW, cheekV, jawSquare, jawW, jawV, jowl, chinW,
    nFace, slopeF, capDepth, chinDepth, backDepth, napeA, chinProj, chinBump, browRidge, socket, cheekU, cheekBone, hollow,
    eyeU, ew, uh, lh, cant, tp, irisFrac, gazeJx, gazeJy, pupilFrac, irisDark, lidW, expr, browLift, browV, browT, browArch, browOut, browIn, crease,
    bridgeH, tipH, tipW, nostrilU, hump, lipW, lipU, lipL, smile, earLen, earD, earFlare, earV0, neckR, neckLen, shW, shDrop, trap,
    hair, hairV, recede, peak, fringe, longV, ht, sideFactor, sweep, partTh, quiff, crownV, hairDark, bunV, bunR, sweptSide, braidBack, sideburn, wrapTone,
    beard, beardT, beardDark, beardLen, glasses, gaze, gazeSide, lightSide, az, el, ambient, bg, bgTone, bgAngle, garment, wrapSide, gTone, gTone2,
    earring, necklace, ribbon, lipDark, hatchAngle,
  };
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
const A105 = a16Of(q(1.05)), A075 = a16Of(q(0.75)), A1 = a16Of(Q), A22 = degA(q(22)), A8 = degA(q(8));

// features() reports through these, so the splat loops allocate nothing
let fDz = 0, fReg = 0, fDir = 0, fDu = 0, fDv = 0, fEx = 0;

function lightDir(P: V11Plan): V3 {
  const sa = sinF(P.az), ca = cosF(P.az), se = sinF(P.el), ce = cosF(P.el);
  return [-P.lightSide * m14(sa, ce), -se * 4, m14(ca, ce)];
}

function makeModel(P: V11Plan) {
  const vCap = q(-0.3), capA = P.craniumH + vCap;
  const xs = [vCap, P.e - q(0.08), P.e + q(0.22), P.jawV, P.chin - q(0.1), P.chin - q(0.03), P.chin + q(0.02), P.chin + q(0.05)];
  for (let i = 1; i < xs.length; i++) if (xs[i]! <= xs[i - 1]!) xs[i] = xs[i - 1]! + 1; // the knots stay in order whatever the draw
  const wSpl = monoSpline(xs, [Q, P.templeW, P.cheekW, P.jawW, P.chinW, mq(P.chinW, q(0.75)), mq(P.chinW, q(0.3)), 0]);
  const bL = P.beardLen, bW = P.beard === B_GOATEE ? q(0.3) : mq(P.chinW, q(0.95)) + q(0.1);
  const beardW = (v: number): number => {
    if (bL <= 0 || v <= P.chin - q(0.12) || v >= P.chin + bL) return 0;
    const t = dq(v - (P.chin - q(0.12)), bL + q(0.12));
    return mq(bW, sqrtQ(Q - mq(t, t)));
  };
  /** sqrt(max(0, 1 - ((v - vCap) / a)^2)). */
  const capF = (v: number, a: number): number => { const t = dq(v - vCap, a); return sqrtQ(Q - mq(t, t)); };
  const width = (v: number): number => { const w0 = v < vCap ? capF(v, capA) : wSpl(v), w = w0 < 0 ? 0 : w0, b = beardW(v); return w > b ? w : b; };
  const dFront = (v: number): number => {
    let d = v < vCap ? mq(P.capDepth, capF(v, capA)) : lerpQ(P.capDepth, P.chinDepth, smQ(dq(v - vCap, P.chin - vCap)));
    d = mq(d, Q - mq(mq(q(0.6), P.slopeF), clampQ(dq(P.browV - v, P.craniumH + P.browV))));
    d += mq(P.chinProj, smQ(dq(v - P.mouth, P.chin - P.mouth)));
    return d < 0 ? 0 : d;
  };
  const dBack = (v: number): number => mq(P.backDepth, capF(v, v < vCap ? capA : P.napeA));
  const nAt = (v: number): number => (v < vCap ? 2 * Q : 2 * Q + mq(P.nFace - 2 * Q, smQ(dq(v - vCap, q(0.4)))));
  /** The jaw line: the side of a slice moves forward from the jaw angle to the chin. */
  const zSide = (v: number): number => mq(q(0.55), smQ(dq(v - P.jawV, P.chin + q(0.02) - P.jawV)));
  const rowOf = (v: number): Row => { const n = nAt(v); return { v, w: width(v), dF: dFront(v), dB: dBack(v), n, invN: dq(Q, n), zs: zSide(v) }; };
  /** Front base depth at u on a slice, by inverting the superellipse. */
  const sliceZ = (u: number, row: Row): number => {
    if (row.w <= 0) return 0;
    const S = clampQ(dq(absI(u), row.w));
    return mq(row.dF, powQ(Q - powQ(S, row.n), row.invN));
  };
  // eyes: the opening scaled to the face's width at the eye line, the spacing kept inside the temple
  const rowE = rowOf(P.e), wE = rowE.w;
  const ew = mq(P.ew, Math.min(Q, dq(wE, q(0.97)))), eyeU = Math.min(P.eyeU, wE - ew - q(0.12));
  const eyeR = q(0.2), eyeR2 = mq(eyeR, eyeR), eyeC = cosF(P.cant) * 4, eyeS = sinF(P.cant) * 4;
  const kp = dq(lnQ(q(0.5)), lnQ(P.tp));
  const upF = (t: number): number => { const tk = powQ(t, kp); return powQ(clampQ(4 * mq(tk, Q - tk)), q(0.75)); };
  const loF = (t: number): number => powQ(clampQ(4 * mq(t, Q - t)), q(1.2));
  const uh = mq(mq(P.uh, P.gaze === 2 ? q(0.7) : Q), P.expr === 2 ? q(0.92) : Q);
  const sinIris = clampI(dq(mq(P.irisFrac, uh + P.lh), 2 * eyeR), q(0.05), q(0.9));
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
    let dz = mq(P.browRidge, g2(u, v - P.browV, q(0.8), q(0.08)));
    dz -= mq(P.socket, g2(au - eyeU, v - P.e, q(0.27), q(0.17)));
    dz += mq(P.cheekBone, g2(au - P.cheekU, v - (P.e + P.cheekV), q(0.22), q(0.14)));
    dz -= mq(P.hollow, g2(au - q(0.6), v - (P.e + q(0.5)), q(0.2), q(0.15)));
    dz += mq(P.chinBump, g2(u, v - (P.chin - q(0.15)), q(0.3), q(0.15)));
    return dz;
  };
  const zcEye = sliceZ(eyeU, rowE) + baseBumps(eyeU, P.e) - q(0.135);
  // the reserved highlight: the gaze pulled a little toward the half vector of view and light
  const Lw = lightDir(P);
  const Vl: V3 = [-sinF(P.yaw) * 4, 0, cosF(P.yaw) * 4], Ll = rotY3(Lw, -P.yaw);
  let Hv = norm3([Vl[0] + Ll[0], Vl[1] + Ll[1], Vl[2] + Ll[2]]);
  Hv = norm3([mq(G[0], q(0.8)) + mq(Hv[0], q(0.2)), mq(G[1], q(0.8)) + mq(Hv[1], q(0.2)) - q(0.06), mq(G[2], q(0.8)) + mq(Hv[2], q(0.2))]);
  const smileEff = mq(P.smile, Math.min(Q, dq(q(0.27), P.lipW))); // wide mouths get less corner lift: never a grin
  const vm = (u: number): number => { const r = dq(u, P.lipW); return P.mouth + mq(smileEff, mq(q(-0.04), mq(r, r))); };
  const bridgeV = P.e - q(0.03), tipV = P.noseBase - q(0.07);
  /** Features at a front point (u, v) with superellipse factor C: fDz, fReg, fDir/fDu/fDv (a head-local tangent), fEx. */
  function features(u: number, v: number, C: number, row: Row): void {
    const au = absI(u), side = u < 0 ? -1 : 1;
    let dz = baseBumps(u, v), region = SKIN, extra = 0, extraRim = 0;
    fDir = 0;
    const fade = clampQ(mq(C, q(1.6)));
    // nose: a ridge from the bridge to the tip with an optional hump, nostril wings, nostril openings
    {
      let A: number, su: number;
      if (v < bridgeV) { A = mq(P.bridgeH, gexp(dq(v - bridgeV, q(0.12)))); su = q(0.08); }
      else if (v <= tipV) { const t = dq(v - bridgeV, tipV - bridgeV); A = lerpQ(P.bridgeH, P.tipH, powQ(t, q(1.3))) + mq(P.hump, sinPi(t) * 4); su = lerpQ(q(0.08), P.tipW, t); }
      else { A = mq(P.tipH, gexp(dq(v - tipV, q(0.06)))); su = P.tipW; }
      dz += mq(A, gexp(dq(u, su)));
      dz += mq(mq(P.tipH, q(0.55)), g2(au - P.nostrilU, v - (P.noseBase - q(0.05)), q(0.07), q(0.055)));
      if (g2(au - mq(P.nostrilU, q(0.62)), v - (P.noseBase - q(0.005)), q(0.034), q(0.014)) > q(0.45)) region = NOSTRIL;
    }
    // lips: an upper roll with a cupid's bow, a lower roll, the mouth line between them
    {
      const m = vm(u), ru = dq(u, P.lipW);
      if (absI(ru) < Q) {
        const ru2 = mq(ru, ru), r95 = dq(ru, q(0.95));
        const fU = mq(powQ(Q - ru2, q(0.7)), Q - mq(q(0.2), gexp(dq(u, q(0.045)))));
        const fL = powQ(clampQ(Q - mq(r95, r95)), q(0.8));
        const topU = m - mq(P.lipU, fU), botL = m + mq(P.lipL, fL);
        if (v >= topU && v < m - q(0.006)) region = LIPU;
        else if (v >= m - q(0.006) && v <= m + q(0.006)) region = MOUTH;
        else if (v > m + q(0.006) && v <= botL) region = LIPL;
        const eR = expQ(-mq(ru2, q(0.8)));
        dz += mq(mq(mq(P.lipU, q(0.6)), gexp(dq(v - (m - mq(P.lipU, q(0.5))), mq(P.lipU, q(0.55))))), eR);
        dz += mq(mq(mq(P.lipL, q(0.8)), gexp(dq(v - (m + mq(P.lipL, q(0.5))), mq(P.lipL, q(0.55))))), eR);
        if (region === LIPU || region === LIPL) { fDir = 1; fDu = Q; fDv = q(0.12) * side; }
        dz -= mq(q(0.015), g2(au - P.lipW, v - m, q(0.05), q(0.04)));
      }
      dz -= mq(mq(mq(q(0.012), gexp(dq(u, q(0.05)))), smQ(dq(v - P.noseBase, q(0.04)))), smQ(dq(m - v, q(0.04))));
      if (region === SKIN && au < P.lipW + q(0.09) && v > P.noseBase + q(0.02) && v < m + P.lipL + q(0.09)) extra = -Q; // the mouth zone: never hatched
    }
    // brow: a band along an arch
    {
      const t = dq(au - (eyeU - ew - P.browIn), 2 * ew + P.browIn + P.browOut);
      if (t > 0 && t < Q) {
        const arch = mq(P.browArch, sinPi(powQ(t, q(0.8))) * 4);
        const bv = P.browV - arch + mq(q(0.04), t - q(0.5)) * (P.cant > 0 ? -1 : 1);
        const th = mq(P.browT, q(0.6) + mq(q(0.6), Q - t));
        if (absI(v - bv) < th >> 1) { region = BROW; fDir = 1; fDu = side * Q; fDv = q(-0.55); }
      }
    }
    // facial hair as a region on the lower face with a small bump; a full beard extends the chin
    if (P.beard !== B_NONE && region === SKIN) {
      const m = vm(u);
      let inB = false;
      if (P.beard === B_FULL || P.beard === B_STUBBLE) inB = v > m + mq(P.lipL, q(1.2)) + q(0.03) || (v > P.mouth - q(0.02) && au > P.lipW + q(0.14)) || (au > q(0.82) && v > P.e + q(0.42));
      else if (P.beard === B_GOATEE) inB = v > m + mq(P.lipL, q(1.2)) + q(0.03) && au < q(0.3);
      if (bL > 0 && v > P.chin - q(0.12)) inB = true;
      if (P.beard !== B_GOATEE) inB = inB || (v > P.noseBase + q(0.045) && v < m - q(0.012) && au < P.lipW + q(0.1) && au > q(0.03));
      if (inB) { region = BEARD; dz += mq(P.beardT, fade); fDir = 1; fDu = side * q(0.3); fDv = Q; }
    }
    // eyes: inside the opening the surface is the eyeball; outside it the lid skin wraps the ball
    {
      const du = au - eyeU, dv = v - P.e;
      const d2 = mq(du, du) + mq(dv, dv);
      if (d2 < eyeR2) {
        const dur = mq(du, eyeC) + mq(dv, eyeS), dvr = mq(dv, eyeC) - mq(du, eyeS);
        const h = sqrtQ(eyeR2 - d2), zEye = zcEye + h;
        const t = (dq(dur, ew) + Q) >> 1;
        const tc = clampQ(t), vUp = -mq(uh, upF(tc)), vLo = mq(P.lh, loF(tc));
        if (t > 0 && t < Q && dvr > vUp && dvr < vLo) {
          dz = zEye - sliceZ(u, row);
          const nx = dq(du * side, eyeR), ny = dq(dv, eyeR), nz = dq(h, eyeR);
          const dG = mq(nx, G[0]) + mq(ny, G[1]) + mq(nz, G[2]), dH = mq(nx, Hv[0]) + mq(ny, Hv[1]) + mq(nz, Hv[2]);
          region = dG > cosPupil ? PUPIL : dG > cosIris ? IRIS : WHITE;
          if (dH > cosHi && region !== WHITE) region = HILITE;
          extra = mq(q(0.6), gexp(dq(dvr - vUp, q(0.045)))); // the lid's shadow on the ball
          extraRim = region === IRIS ? clampQ(sqrtQ(dq(Q - dG, Q - cosIris))) : 0;
          fDir = 1;
          if (region === IRIS) { fDu = -dv; fDv = du * side; } else { fDu = Q; fDv = 0; } // iris: concentric rings read as tone
        } else {
          const lid = zEye + q(0.014) - (sliceZ(u, row) + dz);
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
      const wb = mq(row.w, powQ(clampQ(dq(row.dB, P.backDepth)), q(0.35)));
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
    let vH = P.hairV + mq(q(0.04), mq(amR, amR)) + mq(q(0.11), cos13(am)) - mq(mq(P.recede, q(0.3)), gexp(dq(radQ(a) - q(0.62), q(0.22)))) + mq(mq(P.peak, q(0.05)), gexp(dq(radQ(th), q(0.12))));
    if (P.fringe) vH = P.browV - q(0.07) + mq(q(0.02), nq(mq(radQ(th), 12 * Q) + 50 * Q, 0, Q, P.salt + 9)) + mq(q(0.05), cos13(am));
    return vH;
  };
  /** The wrap's front edge sits just above the brows, the hairline hidden. */
  const wrapLine = (th: number): number => { const a = absI(th), am = a < A105 ? a : A105; return P.browV - q(0.1) + mq(q(0.02), nq(mq(radQ(th), 10 * Q), 0, Q, P.salt + 9)) + mq(q(0.03), cos13(am)); };
  const sideburn = P.sideburn + (P.beard !== B_NONE ? q(0.2) : 0);
  const napeV = P.e + q(0.62);
  const sideKnotsX = [A105, 3390, 3703, 4563, 5085, 6258, 8218];
  const sideKnotsY = P.hair === H_WRAP
    ? [wrapLine(A105), P.e + q(0.35), P.e + q(0.4), P.e + q(0.45), P.e + q(0.55), napeV + q(0.05), napeV + q(0.05)]
    : [hairLine(A105), P.e + sideburn, P.e - q(0.12), P.e - q(0.1), P.e + q(0.28), napeV, napeV];
  /** Where the fall of a long style begins, in 1/16 steps from the front. */
  const sideStart = P.hair === H_LONG_LOOSE ? a16Of(q(0.95)) : P.hair === H_LONG_SWEPT ? a16Of(q(0.85)) : P.hair === H_CURLS_OUT ? a16Of(q(0.9)) : A105;
  const fall = isFall(P.hair);
  const scalpV = (th: number): number => {
    const a = absI(th);
    if (fall && a >= sideStart) return P.longV;
    if (a < A105) return P.hair === H_WRAP ? wrapLine(th) : hairLine(th);
    let i = 0;
    while (i < sideKnotsX.length - 2 && sideKnotsX[i + 1]! < a) i++;
    return lerpQ(sideKnotsY[i]!, sideKnotsY[i + 1]!, smQ(dq(a - sideKnotsX[i]!, sideKnotsX[i + 1]! - sideKnotsX[i]!)));
  };
  const hairAt = (th: number, v: number): boolean => {
    if (P.hair === H_BALD) { const a = absI(th); return a > A075 && v > P.crownV + mq(q(0.5), Q - powQ(dq(a, PI16), q(0.7))) && v < scalpV(th); }
    if (v >= scalpV(th)) return false;
    if (P.hair === H_SHORT && P.recede > q(0.85) && v < P.crownV - mq(q(0.12), cosF(th) * 4) - q(0.1)) return false; // bald crown
    return true;
  };
  /** The fold phase of a wrap's cloth, radians Q16. */
  const foldPhase = (th: number, v: number): number => mq(radQ(th), 4 * Q) + 7 * v;
  const hairThick = (th: number, v: number): number => {
    let h = P.ht;
    const edge = smQ(dq(scalpV(th) - v, q(0.28)));
    if (P.hair === H_WRAP) {
      h = mq(h, Q + mq(q(0.3), sinF(a16Of(foldPhase(th, v))) * 4));
      return q(0.004) + mq(h, q(0.85) + mq(q(0.15), edge));
    }
    const topness = smQ(dq(q(-0.1) - v, q(0.6)));
    h = mq(h, lerpQ(P.sideFactor, Q, topness));
    h = mq(h, Q + mq(P.sweep, sinF(th) * 4));
    if (P.quiff) h = mq(h, Q + mq(mq(mq(P.quiff, gexp(dq(radQ(th - (P.partTh >> 1)), q(0.7)))), smQ(dq(v - (-P.craniumH - q(0.1)), q(0.25)))), smQ(dq(q(-0.45) - v, q(0.35)))));
    const thR = radQ(th);
    if (P.hair === H_CURLY) h = mq(h, Q + mq(mq(q(0.3), nq(mq(thR, 40 * Q) + 100 * Q, 40 * v, 7 * Q, P.salt)), smQ(dq(v + q(0.75), q(0.35)) + q(0.3))));
    if (P.hair === H_CURLS_OUT) h = mq(h, Q + mq(mq(q(0.35), nq(mq(thR, 24 * Q) + 100 * Q, 24 * v, 7 * Q, P.salt)), smQ(dq(v + q(0.75), q(0.35)) + q(0.3))));
    if (P.hair === H_TEXTURED || P.hair === H_PIXIE) h = mq(h, Q + mq(mq(q(0.22), nq(mq(thR, 60 * Q) + 200 * Q, 60 * v, 7 * Q, P.salt + 17)), smQ(dq(v + q(0.75), q(0.35)) + q(0.3)))); // damped to zero over the crown, no scribble
    if (P.hair === H_BRAIDS && v > P.e + q(0.1)) h = mq(h, Q + mq(q(0.35), sinF(a16Of(28 * v + 2 * thR)) * 4));
    if ((P.hair === H_LONG || P.hair === H_LONG_LOOSE || P.hair === H_LONG_SWEPT) && v > P.e) h = mq(h, Q + mq(q(0.3), smQ(v - P.e)));
    return q(0.004) + mq(h, q(0.06) + mq(q(0.94), edge));
  };
  return { vCap, capA, width, dFront, dBack, rowOf, sliceZ, features, basePoint: (th: number, row: Row) => basePoint(th, row), headPoint, frontZ, hairLine, scalpV, hairAt, hairThick, foldPhase, vm, G, Hv, Lw, eyeU, ew, uh, upF, loF, eyeC, eyeS, napeV, sideStart, get bX() { return bX; }, get bZ() { return bZ; }, get bC() { return bC; } };
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
}
/** The composition: the cranium half-width R in raster units, the head's centre. */
const RU = idiv(AHU, 5);
const STEPS_OF = (radQ16: number): number => idiv(radQ16 * 1024, TAUQ);

// a splatted point reports through these
let sX = 0, sY = 0, sZ = 0, sReg = 0, sDir = 0, sD0 = 0, sD1 = 0, sEx = 0;

/**
 * Splat a parametric grid: fn(i, j) fills sX, sY (raster units), sZ (depth, Q16 head units), sReg, sDir
 * with sD0/sD1 (a Q14 direction in grid steps), sEx, or returns false to skip. Normals come from the
 * grid neighbours (one cross product of integer differences, normalised by isqrt, viewer-facing); the
 * z-buffer keeps the nearest.
 */
function splat(F: Field, nA: number, nB: number, fn: (i: number, j: number) => boolean, wrapA: boolean): void {
  const N = nA * nB, X = new Int32Array(N), Y = new Int32Array(N), Z = new Int32Array(N), R = new Uint8Array(N), D0 = new Int16Array(N), D1 = new Int16Array(N), HD = new Uint8Array(N), EX = new Int32Array(N), OK = new Uint8Array(N);
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
    if (!fn(i, j)) continue;
    const k = j * nA + i;
    OK[k] = 1; X[k] = sX; Y[k] = sY; Z[k] = sZ; R[k] = sReg; HD[k] = sDir; D0[k] = sD0; D1[k] = sD1; EX[k] = sEx;
  }
  const RU8 = RU * 8;
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) {
    const k = j * nA + i;
    if (!OK[k]) continue;
    const ia = wrapA ? (i + 1) % nA : Math.min(nA - 1, i + 1), ib = wrapA ? (i + nA - 1) % nA : Math.max(0, i - 1);
    const ja = Math.min(nB - 1, j + 1), jb = Math.max(0, j - 1);
    const ka = j * nA + ia, kb = j * nA + ib, kc = ja * nA + i, kd = jb * nA + i;
    const xa = OK[ka] ? ka : k, xb = OK[kb] ? kb : k, xc = OK[kc] ? kc : k, xd = OK[kd] ? kd : k;
    const ax = (X[xa]! - X[xb]!) * 8, ay = (Y[xa]! - Y[xb]!) * 8, azp = mq(Z[xa]! - Z[xb]!, RU8);
    const bx = (X[xc]! - X[xd]!) * 8, by = (Y[xc]! - Y[xd]!) * 8, bzp = mq(Z[xc]! - Z[xd]!, RU8);
    let nx = ay * bzp - azp * by, ny = azp * bx - ax * bzp, nz = ax * by - ay * bx;
    const L = isqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx = idiv(nx * 16384, L); ny = idiv(ny * 16384, L); nz = idiv(nz * 16384, L);
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const px = idiv(X[k]! + 32, 64), py = idiv(Y[k]! + 32, 64);
    if (px < 0 || py < 0 || px >= FW || py >= FH) continue;
    const q0 = py * FW + px;
    if (Z[k]! <= F.z[q0]!) continue;
    F.z[q0] = Z[k]!; F.reg[q0] = R[k]!; F.nx[q0] = nx; F.ny[q0] = ny; F.nz[q0] = nz; F.extra[q0] = EX[k]!;
    if (HD[k]) { const dx = ax * D0[k]! + bx * D1[k]!, dy = ay * D0[k]! + by * D1[k]!; F.dir[q0] = atan2i(dy, dx); } else F.dir[q0] = NODIR;
  }
}

function setDir(d0: number, d1: number): void { const L = isqrt(d0 * d0 + d1 * d1) || 1; sDir = 1; sD0 = idiv(d0 * 16384, L); sD1 = idiv(d1 * 16384, L); }
const sq = (x: number): number => mq(x, x);
const hypotQ = (a: number, b: number): number => isqrt(a * a + b * b);

interface Pose { cx: number; cy: number; xf: (x: number, y: number, z: number) => void; xfBody: (x: number, y: number, z: number) => void }
let tX = 0, tY = 0, tZ = 0;
function makePose(P: V11Plan): Pose {
  const faceDir = sgn(P.yaw) || 1, turned = absI(P.yaw) > degA(q(12));
  const cx = idiv(AWU * (50 - (turned ? faceDir * 5 : faceDir * 2)), 100), cy = idiv(AHU * 42, 100);
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
function necklineOf(P: V11Plan, shV: number): (u: number) => number {
  const g = P.garment;
  return (u: number): number => {
    const au = absI(u);
    if (g === G_CREW) return au < q(0.75) ? shV + q(0.1) + mq(q(0.14), Q - sq(dq(u, q(0.75)))) : ZFAR;
    if (g === G_SCOOP) return au < q(0.9) ? shV + q(0.1) + mq(q(0.5), Q - sq(dq(u, q(0.9)))) : ZFAR;
    if (g === G_VEE) return au < q(0.6) ? shV + q(0.05) + mq(q(0.75), Q - dq(au, q(0.6))) : ZFAR;
    if (g === G_COLLAR) return au < q(0.4) ? shV + q(0.05) + mq(q(0.5), Q - dq(au, q(0.4))) : ZFAR;
    if (g === G_LAPEL) return au < q(0.6) ? shV + q(0.02) + mq(q(1.15), Q - dq(au, q(0.6))) : ZFAR;
    if (g === G_BOAT) return au < q(1.25) ? shV + q(0.02) + mq(q(0.12), Q - sq(dq(u, q(1.25)))) : ZFAR;
    if (g === G_BLOUSE) return au < q(0.5) ? shV + q(0.04) + mq(q(0.55), Q - powQ(dq(au, q(0.5)), q(1.5))) : ZFAR;
    if (g === G_WRAP) return au < q(0.65) ? shV + q(0.03) + mq(q(0.85), Q - dq(au, q(0.65))) : ZFAR;
    if (g === G_SHAWL) return au < q(0.8) ? shV + q(0.08) + mq(q(0.2), Q - sq(dq(u, q(0.8)))) : ZFAR;
    return ZFAR; // turtleneck, high collar: no skin
  };
}

function buildField(P: V11Plan, M: Model, pose: Pose): Field {
  const F = new Field();
  const { xf, xfBody } = pose;
  const C145 = 145, hair = P.hair;
  // ---- head
  {
    const vTop = -P.craniumH, vBot = P.chin + q(0.05) + P.beardLen, span = vBot - vTop;
    const nTh = cdiv(mq(q(10.47721), RU), 64), nV = cdiv(mq(span, RU) * C145, 6400); // 1.45 samples a field px around 1.15 R, and down the head
    const dTh = idiv(TAUQ, nTh), dV = idiv(span, nV - 1);
    let row: Row = M.rowOf(vTop), rowJ = -1;
    splat(F, nTh, nV, (i, j) => {
      if (j !== rowJ) { rowJ = j; row = M.rowOf(vTop + idiv(span * j, nV - 1)); }
      const th = -PI16 + idiv(A16 * i, nTh);
      M.headPoint(th, row);
      xf(M.bX, row.v, M.bZ);
      sX = tX; sY = tY; sZ = tZ; sReg = fReg; sEx = fEx; sDir = 0;
      if (fDir) { // head-local tangent [du, dv] -> grid steps
        const c = absI(cosF(th) * 4), w = mq(row.w < q(0.05) ? q(0.05) : row.w, c < q(0.15) ? q(0.15) : c);
        setDir(mq(dq(fDu, w), dTh) * 256, mq(fDv, dV) * 256);
      }
      return true;
    }, true);
  }
  // ---- hair (an offset surface), the fall of the long styles, buns, a single braid; or a wrap
  {
    const vTop = -P.craniumH, vBotL = isFall(hair) ? P.longV : 0, vBot = Math.max(P.chin + q(0.05), vBotL), span = vBot - vTop;
    const nTh = cdiv(mq(q(11.38827), RU), 64), nV = cdiv(mq(span, RU) * C145 * 11, 64000);
    const vp = -P.craniumH + q(0.1), vRef = P.e + q(0.1), rowRef = M.rowOf(vRef);
    const scalpCol = new Int32Array(nTh);
    for (let i = 0; i < nTh; i++) scalpCol[i] = M.scalpV(-PI16 + idiv(A16 * i, nTh));
    const fall = isFall(hair), wk = hair === H_BOB ? q(-0.1) : hair === H_BRAIDS ? q(-0.04) : hair === H_LONG_LOOSE ? q(0.08) : q(0.06);
    let row: Row = rowRef, rowJ = -1;
    splat(F, nTh, nV, (i, j) => {
      const th = -PI16 + idiv(A16 * i, nTh), v = vTop + idiv(span * j, nV - 1);
      if (j === 0 || v >= scalpCol[i]!) return false;
      if (!M.hairAt(th, v)) return false;
      const a = absI(th), thR = radQ(th);
      if (fall && a >= M.sideStart) {
        if (hair === H_BRAIDS && v > vRef + q(0.15)) return false; // the two braids are tubes below (drawn after the cap)
        if (hair === H_LONG_SWEPT && sgn(th) !== P.sweptSide && v > vRef + q(0.15)) return false; // the other side is swept over
        const nz1 = nq(6 * v + 40 * Q, th > 0 ? Q : 2 * Q, Q, P.salt + 13);
        const shift = hair === H_LONG_LOOSE ? mq(q(-0.1), smQ(v - P.e)) + mq(q(0.08), nz1) : hair === H_LONG_SWEPT ? mq(q(-0.15), smQ(v - P.e)) + mq(q(0.08), nz1) : hair === H_CURLS_OUT ? mq(q(0.15), nz1) : mq(q(0.35), smQ(dq(v - P.e, q(1.1)))) + mq(q(0.12), nz1);
        if (a < M.sideStart + a16Of(shift)) return false; // the fall's front edge, uneven
        if (v > P.longV - q(0.12) - mq(q(0.15), nq(mq(thR, 10 * Q) + 300 * Q, 0, Q, P.salt + 11))) return false; // ragged ends
      }
      const h = M.hairThick(th, v);
      let px: number, pz: number;
      if (v <= vRef || a < A1) {
        if (j !== rowJ) { rowJ = j; row = M.rowOf(v); }
        M.basePoint(th, row); px = M.bX; pz = M.bZ;
      } else { // the fall hangs from the skull's widest slice
        M.basePoint(th, rowRef);
        const dvr = v - vRef;
        px = mq(M.bX, Q + mq(wk, dvr)); pz = mq(M.bZ, Q + mq(q(0.03), dvr));
        if (hair === H_LONG_LOOSE || hair === H_CURLS_OUT) pz += mq(q(0.25), smQ(dq(dvr, q(0.6)))); // in front of the shoulders
        if (hair === H_LONG_SWEPT) { px -= P.sweptSide * mq(q(0.3), smQ(dq(dvr - q(0.4), q(0.8)))); pz += mq(q(0.35), smQ(dq(dvr - q(0.3), q(0.6)))); }
      }
      // radial offset from the cranium centre
      const dx = px, dy = mq((v < vRef ? v : vRef) - M.vCap, q(0.6)), dz = pz, L = isqrt(dx * dx + dy * dy + dz * dz) || 1;
      xf(px + idiv(h * dx, L), v + idiv(h * dy, L), pz + idiv(h * dz, L));
      sX = tX; sY = tY; sZ = tZ;
      if (hair === H_WRAP) { sReg = WRAP; sEx = mq(q(0.2), sinF(a16Of(M.foldPhase(th, v))) * 4); setDir(q(0.868), q(-0.496)); return true; }
      sReg = HAIR; sEx = Q - smQ(dq(scalpCol[i]! - v, q(0.14)));
      // strand direction in parameter space
      let d0 = mq(radQ(wrapPi16(th - P.partTh)), q(0.6)), d1 = v - vp + q(0.35);
      if (v > vRef) d0 = mq(d0, q(0.2));
      if (hair === H_CURLY || hair === H_CURLS_OUT) {
        const f = hair === H_CURLY ? 30 : 18, amp = hair === H_CURLY ? q(0.85) : q(0.95);
        const an = (atan2i(d1, d0) + STEPS_OF(mq(mq(amp, nq(mq(thR, f * Q), f * v, 5 * Q, P.salt + 3)), smQ(dq(v + q(0.8), q(0.4)) + q(0.25))))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hair === H_TEXTURED || hair === H_PIXIE) {
        if (hair === H_PIXIE) { d0 = -sgn(th) * q(0.7); d1 = q(0.5); }
        const an = (atan2i(d1, d0) + STEPS_OF(mq(mq(q(0.5), nq(mq(thR, 50 * Q), 50 * v, 4 * Q, P.salt + 19)), smQ(dq(v + q(0.8), q(0.4)) + q(0.25))))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hair === H_LONG || hair === H_BOB || hair === H_LONG_LOOSE || hair === H_LONG_SWEPT) {
        const an = (atan2i(d1, d0) + STEPS_OF(mq(q(0.25), nq(mq(thR, 20 * Q), 20 * v, 6 * Q, P.salt + 5)))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hair === H_BRAIDS && v > vRef + q(0.15)) {
        const an = (256 + 98 * sgn(sinF(a16Of(28 * v + 2 * thR)))) & 1023;
        d0 = COS(an); d1 = SIN[an]!;
      } else if (hasParting(hair)) {
        const dd = wrapPi16(th - P.partTh);
        d0 = sgn(dd) * mq(q(0.9), smQ(dq(q(-0.3) - v, q(0.6)))) + mq(d0, q(0.3));
      } else if (hair === H_TIED || hair === H_BUN_HIGH || hair === H_BUN_LOW || hair === H_BRAID_ONE) { // combed toward the bun or the nape
        const target = hair === H_BRAID_ONE ? M.napeV : P.bunV, dv = clampI(target - v, -Q, Q);
        d0 = sgn(th) * q(0.8); d1 = mq(dv, q(0.8));
        if (d0 === 0) d0 = q(0.1);
      }
      setDir(d0, d1);
      return true;
    }, true);
    if (hasBun(hair)) {
      const rb = P.bunR, bunV = P.bunV;
      const bc: V3 = hair === H_BUN_HIGH ? [0, bunV - mq(rb, q(0.5)), q(-0.35)] : [0, bunV, -(M.dBack(bunV) + mq(rb, hair === H_BUN_LOW ? q(0.5) : q(0.55)))];
      const n = cdiv(mq(mq(q(9.1106), rb), RU), 64) + 8, nb = n >> 1;
      splat(F, n, nb, (i, j) => {
        const a = idiv(A16 * i, n), b = idiv(PI16 * j, nb - 1), sb = sinF(b) * 4;
        xf(bc[0] + mq(mq(rb, sb), cosF(a) * 4), bc[1] + mq(rb, cosF(b) * 4), bc[2] + mq(mq(rb, sb), sinF(a) * 4));
        sX = tX; sY = tY; sZ = tZ; sReg = HAIR; sEx = 0; setDir(Q, 0);
        return true;
      }, true);
    }
    // braids: tubes along a curve with a chevron texture; one down the back or over a shoulder, or two from
    // behind the ears down the front of the shoulders
    const braids: Array<[V3, V3, V3]> = [];
    const shV0 = P.chin + P.neckLen, nV0 = M.napeV;
    if (hair === H_BRAID_ONE) {
      const side = P.sweptSide;
      braids.push(P.braidBack ? [[0, nV0 - q(0.15), q(-0.45)], [0, nV0 + q(0.6), q(-0.55)], [0, nV0 + q(1.4), q(-0.6)]] : [[side * q(0.3), nV0 - q(0.1), q(-0.4)], [side * q(0.85), shV0 - q(0.1), q(0.15)], [side * q(0.55), shV0 + q(1.3), q(0.75)]]);
    }
    if (hair === H_BRAIDS) for (const side of [-1, 1]) braids.push([[side * q(0.95), P.e + q(0.2), q(-0.15)], [side * q(0.95), P.chin + q(0.25), q(0.3)], [side * q(0.7), P.chin + q(1.3), q(0.75)]]);
    for (const [p0, p1, p2] of braids) {
      const r = hair === H_BRAIDS ? q(0.085) : q(0.1);
      const nA = cdiv(mq(mq(q(9.1106), r), RU), 64) + 6, nB = cdiv(mq(q(1.6), RU) * C145, 6400);
      splat(F, nA, nB, (i, j) => {
        const a = idiv(A16 * i, nA), s = idiv(Q * j, nB - 1), s1 = Q - s, w0 = sq(s1), w1 = 2 * mq(s1, s), w2 = sq(s);
        const cx0 = mq(w0, p0[0]) + mq(w1, p1[0]) + mq(w2, p2[0]), cy0 = mq(w0, p0[1]) + mq(w1, p1[1]) + mq(w2, p2[1]), cz0 = mq(w0, p0[2]) + mq(w1, p1[2]) + mq(w2, p2[2]);
        const ph = sinF(a16Of(mq(s, 40 * Q))) * 4, rr = mq(r, Q + mq(q(0.15), ph));
        const ca = cosF(a) * 4;
        xf(cx0 + mq(rr, ca), cy0, cz0 + mq(rr, sinF(a) * 4));
        sX = tX; sY = tY; sZ = tZ; sReg = HAIR; sEx = 0;
        setDir(sgn(ca) * sgn(ph) * q(0.7), Q);
        return true;
      }, true);
    }
  }
  // ---- ears
  for (const side of [-1, 1]) {
    const ve = P.earV0 + (P.earLen >> 1), ze = q(-0.08);
    const nA = cdiv(mq(q(4.55531), RU), 64), nB = cdiv(mq(q(0.435), RU), 64);
    splat(F, nA, nB, (i, j) => {
      const a = idiv(A16 * i, nA), rho = idiv(Q * j, nB - 1), sa = sinF(a) * 4, ca = cosF(a) * 4;
      const v = ve + mq(mq(rho, P.earLen >> 1), sa), z = ze + mq(mq(rho, P.earD), ca);
      const u = side * (M.width(v) + q(0.01) + mq(rho, q(0.02) + mq(mq(P.earFlare, q(0.13)), q(0.5) - mq(q(0.5), ca))));
      xf(u, v, z);
      sX = tX; sY = tY; sZ = tZ; sReg = EAR; sEx = 0; setDir(Q, 0);
      return true;
    }, true);
  }
  // ---- neck
  const shV = P.chin + P.neckLen, gar = P.garment, neckline = necklineOf(P, shV);
  {
    const v0 = P.e + q(0.45), v1 = shV + q(0.7), zc0 = q(-0.1);
    const nA = cdiv(mq(mq(q(9.1106), P.neckR), RU), 64), nB = cdiv(mq(v1 - v0, RU) * C145, 6400);
    const turtleV = P.chin + q(0.1), highV = P.chin + q(0.22);
    splat(F, nA, nB, (i, j) => {
      const a = idiv(A16 * i, nA), v = v0 + idiv((v1 - v0) * j, nB - 1);
      const r = mq(P.neckR, Q + mq(q(0.12), smQ(dq(v - P.chin, q(0.6))))), zc = zc0 - mq(q(0.12), smQ(dq(v - P.chin, q(0.8))));
      const px = mq(r, sinF(a) * 4), pz = zc + mq(r, cosF(a) * 4);
      let region = SKIN;
      if (gar === G_TURTLE) { if (v > turtleV) region = GARM; }
      else if (gar === G_HIGH) { if (v > highV) region = GARM2; }
      else {
        const nl = neckline(px);
        if (v > nl) region = gar === G_LAPEL ? SHIRT : gar === G_COLLAR || gar === G_BLOUSE ? GARM2 : GARM;
        if (gar === G_COLLAR && v > shV + q(0.02) && v < nl) region = GARM2;
      }
      xfBody(px, v, pz);
      sX = tX; sY = tY; sZ = tZ; sReg = region; sEx = 0; sDir = 0;
      return true;
    }, true);
  }
  // ---- torso: an elliptical cylinder whose top edge is the shoulder line
  {
    const shW = P.shW, vEnd = shV + q(4.5);
    const nA = cdiv(mq(2 * shW, RU) * C145, 6400), nB = cdiv(mq(q(4.5), RU) * C145, 6400);
    const cu = new Int32Array(nA), cvT = new Int32Array(nA), cr = new Int32Array(nA), cband = new Int32Array(nA), cnl = new Int32Array(nA);
    for (let i = 0; i < nA; i++) {
      const u = -shW + idiv(2 * shW * i, nA - 1), au = absI(u), a = dq(au, shW);
      cu[i] = u;
      cvT[i] = torsoTop(P, shV, u);
      cr[i] = sqrtQ(Q - sq(dq(u, shW)));
      cband[i] = q(0.22) + mq(q(0.7), powQ(a, q(1.5)));
      cnl[i] = neckline(u);
    }
    const lapelW = q(0.6927);
    splat(F, nA, nB, (i, j) => {
      const u = cu[i]!, au = absI(u), vT = cvT[i]!, t = idiv(Q * j, nB - 1), v = vT + mq(vEnd - shV, sq(t));
      const f = powQ(smQ(dq(v - vT, cband[i]!)), q(0.7));
      const z = q(-0.5) + mq(mq(q(1.1), cr[i]!), q(0.15) + mq(q(0.85), f));
      let region = GARM;
      const nl = cnl[i]!;
      if (v < nl) region = gar === G_LAPEL ? SHIRT : SKIN;
      if (gar === G_COLLAR) {
        const edge = au < q(0.4) ? absI(v - nl) : hypotQ(au - q(0.4), Math.max(0, v - (shV + q(0.05))));
        if (v >= nl && edge < q(0.15) && v < shV + q(0.65)) region = GARM2;
        if (v < shV + q(0.1) && au < q(0.75)) region = GARM2;
      } else if (gar === G_LAPEL) {
        if (v >= nl && au < Q && v - nl < lapelW && v < shV + q(1.6)) region = GARM2;
        if (v < shV + q(0.1) && au < q(0.75)) region = SHIRT;
      } else if (gar === G_TURTLE) region = GARM;
      else if (gar === G_HIGH) { if (v < shV + q(0.15)) region = GARM2; }
      else if (gar === G_BLOUSE) { if (v >= nl && v - nl < q(0.16) && v < shV + q(0.6)) region = GARM2; }
      else if (gar === G_WRAP) { // the overlapping panel's edge continues the near side's diagonal across the chest
        const uw = u * P.wrapSide;
        if (uw < 0 && v >= nl && v < shV + q(1.6) && absI(v - (shV + q(0.03) + mq(q(0.85), Q - dq(uw, q(0.65))))) < q(0.08)) region = GARM2;
      } else if (gar === G_SHAWL) { if (au > q(0.85) - mq(q(0.45), smQ(dq(v - shV, q(1.8)))) && region !== SKIN) region = GARM2; }
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
      z[q0] = z[r]!; reg[q0] = reg[r]!; F.nx[q0] = F.nx[r]!; F.ny[q0] = F.ny[r]!; F.nz[q0] = F.nz[r]!; F.dir[q0] = F.dir[r]!; F.extra[q0] = F.extra[r]!;
    }
    // despeckle (two passes, so pairs go too): a covered pixel whose depth agrees with at most one of six or
    // more covered neighbours is a pinhole (a nearer surface missed it, or a farther one shows through); it
    // takes the neighbour most of the others agree with, so no depth-step stamp fires on a speck
    const near = q(0.09);
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
      z[q0] = z[r]!; reg[q0] = reg[r]!; F.nx[q0] = F.nx[r]!; F.ny[q0] = F.ny[r]!; F.nz[q0] = F.nz[r]!; F.dir[q0] = F.dir[r]!; F.extra[q0] = F.extra[r]!;
    }
    }
  }
  return F;
}

/* ── Light and tone ──────────────────────────────────────────────────────────────────────────────── */

function shadeField(P: V11Plan, F: Field, pose: Pose): void {
  const L = lightDir(P), inv = PALS[P.palette]!.inv === 1;
  // 3 field px a step toward the light, the ray's depth rising with the light's z
  const lx = (L[0] * 3 * 256) >> 16, ly = (L[1] * 3 * 256) >> 16, lz = idiv(L[2] * 192, RU);
  const raw = new Int32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const q0 = y * FW + x;
    if (F.reg[q0] === BG) continue;
    const d = (F.nx[q0]! * L[0] + F.ny[q0]! * L[1] + F.nz[q0]! * L[2]) >> 14; // Q16
    let sh = P.ambient + mq(Q - P.ambient, powQ(clampQ(dq(d + q(0.35), q(1.35))), q(1.3))); // a wide wrap: the terminator is a gradient
    let px = (x << 8) + 128, py = (y << 8) + 128, pz = F.z[q0]! + q(0.02);
    for (let i = 0; i < 50; i++) {
      px += lx; py += ly; pz += lz;
      const ix = px >> 8, iy = py >> 8;
      if (ix < 0 || iy < 0 || ix >= FW || iy >= FH) break;
      const r = iy * FW + ix;
      if (F.reg[r] === BG) continue;
      if (F.z[r]! > pz + q(0.035)) { sh = mq(sh, q(0.55)); break; } // in a cast shadow
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
  const browDark = clampQ(P.hairDark + q(0.15));
  const child = P.ageT < Q, lightT = child ? q(0.47) : q(0.56), coreT = q(0.25);
  const faceTone = (sh: number, ex: number, ear: boolean, wob: number): number => {
    if (ex < 0) return 0;
    const lt = lightT + wob;
    if (sh >= lt) return 0;
    if (sh >= coreT) return mq(mq(q(0.38), powQ(dq(lt - sh, lt - coreT), q(0.85))), ear ? q(0.8) : Q);
    if (child) return q(0.38);
    return q(0.4) + mq(q(0.22), clampQ(dq(coreT - sh, coreT)));
  };
  const baldFloor = P.hair === H_BALD || P.recede > q(0.85);
  const faceToneInv = (sh: number, ex: number, wob: number): number => { // dark ground: the lit face is lines, the shadow side is ground
    if (ex < 0) return 0;
    const shadowT = (child ? q(0.5) : q(0.42)) + wob;
    if (sh <= shadowT) return baldFloor ? mq(q(0.12), clampQ(dq(sh, shadowT))) : 0;
    return q(0.14) + mq(child ? q(0.5) : q(0.76), powQ(clampQ(dq(sh - shadowT, Q - shadowT)), q(0.8)));
  };
  const lipLTone = P.lipDark ? q(0.3) : 0;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const q0 = y * FW + x, r = F.reg[q0], sh = inv ? q(0.28) + mq(q(0.72), F.shade[q0]!) : F.shade[q0]!, dk = Q - sh, ex = F.extra[q0]!;
    let t = 0;
    if (r === BG) {
      if (P.bg !== 0) {
        const X = x * FS * U, Y = y * FS * U; // units
        const sx = P.lightSide > 0 ? idiv(X * Q, AWU) : Q - idiv(X * Q, AWU); // 0 at the lit edge, 1 at the shadow edge
        if (P.bg === 1) t = mq(mq(P.bgTone, powQ(smQ(dq(sx - q(0.05), q(0.95))), q(1.6))), q(0.75) + mq(q(0.25), smQ(idiv(Y * Q, AHU))));
        else { const d = idiv(hypotQ(X - pose.cx, Y - pose.cy) * Q, RU); t = mq(mq(mq(q(0.75), P.bgTone), q(0.5) + mq(q(0.5), smQ(dq(d - q(0.9), q(1.4))))), q(0.7) + mq(q(0.3), sx)); }
        if (inv) t = mq(t, q(0.25));
      }
      F.tone[q0] = clampQ(t) >> 4;
      continue;
    }
    if (!inv) {
      switch (r) {
        case SKIN: case EAR: t = faceTone(sh, ex, r === EAR, mq(q(0.05), nq(x * FS, y * FS, 26, P.salt + 23))); break;
        case HAIR: t = mq(Math.min(q(0.7), mq(P.hairDark, q(0.5) + mq(q(0.5), dk)) + q(0.05)), Q - mq(q(0.55), ex)); break;
        case WRAP: t = mq(P.wrapTone, q(0.6) + mq(q(0.4), dk)) + mq(q(0.08), dk) + ex; break;
        case WHITE: t = mq(q(0.08), dk) + mq(ex, q(0.8)); break;
        case IRIS: { const rim = Math.min(Q, Math.max(0, ex - q(0.6)) >> 1), lid = Math.min(q(0.6), ex - 2 * rim); t = mq(mq(Math.max(q(0.42), P.irisDark), q(0.62) + mq(q(0.38), sq(rim))), q(0.9) + mq(q(0.1), dk)) + mq(lid, q(0.8)); break; }
        case PUPIL: t = Q; break;
        case HILITE: t = 0; break;
        case BROW: t = Math.min(q(0.62), mq(browDark, q(0.6) + mq(q(0.4), dk))); break;
        case LIPU: t = 0; break;
        case LIPL: t = lipLTone; break; // a darker lower lip on some adults: one layer along the lip, never across
        case MOUTH: t = Q; break;
        case NOSTRIL: t = q(0.75); break;
        case GARM: t = mq(P.gTone, q(0.6) + mq(q(0.4), dk)) + mq(q(0.08), dk); break;
        case GARM2: t = mq(P.gTone2, q(0.6) + mq(q(0.4), dk)) + mq(q(0.08), dk); break;
        case SHIRT: t = mq(q(0.12), dk); break;
        case BEARD: t = mq(P.beardDark, q(0.45) + mq(q(0.45), dk)); break;
      }
    } else {
      switch (r) {
        case SKIN: case EAR: t = faceToneInv(sh, ex, mq(q(0.05), nq(x * FS, y * FS, 26, P.salt + 23))); break;
        case HAIR: t = mq(mq(mq(q(1.05) - P.hairDark, sh), q(0.9)), Q - mq(q(0.5), ex)); break;
        case WRAP: t = mq(mq(Q - P.wrapTone, q(0.8)), sh) + ex; break;
        case WHITE: t = mq(mq(q(0.85), sh), Q - ex); break;
        case IRIS: { const rim = Math.min(Q, Math.max(0, ex - q(0.6)) >> 1); t = mq(mq(mq(Q - mq(P.irisDark, q(0.8)), q(0.7)), sh), Q - mq(q(0.6), sq(rim))); break; }
        case PUPIL: t = 0; break;
        case HILITE: t = Q; break;
        case BROW: t = mq(mq(Q - browDark, q(0.7)), sh); break;
        case LIPU: case LIPL: t = 0; break;
        case MOUTH: t = 0; break;
        case NOSTRIL: t = q(0.05); break;
        case GARM: t = mq(mq(Q - P.gTone, q(0.8)), sh); break;
        case GARM2: t = mq(mq(Q - P.gTone2, q(0.8)), sh); break;
        case SHIRT: t = mq(q(0.85), sh); break;
        case BEARD: t = mq(mq(Q - P.beardDark, q(0.6)), sh); break;
      }
    }
    F.tone[q0] = clampQ(t) >> 4;
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
    if (d !== NODIR && (r === HAIR || r === BROW || r === IRIS || r === WHITE || r === LIPU || r === LIPL || r === BEARD || r === EAR || r === WRAP)) { F.hd2[q0] = (2 * d) & 1023; continue; }
    const nx = sxA[q0]!, ny = syA[q0]!, t = isqrt(nx * nx + ny * ny) * 4; // Q16 tilt
    const form2 = (2 * (atan2i(ny, nx) + 256)) & 1023;
    const wgt = mq(q(0.6), powQ(clampQ(mq(t, q(1.3))), q(0.9)));
    const c = mq(wgt, COS(form2) * 4) + mq(Q - wgt, COS(diag2) * 4), s = mq(wgt, SIN[form2]! * 4) + mq(Q - wgt, SIN[diag2]! * 4);
    F.hd2[q0] = atan2i(s, c);
  }
}

/* ── Hatching: streamlines along the direction field, four layers at tone thresholds ───────────────── */

interface Stroke { pts: number[]; hw: number[]; c: number }
interface Prims { strokes: Stroke[]; discs: number[]; rects: number[]; stats: V11Stats }
export interface V11Stats { strokes: number; stamps: number; curves: number }
/** Q16 px of the 960-px reference frame to raster units (every length scales with the art height). */
const kU = (pxQ16: number): number => idiv(pxQ16 * AHU, 960 * Q);
interface Style { sp: number; off: readonly number[]; len0: number; len1: number }
const STYLE: ReadonlyArray<Style | null> = [
  /* BG */ { sp: 115, off: [0, 199, -199, 256], len0: 80, len1: 320 },
  /* SKIN */ { sp: 100, off: [0, 176, -165, 256], len0: 40, len1: 150 },
  /* HAIR */ { sp: 70, off: [0, 26, -26, 11], len0: 40, len1: 220 },
  /* WHITE */ { sp: 80, off: [0, 171, -171, 256], len0: 8, len1: 30 },
  /* IRIS */ { sp: 34, off: [0, 0, 0, 0], len0: 4, len1: 40 },
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

function hatch(P: V11Plan, F: Field, prims: Prims, inv: boolean): void {
  const S0 = kU(q(6)), h = kU(q(2)), h8 = h * 8;
  const CELL = 64, GW = cdiv(AWU, CELL), GH = cdiv(AHU, CELL);
  const wmin = kU(q(0.5)), taperL = kU(q(6));
  const fwd: number[] = [], back: number[] = [];
  for (let layer = 0; layer < 4; layer++) {
    const T = THRESH12[layer]!, wmax = kU(layer === 0 ? q(1.25) : q(1.05));
    const occ = new Uint8Array(GW * GH);
    const isOcc = (x: number, y: number): boolean => { const gx = x >> 6, gy = y >> 6; if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return true; return occ[gy * GW + gx] === 1; };
    const mark = (x: number, y: number, r: number): void => {
      const gx0 = Math.max(0, (x - r) >> 6), gx1 = Math.min(GW - 1, (x + r) >> 6), gy0 = Math.max(0, (y - r) >> 6), gy1 = Math.min(GH - 1, (y + r) >> 6), r2 = r * r;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { const dx = gx * 64 + 32 - x, dy = gy * 64 + 32 - y; if (dx * dx + dy * dy <= r2) occ[gy * GW + gx] = 1; }
    };
    const gstep = idiv(S0 * 55, 100), nx = cdiv(AWU, gstep), ny = cdiv(AHU, gstep);
    for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
      const hsh = hash2(gx, gy, P.salt + layer * 977);
      const x0 = gx * gstep + (((hsh & 1023) * gstep) >> 10), y0 = gy * gstep + ((((hsh >>> 10) & 1023) * gstep) >> 10);
      if (x0 >= AWU || y0 >= AHU) continue;
      const reg = regAt(F, x0, y0), st = STYLE[reg];
      if (!st || reg === HILITE) continue;
      if (reg === PUPIL && !inv) continue;
      const t0 = toneAt(F, x0, y0);
      const skinish = reg === SKIN || reg === EAR, b16 = (hsh >>> 16) & 255;
      // the background wash and the first skin layer take a per-stroke threshold jitter so they fade in
      const Teff = reg === BG ? idiv(T * (7650 + 140 * b16), 25500) : skinish && layer === 0 ? idiv(T * (15300 + 90 * b16), 25500) : T;
      if (t0 < Teff) continue;
      const nearT = reg === BG ? clampQ(idiv((t0 - T) * Q, 1024)) : skinish && layer === 0 ? clampQ(idiv((t0 - T) * Q, 573)) : Q;
      const rel = clampQ(idiv((t0 - T) * Q, 4096 - T));
      const spF = reg === BG ? q(2.2) - mq(q(1.2), nearT) : skinish && layer === 0 ? q(1.9) - mq(q(0.9), nearT) - mq(q(0.25), rel) : Q - mq(q(0.25), rel);
      const sp = mq(idiv(S0 * st.sp, 100), spF), rad = idiv(sp * 42, 100), r6 = idiv(rad * 6, 10);
      if (isOcc(x0, y0)) continue;
      const offA = st.off[layer]! + idiv((((hsh >>> 20) & 255) - 128) * 9, 256);
      const l0 = kU(q(st.len0)), l1 = kU(q(st.len1));
      const maxLen = mq(l0 + idiv(((hsh >>> 12) & 255) * (l1 - l0), 255), q(0.3) + mq(q(0.7), nearT)), half = maxLen >> 1;
      const wob = ((hsh >>> 4) & 255) * 4;
      let total = 0;
      for (const sg of [1, -1]) {
        const arr = sg > 0 ? fwd : back;
        arr.length = 0;
        let x8 = x0 * 8, y8 = y0 * 8, prevA = 0, hasPrev = false, L = 0;
        while (L < half) {
          let a = dirAt(F, x8 >> 3, y8 >> 3) + offA;
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
      const minLen = reg === HAIR || reg === BG ? idiv(sp * 25, 10) : reg === IRIS ? idiv(sp * 8, 10) : idiv(sp * 16, 10);
      if (total < minLen) continue;
      const pts: number[] = [], hws: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) pts.push(back[i]!, back[i + 1]!);
      pts.push(x0, y0);
      for (let i = 0; i < fwd.length; i++) pts.push(fwd[i]!);
      const n = pts.length >> 1;
      for (let i = 0; i < n; i++) {
        const tt = clampQ(idiv((toneAt(F, pts[2 * i]!, pts[2 * i + 1]!) - T) * Q, 4096 - T));
        let w = wmin + mq(wmax - wmin, tt);
        const end = Math.min(i, n - 1 - i) * h, taper = clampQ(idiv(end * Q, taperL));
        w = mq(w, q(0.35) + mq(q(0.65), taper));
        w = mq(w, Q + mq(q(0.08), SIN[(wob + i * 82) & 1023]! * 4));
        hws.push(w);
      }
      const mr = idiv(sp * 4, 10);
      for (let i = 0; i < n; i++) mark(pts[2 * i]!, pts[2 * i + 1]!, mr);
      prims.strokes.push({ pts, hw: hws, c: INK + ((hsh >>> 28) & 3) - 1 + ((hsh >>> 26) & 1 ? 0 : -1) });
      prims.stats.strokes++;
    }
  }
}

/* ── Contours: stamps from the field, feature lines projected from head space, the rare details ───── */

/** The shoulder line and the torso's depth in body space (shared by the splat and the necklace). */
function torsoTop(P: V11Plan, shV: number, u: number): number {
  const a = dq(absI(u), P.shW), over = a - q(0.8);
  return shV - mq(P.trap, gexp(dq(u, q(0.5)))) + mq(P.shDrop, powQ(a, q(1.4))) + mq(q(1.2), over > 0 ? sq(dq(over, q(0.2))) : 0);
}
function torsoZ(P: V11Plan, shV: number, u: number, v: number): number {
  const a = dq(absI(u), P.shW), r = sqrtQ(Q - sq(dq(u, P.shW))), band = q(0.22) + mq(q(0.7), powQ(a, q(1.5)));
  const f = powQ(smQ(dq(v - torsoTop(P, shV, u), band)), q(0.7));
  return q(-0.5) + mq(mq(q(1.1), r), q(0.15) + mq(q(0.85), f));
}
function bunCentre(P: V11Plan, M: Model): V3 {
  const rb = P.bunR, bunV = P.bunV;
  return P.hair === H_BUN_HIGH ? [0, bunV - mq(rb, q(0.5)), q(-0.35)] : [0, bunV, -(M.dBack(bunV) + mq(rb, P.hair === H_BUN_LOW ? q(0.5) : q(0.55)))];
}

let cU = 0, cV = 0, cZ = 0;
function contours(P: V11Plan, F: Field, M: Model, pose: Pose, prims: Prims, inv: boolean): void {
  const wm = inv ? q(0.7) : Q, bob = P.hair === H_BOB;
  const edgeW = (a: number, b: number): number => {
    const has = (x: number): boolean => a === x || b === x;
    if (has(BG)) return has(HAIR) ? (bob ? q(0.4) : q(0.5)) : has(WRAP) ? q(0.8) : Q;
    if (has(HAIR)) return bob ? q(0.5) : q(0.35);
    if (has(MOUTH) || has(LIPU) || has(LIPL) || has(HILITE) || has(BROW)) return 0;
    if (has(WHITE) && has(IRIS)) return q(0.38);
    if (has(IRIS) && has(PUPIL)) return 0;
    if (has(NOSTRIL)) return q(0.3);
    if (has(WHITE) && has(SKIN)) return 0; // the lids are drawn as curves
    if (has(BEARD) && has(SKIN)) return 0;
    if (has(WRAP)) return has(SKIN) || has(EAR) ? q(0.55) : q(0.5);
    if ((has(GARM) || has(GARM2) || has(SHIRT)) && has(SKIN)) return q(0.6);
    if (has(GARM2)) return q(0.5);
    if (has(SHIRT)) return q(0.45);
    if (has(EAR)) return q(0.45);
    return 0;
  };
  // the pupil filled (one disc per field pixel); on the dark ground the reserved highlight is filled with the light ink
  const rPupil = kU(q(1.183)), rHi = kU(q(1.318)); // 0.7 and 0.78 field px
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const r = F.reg[y * FW + x];
    if (!inv && r === PUPIL) { prims.discs.push((2 * x + 1) * U, (2 * y + 1) * U, rPupil, INK); prims.stats.stamps++; }
    if (inv && r === HILITE) { prims.discs.push((2 * x + 1) * U, (2 * y + 1) * U, rHi, INK); prims.stats.stamps++; }
  }
  // region edges and depth steps, heavier on the shadow side
  for (let y = 0; y < FH - 1; y++) for (let x = 0; x < FW - 1; x++) {
    const q0 = y * FW + x;
    for (const o of [1, FW]) {
      const r = q0 + o, ra = F.reg[q0]!, rb = F.reg[r]!;
      let w = 0;
      if (ra !== rb) w = edgeW(ra, rb);
      else if (ra !== BG && absI(F.z[q0]! - F.z[r]!) > (ra === HAIR ? q(0.3) : q(0.09))) w = q(0.75);
      if (!w) continue;
      const near = F.z[q0]! > F.z[r]! ? q0 : r, sh = F.reg[near] === BG ? q(0.5) : F.shade[near]!;
      const hw = mq(kU(mq(w, wm)), q(0.55) + mq(q(0.9), Q - sh));
      prims.discs.push(o === 1 ? (x + 1) * 64 : x * 64 + 32, o === FW ? (y + 1) * 64 : y * 64 + 32, hw, INK);
      prims.stats.stamps++;
    }
  }
  /** A run of projected points with a depth test, tapered; fn(t) sets cU, cV (head space) or returns false. */
  let run: number[] = [], runW: number[] = [];
  const flush = (): void => { if (run.length >= 6) { prims.strokes.push({ pts: run, hw: runW, c: INK }); prims.stats.curves++; } run = []; runW = []; };
  const drawCurve = (fn: (t: number) => boolean, n: number, hw0: number, hw1: number, lift = q(0.03)): void => {
    for (let i = 0; i <= n; i++) {
      const t = idiv(i * Q, n);
      if (!fn(t)) { flush(); continue; }
      const z = M.frontZ(cU, M.rowOf(cV)) + lift;
      pose.xf(cU, cV, z);
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) { flush(); continue; }
      const q0 = gy * FW + gx;
      if (F.reg[q0] === BG || F.z[q0]! > tZ + q(0.05)) { flush(); continue; }
      const taper = Math.min(Q, dq(Math.min(t, Q - t), q(0.12)));
      run.push(tX, tY); runW.push(mq(kU(mq(wm, lerpQ(hw0, hw1, t))), q(0.3) + mq(q(0.7), taper)));
    }
    flush();
  };
  /** A run of points already placed by fn (which sets tX, tY, tZ and says whether the point is visible). */
  const drawPlaced = (fn: (t: number) => boolean, n: number, hw0: number, hw1: number): void => {
    for (let i = 0; i <= n; i++) {
      const t = idiv(i * Q, n);
      if (!fn(t)) { flush(); continue; }
      const taper = Math.min(Q, dq(Math.min(t, Q - t), q(0.15)));
      run.push(tX, tY); runW.push(mq(kU(mq(wm, lerpQ(hw0, hw1, t))), q(0.4) + mq(q(0.6), taper)));
    }
    flush();
  };
  const visibleAt = (okRegion: (r: number) => boolean, slack: number): boolean => {
    const gx = tX >> 6, gy = tY >> 6;
    if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
    const q0 = gy * FW + gx;
    return okRegion(F.reg[q0]!) || F.z[q0]! <= tZ + slack;
  };
  const e = P.e, ew = M.ew, eyeU = M.eyeU;
  for (const side of [-1, 1]) {
    const ec = eyeU * side;
    const lidPt = (t: number, up: boolean, scale: number): void => {
      const dur = mq(2 * t - Q, ew), dvr = up ? -mq(mq(M.uh, M.upF(clampQ(t))), scale) : mq(mq(P.lh, M.loF(clampQ(t))), scale);
      cU = ec + side * (mq(dur, M.eyeC) - mq(dvr, M.eyeS)); cV = e + mq(dur, M.eyeS) + mq(dvr, M.eyeC);
    };
    drawCurve((t) => { lidPt(q(-0.02) + mq(q(1.1), t), true, Q); return true; }, 40, mq(q(0.95), P.lidW), mq(q(1.35), P.lidW)); // the upper lid, heavy past the outer corner (lashes by weight)
    if (!(side === -sgn(P.yaw) && absI(P.yaw) > degA(q(28)))) drawCurve((t) => { lidPt(q(0.1) + mq(q(0.8), t), true, Q); cV += q(0.014); return true; }, 30, q(0.4), q(0.5)); // the lid's shadow on the ball, not on the far eye
    drawCurve((t) => { lidPt(q(0.3) + mq(q(0.7), t), false, Q); return true; }, 30, q(0.2), q(0.25));
    if (P.crease && P.ageT > q(0.6)) drawCurve((t) => { lidPt(q(0.05) + mq(q(0.9), t), true, q(1.55)); cV -= q(0.012); return true; }, 30, q(0.3), q(0.3));
    if (P.oldT > q(0.5)) drawCurve((t) => { lidPt(q(0.2) + mq(q(0.75), t), false, q(2.4)); cV += q(0.02); return true; }, 30, q(0.25), mq(q(0.3), P.oldT) + q(0.2));
    // nostril wing crease
    drawCurve((t) => { const a = -1229 + mq(7782, t); cU = side * (P.nostrilU + mq(q(0.085), cosF(a) * 4)); cV = P.noseBase - q(0.05) + mq(q(0.075), sinF(a) * 4); return true; }, 24, q(0.35), q(0.5), q(0.02));
    // nasolabial fold
    if (P.oldT > q(0.05) || P.smile > q(0.4)) {
      const d = clampQ(mq(P.oldT, q(1.2)) + Math.max(0, P.smile - q(0.4)));
      drawCurve((t) => { cU = side * (P.nostrilU + q(0.06) + mq(P.lipW + q(0.08) - P.nostrilU - q(0.06), t) + mq(q(0.08), sinPi(t) * 4)); cV = P.noseBase - q(0.02) + mq(P.mouth + q(0.08) - P.noseBase + q(0.02), t); return true; }, 24, q(0.25), q(0.25) + mq(q(0.5), d), q(0.02));
    }
    // ear: helix and concha
    {
      const ve = P.earV0 + (P.earLen >> 1);
      const earPt = (a: number, rho: number): void => {
        const sa = sinF(a) * 4, ca = cosF(a) * 4;
        cV = ve + mq(mq(rho, P.earLen >> 1), sa); cZ = q(-0.08) + mq(mq(rho, P.earD), ca);
        cU = side * (M.width(cV) + q(0.01) + mq(rho, q(0.02) + mq(mq(P.earFlare, q(0.13)), q(0.5) - mq(q(0.5), ca))));
      };
      const earVisible = (): boolean => visibleAt((r) => r === EAR, q(0.06));
      drawPlaced((t) => { earPt(-4506 + mq(9011, t), q(0.78)); pose.xf(cU, cV, cZ + q(0.02)); return earVisible(); }, 30, q(0.35), q(0.45));
      drawPlaced((t) => { earPt(-2867 + mq(6144, t), q(0.45)); pose.xf(cU, cV, cZ + q(0.03)); return earVisible(); }, 24, q(0.3), q(0.35));
      // earrings: a stud as a dot, a drop as a short line with a bead
      if (P.earring) {
        const vL = P.earV0 + P.earLen, uL = side * (M.width(vL) + q(0.03) + mq(P.earFlare, q(0.065)));
        pose.xf(uL, vL + q(0.02), q(-0.08));
        if (visibleAt((r) => r === EAR || r === SKIN, q(0.08))) {
          if (P.earring === 1) { prims.discs.push(tX, tY, kU(mq(q(1.6), wm)), INK); prims.stats.stamps++; }
          else {
            const x0 = tX, y0 = tY;
            pose.xf(uL, vL + q(0.12), q(-0.08));
            prims.strokes.push({ pts: [x0, y0, (x0 + tX) >> 1, (y0 + tY) >> 1, tX, tY], hw: [kU(mq(q(0.45), wm)), kU(mq(q(0.45), wm)), kU(mq(q(0.45), wm))], c: INK });
            prims.discs.push(tX, tY, kU(mq(q(1.1), wm)), INK); prims.stats.curves++; prims.stats.stamps++;
          }
        }
      }
    }
  }
  // mouth line, lower-lip edge, upper-lip edge with the bow (only on mouths wide enough on screen), mentolabial
  drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, q(1.02))); cV = M.vm(cU); return true; }, 40, q(0.55), q(0.55), q(0.02));
  drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, q(0.95))); const r95 = dq(dq(cU, P.lipW), q(0.95)); cV = M.vm(cU) + mq(P.lipL, powQ(clampQ(Q - sq(r95)), q(0.8))) + q(0.004); return true; }, 40, q(0.25), q(0.4), q(0.02));
  { const cy = cosF(P.yaw) * 4; if (mq(mq(2 * P.lipW, RU), cy < q(0.3) ? q(0.3) : cy) >= kU(q(60))) drawCurve((t) => { cU = mq(2 * t - Q, P.lipW); const ru = dq(cU, P.lipW); cV = M.vm(cU) - mq(mq(P.lipU, powQ(clampQ(Q - sq(ru)), q(0.7))), Q - mq(q(0.2), gexp(dq(cU, q(0.045))))) - q(0.003); return true; }, 40, q(0.3), q(0.3), q(0.02)); }
  if (P.oldT > q(0.6)) drawCurve((t) => { cU = mq(2 * t - Q, mq(P.lipW, q(0.8))); cV = P.mouth + P.lipL + q(0.07) + mq(q(0.03), sq(dq(cU, P.lipW))); return true; }, 30, q(0.2), q(0.3) + mq(q(0.2), P.oldT), q(0.02));
  // forehead lines: one, two over 70
  if (P.oldT > q(0.3)) {
    const n = P.oldT > q(0.7) ? 2 : 1;
    for (let i = 0; i < n; i++) { const vv = P.browV - q(0.15) - i * q(0.1); drawCurve((t) => { cU = mq(2 * t - Q, q(0.4) + i * q(0.1)); cV = vv + mq(q(0.015), cosF(a16Of(5 * cU + i * Q)) * 4) - mq(q(0.03), sq(cU)); return true; }, 36, q(0.3), q(0.45) + mq(q(0.2), P.oldT), q(0.02)); }
  }
  // the parting line on the hair surface
  if (hasParting(P.hair)) {
    const pth = P.partTh, vA = -P.craniumH + q(0.03), vB = M.hairLine(pth) + q(0.02);
    drawPlaced((t) => {
      const v = lerpQ(vA, vB, t), row = M.rowOf(v);
      M.basePoint(pth, row);
      const dx = M.bX, dy = mq(v - M.vCap, q(0.6)), dz = M.bZ, L = isqrt(dx * dx + dy * dy + dz * dz) || 1, h = M.hairThick(pth, v) + q(0.02);
      pose.xf(dx + idiv(h * dx, L), v + idiv(h * dy, L), dz + idiv(h * dz, L));
      return visibleAt((r) => r === HAIR, -Q);
    }, 30, q(0.45), q(0.45));
  }
  // the base of the nose, and the ridge line on the shadow side (not in near-profile, where the silhouette does it)
  drawCurve((t) => { cU = mq(mq(P.nostrilU, q(0.9)), 2 * t - Q); cV = P.noseBase - q(0.012) + mq(q(0.01), cosF(idiv((2 * t - Q) * PI16, Q)) * 4); return true; }, 16, q(0.3), q(0.3), q(0.02));
  { const sideS = absI(P.yaw) > degA(q(50)) ? 0 : -P.lightSide; if (sideS) drawCurve((t) => { const v = lerpQ(e + q(0.02), P.noseBase - q(0.08), t), tt = clampQ(dq(v - (e - q(0.03)), P.noseBase - q(0.07) - (e - q(0.03)))); cU = sideS * lerpQ(q(0.07), mq(P.tipW, q(0.95)), tt); cV = v; return true; }, 30, q(0.2), q(0.45), q(0.02)); }
  // glasses: a double contour around each eye, a bridge, the near temple arm
  if (P.glasses) {
    const rr = ew + q(0.07), hwG = kU(mq(q(0.32), wm)), rowE = M.rowOf(e);
    for (const side of [-1, 1]) for (const sc of [Q, q(1.07)]) {
      const pts: number[] = [], ws: number[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = idiv(A16 * i, 48), u = eyeU * side + mq(mq(mq(rr, q(1.15)), sc), cosF(a) * 4), v = e + q(0.01) + mq(mq(mq(rr, q(0.85)), sc), sinF(a) * 4);
        pose.xf(u, v, M.frontZ(u, M.rowOf(v)) + q(0.12));
        pts.push(tX, tY); ws.push(hwG);
      }
      prims.strokes.push({ pts, hw: ws, c: INK }); prims.stats.curves++;
    }
    {
      const pts: number[] = [], ws: number[] = [], uA = eyeU - mq(rr, q(1.15)), vB = e - q(0.02), rowB = M.rowOf(vB);
      for (let i = 0; i <= 8; i++) { const u = lerpQ(-uA, uA, idiv(i * Q, 8)); pose.xf(u, vB, M.frontZ(u, rowB) + q(0.12)); pts.push(tX, tY); ws.push(hwG); }
      prims.strokes.push({ pts, hw: ws, c: INK }); prims.stats.curves++;
    }
    {
      const side = sgn(P.yaw) || 1, pts: number[] = [], ws: number[] = [], wE = M.width(e), u0 = eyeU + mq(rr, q(1.15));
      for (let i = 0; i <= 10; i++) {
        const t = idiv(i * Q, 10), u = u0 * side + mq(t, side * (wE - u0 + q(0.02)));
        const au = absI(u), uc = (au < mq(wE, q(0.98)) ? au : mq(wE, q(0.98))) * sgn(u);
        const z = mq(M.frontZ(uc, rowE), Q - t) + mq(q(-0.05), t) + mq(q(0.1), Q - t);
        pose.xf(u, e - q(0.01) - mq(q(0.01), t), z);
        const gx = tX >> 6, gy = tY >> 6;
        if (gx >= 0 && gy >= 0 && gx < FW && gy < FH && F.reg[gy * FW + gx] !== BG && F.z[gy * FW + gx]! > tZ + q(0.08)) break;
        pts.push(tX, tY); ws.push(idiv(hwG * 8, 10));
      }
      if (pts.length >= 4) { prims.strokes.push({ pts, hw: ws, c: INK }); prims.stats.curves++; }
    }
  }
  // a thin necklace following the collarbone, on skin only
  if (P.necklace) {
    const shV = P.chin + P.neckLen;
    drawPlaced((t) => {
      const u = mq(2 * t - Q, q(0.55)), v = shV + q(0.06) + mq(q(0.14), Q - sq(dq(u, q(0.55))));
      pose.xfBody(u, v, torsoZ(P, shV, u, v) + q(0.03));
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx;
      return F.reg[q0] === SKIN && F.z[q0]! <= tZ + q(0.06);
    }, 36, q(0.3), q(0.3));
  }
  // a ribbon round a bun
  if (P.ribbon && hasBun(P.hair)) {
    const bc = bunCentre(P, M), rr = mq(P.bunR, q(1.02));
    drawPlaced((t) => {
      const a = idiv(A16 * t, Q);
      pose.xf(bc[0] + mq(rr, cosF(a) * 4), bc[1] + q(0.01), bc[2] + mq(rr, sinF(a) * 4));
      const gx = tX >> 6, gy = tY >> 6;
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) return false;
      const q0 = gy * FW + gx;
      return F.reg[q0] === HAIR && F.z[q0]! <= tZ + q(0.05);
    }, 40, q(0.45), q(0.45));
  }
}

/** Everything that is drawn, in raster units at the recorded size, from the plan alone. */
function compose(P: V11Plan): Prims {
  const M = makeModel(P), pose = makePose(P), inv = PALS[P.palette]!.inv === 1;
  const F = buildField(P, M, pose);
  shadeField(P, F, pose);
  const prims: Prims = { strokes: [], discs: [], rects: [], stats: { strokes: 0, stamps: 0, curves: 0 } };
  hatch(P, F, prims, inv);
  contours(P, F, M, pose, prims, inv);
  // the plate mark: a half-pixel line inset 16 (reference) px
  const m = kU(q(16)), w = U >> 1;
  prims.rects.push(m, m, AWU - m, m + w, m, AHU - m - w, AWU - m, AHU - m, m, m, m + w, AHU - m, AWU - m - w, m, AWU - m, AHU - m);
  return prims;
}
/** Stroke, stamp and feature-line counts for a plan (for review sheets). */
export function statsV11(plan: V11Plan): V11Stats { return compose(plan).stats; }

/* ── Drawing: the slot map at 2 x 2 samples a pixel, then the colours ──────────────────────────────
 * Raster units are 1/32 of a pixel; sample (X, Y) is the point (16X + 8, 16Y + 8). A span [xa, xb) covers
 * the samples X with 16X + 8 in it, [idiv(xa + 7, 16), idiv(xb + 7, 16)); a point at or past a rational
 * crossing N / D (D > 0) is the first X with (16X + 8) D >= N, idiv(N + 8D - 1, 16D). */

class Slots {
  readonly w: number;
  readonly h: number;
  readonly idx: Uint8Array;
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
    const exa: number[] = [], eya: number[] = [], exb: number[] = [], eyb: number[] = [], edir: number[] = [], ey0: number[] = [], ey1: number[] = [];
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
    const cx: number[] = [], cd: number[] = [];
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

function draw(plan: V11Plan, commitment: Uint8Array, S: number): Uint8Array {
  const W = V11_WIDTH * S, H = V11_HEIGHT * S, AWs = AW * S, AHs = AH * S;
  const pal = PALETTES_V11[plan.palette]!, tw = TWINS_V11[plan.palette]!;
  const prims = compose(plan);
  const cv = new Slots(S);
  cv.idx.fill(slot(0, 8));
  for (const g of prims.strokes) cv.stroke(g.pts, g.hw, g.c, S);
  const d = prims.discs;
  for (let i = 0; i < d.length; i += 4) cv.disc(d[i]! * S, d[i + 1]! * S, d[i + 2]! * S, d[i + 3]!);
  const r = prims.rects;
  for (let i = 0; i < r.length; i += 4) cv.rect(r[i]! * S, r[i + 1]! * S, r[i + 2]! * S, r[i + 3]! * S, INK);
  const idx = cv.idx, sw = cv.w, counts = new Int32Array(pal.length);
  // the centre snap: the four samples under each reading pixel take their majority index (paper on a tie)
  if (S === 1) {
    for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 16; tx++) {
      const x = tx * TW + RX, y = ty * TH + RY, a = 2 * y * sw + 2 * x, b = a + sw;
      counts.fill(0);
      counts[idx[a]! >> 4]!++; counts[idx[a + 1]! >> 4]!++; counts[idx[b]! >> 4]!++; counts[idx[b + 1]! >> 4]!++;
      let best = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
      const c = slot(best, 8);
      idx[a] = c; idx[a + 1] = c; idx[b] = c; idx[b + 1] = c;
    }
  }
  // the colours: the mean of the four samples' tinted colours plus the grain; a reading pixel is exact
  const nslot = pal.length * 16, pr = new Int32Array(nslot), pg = new Int32Array(nslot), pb = new Int32Array(nslot);
  for (let k = 0; k < pal.length; k++) for (let t = 0; t < 16; t++) {
    const o = TINTS[t]!, p = pal[k]!;
    pr[k * 16 + t] = Math.min(255, Math.max(0, p[0] + o)); pg[k * 16 + t] = Math.min(255, Math.max(0, p[1] + o)); pb[k * 16 + t] = Math.min(255, Math.max(0, p[2] + o));
  }
  const grain = grainTable(plan.palette);
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[4 * i] = FRAME[0]; px[4 * i + 1] = FRAME[1]; px[4 * i + 2] = FRAME[2]; px[4 * i + 3] = 255; }
  const bitAt = (x: number, y: number): number => { const k = (idiv(y, TH) << 4) + idiv(x, TW); return (commitment[k >> 3]! >> (7 - (k & 7))) & 1; };
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < AHs; y++) {
    const readingRow = S === 1 && y % TH === RY, r0 = 2 * y * sw, r1 = r0 + sw, o = (OFF * S + y) * W + OFF * S, gy = idiv(y, S) * AW;
    for (let x = 0; x < AWs; x++) {
      const a = r0 + 2 * x, b = r1 + 2 * x, k0 = idx[a]!, k1 = idx[a + 1]!, k2 = idx[b]!, k3 = idx[b + 1]!;
      const i = (o + x) * 4;
      if (readingRow && x % TW === RX) {
        counts.fill(0);
        counts[k0 >> 4]!++; counts[k1 >> 4]!++; counts[k2 >> 4]!++; counts[k3 >> 4]!++;
        let best = 0;
        for (let k = 1; k < counts.length; k++) if (counts[k]! > counts[best]!) best = k;
        const col = (bitAt(x, y) ? tw : pal)[best]!;
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
        continue;
      }
      const g = grain[gy + idiv(x, S)]!;
      px[i] = clamp((((pr[k0]! + pr[k1]! + pr[k2]! + pr[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
      px[i + 1] = clamp((((pg[k0]! + pg[k1]! + pg[k2]! + pg[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
      px[i + 2] = clamp((((pb[k0]! + pb[k1]! + pb[k2]! + pb[k3]! + 2) >> 2) * 256 + g + 128) >> 8);
    }
  }
  return px;
}

export function renderV11(plan: V11Plan, commitment: Uint8Array): Uint8Array { return draw(plan, commitment, 1); }
/** The same picture at S times the resolution, for print: a redrawing, not the recorded file. */
export function renderV11At(plan: V11Plan, commitment: Uint8Array, S: number): Uint8Array { return draw(plan, commitment, S); }

/** Read the code from the art alone: the 256 reading pixels, their palette, and whether each is a twin. */
export function decodeV11(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== V11_WIDTH || height !== V11_HEIGHT || px.length !== width * height * 4) return null;
  const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const read: RGB[] = [];
  for (let k = 0; k < 256; k++) {
    const x = OFF + TW * (k & 15) + RX, y = OFF + TH * (k >> 4) + RY;
    const i = (y * width + x) * 4;
    read.push([px[i]!, px[i + 1]!, px[i + 2]!]);
  }
  for (let p = 0; p < PALETTES_V11.length; p++) {
    const out = new Uint8Array(32);
    let ok = true;
    for (let k = 0; k < 256 && ok; k++) {
      if (TWINS_V11[p]!.some((c) => same(c, read[k]!))) out[k >> 3]! |= 1 << (7 - (k & 7));
      else if (!PALETTES_V11[p]!.some((c) => same(c, read[k]!))) ok = false;
    }
    if (ok) return out;
  }
  return null;
}
