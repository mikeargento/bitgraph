// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/15 (2026-10-09): an abstract oil painting, square, 1800 x 1800, every decision drawn from the commitment.
 * The integer port of the paint-engine sketch the operator approved (round 3, with round 4's subtle canvas): a bristle
 * brush stamped along a path, wet paint picked up and dragged, a lit relief on linen, a painter's day of choices and the
 * composition rules that place the marks. Integer-only and deterministic: the plan holds only integers, the raster is
 * fixed point, and no transcendental function of the platform is used.
 *
 * The plan (planV15): a labelled SHA-256 stream over the commitment (as versions 10 and 11) decides the painter's day
 * (composition strategy, weave, ground, edge, underpainting, palette, value key, medium, sessions, temperament, the tool
 * vocabulary, process, drips, spatter) and the composition (grid, focal points, flow, the masses with their outlines,
 * the reserved open shapes and band windows, the balance search, the bites, every field's seed), and the painter's own
 * 32-bit seed. Every mark is then chosen while painting, from that seed, looking at the canvas as it goes (the open
 * space measured each round, the paint under a small mark, the local layer count, the darks at the focal point), as
 * the sketch's painter does. Two commitments with the same plan differ only in the 256 reading pixels.
 *
 * The engine (makeEasel): the sketch's, in fixed point. A brush is a row of bristles across a flat, one a raster pixel,
 * each with its own offset, clumped load, colour streaks or a side load, groove height, contact threshold, late
 * touch-down and drain; the flat twists, varies in width, splays in clumps on turns and as it lifts, hooks at the end,
 * and the edge bristles fray in and out. Each bristle is splatted bilinearly into a stroke buffer (weight, load, colour,
 * height), composited once when the stroke ends against the linen's tooth (dry brush catches the thread tops), with the
 * knife, rag, scratch and glaze operations, the half-cover glaze and the over-mixing guard. Bristles pick up wet paint
 * (wetness falls with the stroke clock; dried between sessions) and mix it in by a geometric mean of the colours (in
 * their logarithm), or carry it a long way in a second reservoir (the drags). Sponges, pours, spatter, specks, drips,
 * stray bristles, sgraffito, finger smudges and the taped border are the sketch's too.
 *
 * The canvas: a plain linen weave of irregular warp and weft threads (irregular pitch, wander at three scales, slubs,
 * per-thread tone fading along each thread, a raised-cosine profile, a slight skew), built once per weave and scale and
 * kept: it does not depend on the painting, so its slow fields are sampled on a 2 or 4 px grid and interpolated. Round
 * 4 (the subtle canvas): the threads show where paint is thin or dry (dry-brush breaks, scumbles, washes), measured by
 * the paint amount blurred over about 3 px; on bare primed ground the weave fades to an almost smooth surface with a
 * faint soft tooth (the blurred weave and the gesso's grain, at 40 percent), and the threads' colour (tone and gap
 * shading) comes back only through thin paint. Raw linen keeps its whole weave.
 *
 * The finish: the relief (paint height plus the weave, damped as paint thickens) is blurred lightly and lit from the
 * top left: Lambert shading with soft shadows, cavities darkened, cliffs tamed, a sheen by the paint's gloss and
 * thickness; then the photographed light: an uneven soft light, a vignette, grime at the very edge, staples on a
 * stapled turn.
 *
 * Units: ONE = 4096 (Q12) for fractions; Q = 65536 (Q16) for positions as a fraction of the side and for noise lattice
 * coordinates; PX = 4096 path units a pixel of the 1200 px layout; A = 16384 angle units a turn (the SIN table);
 * exp and ln from version 11's tables; isqrt. Raster positions are Q8 pixels; the scale S8 (raster px a layout px,
 * Q8) is 384 for the recorded file.
 *
 * Size and speed: the layout is 1200 px; the recorded picture is drawn at 1.5 times, 1800 x 1800. At 2400 x 2400 (the
 * sketch's internal resolution) a painting took a median of 7.7 s on an Apple M3 after every speed-up that leaves the
 * look alone; at 1800 the median is about 5 s. The stamps stay as dense as the sketch's (about one raster pixel apart:
 * sparser deposits measurably roughened the paint), so the brush's cost is the look's.
 *
 * Other scales (renderV15At): the painter decides at the recorded scale, keeping its score (every mark with its resolved
 * parameters and path), and the score is laid again on a canvas of the other scale, mark for mark. The print is the
 * recorded scale (V15_PRINT_LAYOUT_SCALE): a larger one needs the whole larger canvas in memory.
 *
 * The file: version 15 writes its own PNG encoding (png-deflate-v15.ts: the best filter per row, a full deflate with
 * dynamic Huffman codes, in integer JavaScript), about 4 to 6 MB a painting where the fixed deflate of earlier versions
 * left about 9 MB; still a pure function of the pixels.
 *
 * The code: a hidden grid of 16 x 16 tiles over version 11's layout scaled to 1800 (the tile centres at
 * 1.5 x (67.5 + 71 c)); tile k (row-major) carries bit k, most significant bit of byte 0 first. A painting has no
 * palette colours and twins, so the bit is the parity of R + G + B at the tile's reading pixel: the pixel keeps the
 * exact colour the lit paint gave it when that parity already is the bit, and otherwise the lowest bit of its blue is
 * flipped, its one-level twin. decodeV15 reads the 256 parities back from the picture alone.
 */
import { sha256 } from "@noble/hashes/sha256";
import { SIN_V6 as SIN, idiv } from "./commitment-art-v6.ts";

const LABEL = "bitgraph-art/15";
/** The recorded scale: the composition is laid out on a 1200 px canvas and painted at twice that. */
const RS = 1.5;
export const V15_WIDTH = 1200 * RS, V15_HEIGHT = 1200 * RS;
/**
 * The print's scale of the 1200 px layout: the recorded scale. A larger drawing must paint the whole canvas at that size
 * (the paint is wet: a stroke picks up and drags what lies anywhere along its path, so no band or tile of the canvas
 * can be painted without the rest), about 450 to 520 MB at 3000 x 3000, which phones and some laptops cannot hold; at
 * 1800 the print is the painting as recorded, in about the memory of drawing it (about 130 MB of canvas).
 */
export const V15_PRINT_LAYOUT_SCALE = 1.5;

/* ── Integer arithmetic ──────────────────────────────────────────────────────────────────────────────
 * Every quantity is an integer. Units: ONE = 4096 (Q12) for fractions (colour, alpha, load, pressure, wetness,
 * gloss, tooth, heights); Q = 65536 (Q16) for canvas positions as a fraction of the side and for noise lattice
 * coordinates; PX = 4096 path units per pixel of the 1200 px layout; A = 16384 angle units a turn. Products are
 * kept under 2^53, so a product divided by a power of two and floored is exact, and so is every Math.floor here.
 * Constants are written as decimals and converted once with Math.round (q12, q16, ra), the same integers on every
 * machine. No Math.sin, cos, exp, pow or sqrt: the SIN table, the exp and ln tables below, and isqrt. */
const ONE = 4096, Q = 65536, PX = 4096, A = 16384, HALF_A = 8192, QUARTER_A = 4096;
const q12 = (x: number): number => Math.round(x * ONE);
const q16 = (x: number): number => Math.round(x * Q);
/** Radians to angle units. */
const ra = (rad: number): number => Math.round((rad * A) / (2 * Math.PI));
const f12 = (a: number, b: number): number => Math.floor((a * b) / 4096);
const f16 = (a: number, b: number): number => Math.floor((a * b) / 65536);
const cl = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const c1 = (v: number): number => (v < 0 ? 0 : v > ONE ? ONE : v);
const absI = (v: number): number => (v < 0 ? -v : v);
const minI = (a: number, b: number): number => (a < b ? a : b);
const maxI = (a: number, b: number): number => (a > b ? a : b);
/** smoothstep of a Q12 value (clamped to [0, 1] first), Q12. */
const sm = (t: number): number => { t = t < 0 ? 0 : t > ONE ? ONE : t; return f12(f12(t, t), 3 * ONE - 2 * t); };
/** smoothstep((v - lo) / w), all Q12. */
const smr = (v: number, lo: number, w: number): number => sm(idiv((v - lo) * ONE, w));
const lerp = (a: number, b: number, t: number): number => a + f12(b - a, t);

function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}
/** sqrt of a Q12 value, Q12. */
const sqrt12 = (x: number): number => (x <= 0 ? 0 : isqrt(x * ONE));
const hypot = (dx: number, dy: number): number => isqrt(dx * dx + dy * dy);

/* exp(-t) for t in [0, 16] in steps of 1/64, and ln(x) for x in (0, 1] in steps of 1/1024, Q16 (version 11's tables). */
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
/** ln of a Q12 colour value (41..4096), Q16, and exp back to Q12 at 1/1024 steps of the log: the brush's pigment mixing. */
const LN12 = (() => { const t = new Int32Array(ONE + 1); for (let i = 0; i <= ONE; i++) t[i] = lnQ(maxI(41, i) << 4); return t; })();
const EXPT = (() => { const t = new Uint16Array(16385); for (let i = 0; i <= 16384; i++) t[i] = expQ(-(i << 6)) >> 4; return t; })();
/** exp(-x) for x >= 0 in Q12, Q12. */
const expN12 = (x: number): number => expQ(-x * 16) >> 4;
/** x^n for x in [0, 1] Q12, n Q12, Q12. */
function pow12(x: number, n: number): number {
  if (x <= 0) return 0;
  if (x >= ONE) return ONE;
  return expQ(f12(lnQ(x << 4), n)) >> 4;
}

/* Angles: A = 16384 a turn. sin and cos are Q14, linear between the 1024 entries of the SIN table. */
function sinA(a: number): number { const i = (a >> 4) & 1023, f = a & 15; const s0 = SIN[i]!; return s0 + (((SIN[(i + 1) & 1023]! - s0) * f) >> 4); }
const cosA = (a: number): number => sinA(a + QUARTER_A);
/** The sketch's wrapHalfPi: to [-A/4, A/4], modulo a half turn. */
function wrapHalf(a: number): number { a = a % HALF_A; if (a > QUARTER_A) a -= HALF_A; if (a < -QUARTER_A) a += HALF_A; return a; }
/** atan2 in angle units: a binary search over sinA within the octant. */
function atan2A(dy: number, dx: number): number {
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  if (ax === 0 && ay === 0) return 0;
  const oct = (num: number, den: number): number => { // the largest a in [0, A/8] with tan a <= num / den
    let lo = 0, hi = 2048;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sinA(mid) * den <= cosA(mid) * num) lo = mid; else hi = mid - 1; }
    return lo;
  };
  let a = ay <= ax ? oct(ay, ax) : QUARTER_A - oct(ax, ay);
  if (dx < 0) a = HALF_A - a;
  if (dy < 0) a = -a;
  return a;
}
/** Radians (as a Q12 number) of an angle, for the few places the sketch uses an angle as a length. */
const radOf = (a: number): number => idiv(a * 25736, A); // 2 pi in Q12 = 25736
/** sin(pi t) for t in [0, 1] Q12, Q12. */
const sinPi = (t: number): number => sinA(idiv(t * HALF_A, ONE)) >> 2;

/* ── Noise: the sketch's integer hash and value noise, the smoothstep fixed point ─────────────────────────────── */
function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return h >>> 16; // the top 16 bits: the sketch's value in [0, 1) as Q16
}
/** smoothstep of a Q16 fraction (its top 12 bits), Q15. */
const SMT = (() => { const t = new Int32Array(4097); for (let i = 0; i <= 4096; i++) t[i] = Math.floor((i * i * (12288 - 2 * i)) / 2097152); return t; })();
/** Value noise at lattice coordinates (Q16), in [0, 65535] (Q16). */
function vn(x: number, y: number, s: number): number {
  const ix = x >> 16, iy = y >> 16, fx = SMT[(x & 65535) >> 4]!, fy = SMT[(y & 65535) >> 4]!;
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  const ab = a + (((b - a) * fx) >> 15), cd = c + (((d - c) * fx) >> 15);
  return ab + (((cd - ab) * fy) >> 15);
}
const C53 = q16(5.3), C17 = q16(1.7);
/** fbm with rotated octaves (the sketch's), Q16 in and out. */
function fbm(x: number, y: number, s: number, oct: number): number {
  let v = 0, a = 4, t = 0;
  for (let o = 0; o < oct; o++) {
    v += a * vn(x, y, s + o * 17); t += a;
    const nx = Math.floor((x * 8 - y * 6) / 5) + C53, ny = Math.floor((x * 6 + y * 8) / 5) + C17; x = nx; y = ny; a >>= 1;
  }
  return Math.floor(v / t);
}
const TF_C: number[] = [], TF_S: number[] = [];
for (let k = 0; k < 7; k++) { const a = ra(0.5 + k * 0.13); TF_C.push(cosA(a)); TF_S.push(sinA(a)); }
const C031 = q16(0.31), C77 = q16(7.7), C33 = q16(3.3);
/** Texture noise: rotated off the lattice axes and domain-warped (the sketch's tfbm), Q16. */
function tfbm(x: number, y: number, s: number, oct: number): number {
  const c = TF_C[s % 7]!, sn = TF_S[s % 7]!;
  let xr = Math.floor((x * c - y * sn) / 16384), yr = Math.floor((x * sn + y * c) / 16384);
  const ux = f16(xr, C031), uy = f16(yr, C031);
  const wx = vn(ux + C77, uy, s + 101) - 32768, wy = vn(ux, uy + C33, s + 102) - 32768;
  xr += Math.floor((wx * 13) / 10); yr += Math.floor((wy * 13) / 10);
  return fbm(xr, yr, s, oct);
}
const C037 = q16(0.37);
const noise1 = (x: number, s: number): number => vn(x, C037, s);
/** smoothstep of t in [0, 4096] (Q12), Q12. */
const SM12 = (() => { const t = new Int32Array(ONE + 1); for (let i = 0; i <= ONE; i++) t[i] = (((i * i) >> 12) * (3 * ONE - 2 * i)) >> 12; return t; })();
/** Q16 noise to Q12. */
const n12 = (v: number): number => v >> 4;

/* ── Colour, Q12 RGB ─────────────────────────────────────────────────────────────────────────────────────────── */
type C3 = [number, number, number];
const lum = (c: readonly number[]): number => (871 * c[0]! + 2929 * c[1]! + 296 * c[2]!) >> 12;
const satOf = (r: number, g: number, b: number): number => { const mx = r > g ? (r > b ? r : b) : g > b ? g : b, mn = r < g ? (r < b ? r : b) : g < b ? g : b; return mx > 0 ? idiv((mx - mn) * ONE, mx) : 0; };
const sat = (c: readonly number[]): number => satOf(c[0]!, c[1]!, c[2]!);
const vweight = (c: readonly number[]): number => { const d = ONE - lum(c), s = sat(c); return f12(d, q12(0.6) + f12(q12(0.4), s)) + f12(q12(0.25), s); };
function rgb2hsv(c: readonly number[]): C3 {
  const r = c[0]!, g = c[1]!, b = c[2]!;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    let h6 = mx === r ? idiv((g - b) * ONE, d) : mx === g ? idiv((b - r) * ONE, d) + 2 * ONE : idiv((r - g) * ONE, d) + 4 * ONE;
    h6 = idiv(h6, 6); if (h6 < 0) h6 += ONE; h = h6;
  }
  return [h, mx > 0 ? idiv(d * ONE, mx) : 0, mx];
}
function hsv2rgb(hsv: readonly number[]): C3 {
  const h = (((hsv[0]! % ONE) + ONE) % ONE) * 6, s = hsv[1]!, v = hsv[2]!;
  const i = h >> 12, f = h & 4095;
  const p = f12(v, ONE - s), qq = f12(v, ONE - f12(f, s)), t = f12(v, ONE - f12(ONE - f, s));
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [qq, v, p];
    case 2: return [p, v, t];
    case 3: return [p, qq, v];
    case 4: return [t, p, v];
    default: return [v, p, qq];
  }
}
const lerp3 = (a: readonly number[], b: readonly number[], t: number): C3 => [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)];
const WHITE: C3 = [ONE, ONE, ONE];
const tint = (c: readonly number[], f: number): C3 => lerp3(c, WHITE, f);
const SHADE_K: C3 = [q12(0.03), q12(0.03), q12(0.05)];
const shade = (c: readonly number[], f: number): C3 => lerp3(c, SHADE_K, f);
const col = (r: number, g: number, b: number): C3 => [q12(r), q12(g), q12(b)];
/** Loud mid greens are harsh in oil: pulled toward sap green and emerald (the sketch's tameGreen). */
function tameGreen(c: C3): C3 {
  let [h, s, v] = rgb2hsv(c);
  const w = f12(smr(h, q12(0.17), q12(0.05)), smr(q12(0.5) - h, 0, q12(0.05)));
  if (w <= 0 || s < q12(0.4) || v < q12(0.45)) return c;
  const tgt = h < q12(0.32) ? q12(0.25) : q12(0.42);
  h = lerp(h, tgt, f12(q12(0.55), w)); v = lerp(v, minI(v, q12(0.5)), w); s = lerp(s, minI(s, q12(0.72)), w);
  return hsv2rgb([h, s, v]);
}
/** A pigment-like colour from a hue (Q12 of a turn) and saturation: yellows light, blues and violets deep. */
function pigment(h: number, s: number): C3 {
  h = ((h % ONE) + ONE) % ONE;
  const dh = (a: number): number => { const d = absI(h - a); return minI(d, ONE - d); };
  const g = (d: number, den1000: number): number => expQ(-Math.floor((d * d * 16 * 1000) / den1000)) >> 4; // exp(-d^2 / (den / 1000))
  const yel = g(dh(q12(0.14)), 6), blu = g(dh(q12(0.66)), 10);
  return hsv2rgb([h, s, cl(q12(0.72) + f12(q12(0.26), yel) - f12(q12(0.22), blu), q12(0.35), q12(0.98))]);
}
const compOf = (c: C3): C3 => { const h = rgb2hsv(c); return hsv2rgb([(h[0] + ONE / 2) % ONE, h[1], h[2]]); };

/* ── Randomness ─────────────────────────────────────────────────────────────────────────────────────────────── */
/** Draws over a source of 32-bit words: the SHA-256 stream for the plan, sfc32 (seeded from the plan) for the painter. */
class Rand {
  readonly u32: () => number;
  constructor(src: () => number) { this.u32 = src; }
  /** An integer in [lo, hi) (any fixed-point scale), uniform. */
  r(lo: number, hi: number): number {
    const span = hi - lo;
    if (span > -2097152 && span < 2097152) return lo + Math.floor((this.u32() * span) / 4294967296);
    return lo + Math.floor(((this.u32() >>> 11) * span) / 2097152);
  }
  /** Q12 in [a, b) from decimals. */
  f(a: number, b: number): number { return this.r(q12(a), q12(b)); }
  /** Angle units in [a, b) from radians. */
  ang(a: number, b: number): number { return this.r(ra(a), ra(b)); }
  /** Q16 in [a, b) from decimals. */
  q(a: number, b: number): number { return this.r(q16(a), q16(b)); }
  u(): number { return this.u32() >>> 20; } // Q12 in [0, 1)
  i(a: number, b: number): number { return a + Math.floor((this.u32() * (b - a + 1)) / 4294967296); }
  /** True with probability p (Q12). */
  ch(p: number): boolean { return this.u32() >>> 20 < p; }
  pick<T>(a: readonly T[]): T { return a[Math.floor((this.u32() * a.length) / 4294967296)]!; }
  /** A standard normal, Q12: four uniforms summed (Irwin-Hall), scaled to unit variance. */
  g(): number { const s = (this.u32() >>> 20) + (this.u32() >>> 20) + (this.u32() >>> 20) + (this.u32() >>> 20); return ((s - 8190) * 7094) >> 12; }
  /** An index by weights (any non-negative integers). */
  w(ws: readonly number[]): number {
    let tot = 0; for (const x of ws) tot += x;
    if (tot <= 0) return ws.length - 1;
    let t = this.r(0, tot) + 1;
    for (let i = 0; i < ws.length; i++) { t -= ws[i]!; if (t <= 0) return i; }
    return ws.length - 1;
  }
  int16(): number { return this.u32() & 0xffff; }
}
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return t >>> 0;
  };
}
/** A 32-bit mix (for seeding). */
function mix32(x: number): number { x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); return (x ^ (x >>> 16)) >>> 0; }
function seeded(seed: number, salt: number): Rand {
  const s0 = mix32(seed ^ Math.imul(salt, 0x9e3779b1)), s1 = mix32(s0 + 0x6d2b79f5), s2 = mix32(s1 ^ salt), s3 = mix32(s2 + 0x2545f491);
  const f = sfc32(s0, s1, s2, s3);
  for (let i = 0; i < 12; i++) f();
  return new Rand(f);
}

/** The stream: SHA-256 blocks over the label, the purpose and the commitment, read 4 bytes at a time (as version 11). */
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
}

/* ── The painter's palettes ────────────────────────────────────────────────────────────────────────────────────
 * Five reference palettes (roles: D dominant, S secondary, A accent, K dark, P pale), Q12 RGB; part of this version,
 * never reorder or edit. A painting uses one of them (55 percent) or a harmony built from a hue. */
interface Pal { D: C3[]; S: C3[]; A: C3[]; K: C3; P: C3 }
const REF_PALETTES_V15: readonly Pal[] = [
  { D: [col(0.11, 0.16, 0.58), col(0.16, 0.22, 0.66)], S: [col(0.42, 0.55, 0.86), col(0.55, 0.66, 0.9)], A: [col(0.95, 0.45, 0.1), col(0.98, 0.56, 0.16)], K: col(0.06, 0.07, 0.17), P: col(0.95, 0.95, 0.93) },
  { D: [col(0.1, 0.15, 0.56), col(0.15, 0.22, 0.64)], S: [col(0.0, 0.5, 0.36), col(0.08, 0.3, 0.2)], A: [col(0.82, 0.12, 0.1)], K: col(0.04, 0.12, 0.09), P: col(0.94, 0.95, 0.94) },
  { D: [col(0.98, 0.79, 0.1), col(0.97, 0.7, 0.06)], S: [col(0.92, 0.5, 0.08), col(0.36, 0.48, 0.16)], A: [col(0.46, 0.14, 0.42), col(0.36, 0.12, 0.4)], K: col(0.13, 0.2, 0.1), P: col(0.95, 0.94, 0.9) },
  { D: [col(0.62, 0.06, 0.15), col(0.55, 0.05, 0.12)], S: [col(0.13, 0.28, 0.72), col(0.42, 0.44, 0.24)], A: [col(0.58, 0.2, 0.7)], K: col(0.09, 0.06, 0.1), P: col(0.93, 0.93, 0.92) },
  { D: [col(0.16, 0.24, 0.66), col(0.26, 0.22, 0.6)], S: [col(0.42, 0.26, 0.64), col(0.55, 0.45, 0.78)], A: [col(0.84, 0.14, 0.55)], K: col(0.04, 0.04, 0.06), P: col(0.95, 0.91, 0.79) },
];
export const REF_PALETTE_NAMES_V15: readonly string[] = ["ultramarine and orange", "ultramarine, emerald, dark green and red", "cadmium yellow, orange, sap green and violet", "crimson, cobalt, violet and olive", "blues, violets, magenta, black and cream"];
export const HARMONY_NAMES_V15: readonly string[] = ["analogous", "complementary", "split-complementary", "triadic"];
export const STRATEGY_NAMES_V15: readonly string[] = ["field", "burst", "edge-weighted", "horizon band", "columns", "diagonal sweep", "two masses in conversation", "quiet with one loud event"];
export const GROUND_NAMES_V15: readonly string[] = ["primed white", "warm white", "warm grey", "ochre", "pale pink", "raw linen"];
const GROUND_COLS: readonly C3[] = [col(0.94, 0.93, 0.9), col(0.935, 0.915, 0.865), col(0.8, 0.78, 0.74), col(0.84, 0.74, 0.55), col(0.93, 0.85, 0.82), col(0.74, 0.65, 0.52)];
const SURPRISE_COLS: readonly C3[] = [col(0.97, 0.6, 0.72), col(0.99, 0.94, 0.38), col(0.99, 0.99, 0.97), col(0.2, 0.6, 0.85), col(0.92, 0.25, 0.1)];
const PALE_CHOICES: readonly C3[] = [col(0.95, 0.95, 0.93), col(0.95, 0.92, 0.84), col(0.92, 0.93, 0.95)];

/* Enumerations (indices in the plan). */
const ST_FIELD = 0, ST_BURST = 1, ST_EDGE = 2, ST_BAND = 3, ST_COLUMNS = 4, ST_DIAGONAL = 5, ST_CONVERSATION = 6, ST_QUIET = 7;
const K_PRIMARY = 0, K_SECONDARY = 1, K_BAND = 2, K_LEG = 3, K_COLUMN = 4, K_FIELD = 5, K_LOBE = 6, K_BRIDGE = 7, K_DIAG = 8, K_ECHO = 9, K_CALM = 10, K_BUD = 11;
const O_TOP = 0, O_BOTTOM = 1, O_ELL = 2;
const FLOW_HORIZONTAL = 0, FLOW_VERTICAL = 1, FLOW_DIAGONAL = 2, FLOW_RADIAL = 3, FLOW_TOWARD = 4;
const KEY_LIGHT = 1, KEY_DARK = 2; // 0 is the full range
const EDGE_RAW = 1, EDGE_TAPED = 2, EDGE_STAPLES = 3; // 0 is a clean edge
const UNDER_IMPRIMATURA = 1, UNDER_BLOCKIN = 2; // 0 is none

export interface V15Mass {
  /** Centre and radii, Q16 of the side. */
  x: number; y: number; rx: number; ry: number;
  /** 0 dominant, 1 secondary, 2 accent. */
  role: number;
  /** Density, paleness and greying, Q12. */
  dens: number; pale: number; grey: number;
  kind: number;
  /** Tilt (angle units); when hasDir, the marks' own direction is dir. */
  rot: number; hasDir: number; dir: number;
  /** Q12 share of marks thrown radially (bursts), 0 for none. */
  radial: number;
  loop: number;
  /** The outline's noise seed, lump amplitude and spike amplitude (Q12). */
  lumpS: number; lumpA: number; spike: number;
}
export interface V15Open { kind: number; x: number; y: number; rx: number; ry: number; soft: number; scumble: number; inner: number }
export interface V15Plan {
  /** Index into STRATEGY_NAMES_V15. */
  strategy: number;
  weave: number; ground: number; edge: number; underpainting: number;
  /** Reference palette index, or -1 for a harmony (harmony = HARMONY_NAMES_V15 index, hue in degrees). */
  palette: number; harmony: number; hue: number;
  key: number; swapDS: number;
  /** Surprise accent: -1 none, else an index into the surprise colours (pink, lemon, white highlight, cerulean, vermilion). */
  surprise: number;
  /** Medium, Q12 (glazes a count). */
  impasto: number; washes: number; glazes: number; fat: number;
  sessions: number;
  /** Temperament, Q12; hand 1 = right. */
  speed: number; pressure: number; hesitation: number; hand: number; energy: number; reach: number; curl: number;
  /** Tool weights, Q12: flat, round, rigger, fan, knife, mop, sponge, dab, tap, flick, scribble, loop, zigzag. */
  tools: number[];
  /** Process: wipes, sgraffito, smudges, pours, corrections, scrape back (0/1). */
  process: number[];
  drips: number; spatter: number;
  gridKind: number; openTarget: number;
  /** Raw or stapled edge width (Q16 of the side). */
  edgeW: number;
  /** The colours, Q12 RGB: dominant, secondary pair, accent, dark, pale. */
  cD: number[]; cS: number[][]; cA: number[]; cK: number[]; cP: number[];
  /** Composition: grid lines (Q16), the chosen intersections, focal points (Q16), flow kind and angle. */
  grid: number[]; ix: number; iy: number; focal: number[][]; flowKind: number; flowA: number;
  masses: V15Mass[]; opens: V15Open[];
  bites: number[][];
  /** Seeds (16-bit) and field parameters: open-shape edge, energy, colour zones, direction field, porosity, margins, windows, silhouette, canvas. */
  oSeed: number; eSeed: number; cSeed: number; cScale: number; dSeed: number; dTurn: number; dScale: number;
  pSeed: number; porosity: number; pDark: number; pWhite: number; mSeed: number; wSeed: number;
  silSeed: number; silS: number; silThr: number; silA: number; silK: number; silWarp: number;
  wBig: number; nseed: number;
  /** The painter's own seed (32-bit): every mark, chosen while painting, comes from it. */
  seed: number;
}

/** Weighted key from decimal weights (scaled to integers once). */
const wts = (ws: readonly number[]): number[] => ws.map((x) => Math.round(x * 1000));

function harmonyPalette(rng: Rand): { pal: Pal; kind: number; hue: number } {
  const kind = rng.i(0, 3);
  const h0 = rng.u();
  const offs = kind === 0 ? [0, rng.pick([q12(0.07), q12(-0.07), q12(0.1), q12(-0.1)]), q12(0.5) + rng.f(-0.04, 0.04)]
    : kind === 1 ? [0, q12(0.5), rng.pick([q12(0.25), q12(0.75), q12(0.04)])]
    : kind === 2 ? [0, q12(0.42), q12(0.58)] : [0, 1365, 2731];
  const sD = rng.f(0.62, 0.92), sS = rng.f(0.5, 0.85);
  const D = [pigment(h0, sD), pigment(h0 + rng.f(-0.03, 0.03), f12(sD, q12(0.9)))];
  const S = [pigment(h0 + offs[1]!, sS), tint(pigment(h0 + offs[1]! + rng.f(-0.04, 0.04), sS), rng.f(0.15, 0.4))];
  const A2 = [pigment(h0 + offs[2]!, rng.f(0.75, 0.98))];
  const K = shade(lerp3(D[0]!, pigment(h0 + ONE / 2, q12(0.7)), q12(0.45)), q12(0.86));
  const P = rng.pick(PALE_CHOICES);
  return { pal: { D, S, A: A2, K, P }, kind, hue: Math.floor((h0 * 360 + 2048) / 4096) };
}

const PI16 = q16(Math.PI);
const tintC = (c: readonly number[], f: number): C3 => tint(c, f);
function massColourOf(P: { cD: number[]; cS: number[][]; cA: number[] }, m: V15Mass): number[] { return m.role === 0 ? P.cD : m.role === 1 ? P.cS[0]! : P.cA; }
/** Visual weight of a mass, Q16: area x density x vweight. */
function massW(P: { cD: number[]; cS: number[][]; cA: number[] }, m: V15Mass): number {
  const area = f16(f16(PI16, m.rx), m.ry);
  return f12(f12(area, m.dens), vweight(tintC(massColourOf(P, m), m.pale)));
}

/** The canonical plan: the painter's day and the composition, every decision read from the commitment's stream. */
export function planV15(commitment: Uint8Array): V15Plan {
  const st = new Stream(commitment);
  const rng = new Rand(() => st.u32());
  const strategy = rng.w(wts([1, 0.8, 0.6, 1, 0.9, 0.8, 0.8, 0.6]));
  const weave = rng.w(wts([1, 1.4, 0.8]));
  const ground = rng.w(wts([2.2, 1.6, 0.5, 0.35, 0.35, 0.25]));
  const edge = rng.w(wts([3, 0.45, 0.5, 0.3]));
  const underpainting = rng.w(wts([1.2, 0.7, 1]));
  let palette = -1, harmony = -1, hue = 0, pal: Pal;
  if (rng.ch(q12(0.55))) { palette = rng.i(0, 4); pal = REF_PALETTES_V15[palette]!; } else { const h = harmonyPalette(rng); pal = h.pal; harmony = h.kind; hue = h.hue; }
  const key = rng.w(wts([2, 1, 0.6]));
  const swapDS = rng.ch(q12(0.2)) ? 1 : 0;
  const surprise = rng.ch(q12(0.35)) ? rng.i(0, 4) : -1;
  const impasto = rng.f(0.55, 1.7), washes = rng.f(0.05, 0.4), glazes = rng.ch(q12(0.35)) ? rng.i(2, 6) : 0, fat = rng.f(0.25, 1);
  const sessions = rng.w(wts([0.8, 1.2, 0.6])) + 1;
  const speed = rng.u(), pressure = rng.f(0.75, 1.1), hesitation = rng.ch(q12(0.5)) ? rng.f(0.04, 0.2) : 0, hand = rng.ch(q12(0.85)) ? 1 : 0;
  const energy = rng.ch(q12(0.35)) ? rng.f(0.05, 0.3) : rng.f(0.4, 1), reach = rng.f(0.7, 1.7), curl = rng.f(0.5, 2.6);
  const tools = [rng.f(0.8, 1.6), rng.f(0.3, 1.1), rng.f(0, 0.5), rng.ch(q12(0.5)) ? rng.f(0.1, 0.5) : 0, rng.ch(q12(0.55)) ? rng.f(0.1, 0.6) : 0,
    rng.f(0, 0.5), rng.ch(q12(0.25)) ? rng.f(0.1, 0.4) : 0, rng.f(0.15, 0.6), rng.ch(q12(0.5)) ? rng.f(0.1, 0.5) : 0,
    rng.f(0.1, 0.5), rng.ch(q12(0.4)) ? rng.f(0, 0.3) : 0, rng.f(0, 0.4), rng.ch(q12(0.4)) ? rng.f(0, 0.3) : 0];
  const process = [rng.ch(q12(0.45)) ? rng.i(1, 4) : 0, rng.ch(q12(0.35)) ? rng.i(3, 12) : 0, rng.i(0, 3), rng.ch(q12(0.18)) ? rng.i(1, 2) : 0, rng.i(0, 4), rng.ch(q12(0.3)) ? 1 : 0];
  const drips = rng.w(wts([1, 1.4, 0.8]));
  const spatter = rng.w(wts([0.3, 1.2, 0.6]));
  const gridKind = rng.ch(q12(0.5)) ? 0 : 1;
  const openTarget = strategy === ST_QUIET ? rng.f(0.41, 0.45) : strategy === ST_BAND ? rng.f(0.47, 0.53) : rng.f(0.32, 0.44);
  const edgeW = edge === EDGE_RAW ? rng.q(0.004, 0.011) : edge === EDGE_STAPLES ? rng.q(0.01, 0.016) : 0;
  const nseed = rng.int16();

  const cD = swapDS ? pal.S[0]! : rng.pick(pal.D), cS = swapDS ? pal.D : pal.S, cA = rng.pick(pal.A), cK = pal.K, cP = pal.P;
  const PC = { cD, cS, cA };

  /* ── Composition ── */
  const g = gridKind === 0 ? [21845, 43691] : [q16(0.382), q16(0.618)];
  const ix = rng.i(0, 1), iy = rng.i(0, 1);
  const masses: V15Mass[] = [], opens: V15Open[] = [], focal: number[][] = [];
  const flowKind = strategy === ST_BAND ? rng.pick([FLOW_HORIZONTAL, FLOW_DIAGONAL]) : strategy === ST_COLUMNS || strategy === ST_EDGE ? FLOW_VERTICAL : strategy === ST_DIAGONAL ? FLOW_DIAGONAL
    : strategy === ST_BURST ? FLOW_RADIAL : strategy === ST_CONVERSATION ? FLOW_TOWARD : rng.pick([FLOW_DIAGONAL, FLOW_VERTICAL, FLOW_HORIZONTAL]);
  const flowFrom = (k: number): number => (k === FLOW_HORIZONTAL ? rng.ang(-0.18, 0.18) : k === FLOW_VERTICAL ? -QUARTER_A + rng.ang(-0.2, 0.2) : (rng.ch(q12(0.5)) ? -1 : 1) * rng.ang(0.55, 0.85));
  const NOROT = -999999;
  const M = (o: Partial<V15Mass> & { x: number; y: number; rx: number; ry: number; kind: number }): void => {
    masses.push({ role: 0, dens: ONE, pale: 0, grey: 0, rot: NOROT, hasDir: 0, dir: 0, radial: 0, loop: 0, lumpS: 0, lumpA: 0, spike: 0, ...o });
  };
  const O = (o: Partial<V15Open> & { kind: number }): void => { opens.push({ x: 0, y: 0, rx: 0, ry: 0, soft: 0, scumble: 0, inner: 0, ...o }); };
  const Qh = (x: number): number => q16(x);
  let flowA = 0;
  const gx = (k: number): number => g[k]!;
  if (strategy === ST_BAND) {
    const by = gx(1) + rng.q(-0.02, 0.02), top = by - rng.q(0.2, 0.29);
    const F1 = [gx(ix), by], F2 = [gx(1 - ix) + (ix ? Qh(-0.04) : Qh(0.04)), by - rng.q(0.04, 0.1)];
    focal.push(F1, F2);
    M({ x: F1[0]!, y: ((top + by + Qh(0.1)) >> 1) + Qh(0.03), rx: Qh(0.2), ry: (by + Qh(0.1) - top) >> 1, kind: K_PRIMARY, dens: q12(1.1) });
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.15), ry: f16((by + Qh(0.08) - top) >> 1, Qh(0.8)), role: 1, dens: q12(0.6), pale: q12(0.25), kind: K_SECONDARY });
    const xs = rng.ch(q12(0.5)) ? rng.q(0.06, 0.12) : rng.q(0.16, 0.3), xe = Q - (rng.ch(q12(0.5)) ? rng.q(0.06, 0.12) : rng.q(0.16, 0.3)), bs = rng.int16(), half = (by + Qh(0.08) - top) >> 1;
    for (let x = xs; x <= xe; x += rng.q(0.08, 0.14)) {
      if (absI(x - F1[0]!) < Qh(0.07)) continue;
      const taper = sm(idiv(minI(x - xs, xe - x) * ONE, Qh(0.16))), wave = f16(fbm(x * 3, Qh(0.5), bs, 2) - 32768, Qh(0.22));
      const ryM = f12(f16(half, Qh(0.35) + f16(Qh(0.75), fbm(x * 4, Qh(2.5), bs + 1, 2))), q12(0.45) + f12(q12(0.55), taper));
      M({ x, y: ((top + by + Qh(0.08)) >> 1) + wave, rx: rng.q(0.06, 0.1), ry: ryM, role: rng.ch(q12(0.55)) ? 0 : 1, dens: f12(rng.f(0.15, 0.6), q12(0.5) + (taper >> 1)), pale: rng.f(0, 0.2), grey: rng.f(0, 0.3), kind: K_BAND });
    }
    for (let k = 0; k < rng.i(1, 3); k++) M({ x: rng.r(xs + Qh(0.05), xe - Qh(0.05)), y: by + rng.q(0.1, 0.17), rx: rng.q(0.03, 0.06), ry: rng.q(0.05, 0.09), role: rng.ch(q12(0.5)) ? 0 : 1, dens: rng.f(0.2, 0.45), pale: q12(0.1), hasDir: 1, dir: -QUARTER_A, kind: K_LEG });
    O({ kind: O_TOP, y: top - Qh(0.02), soft: q12(0.05), scumble: 1 });
    O({ kind: O_BOTTOM, y: minI(Qh(0.88), by + rng.q(0.1, 0.16)), soft: q12(0.05) });
    for (let k = 0; k < rng.i(1, 3); k++) {
      let wxp = rng.r(xs + Qh(0.06), xe - Qh(0.06)); if (absI(wxp - F1[0]!) < Qh(0.12)) wxp = F1[0]! + (wxp < F1[0]! ? Qh(-0.14) : Qh(0.14));
      O({ kind: O_ELL, x: cl(wxp, Qh(0.12), Qh(0.88)), y: ((top + by + Qh(0.08)) >> 1) + rng.q(-0.05, 0.05), rx: rng.q(0.07, 0.12), ry: rng.q(0.05, 0.085), soft: q12(0.035), inner: 1 });
    }
    flowA = flowFrom(flowKind);
  } else if (strategy === ST_COLUMNS) {
    const F1 = [gx(ix), gx(iy)], F2 = [gx(1 - ix), gx(1 - iy)]; focal.push(F1, F2);
    const top = rng.q(0.07, 0.14);
    M({ x: F1[0]!, y: ((top + Qh(0.88)) >> 1) - Qh(0.03), rx: Qh(0.075), ry: Qh(0.37), kind: K_PRIMARY, hasDir: 1, dir: -QUARTER_A, dens: q12(1.2) });
    const nc = rng.i(1, 3), step = (ix === 0 ? 1 : -1) * rng.q(0.13, 0.17);
    for (let c = 1; c <= nc; c++) { const x = F1[0]! + step * c; if (x < Qh(0.1) || x > Qh(0.9)) continue; M({ x, y: ((top + Qh(0.8)) >> 1) + rng.q(-0.04, 0.04), rx: Qh(0.06), ry: rng.q(0.26, 0.34), dens: q12(0.8), pale: c * q12(0.1), hasDir: 1, dir: -QUARTER_A, kind: K_COLUMN, role: c === 2 ? 1 : 0 }); }
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.11), ry: Qh(0.1), role: 1, dens: q12(0.6), pale: q12(0.35), kind: K_SECONDARY, loop: 1 });
    O({ kind: O_ELL, x: gx(1 - ix) + (ix ? Qh(-0.04) : Qh(0.04)), y: gx(iy), rx: Qh(0.17), ry: Qh(0.2), soft: q12(0.06) });
    flowA = flowFrom(flowKind);
  } else if (strategy === ST_FIELD) {
    const F1 = [gx(ix), gx(iy)], F2 = [gx(1 - ix), gx(1 - iy)]; focal.push(F1, F2);
    M({ x: F1[0]!, y: F1[1]!, rx: Qh(0.17), ry: Qh(0.16), kind: K_PRIMARY, dens: q12(1.3) });
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.13), ry: Qh(0.12), role: 1, dens: q12(0.75), pale: q12(0.25), kind: K_SECONDARY });
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) M({ x: Qh(0.14) + a * Qh(0.24) + rng.q(-0.03, 0.03), y: Qh(0.14) + b * Qh(0.24) + rng.q(-0.03, 0.03), rx: Qh(0.13), ry: Qh(0.13), role: rng.ch(q12(0.6)) ? 0 : 1, dens: q12(0.5), pale: rng.f(0, 0.3), grey: rng.f(0, 0.4), kind: K_FIELD });
    O({ kind: O_ELL, x: gx(1 - ix), y: gx(iy), rx: Qh(0.2), ry: Qh(0.19), soft: q12(0.07), scumble: 1 });
    flowA = flowFrom(flowKind);
  } else if (strategy === ST_BURST) {
    const F1 = [Qh(0.5) + rng.q(-0.04, 0.04), Qh(0.48) + rng.q(-0.03, 0.04)], F2 = [gx(ix), gx(1)]; focal.push(F1, F2);
    M({ x: F1[0]!, y: F1[1]!, rx: rng.q(0.13, 0.26), ry: rng.q(0.09, 0.17), rot: rng.ang(-1.2, 1.2), kind: K_PRIMARY, dens: q12(1.35), radial: rng.f(0.1, 0.35) });
    const lobeA = rng.r(0, A);
    for (let k = 0; k < rng.i(3, 5); k++) { const a = lobeA + f12(rng.g(), ra(k === 0 ? 2.5 : 0.8)), d = rng.q(0.13, 0.29); M({ x: F1[0]! + f16(d, cosA(a) << 2), y: F1[1]! + f16(d, sinA(a) << 2), rx: rng.q(0.07, 0.13), ry: rng.q(0.07, 0.13), role: rng.ch(q12(0.6)) ? 0 : 1, dens: rng.f(0.3, 0.7), pale: rng.f(0, 0.2), kind: K_LOBE }); }
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.1), ry: Qh(0.09), role: 1, dens: q12(0.6), pale: q12(0.25), kind: K_SECONDARY });
    O({ kind: O_ELL, x: cl(F1[0]! - f16(Qh(0.36), cosA(lobeA) << 2), Qh(0.2), Qh(0.8)), y: cl(F1[1]! - f16(Qh(0.36), sinA(lobeA) << 2), Qh(0.2), Qh(0.8)), rx: rng.q(0.17, 0.25), ry: rng.q(0.14, 0.22), soft: q12(0.07), scumble: rng.ch(q12(0.5)) ? 1 : 0 });
    flowA = -QUARTER_A + rng.ang(-0.6, 0.6);
  } else if (strategy === ST_EDGE) {
    const F1 = [gx(ix) < Q / 2 ? Qh(0.24) : Qh(0.76), gx(iy)], F2 = [Q - F1[0]!, gx(1 - iy)]; focal.push(F1, F2);
    M({ x: F1[0]!, y: Qh(0.5), rx: Qh(0.14), ry: Qh(0.36), kind: K_PRIMARY, dens: q12(1.25), hasDir: 1, dir: -QUARTER_A + rng.ang(-0.3, 0.3) });
    M({ x: F2[0]!, y: Qh(0.5) + rng.q(-0.05, 0.05), rx: Qh(0.12), ry: Qh(0.3), role: 1, dens: q12(0.7), pale: q12(0.2), kind: K_SECONDARY });
    M({ x: Qh(0.5), y: F2[1]! > Q / 2 ? Qh(0.86) : Qh(0.14), rx: Qh(0.2), ry: Qh(0.06), role: 1, dens: q12(0.35), pale: q12(0.35), kind: K_BRIDGE });
    O({ kind: O_ELL, x: Qh(0.5), y: Qh(0.5), rx: Qh(0.15), ry: Qh(0.3), soft: q12(0.06) });
    flowA = flowFrom(flowKind);
  } else if (strategy === ST_DIAGONAL) {
    const F1 = [gx(ix), gx(iy)], steep = rng.pick([0, Qh(0.12), Qh(-0.12)]);
    const F2 = [cl(gx(1 - ix) + (steep !== 0 ? 0 : rng.q(-0.05, 0.05)), Qh(0.2), Qh(0.8)), cl(gx(1 - iy) + steep, Qh(0.2), Qh(0.8))]; focal.push(F1, F2);
    const ang = atan2A(F2[1]! - F1[1]!, F2[0]! - F1[0]!), nx0 = -sinA(ang) << 2, ny0 = cosA(ang) << 2;
    const stepT = rng.q(0.13, 0.2), wob = rng.q(0.02, 0.07);
    for (let t = Qh(-0.45); t <= Qh(1.46); t += stepT) {
      if (t > Qh(0.15) && t < Qh(0.85) && rng.ch(q12(0.3))) continue;
      const off = f12(rng.g(), wob);
      const x = F1[0]! + f16(F2[0]! - F1[0]!, t) + f16(nx0, off), y = F1[1]! + f16(F2[1]! - F1[1]!, t) + f16(ny0, off);
      if (x < Qh(0.1) || x > Qh(0.9) || y < Qh(0.1) || y > Qh(0.9)) continue;
      const big = Q - minI(Q, f16(absI(t), Qh(0.7)));
      M({ x, y, rx: Qh(0.09) + f12(f16(Qh(0.1), big), rng.f(0.7, 1.3)), ry: Qh(0.09) + f12(f16(Qh(0.1), big), rng.f(0.7, 1.3)), role: t > Qh(0.6) ? 1 : 0, dens: q12(0.35) + (f16(q12(0.5), big)), pale: t > Qh(0.6) ? q12(0.2) : 0, kind: K_DIAG });
    }
    M({ x: F1[0]!, y: F1[1]!, rx: Qh(0.13), ry: Qh(0.13), kind: K_PRIMARY, dens: q12(1.3) });
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.1), ry: Qh(0.1), role: 1, dens: q12(0.6), pale: q12(0.2), kind: K_SECONDARY });
    O({ kind: O_ELL, x: Qh(0.5) + f16(nx0, Qh(0.32)), y: Qh(0.5) + f16(ny0, Qh(0.32)), rx: Qh(0.17), ry: Qh(0.17), soft: q12(0.06) });
    O({ kind: O_ELL, x: Qh(0.5) - f16(nx0, Qh(0.33)), y: Qh(0.5) - f16(ny0, Qh(0.33)), rx: Qh(0.13), ry: Qh(0.13), soft: q12(0.06), scumble: 1 });
    flowA = ang + (rng.ch(q12(0.5)) ? HALF_A : 0);
  } else if (strategy === ST_CONVERSATION) {
    const F1 = [gx(ix), gx(iy)], F2 = [gx(1 - ix), gx(1 - iy) + rng.q(-0.06, 0.06)]; focal.push(F1, F2);
    M({ x: F1[0]!, y: F1[1]!, rx: Qh(0.2), ry: Qh(0.19), kind: K_PRIMARY, dens: q12(1.3) });
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.16), ry: Qh(0.15), role: 1, dens: q12(0.85), pale: q12(0.15), kind: K_SECONDARY, loop: 1 });
    M({ x: (F1[0]! + F2[0]!) >> 1, y: (F1[1]! + F2[1]!) >> 1, rx: Qh(0.11), ry: Qh(0.11), role: 1, dens: q12(0.35), pale: q12(0.3), kind: K_BRIDGE });
    O({ kind: O_ELL, x: gx(1 - ix), y: gx(iy), rx: Qh(0.14), ry: Qh(0.14), soft: q12(0.06), scumble: rng.ch(q12(0.5)) ? 1 : 0 });
    M({ x: gx(ix), y: gx(1 - iy), rx: Qh(0.1), ry: Qh(0.1), role: 1, dens: q12(0.3), pale: q12(0.35), kind: K_ECHO });
    flowA = atan2A(F2[1]! - F1[1]!, F2[0]! - F1[0]!);
  } else {
    const F1 = [gx(ix), gx(iy)], F2 = [gx(1 - ix), gx(1 - iy)]; focal.push(F1, F2);
    M({ x: F1[0]!, y: F1[1]!, rx: Qh(0.1), ry: Qh(0.1), kind: K_PRIMARY, dens: q12(2.0) });
    M({ x: F2[0]!, y: F2[1]!, rx: Qh(0.16), ry: Qh(0.13), role: 1, dens: q12(0.35), pale: q12(0.45), grey: q12(0.4), kind: K_SECONDARY });
    M({ x: Qh(0.5), y: Qh(0.5), rx: Qh(0.36), ry: Qh(0.34), role: 1, dens: q12(0.8), pale: q12(0.08), grey: q12(0.12), kind: K_CALM });
    O({ kind: O_ELL, x: gx(ix), y: gx(1 - iy), rx: Qh(0.18), ry: Qh(0.17), soft: q12(0.08), scumble: 1 });
    flowA = flowFrom(flowKind);
  }
  for (const m of masses) if (m.rot === NOROT) m.rot = m.hasDir ? 0 : f12(rng.ang(-0.6, 0.6), strategy === ST_BAND ? q12(0.4) : ONE);
  const prim = masses.find((m) => m.kind === K_PRIMARY)!;

  // balance: counterweights moved by a small grid search toward (0.50, 0.53)
  const balanceOf = (): number[] => { let sw = 0, sx = 0, sy = 0; for (const m of masses) { const w = massW(PC, m); sw += w; sx += w * m.x; sy += w * m.y; } return sw > 0 ? [Math.floor(sx / sw), Math.floor(sy / sw)] : [Q / 2, Q / 2]; };
  const target = [Qh(0.5), Qh(0.53)];
  {
    const movers = masses.filter((m) => m.kind !== K_PRIMARY);
    const DX = [Qh(-0.07), Qh(-0.035), 0, Qh(0.035), Qh(0.07)], DY = [Qh(-0.05), 0, Qh(0.05)], DS = [q12(0.75), ONE, q12(1.25)];
    const primW = massW(PC, prim);
    for (let it = 0; it < 3; it++) for (const m of movers) {
      let best: { e: number; x: number; y: number; d: number } | null = null; const bx = m.x, by2 = m.y, bd = m.dens;
      for (const dx of DX) for (const dy of DY) for (const ds of DS) {
        m.x = bx + dx; m.y = by2 + dy; m.dens = f12(bd, ds);
        if (m.x < Qh(0.08) || m.x > Qh(0.92) || m.y < Qh(0.08) || m.y > Qh(0.92)) continue;
        if (m.kind === K_SECONDARY && Math.min(m.x, Q - m.x, m.y, Q - m.y) < Qh(0.2)) continue;
        if (massW(PC, m) > f16(Qh(0.62), primW)) continue;
        const b = balanceOf(); const e = hypot(b[0]! - target[0]!, b[1]! - target[1]!) + f16(Qh(0.15), hypot(dx, dy));
        if (!best || e < best.e) best = { e, x: m.x, y: m.y, d: m.dens };
      }
      if (best) { m.x = best.x; m.y = best.y; m.dens = best.d; } else { m.x = bx; m.y = by2; m.dens = bd; }
    }
    const sec = masses.find((m) => m.kind === K_SECONDARY); if (sec) focal[1] = [sec.x, sec.y];
  }
  const oSeed = rng.int16(), eSeed = rng.int16();
  const speedK = q12(1.1) - f12(q12(0.2), speed);
  // the day's big brush, px: field, burst and diagonal 45..65, edge 50..72, band and conversation 42..62, columns 55..80, quiet 36..55
  const wr = [[45, 65], [45, 65], [50, 72], [42, 62], [55, 80], [45, 65], [42, 62], [36, 55]][strategy]!;
  const wBig = f12(rng.r(q12(wr[0]!), q12(wr[1]!)), speedK);
  const cSeed = rng.int16(), cScale = rng.q(1.8, 3.2);
  const dSeed = rng.int16(), dTurn = rng.ang(0.5, 1.4), dScale = rng.q(1.5, 3.5);
  const pSeed = rng.int16(), porosity = strategy === ST_BAND ? rng.f(0.6, 0.85) : rng.f(0.35, 0.75);
  const pDark = key === KEY_DARK ? rng.f(0.16, 0.26) : key === KEY_LIGHT ? rng.f(0.05, 0.09) : rng.f(0.07, 0.15), pWhite = key === KEY_LIGHT ? rng.f(0.14, 0.24) : rng.f(0.08, 0.16);
  const mSeed = rng.int16();
  for (const m of masses) { m.lumpS = rng.int16(); m.lumpA = f12(m.kind === K_PRIMARY ? rng.f(0.25, 0.5) : rng.f(0.2, 0.45), strategy === ST_FIELD ? q12(0.6) : ONE); m.spike = rng.f(0, 0.35); }
  const wSeed = rng.int16();
  const bites: number[][] = [];
  for (const m of masses) if (m.kind === K_PRIMARY || m.kind === K_BAND || m.kind === K_LOBE || m.kind === K_SECONDARY) {
    for (let k = 0; k < rng.i(strategy === ST_BAND ? 1 : 0, strategy === ST_BAND ? 3 : 2); k++) { const a = rng.r(0, A); bites.push([m.x + f12(f16(cosA(a) << 2, m.rx), rng.f(0.8, 1.15)), m.y + f12(f16(sinA(a) << 2, m.ry), rng.f(0.8, 1.15)), f12(minI(m.rx, m.ry), rng.f(0.35, 0.7))]); }
  }
  if (strategy === ST_BAND) for (const m of masses) if (m.kind === K_BAND || m.kind === K_PRIMARY) { for (let k = 0; k < rng.i(0, 2); k++) bites.push([m.x + f12(f12(rng.g(), m.rx), q12(0.5)), m.y + f12(f12(rng.g(), m.ry), q12(0.4)), rng.q(0.035, 0.075)]); }
  const silSeed = rng.int16(), silS = rng.q(1.8, 3.8), silThr = strategy === ST_FIELD ? rng.q(0.22, 0.32) : rng.q(0.3, 0.42), silA = rng.r(0, A), silK = rng.f(0.25, 0.65), silWarp = rng.q(0.05, 0.14);
  const seed = rng.u32();
  return {
    strategy, weave, ground, edge, underpainting, palette, harmony, hue, key, swapDS, surprise, impasto, washes, glazes, fat, sessions,
    speed, pressure, hesitation, hand, energy, reach, curl, tools, process, drips, spatter, gridKind, openTarget, edgeW,
    cD: [...cD], cS: cS.map((c) => [...c]), cA: [...cA], cK: [...cK], cP: [...cP],
    grid: g, ix, iy, focal, flowKind, flowA, masses, opens, bites,
    oSeed, eSeed, cSeed, cScale, dSeed, dTurn, dScale, pSeed, porosity, pDark, pWhite, mSeed, wSeed, silSeed, silS, silThr, silA, silK, silWarp,
    wBig, nseed, seed,
  };
}

/* ── The linen: a plain weave of irregular warp and weft threads, built once per weave and scale and kept ─────────────
 * It does not depend on the painting (the sketch drew one per seed; here the three weaves are three fixed canvases), so
 * it is cached: the slow, smooth fields (the threads' wander, the gesso sizing, the tooth's coarse grain) are evaluated on
 * a 2 or 4 px grid and interpolated, the fine ones per pixel. Stored per pixel: the thread height T, the thread tone
 * TONE, the sizing SIZE and the tooth (Q12). */
const PITCH: readonly number[] = [q12(2.6), q12(3.3), q12(4.4)];
const SKEW: readonly number[] = [ra((0.8 * Math.PI) / 180), ra((-0.6 * Math.PI) / 180), ra((1.1 * Math.PI) / 180)];
const WEAVE_SEED: readonly number[] = [0x51e71, 0x2b6f3, 0x7c0d5];
interface Linen { kind: number; S8: number; D: number; T: Uint16Array; TONE: Int16Array; SIZE: Uint16Array; TOOTH: Uint16Array }
let linens: Linen[] = [];

/** A smooth field sampled every G px (a power of two), read back a row at a time, bilinearly between the samples. */
function gridField(D: number, G: number, fn: (x: number, y: number) => number): (y: number, row: Int32Array) => void {
  const n = Math.floor(D / G) + 2, v = new Int32Array(n * n), sh = G === 16 ? 4 : G === 4 ? 2 : 1, col = new Int32Array(n);
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) v[gy * n + gx] = fn(gx * G, gy * G);
  return (y: number, row: Int32Array): void => {
    const gy = y >> sh, fy = y & (G - 1), o = gy * n;
    for (let gx = 0; gx < n; gx++) col[gx] = v[o + gx]! * (G - fy) + v[o + n + gx]! * fy;
    for (let x = 0; x < D; x++) { const gx = x >> sh, fx = x & (G - 1); row[x] = (col[gx]! * (G - fx) + col[gx + 1]! * fx) >> (2 * sh); }
  };
}

function linenFor(kind: number, S8: number): Linen {
  const hit = linens.find((l) => l.kind === kind && l.S8 === S8);
  if (hit) return hit;
  if (linens.some((l) => l.S8 !== S8)) linens = []; // one scale at a time (the recorded size, or a print)
  const D = (1200 * S8) >> 8, N = D * D, n = WEAVE_SEED[kind]! & 0xffff;
  const P8 = (PITCH[kind]! * S8) >> 12; // the pitch in raster px, Q8
  const S = S8; // raster px per layout px, Q8
  const ext = D + ((80 * S) >> 8);
  const mk = (salt: number): { idx: Int32Array; loc: Uint16Array; tk: number[]; tone: number[]; L: number } => {
    const r2 = seeded(WEAVE_SEED[kind]!, salt), ds = r2.int16();
    const pos = [0], tk: number[] = [], tone: number[] = [];
    while (pos[pos.length - 1]! < ext * 256) {
      const k = pos.length;
      const drift = ONE + f12(q12(0.32), n12(noise1(Math.floor((k * Q) / 23) + C037, ds)) - 2048) + f12(q12(0.1), r2.u() - 2048);
      pos.push(pos[pos.length - 1]! + f12(f12(P8, drift), q12(0.72) + f12(q12(0.56), r2.u())));
      const u1 = r2.u(), u2 = r2.u();
      tk.push(q12(0.6) + f12(q12(0.3), f12(u1, u2)) + (r2.ch(q12(0.06)) ? q12(0.18) : 0));
      tone.push((r2.u() - 2048) * 2);
    }
    const L = ext * 4, idx = new Int32Array(L), loc = new Uint16Array(L);
    let i = 0;
    for (let k = 0; k < L; k++) { const x = k * 64; while (pos[i + 1]! <= x) i++; idx[k] = i; loc[k] = Math.floor(((x - pos[i]!) * ONE) / (pos[i + 1]! - pos[i]!)); }
    return { idx, loc, tk, tone, L };
  };
  const wx = mk(1), wy = mk(2), off = 40 * S;
  const skC = cosA(SKEW[kind]!), skS = sinA(SKEW[kind]!);
  const lat = (px: number, cell10: number): number => Math.floor((px * Q * 2560) / (cell10 * S)); // raster px over a layout cell (in tenths of a px), Q16 lattice
  const cP = (v: number, k100: number): number => Math.floor(((v - 32768) * P8 * k100) / (65536 * 100)); // (v - 0.5) * P * k/100, Q8
  // smooth wander (60 and 22 px), the sizing (260 px) and the tooth's coarse grain (14 px): every 4 px
  const w60x = gridField(D, 4, (x, y) => cP(tfbm(lat(x, 600), lat(y, 600), n + 1, 2), 160) + cP(tfbm(lat(x, 220), lat(y, 220), n + 21, 2), 110));
  const w60y = gridField(D, 4, (x, y) => cP(tfbm(lat(x, 600), lat(y, 600), n + 2, 2), 160) + cP(tfbm(lat(x, 220), lat(y, 220), n + 22, 2), 110));
  const sizeF = gridField(D, 4, (x, y) => tfbm(lat(x, 2600), lat(y, 2600), n + 6, 3) >> 4);
  const t14 = gridField(D, 4, (x, y) => tfbm(lat(x, 140), lat(y, 140), n + 11, 2) >> 4);
  // the threads' fast wander across their own direction (7 by 40 px): every 2 px
  const C03 = q16(0.3), C07 = q16(0.7);
  const w7x = gridField(D, 2, (x, y) => cP(tfbm(lat(y, 70) + C03, lat(x, 400), n + 23, 1), 45));
  const w7y = gridField(D, 2, (x, y) => cP(tfbm(lat(x, 70) + C07, lat(y, 400), n + 24, 1), 45));
  const T = new Uint16Array(N), TONE = new Int16Array(N), SIZE = new Uint16Array(N), TOOTH = new Uint16Array(N);
  const k45 = Math.floor((Q * 256 * 10) / (P8 * 45)), k17 = Math.floor((Q * 256 * 10) / (P8 * 17)); // lattice per raster px Q8: 1 / (P x 4.5), 1 / (P x 1.7)
  const k40 = Math.floor((Q * 256) / (40 * S));
  const Q0618 = q16(0.618), Q137 = q16(1.37), Q0382 = q16(0.382), Q211 = q16(2.11), Q071 = q16(0.71), Q19 = q16(1.9);
  const rA = new Int32Array(D), rB = new Int32Array(D), rC = new Int32Array(D), rD = new Int32Array(D), rE = new Int32Array(D), rF = new Int32Array(D);
  for (let y = 0; y < D; y++) {
    w60x(y, rA); w7x(y, rB); w60y(y, rC); w7y(y, rD); sizeF(y, rE); t14(y, rF);
    for (let x = 0; x < D; x++) {
      const p = y * D + x;
      const wnx = rA[x]! + rB[x]!, wny = rC[x]! + rD[x]!;
      const xs = (x * skC - y * skS) >> 6, ys = (x * skS + y * skC) >> 6; // Q8 px
      const kx = cl((xs + wnx + off) >> 6, 0, wx.L - 1), ky = cl((ys + wny + off) >> 6, 0, wy.L - 1);
      const i = wx.idx[kx]!, lx = wx.loc[kx]!, j = wy.idx[ky]!, ly = wy.loc[ky]!;
      const v1 = vn(Math.floor((ys * k45) / 65536) + i * Q0618, i * Q137, n + 3) >> 4, v2 = vn(Math.floor((ys * k17) / 65536) + i * Q0382, i * Q211, n + 13) >> 4;
      const slx = f12(ONE + Math.floor((q12(0.65) * maxI(0, v1 - q12(0.62))) / q12(0.38)), q12(0.85) + f12(q12(0.3), v2));
      const v3 = vn(Math.floor((xs * k45) / 65536) + j * Q0618, j * Q137, n + 4) >> 4, v4 = vn(Math.floor((xs * k17) / 65536) + j * Q0382, j * Q211, n + 14) >> 4;
      const sly = f12(ONE + Math.floor((q12(0.65) * maxI(0, v3 - q12(0.62))) / q12(0.38)), q12(0.85) + f12(q12(0.3), v4));
      const hx = minI(2048, f12(wx.tk[i]!, slx) >> 1), hy = minI(2048, f12(wy.tk[j]!, sly) >> 1);
      const ex = Math.floor((absI(lx - 2048) * ONE) / maxI(1, hx)), ey = Math.floor((absI(ly - 2048) * ONE) / maxI(1, hy));
      const pv = ex < ONE ? (16384 + cosA(ex * 2)) >> 3 : 0, ph = ey < ONE ? (16384 + cosA(ey * 2)) >> 3 : 0;
      const over = (i + j) & 1, sx = sinA(lx * 2) >> 2, sy = sinA(ly * 2) >> 2;
      const warpH = f12(pv, over ? q12(0.72) + f12(q12(0.28), sy) : q12(0.42) + f12(q12(0.22), ONE - sy));
      const weftH = f12(ph, over ? q12(0.42) + f12(q12(0.22), ONE - sx) : q12(0.72) + f12(q12(0.28), sx));
      let t = warpH > weftH ? warpH : weftH;
      const top = warpH > weftH
        ? f12(wx.tone[i]!, vn(Math.floor((ys * k40) / 65536) + i * Q071, i * Q19, n + 15) >> 4)
        : f12(wy.tone[j]!, vn(Math.floor((xs * k40) / 65536) + j * Q071, j * Q19, n + 16) >> 4);
      t = f12(t, q12(0.9) + ((hash2(x, y, n + 5) * 410) >> 16));
      T[p] = t; TONE[p] = top; SIZE[p] = rE[x]!;
      const fine = tfbm(lat(x, 35), lat(y, 35), n + 10, 3) >> 4;
      TOOTH[p] = ((1229 * t) >> 12) + ((1720 * fine) >> 12) + ((1147 * rF[x]!) >> 12);
    }
  }
  const out = { kind, S8, D, T, TONE, SIZE, TOOTH };
  linens.push(out);
  return out;
}

/* ── The easel: the canvas state at one scale, the bristle brush and the compositor ──────────────────────────────────── */
const OP_PAINT = 0, OP_KNIFE = 1, OP_WIPE = 2, OP_SCRATCH = 3, OP_GLAZE = 4;
const PF_NONE = 0, PF_TAPER = 1, PF_SWELL = 2, PF_FLICK = 3, PF_SCRUB = 4, PF_WASH = 5, PF_HAZE = 6, PF_CALM = 7, PF_RIGGER = 8, PF_DRIP = 9, PF_LINE = 10;
const AUTO = -0x7fffffff;
/** One mark, every parameter resolved by the painter (integers; AUTO where the brush decides for itself). */
interface Mark {
  W: number; col: C3; col2: C3 | null; side: number; mix2: number;
  load: number; dryFrac: number; pickup: number; opacity: number; thick: number; round: number; follow: number;
  tooth: number; wet: number; gaps: number; lip: number; role: number; press: number[]; gloss: number;
  pf: number; pfA: number; pfB: number; fade: number; soft: number; crisp: number;
  /** A fixed bristle count, or bristles per raster px (Q12) with a floor; 0 for one a pixel. */
  nb: number; nbK: number; nbMin: number;
  dome: number; ridges: number; wobble: number; angle0: number; memory: number; carry: number; ridge: number;
  broken: number; brokenScale: number; brokenAng: number; twist: number; splay: number; hook: number; widthVar: number; rag: number;
  op: number; noTrim: number; ignoreWin: number; glaze: number;
}
const MAXB = 1200;

/** The painting's state at one scale. */
function makeEasel(P: V15Plan, S8: number) {
  const D = (1200 * S8) >> 8, N = D * D;
  const linen = linenFor(P.weave, S8);
  const TOOTH = linen.TOOTH;
  // the canvas, interleaved, 8 values a pixel (one cache line holds four pixels): red, green, blue (Q12), height (Q12),
  // paint amount (Q12), wetness when laid (Q12), the stroke clock when laid, and gloss (Q8, low byte) with the layer count (high byte)
  const CAN = new Uint16Array(N * 8);
  // what a rag, a scratch or the tape reveals (10 bits a channel), kept only when the day has rag wipes, sgraffito or
  // a taped border, the only things that read it
  const needBase = P.process[0]! > 0 || P.process[1]! > 0 || P.edge === EDGE_TAPED;
  const BASE = new Uint32Array(needBase ? N : 1);
  let ROLEMAP = new Int8Array(N).fill(-1);
  let WIN: Uint8Array | null = null;
  const SLOT = new Int32Array(N).fill(-1);
  let cap = 1 << 19;
  // the stroke buffer: per touched pixel a slot of six accumulators (weight, and weight x load, r, g, b, height), interleaved
  let TOUCH = new Int32Array(cap), ACC = new Int32Array(cap * 6);
  let nt = 0, cur = 0, clock = 0, tau = 900, dec8 = Math.floor((ONE * 256) / 900);
  const grow = (): void => {
    const n2 = cap * 2;
    const t2 = new Int32Array(n2); t2.set(TOUCH); TOUCH = t2;
    const a2 = new Int32Array(n2 * 6); a2.set(ACC); ACC = a2; cap = n2;
  };
  const add = (p: number, w: number, l: number, r: number, g: number, b: number, h: number): void => {
    if (w <= 0) return;
    let s = SLOT[p]!;
    if (s < 0) {
      if (nt === cap) grow();
      s = nt++; SLOT[p] = s; TOUCH[s] = p;
      const o = s * 6; ACC[o] = w; ACC[o + 1] = (w * l) >> 4; ACC[o + 2] = (w * r) >> 4; ACC[o + 3] = (w * g) >> 4; ACC[o + 4] = (w * b) >> 4; ACC[o + 5] = (w * h) >> 5;
      return;
    }
    const o = s * 6; ACC[o] += w; ACC[o + 1] += (w * l) >> 4; ACC[o + 2] += (w * r) >> 4; ACC[o + 3] += (w * g) >> 4; ACC[o + 4] += (w * b) >> 4; ACC[o + 5] += (w * h) >> 5;
  };
  /** A bilinear splat at (x, y) in raster px Q8 with weight w (Q8 px^2). */
  const splat = (x: number, y: number, w: number, l: number, r: number, g: number, b: number, h: number): void => {
    const xf = x - 128, yf = y - 128, ix = xf >> 8, iy = yf >> 8, fx = xf & 255, fy = yf & 255;
    const gx = 256 - fx, gy = 256 - fy;
    const w00 = (((gx * gy) >> 4) * w) >> 12, w10 = (((fx * gy) >> 4) * w) >> 12, w01 = (((gx * fy) >> 4) * w) >> 12, w11 = (((fx * fy) >> 4) * w) >> 12;
    if (ix < 0 || iy < 0 || ix + 1 >= D || iy + 1 >= D) {
      if (iy >= 0 && iy < D) { if (ix >= 0 && ix < D) add(iy * D + ix, w00, l, r, g, b, h); if (ix + 1 >= 0 && ix + 1 < D) add(iy * D + ix + 1, w10, l, r, g, b, h); }
      if (iy + 1 >= 0 && iy + 1 < D) { if (ix >= 0 && ix < D) add((iy + 1) * D + ix, w01, l, r, g, b, h); if (ix + 1 >= 0 && ix + 1 < D) add((iy + 1) * D + ix + 1, w11, l, r, g, b, h); }
      return;
    }
    const p = iy * D + ix, wl = l, wr = r, wg = g, wb = b, wh = h;
    for (let c = 0; c < 4; c++) {
      const q = c === 0 ? p : c === 1 ? p + 1 : c === 2 ? p + D : p + D + 1, ww = c === 0 ? w00 : c === 1 ? w10 : c === 2 ? w01 : w11;
      if (ww <= 0) continue;
      let sl = SLOT[q]!;
      if (sl < 0) {
        if (nt === cap) grow();
        sl = nt++; SLOT[q] = sl; TOUCH[sl] = q;
        const o = sl * 6, A6 = ACC; A6[o] = ww; A6[o + 1] = (ww * wl) >> 4; A6[o + 2] = (ww * wr) >> 4; A6[o + 3] = (ww * wg) >> 4; A6[o + 4] = (ww * wb) >> 4; A6[o + 5] = (ww * wh) >> 5;
      } else {
        const o = sl * 6, A6 = ACC; A6[o] += ww; A6[o + 1] += (ww * wl) >> 4; A6[o + 2] += (ww * wr) >> 4; A6[o + 3] += (ww * wg) >> 4; A6[o + 4] += (ww * wb) >> 4; A6[o + 5] += (ww * wh) >> 5;
      }
    }
  };
  /** A disc of paint (spatter, specks), centre and radius in raster px Q8, stretched ex (Q12) along ang. */
  const disk = (x: number, y: number, rad: number, l: number, cc: readonly number[], h: number, ex: number, ang: number): void => {
    const ca = cosA(ang) >> 2, sa = sinA(ang) >> 2, ext = (f12(rad, ex) >> 8) + 2;
    const cx = x >> 8, cy = y >> 8;
    const x0 = maxI(0, cx - ext), x1 = minI(D - 1, cx + ext), y0 = maxI(0, cy - ext), y1 = minI(D - 1, cy + ext);
    const R8 = rad + 128;
    for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
      const dx = X * 256 + 128 - x, dy = Y * 256 + 128 - y;
      const u = Math.floor(((dx * ca + dy * sa) / ex)), v = (-dx * sa + dy * ca) >> 12;
      const dd = isqrt(u * u + v * v); // Q8
      const c = cl(R8 - dd, 0, 256); if (c <= 0) continue;
      const rr = Math.floor((dd * ONE) / R8), dome = sqrt12(ONE - minI(ONE, f12(rr, rr)));
      add(Y * D + X, (c * 230) >> 8, l, cc[0]!, cc[1]!, cc[2]!, f12(h, q12(0.35) + f12(q12(0.65), dome)));
    }
  };

  /** Composite the stroke buffer onto the canvas; the operation decides how paint meets paint. */
  const composite = (st: { op: number; opacity: number; tooth: number; thick: number; wet: number; role: number; glaze: number; gloss: number; broken: number; brokenScale: number; brokenAng: number; ignoreWin: number }): void => {
    const broken = st.broken, bSeed = (cur * 7919) & 0xffff, bS8 = maxI(256, (st.brokenScale * S8) >> 12), bC = cosA(st.brokenAng), bSn = sinA(st.brokenAng);
    const op = st.opacity, tooth = st.tooth, thick = st.thick, wetv = st.wet, role = st.role, glaze = st.glaze, gloss = (st.gloss * 255) >> 12, kind = st.op;
    const win = WIN !== null && role >= 0 && role <= 3 && !st.ignoreWin ? WIN : null;
    const hk = kind === OP_KNIFE ? 3482 : 2253, d8 = dec8, clk = clock;
    const A6 = ACC;
    for (let k = 0; k < nt; k++) {
      const p = TOUCH[k]!, o6 = k * 6, w = A6[o6]!, o = p << 3;
      SLOT[p] = -1;
      if (w <= 0) continue;
      const cov = w >= 159 ? ONE : SM12[(w * 26426) >> 10]!;
      const inv = Math.floor(268435456 / w); // 2^28 / w: the means below are sums times inv
      let av = Math.floor((A6[o6 + 1]! * inv) / 16777216); if (av > 16384) av = 16384;
      let a: number;
      if (kind === OP_PAINT && tooth) { let tq = ((TOOTH[p]! - 4178 + ((5652 * av) >> 12)) * 4267) >> 10; tq = tq < 0 ? 0 : tq > ONE ? ONE : tq; const m2 = 1024 + ((5120 * av) >> 12); a = (tq * (m2 > ONE ? ONE : m2)) >> 12; }
      else if (kind === OP_KNIFE) { a = ((av * 6144) >> 12) - ((TOOTH[p]! * 3072) >> 12) + 1229; a = a < 0 ? 0 : a > ONE ? ONE : a; }
      else if (kind === OP_WIPE) { let a0 = 1434 + ((2662 * av) >> 12); a0 = a0 > ONE ? ONE : a0; a = (a0 * (2253 + ((1843 * TOOTH[p]!) >> 12))) >> 12; }
      else if (kind === OP_SCRATCH) a = ONE;
      else { a = (av * 6144) >> 12; if (a > ONE) a = ONE; }
      a = (((a * cov) >> 12) * op) >> 12;
      if (win !== null) a = (a * (ONE - ((win[p]! * 4112) >> 8))) >> 12;
      if (broken > 0 && a > 16) {
        const px = p % D, py = (p - px) / D;
        const u = Math.floor(((px * bC + py * bSn) * 256) / bS8), v = Math.floor(((-px * bSn + py * bC) * 1024) / bS8);
        let tq = (((tfbm(u, v, bSeed, 3) >> 4) - 1802) * 7318) >> 10; tq = tq < 0 ? 0 : tq > ONE ? ONE : tq;
        a = (a * (ONE - broken + ((broken * SM12[tq]!) >> 12))) >> 12;
      }
      if (a < 16) continue;
      const r = Math.floor((A6[o6 + 2]! * inv) / 16777216), g = Math.floor((A6[o6 + 3]! * inv) / 16777216), b = Math.floor((A6[o6 + 4]! * inv) / 16777216);
      const R0 = CAN[o]!, G0 = CAN[o + 1]!, B0 = CAN[o + 2]!, na = ONE - a;
      if (kind === OP_WIPE || kind === OP_SCRATCH) {
        let k2 = 3359; if (kind === OP_SCRATCH) { let m2 = ((CAN[o + 4]! * 6144) >> 12) + 819; if (m2 > ONE) m2 = ONE; k2 = (3768 * m2) >> 12; }
        const ak = (a * k2) >> 12, bc = BASE[p]!;
        CAN[o] = R0 + (((((bc >>> 20) & 1023) << 2) - R0) * ak >> 12); CAN[o + 1] = G0 + (((((bc >>> 10) & 1023) << 2) - G0) * ak >> 12); CAN[o + 2] = B0 + ((((bc & 1023) << 2) - B0) * ak >> 12);
        CAN[o + 4] = (CAN[o + 4]! * (ONE - ((a * (kind === OP_SCRATCH ? 3686 : 2867)) >> 12))) >> 12; CAN[o + 3] = (CAN[o + 3]! * (ONE - ((a * (kind === OP_SCRATCH ? 3891 : 2867)) >> 12))) >> 12; CAN[o + 7] = (CAN[o + 7]! & 0xff00) | (((CAN[o + 7]! & 255) * (ONE - ((a * 2458) >> 12))) >> 12);
        continue;
      }
      if (kind === OP_GLAZE) {
        CAN[o] = (R0 * (na + ((a * r) >> 12))) >> 12; CAN[o + 1] = (G0 * (na + ((a * g) >> 12))) >> 12; CAN[o + 2] = (B0 * (na + ((a * b) >> 12))) >> 12;
        { const g7 = CAN[o + 7]!, gl = g7 & 255; CAN[o + 7] = (g7 & 0xff00) | (gl + (((gloss - gl) * a) >> 12)); } CAN[o + 3] = CAN[o + 3]! + ((82 * a) >> 12);
        continue;
      }
      const lr = R0 + (((r - R0) * a) >> 12), lg = G0 + (((g - G0) * a) >> 12), lb = B0 + (((b - B0) * a) >> 12);
      const gz = (((glaze * na) >> 12) * a) >> 11;
      let nr = lr + ((((R0 * (na + ((a * r) >> 12))) >> 12) - lr) * gz >> 12), ng = lg + ((((G0 * (na + ((a * g) >> 12))) >> 12) - lg) * gz >> 12), nb2 = lb + ((((B0 * (na + ((a * b) >> 12))) >> 12) - lb) * gz >> 12);
      if (a < 4076) { // a half-covering layer of a complementary colour would average to grey-brown: keep the broken colour lively instead
        const mx = nr > ng ? (nr > nb2 ? nr : nb2) : ng > nb2 ? ng : nb2, mn = nr < ng ? (nr < nb2 ? nr : nb2) : ng < nb2 ? ng : nb2;
        if (mx > 901 && mx < 3113 && (mx - mn) * ONE < 1065 * mx) {
          const sIn = maxI(satOf(r, g, b), satOf(R0, G0, B0));
          if (sIn > 1229) {
            const mean = Math.floor((nr + ng + nb2) / 3), kk = minI(10650, Math.floor((((1106 * mx) >> 12) * ONE) / maxI(41, mx - mn)));
            nr = c1(mean + (((nr - mean) * kk) >> 12)); ng = c1(mean + (((ng - mean) * kk) >> 12)); nb2 = c1(mean + (((nb2 - mean) * kk) >> 12));
          }
        }
      }
      CAN[o] = nr < 0 ? 0 : nr; CAN[o + 1] = ng < 0 ? 0 : ng; CAN[o + 2] = nb2 < 0 ? 0 : nb2;
      let hd = Math.floor((A6[o6 + 5]! * inv) / 8388608); if (hd > 65535) hd = 65535;
      hd = (hd * thick) >> 12; if (cov < ONE) hd = (hd * ((cov * cov) >> 12)) >> 12;
      const h1 = ((CAN[o + 3]! * (ONE - ((a * hk) >> 12))) >> 12) + ((hd * a) >> 12);
      CAN[o + 3] = h1 > 65535 ? 65535 : h1;
      CAN[o + 4] = CAN[o + 4]! + ((a * (ONE - CAN[o + 4]!)) >> 12);
      { const g7 = CAN[o + 7]!, gl = g7 & 255; CAN[o + 7] = (g7 & 0xff00) | (gl + (((gloss - gl) * a) >> 12)); }
      let wc = CAN[o + 5]! - (((clk - CAN[o + 6]!) * d8) >> 8); if (wc < 0) wc = 0;
      CAN[o + 5] = ((wc * na) >> 12) + ((wetv * a) >> 12); CAN[o + 6] = clk;
      if (a > 1843 && role >= 0) ROLEMAP[p] = role;
      if (a > 1434 && CAN[o + 7]! < 0xff00) CAN[o + 7] = CAN[o + 7]! + 256;
    }
    nt = 0; clock++;
  };

  // the bristles of the current brush
  const U8 = new Int32Array(MAXB), BLd = new Int32Array(MAXB), CR = new Int32Array(MAXB), CG = new Int32Array(MAXB), CB = new Int32Array(MAXB);
  const LR = new Int32Array(MAXB), LG = new Int32Array(MAXB), LB = new Int32Array(MAXB);
  const TH = new Int32Array(MAXB), CT = new Int32Array(MAXB), RATE = new Int32Array(MAXB), ST8 = new Int32Array(MAXB), WOB = new Int32Array(MAXB);
  const INC = new Uint8Array(MAXB), EDG = new Int32Array(MAXB), CLC = new Int32Array(MAXB);
  const PR = new Int32Array(MAXB), PG = new Int32Array(MAXB), PB = new Int32Array(MAXB), PL = new Int32Array(MAXB);
  const F1C = new Int32Array(MAXB), F1A = new Int32Array(MAXB), F1B = new Int32Array(MAXB), F2C = new Int32Array(MAXB), F2A = new Int32Array(MAXB), F2B = new Int32Array(MAXB);
  const clumpLift = new Int32Array(MAXB), clumpLoad = new Int32Array(MAXB);
  const FY037 = SMT[(C037 & 65535) >> 4]!;
  /** The row of the sketch's noise1 at lattice cell c (the value at y = 0.37), Q16. */
  const nrow = (c: number, s: number): number => { const a = hash2(c, 0, s), b = hash2(c, 1, s); return a + (((b - a) * FY037) >> 15); };
  const S = S8; // raster px per layout px, Q8
  const latS = (px8: number, cell10: number): number => Math.floor((px8 * Q * 10) / (cell10 * S)); // raster px (Q8) over a cell of layout px (in tenths), Q16 lattice
  const LIP_K = [q12(0.7), q12(1.6)];

  /** Pressure along the stroke for the shaped brushes (s Q12). */
  const pfun = (kind: number, s: number, a: number, b: number): number => {
    switch (kind) {
      case PF_TAPER: return f12(q12(0.35) + f12(q12(0.65), smr(s, 0, q12(0.18))), ONE - f12(q12(0.92), smr(s, q12(0.45), q12(0.55))));
      case PF_SWELL: return q12(0.18) + f12(q12(0.82), pow12(sinPi(s), q12(0.8)));
      case PF_FLICK: return ONE - f12(q12(0.95), pow12(s, q12(0.7)));
      case PF_SCRUB: return q12(0.25) + f12(q12(0.75), pow12(sinPi(s), q12(0.4)));
      case PF_WASH: return pow12(sinPi(c1(s)), q12(0.6));
      case PF_HAZE: return f12(pow12(sinPi(c1(s)), q12(0.5)), q12(0.85) + f12(q12(0.15), sinA(Math.floor((s * ra(9)) / ONE)) >> 2));
      case PF_CALM: return pow12(sinPi(s), q12(0.5));
      case PF_RIGGER: return q12(0.6) + f12(q12(0.4), sinPi(s));
      case PF_DRIP: return (s < q12(0.03) ? q12(0.7) + 10 * s : ONE - f12(q12(0.65), smr(s, 0, q12(0.92)))) + f12(a, smr(s, q12(0.9), q12(0.07))) - f12(q12(0.35) + a, smr(s, q12(0.975), q12(0.025)));
      case PF_LINE: return c1(f12(f12(q12(0.35) + f12(q12(0.65), smr(s, 0, q12(0.12))), q12(0.55) + f12(q12(0.45), sinA(a + f12(f12(s, A), b)) >> 2)), ONE - f12(q12(0.8), smr(s, q12(0.75), q12(0.25)))) + q12(0.15));
      default: return ONE;
    }
  };

  // the current stroke's constants, for the per-stamp bristle loop
  let bNb = 0, bNs = 0, bWob8 = 0, bLipLast = 0, bPick = 0, bMem8 = 0, bCarry = 0;
  /** One stamp: every bristle of the brush at its place across the stroke (the sketch's inner loop; its own function, so it is
   *  optimised as a whole rather than entered mid-loop). */
  const bristles = (cx: number, cy: number, ca: number, sa: number, p: number, sAcc8: number, wsc: number, hook8: number, spW: number, lw: number, l1: number, l2: number, pa: number, wsplat: number, dsub: number, last: number, decS: number, dk: number): void => {
    const nb = bNb, ns = bNs, wob8 = bWob8, lipLast = bLipLast, pickQ16 = bPick, memory8 = bMem8, carry = bCarry;
    const wsp2 = wsplat * 2, d8 = dec8, clk = clock;
    for (let j = 0; j < nb; j++) {
      let uo = (((U8[j]! + ((CLC[j]! * spW) >> 13)) * wsc) >> 12) + hook8;
      if (wob8 > 0) uo += (wob8 * ((n12(noise1(lw + WOB[j]!, ns + 21)) - 2048) * 2)) >> 12;
      const x = cx + ((ca * uo) >> 12), y = cy + ((sa * uo) >> 12);
      if (p < CT[j]! || sAcc8 < ST8[j]!) {
        if (INC[j] === 1) { INC[j] = 2; const L0 = BLd[j]!; if (L0 > 614) splat(x, y, wsp2, L0, CR[j]!, CG[j]!, CB[j]!, (((TH[j]! * L0) >> 12) * lipLast) >> 12); }
        continue;
      }
      INC[j] = 1;
      if (pickQ16 > 0) {
        const X = x >> 8, Y = y >> 8;
        if (X >= 0 && Y >= 0 && X < D && Y < D) {
          const q0 = (Y * D + X) << 3, pa0 = CAN[q0 + 4]!;
          if (pa0 > 82) {
            let wt = CAN[q0 + 5]! - (((clk - CAN[q0 + 6]!) * d8) >> 8); if (wt < 0) wt = 0;
            const qq = (((((pickQ16 * wt) >> 12) * pa0) >> 12) * dsub) >> 8; // Q16
            if (qq > 0) {
              const c0 = CAN[q0]!, c1v = CAN[q0 + 1]!, c2v = CAN[q0 + 2]!, cr0 = c0 < 41 ? 41 : c0 > ONE ? ONE : c0, cg0 = c1v < 41 ? 41 : c1v > ONE ? ONE : c1v, cb0 = c2v < 41 ? 41 : c2v > ONE ? ONE : c2v;
              if (memory8 > 0) { // long memory: the picked-up colour goes into a second reservoir that is carried and smeared out slowly
                const f = Math.floor((qq * ONE) / (PL[j]! * 16 + qq));
                PR[j] = PR[j]! + (((cr0 - PR[j]!) * f) >> 12); PG[j] = PG[j]! + (((cg0 - PG[j]!) * f) >> 12); PB[j] = PB[j]! + (((cb0 - PB[j]!) * f) >> 12);
                PL[j] = PL[j]! + (((qq * carry) >> 12) >> 4);
              } else { // pick up wet paint: pigment-like (geometric) mixing into the bristle, in the log of the colour
                const f = Math.floor((qq * ONE) / (BLd[j]! * 16 + qq));
                let lr = LR[j]!, lg = LG[j]!, lb = LB[j]!;
                lr += ((LN12[cr0]! - lr) * f) >> 12; lg += ((LN12[cg0]! - lg) * f) >> 12; lb += ((LN12[cb0]! - lb) * f) >> 12;
                let r0 = EXPT[(-lr) >> 6]!, g0 = EXPT[(-lg) >> 6]!, b0 = EXPT[(-lb) >> 6]!;
                BLd[j] = BLd[j]! + ((qq * 1434) >> 16);
                const mx = r0 > g0 ? (r0 > b0 ? r0 : b0) : g0 > b0 ? g0 : b0, mn = r0 < g0 ? (r0 < b0 ? r0 : b0) : g0 < b0 ? g0 : b0;
                if (mx > 901 && mx < 3113 && (mx - mn) * ONE < 1065 * mx) { // over-mixing guard: a bristle never goes to grey-brown mud
                  const mean = Math.floor((r0 + g0 + b0) / 3), kk = minI(10650, Math.floor((((1106 * mx) >> 12) * ONE) / maxI(41, mx - mn)));
                  r0 = cl(mean + (((r0 - mean) * kk) >> 12), 41, ONE); g0 = cl(mean + (((g0 - mean) * kk) >> 12), 41, ONE); b0 = cl(mean + (((b0 - mean) * kk) >> 12), 41, ONE);
                  lr = LN12[r0]!; lg = LN12[g0]!; lb = LN12[b0]!;
                }
                CR[j] = r0; CG[j] = g0; CB[j] = b0; LR[j] = lr; LG[j] = lg; LB[j] = lb;
              }
            }
          }
        }
      }
      const L = BLd[j]!;
      let fr = ONE;
      const eg = EDG[j]!;
      if (eg > 0) { // edge bristles fray in and out along the stroke (the noise rows are cached per bristle)
        const wj = WOB[j]!, X1 = l1 + wj, c1x = X1 >> 16;
        if (c1x !== F1C[j]) { F1C[j] = c1x; F1A[j] = nrow(c1x, ns + 31); F1B[j] = nrow(c1x + 1, ns + 31); }
        const X2 = l2 + wj, c2x = X2 >> 16;
        if (c2x !== F2C[j]) { F2C[j] = c2x; F2A[j] = nrow(c2x, ns + 32); F2B[j] = nrow(c2x + 1, ns + 32); }
        const v1 = F1A[j]! + (((F1B[j]! - F1A[j]!) * SMT[(X1 & 65535) >> 4]!) >> 15), v2 = F2A[j]! + (((F2B[j]! - F2A[j]!) * SMT[(X2 & 65535) >> 4]!) >> 15);
        const tq = (((((v1 * 7 + v2 * 3) / 160) | 0) - ((eg * 3072) >> 12) + 492) * 5691) >> 10; // (0.7 v1 + 0.3 v2 - 0.75 EDG + 0.12) / 0.18
        fr = tq <= 0 ? 0 : tq >= ONE ? ONE : SM12[tq]!;
      }
      if (memory8 > 0) {
        const pl = PL[j]!, m = Math.floor((pl * ONE) / (pl + (L >> 1) + 1)), Le = L + ((pl * 3277) >> 12);
        if (Le > 16 && fr > 82) { let lv = (Le * 6963) >> 12; if (lv > 4915) lv = 4915; splat(x, y, wsplat, (((lv * pa) >> 12) * fr) >> 12, CR[j]! + (((PR[j]! - CR[j]!) * m) >> 12), CG[j]! + (((PG[j]! - CG[j]!) * m) >> 12), CB[j]! + (((PB[j]! - CB[j]!) * m) >> 12), (((TH[j]! * Le) >> 12) * fr) >> 12); }
        PL[j] = (pl * decS) >> 12;
      } else if (L > 16 && fr > 82) {
        let h = (TH[j]! * L) >> 12; if (last && L > 819) h = (h * lipLast) >> 12;
        let lv = (L * 6963) >> 12; if (lv > 4915) lv = 4915;
        splat(x, y, wsplat, (((lv * pa) >> 12) * fr) >> 12, CR[j]!, CG[j]!, CB[j]!, (h * fr) >> 12);
      }
      const dr = Math.floor((RATE[j]! * dk) / 4294967296);
      BLd[j] = L > dr ? L - dr : 0;
    }
  };

  /** One brush stroke: a row of bristles stamped densely along a path (layout px, Q12), the sketch's stroke(). */
  const stroke = (st: Mark, path: readonly number[]): void => {
    const n = path.length >> 1; if (n < 2) return;
    cur++;
    const W8 = maxI(256, (st.W * S8) >> 12);
    const nb = minI(MAXB, st.nb > 0 ? st.nb : st.nbK > 0 ? maxI(st.nbMin, Math.floor((f12(W8, st.nbK) + 128) / 256)) : maxI(1, ((W8 + 128) >> 8) + 1));
    const r2 = seeded(P.seed, cur), ns = r2.int16();
    let jit = (r2.u32() | 1) >>> 0;
    const jr = (): number => { jit ^= jit << 13; jit ^= jit >>> 17; jit ^= jit << 5; return (jit >>> 0) >>> 20; }; // Q12
    let len8 = 0;
    for (let i = 1; i < n; i++) len8 += hypot(path[2 * i]! - path[2 * i - 2]!, path[2 * i + 1]! - path[2 * i - 1]!);
    len8 = Math.floor((len8 * S8) / 4096); if (len8 < 256) len8 = 256;
    const crisp = st.crisp, explicitNb = st.nb > 0 || st.nbK > 0;
    const rag = crisp ? 0 : st.rag !== AUTO ? st.rag : q12(0.9);
    const flatLike = !crisp && !explicitNb && nb > 6 && !st.dome && st.pf === PF_NONE;
    const twistAmp = st.twist !== AUTO ? st.twist : flatLike ? r2.ang(0.12, 0.6) : ra(0.05);
    const splayAmt = st.splay !== AUTO ? st.splay : flatLike ? r2.f(0.35, 1.1) : 0;
    const hookAmt = st.hook !== AUTO ? st.hook : !crisp && !st.dome && r2.ch(q12(0.3)) ? f12(r2.f(-1, 1), flatLike ? q12(0.2) : q12(0.5)) : 0;
    const widthVar = st.widthVar !== AUTO ? st.widthVar : flatLike ? r2.f(0.14, 0.34) : crisp ? q12(0.03) : q12(0.1);
    const memory8 = st.memory > 0 ? (st.memory * S8) >> 12 : 0, carry = st.carry;
    const ridge = st.ridge !== AUTO ? st.ridge : crisp || st.broken > 0 || st.pickup > q12(1.5) || st.load < q12(0.85) ? ONE : f12(cl(q12(1.75) - f12(st.load, q12(1.1)), q12(0.15), ONE), r2.f(0.7, 1.15));
    let gloss = st.gloss;
    if (ridge < q12(0.6)) gloss = minI(ONE, gloss + f12(q12(0.18), ONE - ridge));
    // bristle clumps: neighbours stick together; each clump has its own centre, lift height and load
    let cStart = 0, cLift = r2.f(0, 0.45), cLoad = r2.f(0.75, 1.2);
    for (let j = 0; j < nb; j++) {
      const uu = nb === 1 ? 0 : Math.floor(((j * ONE + f12(r2.u() - 2048, q12(0.6))) * ONE) / ((nb - 1) * ONE)) - 2048; // Q12, jittered across the brush
      U8[j] = f12(uu, W8);
      const endClump = j === nb - 1 || r2.ch(Math.floor((ONE * ONE) / maxI(2 * ONE, f12(r2.f(2.5, 6), S8 << 4))));
      clumpLift[j] = cLift; clumpLoad[j] = cLoad;
      if (endClump) { const c = Math.floor(((U8[cStart]! + U8[j]!) * 2048) / W8); for (let q = cStart; q <= j; q++) CLC[q] = c; cStart = j + 1; cLift = r2.f(0, 0.45); cLoad = r2.ch(q12(0.15)) ? r2.f(0.3, 0.6) : r2.f(0.75, 1.2); }
    }
    const cc = st.col, c2 = st.col2, lipK = st.lip > 0 ? f12(st.lip, LIP_K[crisp]!) : 0;
    for (let j = 0; j < nb; j++) {
      const uu = nb === 1 ? 0 : Math.floor((U8[j]! * ONE) / W8);
      const edge = ONE - absI(uu) * 2;
      const u8 = U8[j]!;
      const clump = n12(noise1(latS(u8, 32), ns));
      let L = f12(f12(f12(st.load, q12(0.62) + f12(q12(0.75), clump)), q12(0.85) + f12(q12(0.3), r2.u())), flatLike ? clumpLoad[j]! : ONE);
      if (st.soft > 0) L = f12(L, q12(0.15) + f12(q12(0.85), sm(Math.floor((edge * ONE) / st.soft))));
      else if (!crisp && edge < q12(0.12) && nb > 4) L = f12(L, q12(0.55) + f12(q12(3.5), maxI(0, edge)));
      if (r2.ch(st.gaps)) L = f12(L, r2.f(0.04, 0.3));
      BLd[j] = L;
      const cv = f12(q12(0.13), n12(noise1(latS(u8, 45), ns + 3)) - 2048) + f12(q12(0.1), n12(noise1(latS(u8, 140), ns + 4)) - 2048) + f12(q12(0.04), r2.u() - 2048);
      let r = f12(cc[0], ONE + cv), g = f12(cc[1], ONE + cv), b = f12(cc[2], ONE + cv);
      if (c2) {
        let m = 0;
        if (st.side !== 0) m = f12(smr(uu * st.side, -q12(0.08), q12(0.3)), q12(0.75) + f12(q12(0.25), n12(noise1(latS(u8, 30), ns + 6))));
        else if (n12(noise1(latS(u8, 90) + q16(3.1), ns + 5)) < st.mix2) m = q12(0.45) + f12(q12(0.5), n12(noise1(latS(u8, 30), ns + 6)));
        r = lerp(r, c2[0], m); g = lerp(g, c2[1], m); b = lerp(b, c2[2], m);
      }
      CR[j] = cl(r, 41, ONE); CG[j] = cl(g, 41, ONE); CB[j] = cl(b, 41, ONE);
      LR[j] = lnQ(CR[j]! << 4); LG[j] = lnQ(CG[j]! << 4); LB[j] = lnQ(CB[j]! << 4);
      PR[j] = CR[j]!; PG[j] = CG[j]!; PB[j] = CB[j]!; PL[j] = 0;
      const edPx8 = f12(2048 - absI(uu), W8);
      const g1 = n12(noise1(latS(u8, 17), ns + 9)), g2 = n12(noise1(latS(u8, 50), ns + 10)), u1 = r2.u(), u2 = r2.u();
      const grooves = ONE + f12(q12(0.45) + f12(q12(0.6), g1) + f12(q12(0.45), g2) + f12(q12(0.35), f12(u1, u2)) - q12(1.05), ridge);
      const ed3 = Math.floor((edPx8 * ONE) / (3 * S8)); // edPx / (3 S), Q12
      let th = f12(grooves, ONE + f12(lipK, expN12(f12(ed3, ed3))));
      if (st.dome) th = f12(th, q12(0.25) + f12(q12(0.75), sqrt12(maxI(0, ONE - f12(uu * 2, uu * 2)))));
      if (st.ridges) th = q12(0.25) + f12(q12(0.75), 2048 + (sinA(Math.floor((u8 * 3725) / S8)) >> 3)); // 0.5 + 0.5 sin(U / (0.7 S))
      TH[j] = th;
      CT[j] = crisp ? 0 : flatLike ? f12(f12(clumpLift[j]!, q12(0.8) + f12(q12(0.4), r2.u())), ONE + f12(ONE - edge, q12(0.4))) : f12(r2.f(0, 0.32), ONE + f12(ONE - edge, q12(0.6)));
      RATE[j] = Math.floor((f12(L, q12(0.6) + f12(q12(0.8), r2.u())) * 4294967296) / (len8 * st.dryFrac)); // the reservoir drains linearly: L / (len x dryFrac) a px, scaled by 2^32 / 2^20
      ST8[j] = crisp ? 0 : Math.floor((f12(n12(noise1(latS(u8, 60), ns + 13)) * 9 + f12(r2.u(), r2.u()) * 5, minI(ONE, Math.floor(st.W / 20))) * S8) / 4096);
      WOB[j] = r2.r(0, 100 * Q); INC[j] = 0; F1C[j] = -0x40000000; F2C[j] = -0x40000000;
      EDG[j] = rag > 0 && nb > 6 ? f12(c1(Math.floor(((absI(uu) * 2 - q12(0.45)) * ONE) / q12(0.55))), rag) : 0;
    }
    const pS = st.press[0]!, pB = st.press[1]!, pLft = st.press[2]!, pE = st.press[3]!;
    const pf = st.pf, pfA = st.pfA, pfB = st.pfB;
    const pickQ16 = Math.floor((st.pickup * 1442 * 256) / (ONE * S8)); // pickup x 0.022 / S, Q16 per raster px
    let phi = st.angle0 !== AUTO ? st.angle0 : atan2A(path[3]! - path[1]!, path[2]! - path[0]!) + QUARTER_A;
    let sAcc8 = 0;
    const round = st.round, follow = st.follow, wob8 = (st.wobble * S8) >> 12;
    let turnS = 0; // smoothed turning rate, radians a layout px, Q12
    const fade = st.fade;
    const Wst = st.W; // layout px Q12
    const lipLast = ONE + f12(st.lip, q12(2.5));
    const s1cell = 24 * S, s2cell = 6 * S;
    bNb = nb; bNs = ns; bWob8 = wob8; bLipLast = lipLast; bPick = pickQ16; bMem8 = memory8; bCarry = carry;
    for (let i = 0; i < n - 1; i++) {
      const x0 = Math.floor((path[2 * i]! * S8) / 4096), y0 = Math.floor((path[2 * i + 1]! * S8) / 4096), x1 = Math.floor((path[2 * i + 2]! * S8) / 4096), y1 = Math.floor((path[2 * i + 3]! * S8) / 4096);
      const hx = x1 - x0, hy = y1 - y0, seg = hypot(hx, hy); if (seg <= 0) continue;
      const head = atan2A(hy, hx), nrm = head + QUARTER_A;
      const dphi = f12(wrapHalf(nrm - phi), follow);
      const nphi = phi + dphi;
      if (i > 0) {
        const pn = atan2A(path[2 * i + 1]! - path[2 * i - 1]!, path[2 * i]! - path[2 * i - 2]!);
        const tr = Math.floor((radOf(absI(wrapHalf(head - pn))) * ONE) / maxI(q12(0.2), Math.floor((seg * ONE) / S8))); // rad a layout px
        turnS += f12(tr - turnS, q12(0.15));
      }
      const maxStep = f12(q12(0.75) + f12(q12(0.4), jr()), S8); // raster px Q8
      const nsub = maxI(1, Math.ceil((seg + (f12(radOf(absI(dphi)), W8) >> 1) + f12(f12(radOf(twistAmp), q12(0.02)), W8)) / maxStep));
      const dsub = Math.floor(seg / nsub); // Q8
      for (let k = 1; k <= nsub; k++) {
        const last = i === n - 2 && k === nsub;
        const t = Math.floor((k * ONE - 2048 + jr()) / nsub);
        const cx = x0 + f12(hx, t), cy = y0 + f12(hy, t);
        sAcc8 += dsub;
        const s = Math.floor((sAcc8 * ONE) / len8), sc = s > ONE ? ONE : s;
        const p = pf !== PF_NONE ? pfun(pf, sc, pfA, pfB)
          : f12(f12(pS + f12(ONE - pS, smr(s, 0, pB)), ONE - f12(ONE - pE, smr(s, ONE - pLft, pLft))), q12(0.92) + f12(q12(0.16), n12(noise1(latS(sAcc8, 700), ns + 11))));
        const ph = phi + f12(dphi, t) + f12(twistAmp, (n12(noise1(latS(sAcc8, 950), ns + 41)) - 2048) * 2) + f12(f12(twistAmp, q12(0.6)), n12(noise1(latS(sAcc8, 230), ns + 42)) - 2048);
        const wsc = f12(lerp(q12(0.86) + f12(q12(0.14), p), q12(0.22) + f12(q12(0.78), p), round),
          ONE + f12(widthVar, (n12(noise1(latS(sAcc8, 600), ns + 17)) - 2048) * 2) + f12(q12(0.08), n12(noise1(latS(sAcc8, 140), ns + 18)) - 2048));
        const sp = f12(splayAmt, f12(q12(0.25), smr(p, q12(0.93), q12(0.07))) + minI(ONE, f12(f12(turnS, Wst), q12(0.6))) + f12(q12(0.55), smr(s, q12(0.88), q12(0.12))));
        const hk = smr(s, q12(0.8), q12(0.2)), hook8 = f12(f12(hookAmt, W8), f12(hk, hk));
        const ca = cosA(ph) >> 2, sa = sinA(ph) >> 2;
        const spacing8 = nb > 1 ? Math.floor(f12(W8, wsc) / nb) : f12(q12(1.1), S8), spacingE = explicitNb && nb > 1 ? minI(spacing8, f12(q12(1.3), S8)) : spacing8;
        const wsplat = maxI(38, (spacingE * dsub) >> 8);
        const pa = fade ? p : q12(0.45) + f12(q12(0.55), p), dep = q12(0.4) + f12(q12(0.6), p);
        const l1 = Math.floor((sAcc8 * Q) / s1cell), l2 = Math.floor((sAcc8 * Q) / s2cell), lw = wob8 > 0 ? latS(sAcc8, 180) : 0;
        const spW = (sp * W8) >> 12;
        const decS = memory8 > 0 ? expN12(Math.floor((dsub * ONE) / memory8)) : 0, dk = dsub * dep; // dk: travel x pressure, Q20 px
        bristles(cx, cy, ca, sa, p, sAcc8, wsc, hook8, spW, lw, l1, l2, pa, wsplat, dsub, last ? 1 : 0, decS, dk);
      }
      phi = nphi;
    }
    composite({ op: st.op, opacity: st.opacity, tooth: st.tooth, thick: st.thick, wet: st.wet, role: st.role, glaze: st.glaze, gloss, broken: st.broken, brokenScale: st.brokenScale, brokenAng: st.brokenAng, ignoreWin: st.ignoreWin });
  };

  return {
    D, N, S8, CAN, BASE, SLOT, linen,
    get ROLEMAP() { return ROLEMAP; },
    /** Let go of what only the painting needs (the stroke buffer, the role map) before the light is worked out. */
    release(): void { cap = 1; TOUCH = new Int32Array(1); ACC = new Int32Array(6); nt = 0; ROLEMAP = new Int8Array(1); },
    get WIN() { return WIN; }, set WIN(w: Uint8Array | null) { WIN = w; },
    get cur() { return cur; }, set cur(v: number) { cur = v; },
    setTau(t: number): void { tau = t; dec8 = Math.floor((ONE * 256) / tau); },
    stroke, composite, add, disk,
    dryAll(): void { for (let o = 5; o < N * 8; o += 8) CAN[o] = 0; },
    snapshotBase(): void { if (!needBase) return; for (let p = 0; p < N; p++) { const o = p << 3; BASE[p] = (minI(1023, CAN[o]! >> 2) << 20) | (minI(1023, CAN[o + 1]! >> 2) << 10) | minI(1023, CAN[o + 2]! >> 2); } },
  };
}
type Easel = ReturnType<typeof makeEasel>;

/* ── The score: every mark the painter laid, in order, so the painting can be laid again at another scale ─────────── */
type Op =
  | { k: 0; st: Mark; path: number[] }
  | { k: 1 } // the canvas dries (between sessions, before glazes)
  | { k: 2 } // what a rag or scratch reveals is taken from here on
  | { k: 3; x: number; y: number; r: number; col: C3; s0: number; thr: number; role: number }
  | { k: 4; lobes: number[][]; col: C3; s0: number; role: number }
  | { k: 5; disks: number[][]; cols: C3[]; comp: { opacity: number; thick: number; wet: number; gloss: number } }
  | { k: 6; tw: number; s0: number };

/** Lay one op on an easel (the painter calls this as it paints; a replay calls it for every op of a score). */
function layOp(ez: Easel, op: Op): void {
  const S8 = ez.S8, D = ez.D;
  const ras = (v: number): number => Math.floor((v * S8) / 4096); // layout px Q12 to raster px Q8
  switch (op.k) {
    case 0: ez.stroke(op.st, op.path); return;
    case 1: ez.dryAll(); return;
    case 2: ez.snapshotBase(); return;
    case 3: { // sponge: a thresholded noise stipple
      ez.cur = ez.cur + 1;
      const x = ras(op.x), y = ras(op.y), Rr = ras(op.r), ext = f12(Rr, q12(1.3)) >> 8;
      const X0 = maxI(0, (x >> 8) - ext), X1 = minI(D - 1, (x >> 8) + ext), Y0 = maxI(0, (y >> 8) - ext), Y1 = minI(D - 1, (y >> 8) + ext);
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
        const dx = X * 256 - x, dy = Y * 256 - y, a = atan2A(dy, dx);
        const rr = f12(Rr, q12(0.7) + f12(q12(0.5), n12(noise1(f16(Math.floor((a * 411775) / A), q16(2)) + q16(10), op.s0))));
        const e = ONE - Math.floor((hypot(dx, dy) * ONE) / maxI(1, rr)); if (e <= 0) continue;
        const v = n12(tfbm(Math.floor((X * Q * 2560) / (24 * S8)), Math.floor((Y * Q * 2560) / (24 * S8)), op.s0 + 1, 2)) + f12(q12(0.15), smr(e, 0, q12(0.4)));
        if (v > op.thr) ez.add(Y * D + X, (smr(v, op.thr, q12(0.05)) * 256) >> 12, ONE, op.col[0], op.col[1], op.col[2], q12(0.9) + f12(q12(0.6), n12(vn(Math.floor((X * Q * 2560) / (15 * S8)), Math.floor((Y * Q * 2560) / (15 * S8)), op.s0 + 2))));
      }
      ez.composite({ op: OP_PAINT, opacity: q12(0.95), tooth: 0, thick: q12(0.6), wet: ONE, role: op.role, glaze: q12(0.35), gloss: q12(0.4), broken: 0, brokenScale: 0, brokenAng: 0, ignoreWin: 0 });
      return;
    }
    case 4: { // pour: a lobed, translucent pool; pigment gathers at the rim
      ez.cur = ez.cur + 1;
      let mx0 = 1 << 30, my0 = 1 << 30, mx1 = -(1 << 30), my1 = -(1 << 30);
      for (const [lx, ly, lr] of op.lobes) { const e2 = f12(lr!, q12(1.25)); mx0 = minI(mx0, lx! - e2); mx1 = maxI(mx1, lx! + e2); my0 = minI(my0, ly! - e2); my1 = maxI(my1, ly! + e2); }
      const X0 = maxI(0, (ras(mx0) >> 8) - 2), X1 = minI(D - 1, (ras(mx1) >> 8) + 2), Y0 = maxI(0, (ras(my0) >> 8) - 2), Y1 = minI(D - 1, (ras(my1) >> 8) + 2);
      const lob = op.lobes.map(([lx, ly, lr]) => [ras(lx!), ras(ly!), ras(lr!), lx!]);
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
        const px = X * 256, py = Y * 256;
        let e = -(1 << 30);
        for (const [lx, ly, lr, lx12] of lob) {
          const dx = px - lx!, dy = py - ly!, a = atan2A(dy, dx), ar = Math.floor((a * 411775) / A); // radians Q16
          const rr = f12(lr!, q12(0.8) + f12(q12(0.3), n12(noise1(2 * ar + lx12! * 16, op.s0))) + f12(q12(0.1), n12(noise1(7 * ar, op.s0 + 1))));
          e = maxI(e, rr - hypot(dx, dy));
        }
        if (e <= -256) continue; // Q8 raster px
        const e12 = Math.floor((e * ONE * 10) / (S8 * 22)); // e / (2.2 S), Q12
        const rim = expN12(f12(e12, e12)), k2 = ONE - f12(q12(0.28), rim);
        ez.add(Y * D + X, cl(e + 256, 0, 256), q12(0.55) + f12(q12(0.45), rim), f12(op.col[0], k2), f12(op.col[1], k2), f12(op.col[2], k2), q12(0.25) + f12(q12(0.45), rim));
      }
      ez.composite({ op: OP_PAINT, opacity: q12(0.85), tooth: 0, thick: q12(0.5), wet: ONE, role: op.role, glaze: q12(0.85), gloss: ONE, broken: 0, brokenScale: 0, brokenAng: 0, ignoreWin: 0 });
      return;
    }
    case 5: { // discs: spatter, specks and grit
      ez.cur = ez.cur + 1;
      op.disks.forEach((d, i) => ez.disk(ras(d[0]!), ras(d[1]!), ras(d[2]!), d[3]!, op.cols[i]!, d[4]!, d[5]!, d[6]!));
      ez.composite({ op: OP_PAINT, opacity: op.comp.opacity, tooth: 0, thick: op.comp.thick, wet: op.comp.wet, role: -1, glaze: q12(0.35), gloss: op.comp.gloss, broken: 0, brokenScale: 0, brokenAng: 0, ignoreWin: 0 });
      return;
    }
    case 6: { // taped border: paint stops at a crisp line with a ridge where it built up against the tape
      const tw = f16(op.tw, D * 256); // Q8 raster px
      const CAN = ez.CAN, BASE = ez.BASE;
      const lim = tw + 3 * S8;
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const dd = minI(minI(x, y), minI(D - 1 - x, D - 1 - y)) * 256; if (dd > lim) continue;
        const p = y * D + x;
        const bleed = f12(vn(Math.floor((x * Q * 256) / (3 * S8)), Math.floor((y * Q * 256) / (3 * S8)), op.s0) - 32768 >> 4, q12(1.2)) * S8 >> 12;
        const o = p << 3;
        if (dd < tw + bleed) { const bc = BASE[p]!; CAN[o] = ((bc >>> 20) & 1023) << 2; CAN[o + 1] = ((bc >>> 10) & 1023) << 2; CAN[o + 2] = (bc & 1023) << 2; CAN[o + 4] = 0; CAN[o + 3] = 0; CAN[o + 7] = CAN[o + 7]! & 0xff00; }
        else if (dd < tw + f12(q12(2.5), S8) && CAN[o + 4]! > 1229) CAN[o + 3] = minI(65535, CAN[o + 3]! + f12(q12(0.6), CAN[o + 4]!));
      }
      return;
    }
  }
}


/** The band windows, rasterised once with a ragged displaced edge: colour paint thins out and stops at them. */
function applyWindows(ez: Easel, P: V15Plan): void {
  const D = ez.D;
  if (!P.opens.some((o) => o.inner)) return;
  const W8 = new Uint8Array(ez.N);
  for (const w of P.opens) if (w.inner) {
      const x0 = maxI(0, Math.floor(((w.x - f12(w.rx, q12(1.6))) * D) / Q)), x1 = minI(D - 1, Math.floor(((w.x + f12(w.rx, q12(1.6))) * D) / Q));
      const y0 = maxI(0, Math.floor(((w.y - f12(w.ry, q12(1.6))) * D) / Q)), y1 = minI(D - 1, Math.floor(((w.y + f12(w.ry, q12(1.6))) * D) / Q));
      for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
        const xu = Math.floor((X * Q) / D), yu = Math.floor((Y * Q) / D);
        const dd = hypot(Math.floor(((xu - w.x) * ONE) / w.rx), Math.floor(((yu - w.y) * ONE) / w.ry)) + f12(q12(0.45), n12(tfbm(xu * 14, yu * 14, P.wSeed, 3)) - 2048) + f12(q12(0.15), n12(tfbm(xu * 60, yu * 60, P.wSeed + 3, 2)) - 2048);
        const v = (sm(Math.floor(((ONE - dd) * ONE) / q12(0.3))) * 255) >> 12, p = Y * D + X;
        if (v > W8[p]!) W8[p] = v;
      }
  }
  ez.WIN = W8;
}

/* ── The painter ───────────────────────────────────────────────────────────────────────────────────────────────── */
interface PaintResult { ez: Easel; score: Op[]; staples: number[]; measures: V15Measures; prm: Uint8Array | null }
export interface V15Measures { open: number; mud: number; valueRange: number; saturatedShare: number; focalEdge: number; openTarget: number; strokes: number; rounds: number }

/** Paint the plan on an easel at scale S8 (the painter decides as it looks at this canvas), keeping the score when asked. */
function paint(P: V15Plan, S8: number, keepScore: boolean): PaintResult {
  const ez = makeEasel(P, S8);
  const prm = primedPlane(P, ez.D, S8);
  groundInit(ez, P, prm);
  ez.setTau(P.sessions === 1 ? 1600 : 700);
  applyWindows(ez, P);
  const D = ez.D, CAN = ez.CAN, ROLEMAP = ez.ROLEMAP;
  const rng = seeded(P.seed, 0);
  const score: Op[] = [];
  const lay = (op: Op): void => { if (keepScore) score.push(op); layOp(ez, op); };
  const strategy = P.strategy, energy = P.energy, speed = P.speed;
  const masses: V15Mass[] = P.masses.map((m) => ({ ...m }));
  const opens = P.opens, focal = P.focal.map((f) => [...f]), flowA = P.flowA;
  const cD = P.cD, cS = P.cS, cA = P.cA, cK = P.cK, cP = P.cP;
  const surpriseCol = P.surprise >= 0 ? SURPRISE_COLS[P.surprise]! : null;
  const keyTint = P.key === KEY_LIGHT ? q12(0.32) : P.key === KEY_DARK ? q12(0.04) : q12(0.12);
  const keyShade = P.key === KEY_DARK ? q12(0.4) : P.key === KEY_LIGHT ? q12(0.04) : q12(0.12);
  const handBias = P.hand ? ra(0.18) : ra(-0.18);
  const impasto = P.impasto;
  const XY = (x: number, y: number): number[] => [x * 75, y * 75]; // Q16 of the side to layout px Q12
  const toN = (v: number): number => Math.floor(v / 75); // layout px Q12 to Q16 of the side
  const kq = (rad: number): number => Math.round((rad * A * 256) / (2 * Math.PI)); // curvature, radians a px, in 1/256 angle units a px
  const KQ1 = kq(1);

  // ---- paths (layout px, Q12)
  const gesturePath = (x: number, y: number, h: number, len: number, o: { k0?: number; kA?: number; kF?: number; kMax?: number; hook?: number } = {}): number[] => {
    const k0 = o.k0 ?? 0, kA = f12(o.kA ?? kq(0.004), q12(1.35) - f12(q12(0.7), speed)), kF = o.kF ?? Math.floor(Q / 140), kMax = o.kMax ?? kq(0.08), hook = o.hook ?? 0;
    const s0 = rng.int16(), pts: number[] = [], n = maxI(2, (len + 2048) >> 12);
    let hq = h * 256;
    for (let i = 0; i < n; i++) {
      pts.push(x, y);
      let k = k0 + f12(kA, (n12(noise1(i * kF, s0)) * 2 - ONE) * 2);
      if (hook && i * 10 > n * 8) k += hook;
      k = cl(k, -kMax, kMax); hq += k; const ha = Math.floor(hq / 256); x += cosA(ha) >> 2; y += sinA(ha) >> 2;
    }
    return pts;
  };
  const resample = (pts: number[], step = PX): number[] => {
    const out = [pts[0]!, pts[1]!]; let acc = 0;
    for (let i = 2; i < pts.length; i += 2) {
      let ax = pts[i - 2]!, ay = pts[i - 1]!; const bx = pts[i]!, by = pts[i + 1]!; let dd = hypot(bx - ax, by - ay);
      while (acc + dd >= step && dd > 0) { const need = step - acc; ax += Math.floor(((bx - ax) * need) / dd); ay += Math.floor(((by - ay) * need) / dd); out.push(ax, ay); dd = hypot(bx - ax, by - ay); acc = 0; }
      acc += dd;
    }
    return out;
  };
  const chaikin = (pts: number[], it: number): number[] => { let p = pts; for (let k = 0; k < it; k++) { const q: number[] = [p[0]!, p[1]!]; for (let i = 0; i < p.length - 2; i += 2) q.push((3 * p[i]! + p[i + 2]!) >> 2, (3 * p[i + 1]! + p[i + 3]!) >> 2, (p[i]! + 3 * p[i + 2]!) >> 2, (p[i + 1]! + 3 * p[i + 3]!) >> 2); q.push(p[p.length - 2]!, p[p.length - 1]!); p = q; } return p; };
  const scrubPath = (cx: number, cy: number, dirA: number, amp: number, adv: number, cycles: number): number[] => {
    const pts: number[] = []; const s0 = rng.int16(), n = 400, dx = cosA(dirA) >> 2, dy = sinA(dirA) >> 2, ex = -dy, ey = dx;
    for (let i = 0; i <= n; i++) {
      const t = Math.floor((i * ONE) / n);
      const a = f12(amp, q12(0.75) + f12(q12(0.5), n12(noise1(Math.floor((i * 3 * Q) / n), s0))));
      const o = f12(sinA(Math.floor((i * cycles * 4) / n)) >> 2, a), v = f12(t - 2048, adv) + f12(n12(noise1(Math.floor((i * 5 * Q) / n), s0 + 1)) - 2048, f12(amp, q12(0.3)));
      pts.push(cx + f12(dx, o) + f12(ex, v), cy + f12(dy, o) + f12(ey, v));
    }
    return resample(pts);
  };
  const loopPath = (x: number, y: number, h: number, len: number, rad: number): number[] => {
    const pts: number[] = []; const s0 = rng.int16(); let sgn = rng.ch(2048) ? 1 : -1, hq = h * 256;
    const n = (len + 2048) >> 12, k1 = Math.floor((KQ1 * ONE) / rad);
    for (let i = 0; i < n; i++) {
      pts.push(x, y);
      if (n12(noise1(Math.floor((i * Q) / 70), s0)) > q12(0.74) && n12(noise1(Math.floor(((i - 1) * Q) / 70), s0)) <= q12(0.74)) sgn = -sgn;
      const k = sgn * f12(k1, q12(0.1) + f12(q12(1.7), pow12(n12(noise1(Math.floor((i * Q) / 35), s0 + 1)), q12(1.5)))) + f12(n12(noise1(Math.floor((i * Q) / 9), s0 + 2)) - 2048, kq(0.04));
      hq += k; const ha = Math.floor(hq / 256); x += cosA(ha) >> 2; y += sinA(ha) >> 2;
    }
    return pts;
  };
  const zigzagPath = (x: number, y: number, h: number, segs: number, segL: number, ang: number): number[] => {
    const pts = [x, y]; let sgn = 1;
    for (let i = 0; i < segs; i++) { const a = h + sgn * f12(ang, rng.f(0.7, 1.2)); const L = f12(segL, rng.f(0.7, 1.3)); x += f12(cosA(a) >> 2, L); y += f12(sinA(a) >> 2, L); pts.push(x, y); sgn = -sgn; }
    return resample(chaikin(pts, 2));
  };
  const scribblePath = (x: number, y: number, len: number): number[] => gesturePath(x, y, rng.r(0, A), len, { kA: kq(0.09), kF: Math.floor(Q / 14), kMax: kq(0.22) });

  // ---- colour choices
  const vary = (c: readonly number[], a = ONE): C3 => {
    const [h, s, v] = rgb2hsv(c);
    return tameGreen(hsv2rgb([h + f12(f12(rng.g(), q12(0.012)), a), c1(f12(s, ONE + f12(f12(rng.g(), q12(0.08)), a))), cl(f12(v, ONE + f12(f12(rng.g(), q12(0.06)), a)), q12(0.02), ONE)]));
  };
  const colourFor = (role: number, pale = 0, grey = 0): C3 => {
    let c: C3 = (role === 0 ? cD : role === 1 ? (rng.ch(q12(0.68)) ? cS[0]! : cS[cS.length - 1]!) : role === 2 ? cA : role === 3 ? cK : cP) as C3;
    if (role <= 1) {
      if (rng.ch(keyTint)) c = tint(c, rng.f(0.15, 0.5));
      else if (rng.ch(keyShade)) c = rng.ch(2048) ? shade(c, rng.f(0.15, 0.35)) : lerp3(c, compOf(c), rng.f(0.06, 0.16));
    }
    if (pale > 0) c = tint(c, minI(P.key === KEY_LIGHT ? q12(0.3) : q12(0.5), f12(pale, rng.f(0.6, 1.2))));
    if (grey > 0) {
      const s0 = sat(c), gg = minI(f12(grey, rng.f(0.5, 1)), s0 > q12(0.3) ? ONE - Math.floor((q12(0.3) * ONE) / s0) : 0);
      if (gg > 0) { const l = lum(c); c = lerp3(c, [l, l, l], gg); if (lum(c) < q12(0.72)) c = tint(c, f12(gg, q12(0.6))); }
    }
    return vary(c);
  };

  // ---- composition fields (positions Q16 of the side)
  const corner = (x: number, y: number): boolean => (x < 8520 || x > 57016) && (y < 8520 || y > 57016);
  const openAt = (x0: number, y0: number): number => {
    const x = x0 + f16(q16(0.1), fbm(f16(x0, q16(2.6)), f16(y0, q16(2.6)), P.oSeed, 3) - 32768), y = y0 + f16(q16(0.14), fbm(f16(x0, q16(2.6)) + q16(9), f16(y0, q16(2.6)), P.oSeed + 1, 3) - 32768);
    let o = 0;
    for (const s of opens) {
      let v = 0;
      if (s.kind === O_BOTTOM) v = sm(Math.floor(((y - s.y - f16(q16(0.16), fbm(f16(x, q16(2.2)), q16(3.1), P.oSeed + 9, 2) - 32768) - f16(q16(0.035), fbm(f16(x, q16(6.5)), q16(4.3), P.oSeed + 10, 2) - 32768)) * 256) / s.soft) + 2048);
      else if (s.kind === O_TOP) v = sm(Math.floor(((s.y + f16(q16(0.28), fbm(f16(x, q16(2.4)), q16(0.7), P.oSeed + 5, 2) - 32768) + f16(q16(0.04), fbm(f16(x, q16(7)), q16(1.9), P.oSeed + 6, 2) - 32768) - y) * 256) / s.soft) + 2048);
      else { const dd = hypot(Math.floor(((x - s.x) * ONE) / s.rx), Math.floor(((y - s.y) * ONE) / s.ry)); v = sm(Math.floor(((ONE - dd) * minI(s.rx, s.ry)) / (s.soft * 16)) + 2048); }
      if (v > o) o = v;
    }
    return o;
  };
  const innerAt = (x: number, y: number): number => { let o = 0; for (const s of opens) if (s.inner) { const dd = hypot(Math.floor(((x - s.x) * ONE) / (s.rx + 3277)), Math.floor(((y - s.y) * ONE) / (s.ry + 3277))); o = maxI(o, ONE - dd); } return o; };
  const f0 = (): number[] => focal[0]!;
  const energyAt = (x: number, y: number): number => {
    const dx = x - f0()[0]!, dy = y - f0()[1]!;
    return c1(f12(energy, q12(0.25) + f12(q12(0.9), n12(fbm(f16(x, q16(2.2)), f16(y, q16(2.2)), P.eSeed, 2)) - q12(0.3))) + f12(q12(0.45), expQ(-Math.floor(((dx * dx + dy * dy) * 1000) / (65536 * 12))) >> 4));
  };
  const sizes = [f12(P.wBig, q12(1.6)), P.wBig, f12(P.wBig, q12(0.55)), f12(P.wBig, q12(0.3)), f12(P.wBig, q12(0.15))];
  const calmK = ONE - energy, layerCap = f12(q12(3) + 5 * energy, strategy === ST_BAND ? q12(0.65) : ONE);
  const classW = [q12(0.6) + f12(q12(0.8), calmK), q12(1.5) + f12(q12(0.8), calmK), q12(1.6), f12(q12(1.5), q12(0.35) + f12(q12(0.8), energy)), f12(q12(1.1), q12(0.25) + f12(q12(0.9), energy))];
  const shareTarget = [q12(0.6), q12(0.3), q12(0.1)], chroma = [0, 0, 0];
  const zone = (x: number, y: number, k: number): number => smr(n12(fbm(f16(x, P.cScale) + k * q16(7.1), f16(y, P.cScale) - k * q16(3.3), P.cSeed + k, 2)), 2048, q12(0.09));
  const chooseRole = (massRole: number, x: number, y: number): number => {
    const tot = chroma[0]! + chroma[1]! + chroma[2]! + 1;
    const def = [0, 1, 2].map((r) => shareTarget[r]! - Math.floor((chroma[r]! * ONE) / tot));
    const dF = hypot(x - f0()[0]!, y - f0()[1]!);
    if (dF < q16(0.16) && rng.ch(cl(q12(0.1) + def[2]! * 3, 0, q12(0.5)))) return 2;
    const base0 = massRole === 1 ? q12(0.62) : massRole === 2 ? q12(0.5) : q12(0.12);
    const pS = cl((base0 >> 1) + f12(zone(x, y, 1), q12(0.55)) + f12(def[1]!, q12(2.5)), q12(0.02), q12(0.97));
    return rng.ch(pS) ? 1 : 0;
  };
  const fieldDir = (x: number, y: number): number => f16((fbm(f16(x, P.dScale), f16(y, P.dScale), P.dSeed, 2) - 32768) * 2, P.dTurn);
  const dirFor = (m: V15Mass, x0?: number, y0?: number): number => {
    const x = x0 ?? m.x, y = y0 ?? m.y;
    if (rng.ch(q12(0.09))) return flowA + QUARTER_A + rng.ang(-0.3, 0.3);
    if (m.radial > 0 && rng.ch(m.radial)) return atan2A(y - m.y, x - m.x) + rng.ang(-0.3, 0.3);
    const f = fieldDir(x, y);
    if (m.hasDir) return m.dir + f12(f, q12(0.45)) + rng.ang(-0.18, 0.18) + (handBias >> 1);
    return flowA + f + rng.ang(-0.22, 0.22) + handBias;
  };
  const porous = (x: number, y: number): number => ONE - f12(P.porosity, smr(n12(fbm(x * 7, y * 7, P.pSeed, 3)), q12(0.38), q12(0.2)));
  let spreadAll = false, relax = 0;
  const edgeM = strategy === ST_FIELD ? q16(0.03) : q16(0.075), trimM = strategy === ST_FIELD ? q16(0.015) : q16(0.035);
  const bites = P.bites;
  const outlineOf = (m: V15Mass, x: number, y: number): number => {
    const dx = x - m.x, dy = y - m.y, cr = cosA(m.rot), sr = sinA(m.rot);
    const u = Math.floor(((dx * cr + dy * sr) / 16384) * ONE / m.rx), v = Math.floor(((-dx * sr + dy * cr) / 16384) * ONE / m.ry);
    const d = hypot(u, v);
    if (d > q12(2.6)) return 0;
    const a = Math.floor((atan2A(v, u) * 411775) / A), s0 = m.lumpS; // radians Q16
    const sp = n12(noise1(f16(a, q16(8.3)), s0 + 2)), sp2 = f12(sp, sp), sp6 = f12(f12(sp2, sp2), sp2);
    const rr = f12(q12(1.12), ONE + f12(m.lumpA, (n12(noise1(f16(a, q16(1.3)) + q16(5), s0)) - 2048) * 2) + f12(f12(m.lumpA, q12(0.6)), (n12(noise1(f16(a, q16(3.7)) + q16(9), s0 + 1)) - 2048) * 2) + f12(m.spike, sp6) * 3);
    return sm(Math.floor(((rr - d) * ONE) / q12(0.22)) + 2048);
  };
  const outlineAt = (x: number, y: number): number => {
    let f = 0;
    for (const m of masses) { if (m.kind === K_CALM) continue; const v = outlineOf(m, x, y); if (v > f) { f = v; if (f > q12(0.98)) break; } }
    for (const b of bites) { const d = Math.floor((hypot(x - b[0]!, y - b[1]!) * ONE) / b[2]!); if (d < q12(1.3)) f = f12(f, smr(d, q12(0.75), q12(0.4))); }
    return f;
  };
  const silC = cosA(P.silA), silSn = sinA(P.silA);
  const silAt = (x: number, y: number): number => {
    const wx = x + f16(P.silWarp, fbm(f16(x, q16(2.1)) + q16(3), f16(y, q16(2.1)), P.silSeed + 7, 2) - 32768), wy = y + f16(P.silWarp, fbm(f16(x, q16(2.1)), f16(y, q16(2.1)) + q16(5), P.silSeed + 8, 2) - 32768);
    const xr = Math.floor((wx * silC - wy * silSn) / 16384), yr = Math.floor((wx * silSn + wy * silC) / 16384);
    let v = sm(Math.floor(((fbm(f16(xr, P.silS) + q16(11), f16(f16(yr, P.silS), q16(1.3)), P.silSeed, 3) - P.silThr) * ONE) / q16(0.12)));
    v = f12(v, ONE - f12(P.silK, sm(Math.floor((((x - 32768) * silC + (y - 32768) * silSn) / 16384) * ONE / q16(0.3)) + 2048)));
    const dx = x - f0()[0]!, dy = y - f0()[1]!;
    return maxI(maxI(v, expQ(-Math.floor(((dx * dx + dy * dy) * 1000) / (65536 * 8))) >> 4), q12(0.06));
  };
  const samplePt = (m: V15Mass, spread = ONE): number[] | null => {
    const cr = cosA(m.rot), sr = sinA(m.rot);
    for (let k = 0; k < 30; k++) {
      const u = f12(f12(Math.floor(((rng.u() + rng.u() + rng.u() - 6144) * ONE) / 6144), q12(1.25)), spread), v = f12(f12(Math.floor(((rng.u() + rng.u() + rng.u() - 6144) * ONE) / 6144), q12(1.25)), spread);
      const ur = f12(u, m.rx), vr = f12(v, m.ry);
      const x = m.x + Math.floor((ur * cr - vr * sr) / 16384), y = m.y + Math.floor((ur * sr + vr * cr) / 16384);
      if (x < q16(0.02) || x > q16(0.98) || y < q16(0.02) || y > q16(0.98) || corner(x, y)) continue;
      if (rng.u() > pow12(f12(silAt(x, y), m.kind === K_CALM ? ONE : q12(0.15) + f12(q12(0.85), outlineAt(x, y))), ONE - f12(relax, q12(0.8)))) continue;
      { const de = Math.min(x, Q - x, y, Q - y), soft = edgeM + f16(q16(0.09), fbm(x * 5 + y * 2, y * 5 - x * 2, P.mSeed, 2) - q16(0.35)); if (rng.u() < sm(Math.floor(((soft - de) * ONE) / q16(0.05)) + 2048)) continue; }
      if (rng.u() < f12(openAt(x, y), q12(0.96))) continue;
      if (!spreadAll && rng.u() > porous(x, y)) continue;
      return [x, y];
    }
    return null;
  };
  let session = 1, rounds = 0, strokes = 0;
  const press = (o: { s?: number; b?: number; l?: number; e?: number } = {}): number[] => [o.s ?? f12(rng.f(0.65, 0.95), minI(ONE, P.pressure)), o.b ?? rng.f(0.03, 0.08), o.l ?? rng.f(0.12, 0.35), o.e ?? rng.f(0, 0.35)];
  const fatGloss = (): number => cl(q12(0.25) + f12(f12(f12(q12(0.75), P.fat), rng.f(0.6, 1.2)), q12(0.7) + q12(0.15) * session), q12(0.1), ONE);
  const base = (o: Partial<Mark> & { W: number; col: C3 }): Mark => ({
    col2: null, side: 0, mix2: 0, load: ONE, dryFrac: q12(1.2), pickup: q12(0.5), opacity: ONE, thick: q12(0.45), round: q12(0.15), follow: q12(0.06),
    tooth: 1, wet: ONE, gaps: q12(0.06), lip: q12(0.5), role: 0, press: press(), gloss: fatGloss(),
    pf: PF_NONE, pfA: 0, pfB: 0, fade: 0, soft: 0, crisp: 0, nb: 0, nbK: 0, nbMin: 0, dome: 0, ridges: 0, wobble: 0, angle0: AUTO, memory: 0, carry: ONE, ridge: AUTO,
    broken: 0, brokenScale: q12(9), brokenAng: 0, twist: AUTO, splay: AUTO, hook: AUTO, widthVar: AUTO, rag: AUTO, op: OP_PAINT, noTrim: 0, ignoreWin: 0, glaze: q12(0.35),
    ...o,
  });
  const trimPath = (path: number[], Wst: number): number[] => {
    const shooter = rng.ch(q12(0.12)), thr = shooter ? 2 * ONE : rng.f(0.62, 0.97), outT = rng.f(0.05, 0.3), tm = trimM + f12(rng.q(0, 0.05), rng.u());
    const hw = Math.floor((f12(Wst, q12(0.42)) * Q) / (1200 * PX)); // Q16 of the side
    const stop = (i: number): number[] => (i < 120 || i * 10 < path.length * 4 ? [] : path.slice(0, i));
    for (let i = 0; i < path.length; i += 6) {
      const x = toN(path[i]!), y = toN(path[i + 1]!);
      if (hw > q16(0.004) && i + 3 < path.length && !shooter) {
        const tx = path[i + 2]! - path[i]!, ty = path[i + 3]! - path[i + 1]!, tl = hypot(tx, ty) || 1, nx = Math.floor((-ty * hw) / tl), ny = Math.floor((tx * hw) / tl);
        if (maxI(openAt(x + nx, y + ny), openAt(x - nx, y - ny)) > thr + q12(0.05)) return stop(i);
      }
      const tmx = tm + f16(q16(0.03), fbm(x * 9, y * 9, P.mSeed + 3, 2) - 32768);
      if (x < tmx || x > Q - tmx || y < tmx || y > Q - tmx || corner(x, y) || openAt(x, y) > thr || (!shooter && i > 30 && outlineAt(x, y) < outT)) return stop(i);
    }
    return path;
  };
  const doStroke = (st: Mark, path: number[]): number[] => {
    if (st.role >= 0 && st.role <= 3 && !st.noTrim) path = trimPath(path, st.W);
    if (path.length >= 4) lay({ k: 0, st, path });
    strokes++;
    if (st.role >= 0 && st.role <= 2) chroma[st.role] = chroma[st.role]! + f12(f12(st.W, path.length >> 1), st.opacity);
    return path;
  };
  const speedDry = q12(1.25) - f12(q12(0.55), speed);
  const along = (x: number, y: number, h: number, L: number): number[] => [x - (f12(cosA(h) >> 2, L) >> 1), y - (f12(sinA(h) >> 2, L) >> 1)];
  const curl = P.curl, tools = P.tools;
  const T_FLAT = 0, T_ROUND = 1, T_RIGGER = 2, T_FAN = 3, T_KNIFE = 4, T_MOP = 5, T_SPONGE = 6, T_DAB = 7, T_TAP = 8, T_FLICK = 9, T_SCRIBBLE = 10, T_LOOP = 11, T_ZIGZAG = 12, T_CALM = 13;
  type O2 = { role?: number; col2?: C3 | null; load?: number; thick?: number; opacity?: number; broken?: number; kind?: number; W?: number; len?: number; rad?: number; w?: number; hero?: boolean; dark?: boolean };

  // ---- tools (the mark library)
  const T = {
    flat(x: number, y: number, h: number, W: number, L: number, col: C3, o: O2 = {}): number[] {
      const kS = f12(minI(ONE, Math.floor((30 * PX * ONE) / W)), curl);
      const s = along(x, y, h, L);
      const path = gesturePath(s[0]!, s[1]!, h, L, { kA: f12(rng.r(kq(0.001), kq(0.005)), kS), k0: f12(rng.r(kq(-0.003), kq(0.003)), kS), kMax: Math.floor((KQ1 * PX) / maxI(20 * PX, 3 * W)), hook: rng.ch(q12(0.15)) ? f12(rng.r(kq(-0.03), kq(0.03)), kS) : 0 });
      const side = o.col2 && rng.ch(q12(0.4)) ? (rng.ch(2048) ? 1 : -1) : 0;
      doStroke(base({ W, col, col2: o.col2 ?? null, side, mix2: rng.f(0.15, 0.45), load: f12(o.load ?? rng.f(0.4, 1.15), q12(1.1) - f12(q12(0.2), speed)), dryFrac: f12(rng.f(0.7, 1.8), speedDry), pickup: rng.f(0.3, 0.8), thick: f12(o.thick ?? rng.f(0.3, 0.6), impasto), round: q12(0.12), follow: rng.f(0.02, 0.12), role: o.role ?? -1, lip: rng.f(0.3, 0.8) }), path);
      return path; // the untrimmed path: a restatement or a correction follows the gesture, then is trimmed itself
    },
    scrub(x: number, y: number, dir: number, W: number, col: C3, o: O2 = {}): void {
      const path = scrubPath(x, y, dir, f12(W, rng.f(0.5, 1.1)), f12(W, rng.f(0.6, 1.4)), rng.f(2, 4.5));
      doStroke(base({ W, col, load: o.load ?? rng.f(0.32, 0.55), dryFrac: rng.f(1.5, 3), pickup: q12(1.2), fade: 1, pf: PF_SCRUB, opacity: o.opacity ?? rng.f(0.5, 0.8), thick: q12(0.06), follow: q12(0.03), angle0: dir + QUARTER_A + rng.ang(-0.5, 0.5), round: q12(0.3), press: press({ s: q12(0.6), b: q12(0.15), l: q12(0.3), e: q12(0.1) }), role: o.role ?? -1, lip: 0, glaze: q12(0.8), gaps: q12(0.15), gloss: q12(0.25), soft: q12(0.35), twist: ra(0.35), widthVar: q12(0.4), broken: o.broken ?? rng.f(0.4, 0.75), brokenScale: rng.f(3, 7), brokenAng: dir }), path);
    },
    round(x: number, y: number, h: number, W: number, L: number, col: C3, o: O2 = {}): void {
      const kind = o.kind ?? rng.pick([PF_TAPER, PF_SWELL, PF_TAPER, -1]);
      const s = along(x, y, h, L);
      const path = gesturePath(s[0]!, s[1]!, h, L, { kA: rng.r(kq(0.004), kq(0.012)), kF: Math.floor(Q / 80), kMax: minI(kq(0.08), Math.floor((KQ1 * PX * 10) / (W * 22))), hook: kind === -1 ? (rng.ch(2048) ? 1 : -1) * rng.r(kq(0.03), kq(0.07)) : 0 });
      doStroke(base({ W, col, load: rng.f(0.9, 1.15), dryFrac: f12(rng.f(1, 2.4), speedDry), pickup: q12(0.35), thick: f12(q12(0.55), impasto), round: q12(0.9), follow: q12(0.7), pf: kind === -1 ? PF_NONE : kind, gaps: q12(0.02), role: o.role ?? -1, lip: q12(0.4) }), path);
    },
    rigger(x: number, y: number, h: number, L: number, col: C3, o: O2 = {}): void {
      const path = gesturePath(x, y, h, L, { kA: rng.r(kq(0.002), kq(0.008)), kF: Math.floor(Q / 160), kMax: kq(0.05) });
      doStroke(base({ W: rng.f(1.3, 2.8), nb: 3, col, load: q12(1.05), dryFrac: rng.f(2, 5), pickup: q12(0.2), thick: q12(0.15), round: ONE, follow: ONE, pf: PF_RIGGER, gaps: 0, lip: q12(0.2), role: o.role ?? -1 }), path);
    },
    fan(x: number, y: number, h: number, W: number, L: number, col: C3, o: O2 = {}): void {
      const s = along(x, y, h, L);
      const path = gesturePath(s[0]!, s[1]!, h, L, { kA: rng.r(kq(0.003), kq(0.008)), kMax: kq(0.04) });
      doStroke(base({ W, nb: rng.i(7, 15), col, load: rng.f(0.65, 0.95), dryFrac: f12(rng.f(0.6, 1.1), speedDry), pickup: q12(0.4), thick: q12(0.3), round: 0, follow: q12(0.15), wobble: rng.f(0.8, 2), gaps: q12(0.1), lip: q12(0.1), role: o.role ?? -1 }), path);
    },
    knife(x: number, y: number, h: number, W: number, L: number, col: C3, o: O2 = {}): void {
      const s = along(x, y, h, L);
      const path = gesturePath(s[0]!, s[1]!, h, L, { kA: kq(0.003), kMax: kq(0.02) });
      doStroke(base({ W, col, load: rng.f(0.75, 1), dryFrac: rng.f(0.8, 1.4), pickup: q12(1.1), thick: q12(0.18), round: q12(0.1), follow: q12(0.2), angle0: h + QUARTER_A + rng.ang(-0.15, 0.15), crisp: 1, gaps: q12(0.12), lip: q12(1.4), op: OP_KNIFE, tooth: 0, gloss: q12(0.9), role: o.role ?? -1, press: [ONE, q12(0.02), q12(0.3), q12(0.2)] }), path);
    },
    mop(x: number, y: number, h: number, W: number, L: number, col: C3, o: O2 = {}): void {
      const s = along(x, y, h, L);
      const path = gesturePath(s[0]!, s[1]!, h, L, { kA: kq(0.002), kMax: kq(0.01) });
      doStroke(base({ W, col, load: q12(0.75), dryFrac: q12(4), pickup: q12(0.9), opacity: o.opacity ?? rng.f(0.22, 0.45), thick: q12(0.02), round: q12(0.2), follow: q12(0.05), soft: q12(0.5), fade: 1, pf: PF_WASH, tooth: 0, glaze: q12(0.85), gaps: 0, lip: 0, gloss: q12(0.3), role: o.role ?? -1 }), path);
    },
    drag(x: number, y: number, h: number, L: number, W: number, col: C3, o: O2 = {}): void {
      let path = gesturePath(x, y, h, L, { kA: rng.r(kq(0.001), kq(0.003)), kF: Math.floor(Q / 300), kMax: kq(0.01) });
      { let st0 = -1, en = path.length; for (let i = 0; i < path.length; i += 2) { const px = toN(path[i]!), py = toN(path[i + 1]!); const out = px < q16(0.03) || px > q16(0.97) || py < q16(0.03) || py > q16(0.97) || corner(px, py); if (!out && st0 < 0) st0 = i; else if (out && st0 >= 0) { en = i; break; } } path = st0 < 0 ? [] : path.slice(st0, en); }
      if (path.length < 160) return;
      doStroke(base({ W, col, load: o.load ?? rng.f(0.7, 1), dryFrac: rng.f(2.5, 5), pickup: o.hero ? rng.f(1.4, 2.2) : rng.f(2.2, 3.4), memory: rng.f(220, 520), ridge: rng.f(0.35, 0.65), carry: o.hero ? q12(0.8) : q12(1.2), opacity: o.hero ? rng.f(0.86, 0.96) : rng.f(0.72, 0.92), glaze: q12(0.45), thick: q12(0.22), round: q12(0.15), follow: q12(0.04), gaps: q12(0.18), lip: q12(0.4), rag: ONE, splay: rng.f(0.5, 1.2), gloss: q12(0.55), role: o.role ?? 4, noTrim: 1, press: press({ s: q12(0.9), b: q12(0.04), l: rng.f(0.15, 0.3), e: rng.f(0, 0.25) }) }), path);
    },
    dab(x: number, y: number, h: number, W: number, col: C3, o: O2 = {}): void {
      const L = f12(W, rng.f(0.5, 1.5));
      doStroke(base({ W, col, col2: o.col2 ?? null, mix2: q12(0.35), load: q12(1.35), dryFrac: rng.f(2.5, 5), pickup: q12(0.45), thick: f12(rng.f(0.7, 1.2), impasto), dome: 1, rag: q12(0.2), round: q12(0.55), follow: q12(0.03), press: press({ s: q12(0.95), e: rng.f(0.2, 0.5), l: q12(0.3) }), role: o.role ?? -1, lip: ONE, gaps: q12(0.03), gloss: q12(0.85) }), gesturePath(x, y, h, L, { kA: kq(0.004), kMax: kq(0.05) }));
    },
    tap(x: number, y: number, Rr: number, col: C3, o: O2 = {}): void {
      const n = rng.i(5, 14);
      for (let i = 0; i < n; i++) { const a = rng.r(0, A), d = f12(sqrt12(rng.u()), Rr); const W = rng.f(7, 16); doStroke(base({ W, col: vary(col, q12(0.6)), load: q12(1.3), rag: q12(0.2), dryFrac: q12(4), pickup: q12(0.5), thick: f12(q12(0.9), impasto), dome: 1, round: q12(0.7), follow: q12(0.1), press: press({ s: q12(0.95), e: q12(0.4), l: q12(0.4) }), role: o.role ?? -1, lip: ONE, gaps: 0, gloss: q12(0.8) }), gesturePath(x + f12(cosA(a) >> 2, d), y + f12(sinA(a) >> 2, d), rng.r(0, A), f12(W, rng.f(0.4, 1)))); }
    },
    flick(x: number, y: number, h: number, col: C3, o: O2 = {}): void {
      const L = rng.f(12, 60);
      doStroke(base({ W: rng.f(2, 7), col, load: ONE, dryFrac: q12(1.5), pickup: q12(0.2), thick: q12(0.5), round: ONE, follow: ONE, pf: PF_FLICK, gaps: 0, lip: q12(0.3), role: o.role ?? -1 }), gesturePath(x, y, h, L, { kA: kq(0.01), kMax: kq(0.05) }));
    },
    loop(x: number, y: number, h: number, col: C3, o: O2 = {}): void {
      const path = loopPath(x, y, h, o.len ?? rng.f(200, 600), o.rad ?? rng.f(35, 110));
      doStroke(base({ W: o.W ?? rng.f(3, 8), col, load: q12(1.05), dryFrac: f12(rng.f(1.2, 2.4), speedDry), pickup: q12(0.3), thick: f12(q12(0.6), impasto), round: q12(0.9), follow: q12(0.6), press: press({ l: q12(0.25), e: q12(0.05) }), role: o.role ?? -1, lip: q12(0.4), gaps: 0 }), path);
    },
    zigzag(x: number, y: number, h: number, col: C3, o: O2 = {}): void {
      const path = zigzagPath(x, y, h, rng.i(3, 7), rng.f(20, 60), rng.ang(0.6, 1.3));
      doStroke(base({ W: rng.f(3, 10), col, load: ONE, dryFrac: f12(q12(1.6), speedDry), pickup: q12(0.3), thick: q12(0.5), round: q12(0.85), follow: q12(0.6), role: o.role ?? -1, lip: q12(0.3), gaps: 0 }), path);
    },
    scribble(x: number, y: number, col: C3, o: O2 = {}): void {
      doStroke(base({ W: rng.f(2, 6), col, load: ONE, dryFrac: f12(q12(1.4), speedDry), pickup: q12(0.3), thick: q12(0.45), round: q12(0.95), follow: q12(0.8), role: o.role ?? -1, lip: q12(0.2), gaps: 0 }), scribblePath(x, y, rng.f(110, 320)));
    },
    sponge(x: number, y: number, Rr: number, col: C3, o: O2 = {}): void {
      const s0 = rng.int16(), thr = rng.f(0.52, 0.62);
      lay({ k: 3, x, y, r: Rr, col, s0, thr, role: o.role ?? -1 });
    },
    wipe(x: number, y: number, dir: number, W: number, L: number): void {
      const s = along(x, y, dir, L);
      const path = gesturePath(s[0]!, s[1]!, dir, L, { kA: kq(0.003), kMax: kq(0.02) });
      doStroke(base({ W, col: [2048, 2048, 2048], load: rng.f(0.5, 0.9), dryFrac: q12(2), pickup: 0, opacity: rng.f(0.55, 0.85), op: OP_WIPE, soft: q12(0.35), follow: q12(0.05), round: q12(0.3), gaps: q12(0.2), lip: 0, role: -1, nbK: 1365, nbMin: 1 }), path);
    },
    sgraffito(x: number, y: number, h: number, L: number): void {
      const path = gesturePath(x, y, h, L, { kA: rng.r(kq(0.004), kq(0.02)), kF: Math.floor(Q / 40), kMax: kq(0.1) });
      doStroke(base({ W: rng.f(1.4, 3.2), nb: 3, col: [2048, 2048, 2048], load: ONE, dryFrac: q12(50), pickup: 0, op: OP_SCRATCH, round: ONE, follow: ONE, crisp: 1, gaps: 0, lip: 0, role: -1 }), path);
    },
    smudge(x: number, y: number, h: number): void {
      doStroke(base({ W: rng.f(13, 20), nb: 14, col: [2048, 2048, 2048], load: 0, dryFrac: q12(3), pickup: q12(3.2), opacity: q12(0.85), thick: q12(0.25), round: q12(0.6), follow: q12(0.2), tooth: 0, gaps: 0, lip: 0, ridges: 1, role: -1, press: press({ s: q12(0.9), e: q12(0.2) }) }), gesturePath(x, y, h, rng.f(25, 55), { kA: kq(0.004) }));
    },
    drip(x: number, y: number, col: C3, len: number, o: O2 = {}): void {
      const pts: number[] = []; const s0 = rng.int16(); let dx = 0;
      const n = (len + 4095) >> 12;
      for (let i = 0; i < n; i++) { dx += f12(n12(noise1(Math.floor((i * Q) / 25), s0)) - 2048, q12(0.12)); pts.push(x + dx, y + i * PX); }
      const w0 = o.w ?? rng.f(1.3, 4.2), pool = rng.f(0.25, 0.55);
      doStroke(base({ W: w0, col: vary(col, q12(0.4)), load: ONE, dryFrac: q12(9), pickup: 0, opacity: rng.f(0.75, 0.95), thick: q12(0.5), round: ONE, follow: ONE, tooth: 0, gaps: 0, lip: q12(0.3), role: -1, nbK: q12(1.2), nbMin: 2, glaze: q12(0.5), gloss: q12(0.9), pf: PF_DRIP, pfA: pool }), pts);
    },
    pour(x: number, y: number, Rr: number, col: C3, o: O2 = {}): void {
      const s0 = rng.int16(), lobes: number[][] = [];
      for (let k = 0; k < rng.i(3, 5); k++) lobes.push([x + f12(rng.g(), f12(Rr, q12(0.45))), y + f12(rng.g(), f12(Rr, q12(0.3))) + k * f12(Rr, q12(0.12)), f12(Rr, rng.f(0.45, 0.8))]);
      lay({ k: 4, lobes, col, s0, role: o.role ?? -1 });
      // the lowest point of the pool, on the layout grid (1 px), where the runs start
      let lowX = x, lowY = y;
      const ext = f12(Rr, q12(1.8));
      for (let py = y - ext; py <= y + f12(ext, q12(1.2)); py += PX) for (let px = x - ext; px <= x + ext; px += PX) {
        let e = -(1 << 30);
        for (const [lx, ly, lr] of lobes) { const dx = px - lx!, dy = py - ly!, ar = Math.floor((atan2A(dy, dx) * 411775) / A); const rr = f12(lr!, q12(0.8) + f12(q12(0.3), n12(noise1(2 * ar + lx! * 16, s0))) + f12(q12(0.1), n12(noise1(7 * ar, s0 + 1)))); e = maxI(e, rr - hypot(dx, dy)); }
        if (py > lowY && e > PX) { lowY = py; lowX = px; }
      }
      for (let k = 0; k < rng.i(1, 2); k++) T.drip(lowX + rng.f(-4, 4), lowY - 3 * PX, col, minI(1185 * PX - lowY, rng.f(80, 380)), { w: rng.f(3, 6) });
    },
    spatter(ox: number, oy: number, dir: number, col: C3, n: number, sc: number): void {
      const disks: number[][] = [], cols: C3[] = [];
      const cd = cosA(dir) >> 2, sd = sinA(dir) >> 2;
      for (let i = 0; i < n; i++) {
        const d = f12(-(lnQ(Q - f16(rng.u() << 4, q16(0.98))) >> 4), sc); // exponential throw, layout px Q12
        const lat = f12(f12(rng.g(), q12(0.15) + Math.floor((q12(0.25) * d) / sc)), d) >> 1;
        const x = ox + f12(cd, d) - f12(sd, lat), y = oy + f12(sd, d) + f12(cd, lat);
        const u = rng.u(), u35 = pow12(u, q12(3.5)), rad = q12(0.4) + f12(q12(2.4), u35);
        disks.push([x, y, rad, ONE, q12(0.9), ONE + minI(q12(1.2), Math.floor(f12(d, 2048) * ONE / sc)), dir]); cols.push(col);
        if (rad > q12(1.8) && rng.ch(q12(0.3))) { disks.push([x + f12(f12(cd, rad), q12(2.4)), y + f12(f12(sd, rad), q12(2.4)), f12(rad, q12(0.35)), ONE, ONE, ONE, dir]); cols.push(col); }
      }
      lay({ k: 5, disks, cols, comp: { opacity: ONE, thick: q12(0.9), wet: ONE, gloss: q12(0.8) } });
    },
    glaze(x: number, y: number, h: number, W: number, L: number, col: C3): void {
      const s = along(x, y, h, L);
      const path = gesturePath(s[0]!, s[1]!, h, L, { kA: kq(0.002), kMax: kq(0.01) });
      doStroke(base({ W, col, load: q12(0.8), dryFrac: q12(5), pickup: 0, opacity: rng.f(0.25, 0.45), op: OP_GLAZE, soft: q12(0.6), fade: 1, pf: PF_WASH, tooth: 0, follow: q12(0.05), gaps: 0, lip: 0, role: -1, gloss: q12(0.95) }), path);
    },
    hair(x: number, y: number, h: number, col: C3): void {
      doStroke(base({ W: q12(0.6), nb: 1, col, load: rng.f(0.6, 0.9), dryFrac: ONE, pickup: q12(0.2), thick: q12(0.25), round: ONE, follow: ONE, tooth: 0, gaps: 0, lip: 0, role: -1, press: [q12(0.9), q12(0.05), q12(0.25), 0] }), gesturePath(x, y, h, rng.f(25, 140), { kA: kq(0.01), kMax: kq(0.05) }));
    },
  };
  const dryAll = (): void => lay({ k: 1 });
  const snapshotBase = (): void => lay({ k: 2 });

  // ================================================================ PAINTING (sessions)
  const prim = masses.find((m) => m.kind === K_PRIMARY)!;
  if (P.underpainting === UNDER_IMPRIMATURA) {
    const tone = lerp3(vary(rng.ch(2048) ? col(0.78, 0.6, 0.42) : lerp3(cD, col(0.8, 0.75, 0.7), q12(0.6))), col(0.9, 0.88, 0.85), q12(0.2));
    for (let k = 0; k < 7; k++) T.mop(rng.f(120, 1080), rng.f(120, 1080), rng.ang(0, 3.14), rng.f(300, 500), rng.f(500, 900), tone, { opacity: rng.f(0.18, 0.3) });
  }
  if (P.underpainting === UNDER_BLOCKIN) {
    for (const m of masses) { if (rng.ch(q12(0.3))) continue; const [x, y] = XY(m.x, m.y); T.mop(x!, y!, dirFor(m), f12(m.rx * 75, rng.f(1, 1.6)), f12(m.ry * 75, rng.f(1.2, 2)), tint(colourFor(m.role === 2 ? 2 : m.role, m.pale), rng.f(0.1, 0.35)), { opacity: rng.f(0.25, 0.45) }); }
  }
  snapshotBase();
  // 1. thinned underlayer scrubs (hazy colour passages) + mop washes
  for (const m of masses) {
    const n = Math.floor((f12(f12(f12(m.dens, m.kind === K_PRIMARY ? q12(4) : q12(1.5)), q12(0.6) + P.washes * 2), rng.f(0.7, 1.3)) + 2048) / ONE);
    for (let k = 0; k < n; k++) {
      const c = samplePt(m, q12(0.8)); if (!c) continue;
      const role = m.role === 2 ? 2 : rng.ch(q12(0.75)) ? m.role : 1 - minI(1, m.role);
      const [x, y] = XY(c[0]!, c[1]!);
      if (rng.ch(f12(tools[T_MOP]!, 2048))) T.mop(x!, y!, dirFor(m), f12(sizes[0]!, rng.f(0.8, 1.4)), f12(sizes[0]!, rng.f(1.5, 3)), tint(colourFor(role, m.pale, m.grey), rng.f(0.05, 0.3)), { role });
      else T.scrub(x!, y!, dirFor(m), f12(sizes[0]!, rng.f(0.7, 1.3)), tint(colourFor(role, m.pale, m.grey), rng.f(0.05, 0.3)), { role });
    }
  }
  // pale haze in and around the open spaces: breathing room is shaped, not leftover
  {
    const nh = opens.some((o) => o.scumble) ? rng.i(5, 9) : rng.i(2, 4);
    for (let k = 0; k < nh; k++) {
      let x = 0, y = 0, ok = false;
      for (let t = 0; t < 40 && !ok; t++) { x = rng.q(0.08, 0.92); y = rng.q(0.06, 0.92); const o = openAt(x, y); ok = o > q12(0.35) && o < q12(0.97); }
      if (!ok) continue;
      const grey = rng.ch(2048) ? tint(lerp3(cP, col(0.55, 0.55, 0.62), 2048), rng.f(0.2, 0.6)) : tint(rng.ch(2048) ? cS[0]! : cD, rng.f(0.7, 0.88));
      const hc = vary(grey, 2048);
      for (let q = 0; q < rng.i(3, 6); q++) {
        const h = flowA + rng.ang(-0.7, 0.7) + (rng.ch(2048) ? HALF_A : 0), L = rng.f(90, 260), W = rng.f(35, 90);
        const xx = x * 75 + f12(rng.g(), 50 * PX), yy = y * 75 + f12(rng.g(), 40 * PX);
        const s = along(xx, yy, h, L);
        doStroke(base({ W, col: vary(hc, q12(0.3)), load: rng.f(0.35, 0.6), dryFrac: rng.f(0.6, 1.2), pickup: q12(0.8), opacity: rng.f(0.45, 0.8), thick: q12(0.06), round: q12(0.4), follow: q12(0.1), fade: 1, pf: PF_HAZE, role: 4, lip: 0, gaps: q12(0.25), glaze: q12(0.2), gloss: q12(0.2), soft: q12(0.3), broken: rng.f(0.3, 0.6), brokenScale: rng.f(3, 7), brokenAng: h }), gesturePath(s[0]!, s[1]!, h, L, { kA: kq(0.004), kMax: kq(0.02) }));
      }
    }
  }
  // 1b. the backbone: a few very large, confident gestures laid in early
  const cutPath = (path: number[], openLim: number): number[] => {
    for (let i = 0; i < path.length; i += 4) { const x = toN(path[i]!), y = toN(path[i + 1]!); if (x < q16(0.035) || x > q16(0.965) || y < q16(0.035) || y > q16(0.965) || corner(x, y) || openAt(x, y) > openLim || innerAt(x, y) > q12(0.3)) return path.slice(0, i); }
    return path;
  };
  {
    const nB = rng.i(2, 4) + (energy < q12(0.35) ? 2 : 0);
    const bigMasses = masses.filter((m) => m.kind !== K_CALM && f16(f16(m.dens * 16, m.rx), m.ry) > q16(0.004));
    let made = 0;
    for (let k = 0; k < nB * 4 && made < nB; k++) {
      const m = made === 0 ? prim : bigMasses.length ? bigMasses[rng.w(bigMasses.map((mm) => f16(f16(mm.dens * 16, mm.rx), mm.ry)))]! : prim;
      const c = samplePt(m, q12(0.6)); if (!c) continue;
      const kind = rng.w([1400, strategy === ST_COLUMNS || strategy === ST_EDGE ? 2000 : 300, 800]); // sweep, column, milky
      let h = kind === 1 ? -QUARTER_A + rng.ang(-0.18, 0.18) : m.hasDir ? m.dir + rng.ang(-0.2, 0.2) : flowA + rng.ang(-0.25, 0.25) + (strategy === ST_BAND ? -f12(flowA, q12(0.8)) : 0);
      if (rng.ch(2048)) h += HALF_A;
      const L = kind === 1 ? rng.f(380, 720) : rng.f(480, 980), W = kind === 2 ? rng.f(150, 260) : kind === 1 ? rng.f(75, 135) : rng.f(70, 165);
      let path = gesturePath(c[0]! * 75 - (f12(cosA(h) >> 2, L) >> 1), c[1]! * 75 - (f12(sinA(h) >> 2, L) >> 1), h, L, { kA: rng.r(kq(0.0006), kq(0.002)), kF: Math.floor(Q / 320), k0: rng.r(kq(-0.0015), kq(0.0015)), kMax: kq(0.006) });
      path = cutPath(path, kind === 2 ? q12(0.95) : q12(0.75)); if (path.length < 300) continue; made++;
      const role = kind === 2 ? 4 : rng.ch(q12(0.7)) ? (m.role === 2 ? 0 : m.role) : chooseRole(m.role, c[0]!, c[1]!);
      const colr = kind === 2 ? vary(tint(rng.ch(2048) ? cP : colourFor(rng.i(0, 1)), rng.f(0.55, 0.85)), q12(0.3)) : colourFor(role, m.pale >> 1);
      const col2 = kind !== 2 && rng.ch(q12(0.45)) ? colourFor(rng.ch(2048) ? role : rng.i(0, 1)) : null;
      if (kind === 2) doStroke(base({ W, col: colr, load: rng.f(0.6, 0.85), dryFrac: rng.f(1.6, 2.8), pickup: q12(1.4), memory: rng.f(250, 450), opacity: rng.f(0.6, 0.85), glaze: 2048, thick: q12(0.12), round: q12(0.2), follow: q12(0.03), soft: q12(0.3), broken: rng.f(0.25, 0.45), brokenScale: rng.f(4, 8), brokenAng: h, gaps: q12(0.12), lip: 0, role: 4, noTrim: 1, twist: ra(0.2), press: press({ s: q12(0.85), l: q12(0.25), e: q12(0.15) }) }), path);
      else doStroke(base({ W, col: colr, col2, side: col2 && rng.ch(2048) ? (rng.ch(2048) ? 1 : -1) : 0, mix2: rng.f(0.15, 0.35), load: rng.f(1.0, 1.2), dryFrac: rng.f(1.6, 3), pickup: rng.f(0.4, 0.8), thick: f12(rng.f(0.4, 0.7), impasto), round: q12(0.1), follow: kind === 1 ? q12(0.02) : q12(0.05), twist: rng.ang(0.08, 0.25), splay: rng.f(0.2, 0.5), gaps: q12(0.04), lip: q12(0.6), role, noTrim: 1, gloss: fatGloss(), press: press({ s: q12(0.9), b: q12(0.03), l: rng.f(0.12, 0.22), e: rng.f(0.05, 0.3) }) }), path);
    }
  }
  // 2. main marks in masses: sizes in the power-law rhythm, tools by size, energy and the day's vocabulary
  const toolFor = (cls: number, e: number): number => {
    const t = tools, w = new Array<number>(14).fill(0);
    if (cls === 0) { w[T_FLAT] = t[T_FLAT]!; w[T_KNIFE] = f12(t[T_KNIFE]!, q12(0.4)); }
    else if (cls === 1) { w[T_FLAT] = t[T_FLAT]!; w[T_KNIFE] = f12(t[T_KNIFE]!, 2048); w[T_FAN] = f12(t[T_FAN]!, q12(0.6)); }
    else if (cls === 2) { w[T_FLAT] = f12(t[T_FLAT]!, q12(0.8)); w[T_ROUND] = f12(t[T_ROUND]!, q12(0.6) + e); w[T_FAN] = t[T_FAN]!; w[T_KNIFE] = f12(t[T_KNIFE]!, q12(0.4)); w[T_DAB] = f12(t[T_DAB]!, q12(0.4)); }
    else if (cls === 3) { w[T_ROUND] = f12(t[T_ROUND]!, q12(0.8) + e); w[T_FLAT] = f12(t[T_FLAT]!, q12(0.25)); w[T_DAB] = f12(t[T_DAB]!, 2048); w[T_TAP] = f12(t[T_TAP]!, 2048); w[T_FLICK] = f12(t[T_FLICK]!, e); w[T_ZIGZAG] = f12(t[T_ZIGZAG]!, e); w[T_SCRIBBLE] = f12(t[T_SCRIBBLE]!, e); w[T_RIGGER] = f12(t[T_RIGGER]!, q12(0.6)); }
    else { w[T_FLICK] = t[T_FLICK]!; w[T_DAB] = f12(t[T_DAB]!, q12(0.3)); w[T_ROUND] = f12(t[T_ROUND]!, q12(0.6)); w[T_SCRIBBLE] = f12(t[T_SCRIBBLE]!, e); w[T_RIGGER] = f12(t[T_RIGGER]!, 2048); w[T_LOOP] = f12(f12(t[T_LOOP]!, e), q12(0.6)); w[T_SPONGE] = f12(t[T_SPONGE]!, q12(0.3)); }
    return rng.w(w);
  };
  const pixAt = (c: number[]): number => Math.floor((c[1]! * D) / Q) * D + Math.floor((c[0]! * D) / Q);
  const mark = (m: V15Mass, cls: number, opt: { at?: number[]; tool?: number; role?: number; col?: C3; spread?: number; dir?: number } = {}): void => {
    const c = opt.at ?? samplePt(m, opt.spread ?? (cls >= 3 ? q12(0.75) : ONE)); if (!c) return;
    if (cls >= 2 && !opt.at && opt.role !== 2) { // local density cap: a spot that already carries enough layers gets no more small marks
      let lay2 = 0; const X = Math.floor((c[0]! * D) / Q), Y = Math.floor((c[1]! * D) / Q), d8 = (8 * S8) >> 8;
      for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) { const xx = cl(X + dx! * d8, 0, D - 1), yy = cl(Y + dy! * d8, 0, D - 1); lay2 += CAN[((yy * D + xx) << 3) + 7]! >> 8; }
      if (Math.floor((lay2 * ONE) / 5) > f12(f12(layerCap, ONE + relax), m.kind === K_PRIMARY ? q12(1.4) : ONE)) return;
    }
    if (cls >= 3 && !opt.at) { const q = pixAt(c) << 3, cc = [CAN[q]!, CAN[q + 1]!, CAN[q + 2]!]; if (CAN[q + 4]! < q12(0.35) || (lum(cc) > q12(0.78) && sat(cc) < q12(0.18))) return; } // small marks sit on paint, never alone in the white
    const e = energyAt(c[0]!, c[1]!);
    const tool = opt.tool ?? (m.kind === K_CALM ? (rng.ch(2048) ? T_CALM : T_MOP) : toolFor(cls, e));
    const role = opt.role ?? (rng.ch(f12(f12(P.pDark, m.kind === K_PRIMARY ? q12(1.3) : q12(0.7)), q12(0.35) + f12(q12(1.65), zone(c[0]!, c[1]!, 2)))) ? 3 : rng.ch(f12(P.pWhite, q12(0.3) + f12(q12(1.7), zone(c[0]!, c[1]!, 3)))) ? 4 : chooseRole(m.role, c[0]!, c[1]!));
    const W0 = f12(f12(sizes[cls]!, rng.f(0.85, 1.15)), cls >= 2 ? q12(1.25) - (e >> 1) : ONE + f12(q12(0.35), calmK));
    const dir = opt.dir ?? dirFor(m, c[0]!, c[1]!);
    let colr = opt.col ?? colourFor(role, m.pale, m.grey);
    if (surpriseCol && cls >= 3 && rng.ch(q12(0.03))) colr = vary(surpriseCol, 2048);
    const [x, y] = XY(c[0]!, c[1]!);
    const o: O2 = { role };
    switch (tool) {
      case T_FLAT: {
        const ns = cls <= 1 ? rng.i(2, 3 + Math.floor((4 * energy + 2048) / ONE)) : rng.i(1, 2 + Math.floor((2 * energy + 2048) / ONE)); const col2 = rng.ch(q12(0.35)) ? colourFor(rng.ch(2048) ? role : rng.i(0, 1)) : null;
        for (let s = 0; s < ns; s++) {
          const L = maxI(45 * PX, f12(f12(f12(W0, P.reach), rng.f(2.5, cls === 0 ? 4 : 8)), q12(0.85) + f12(q12(0.4), speed)));
          const gx1 = rng.g(), gx2 = rng.g(), gy1 = rng.g(), gy2 = rng.g();
          const px = x! + f12(f12(gx1, W0), q12(0.55)) + f12(cosA(dir) >> 2, f12(gx2, W0)), py = y! + f12(f12(gy1, W0), q12(0.55)) + f12(sinA(dir) >> 2, f12(gy2, W0));
          const path = T.flat(px, py, dir + rng.ang(-0.16, 0.16), f12(W0, rng.f(0.75, 1.15)), L, vary(colr, 2048), { ...o, col2 });
          if (rng.ch(P.hesitation)) doStroke(base({ W: f12(W0, q12(0.8)), col: vary(colr, q12(1.2)), load: q12(0.7), dryFrac: ONE, pickup: q12(0.6), thick: q12(0.3), round: q12(0.12), follow: q12(0.05), role, lip: q12(0.3) }), path.map((q) => q + rng.f(-4, 4)));
        }
        break;
      }
      case T_KNIFE: T.knife(x!, y!, dir, f12(W0, rng.f(0.4, 0.8)), f12(W0, rng.f(1.5, 3)), colr, o); break;
      case T_CALM: { const L = rng.f(120, 300), W = rng.f(50, 110); const s = along(x!, y!, dir, L); doStroke(base({ W, col: tint(colr, rng.f(0.05, 0.25)), load: rng.f(0.45, 0.75), dryFrac: rng.f(0.8, 1.4), pickup: q12(0.7), opacity: rng.f(0.75, 0.95), thick: q12(0.08), round: q12(0.4), follow: q12(0.08), fade: 1, pf: PF_CALM, role, lip: 0, gaps: q12(0.2), gloss: q12(0.2) }), gesturePath(s[0]!, s[1]!, dir, L, { kA: kq(0.003), kMax: kq(0.02) })); break; }
      case T_MOP: T.mop(x!, y!, dir, f12(W0, q12(1.2)), f12(W0, rng.f(1.5, 3)), colr, o); break;
      case T_FAN: T.fan(x!, y!, dir, f12(W0, rng.f(0.7, 1.1)), maxI(40 * PX, f12(W0, rng.f(2, 5))), colr, o); break;
      case T_ROUND: T.round(x!, y!, dir, cl(f12(W0, rng.f(0.35, 0.7)), 3 * PX, 32 * PX), maxI(40 * PX, f12(W0, rng.f(3, 9))), colr, o); break;
      case T_DAB: T.dab(x!, y!, dir, cl(f12(W0, rng.f(0.6, 1.3)), 8 * PX, 36 * PX), colr, { ...o, col2: rng.ch(q12(0.4)) ? colourFor(rng.i(0, 1)) : null }); break;
      case T_TAP: T.tap(x!, y!, rng.f(14, 36), colr, o); break;
      case T_FLICK: for (let k = 0; k < rng.i(1, 4); k++) T.flick(x! + f12(rng.g(), 10 * PX), y! + f12(rng.g(), 10 * PX), dir + rng.ang(-0.6, 0.6), colr, o); break;
      case T_ZIGZAG: T.zigzag(x!, y!, dir, colr, o); break;
      case T_SCRIBBLE: T.scribble(x!, y!, colr, o); break;
      case T_RIGGER: T.rigger(x!, y!, dir, rng.f(150, 500), colr, o); break;
      case T_LOOP: T.loop(x!, y!, dir, colr, o); break;
      case T_SPONGE: T.sponge(x!, y!, rng.f(20, 45), colr, o); break;
    }
  };
  // the adaptive density loop: keep adding marks in rhythm until the open space reaches its target
  const openFraction = (): number => { // also re-measures the colour shares from the visible top layer
    let o = 0, n = 0; const st = (8 * S8) >> 8, rc = [0, 0, 0];
    for (let y = st >> 1; y < D; y += st) for (let x = st >> 1; x < D; x += st) {
      const p = y * D + x; n++;
      const q8 = p << 3, r = CAN[q8]!, g = CAN[q8 + 1]!, b = CAN[q8 + 2]!;
      if (CAN[q8 + 4]! < 1024 || ((871 * r + 2929 * g + 296 * b) >> 12 > 3195 && satOf(r, g, b) < 737)) o++;
      else if (ROLEMAP[p]! >= 0 && ROLEMAP[p]! <= 2) rc[ROLEMAP[p]!]++;
    }
    for (let r = 0; r < 3; r++) chroma[r] = rc[r]! * 64;
    return Math.floor((o * ONE) / n);
  };
  const jobsFor = (mult: number): number[][] => {
    const jobs: number[][] = [];
    masses.forEach((m, mi) => {
      const area = f16(f16(PI16, m.rx), m.ry);
      const cnt = Math.floor((f12(f12(f16(area, m.dens * 115 * 16), mult), m.kind === K_PRIMARY ? q12(1.3) : m.kind === K_CALM ? q12(0.35) : ONE) + 32768) / Q);
      for (let k = 0; k < cnt; k++) { let cls = rng.w(classW); if (m.kind !== K_PRIMARY && cls <= 1 && rng.ch(2048)) cls = 2; if (m.kind === K_CALM && cls >= 3) cls = 1; jobs.push([mi, cls, 0]); }
    });
    for (const j of jobs) j[2] = j[1]! * ONE + f12(rng.u() - 2048, q12(1.2)); // sort key: class plus a jitter
    jobs.sort((a, b) => a[2]! - b[2]!);
    return jobs;
  };
  let open = ONE, lowGain = 0;
  for (; rounds < 16; rounds++) {
    if (rounds === 5 && strategy !== ST_BAND && strategy !== ST_BURST) spreadAll = true;
    const need = rounds === 0 ? q12(0.6) : cl((open - P.openTarget) * 4, q12(0.25), q12(0.9));
    for (const [mi, cls] of jobsFor(need)) mark(masses[mi!]!, cls!);
    const prevOpen = open; open = openFraction();
    if (rounds >= 7 && open > P.openTarget + q12(0.12)) relax = minI(ONE, relax + q12(0.25));
    lowGain = prevOpen - open < q12(0.012) ? lowGain + 1 : 0;
    if (rounds >= 9 && lowGain >= 4 && open < P.openTarget + q12(0.1)) break;
    if (rounds === 0 && P.sessions >= 2) { session = 2; dryAll(); }
    if (rounds >= 1 && open <= P.openTarget + q12(0.03)) break; // the painter always takes a second round (a pale wash over most of the canvas once met the target after the first and left the painting nearly empty)
    if (rounds >= 1) { // grow by budding satellite masses at the rim, so silhouettes stay irregular
      const nb2 = rng.i(3, 5) + (lowGain >= 1 ? 3 : 0);
      for (const m of masses) if (m.kind !== K_CALM) { m.rx = minI(f12(m.rx, q12(1.06)), q16(0.42)); m.ry = minI(f12(m.ry, q12(1.06)), q16(0.45)); }
      for (let k = 0; k < nb2; k++) {
        const pm = masses[rng.w(masses.map((mm) => (mm.kind === K_CALM ? 0 : f16(f16(mm.dens * 16, mm.rx), mm.ry))))]!;
        let a = rng.r(0, A);
        if (strategy === ST_BAND) a = rng.ch(q12(0.4)) ? (rng.ch(2048) ? 0 : HALF_A) + rng.ang(-0.5, 0.5) : (rng.ch(q12(0.6)) ? QUARTER_A : -QUARTER_A) + rng.ang(-0.5, 0.5);
        if (pm.hasDir && strategy !== ST_BAND) a = pm.dir + (rng.ch(2048) ? 0 : HALF_A) + rng.ang(-0.6, 0.6);
        const nx = pm.x + f12(f16(cosA(a) << 2, pm.rx), rng.f(0.9, 1.3)), ny = pm.y + f12(f16(sinA(a) << 2, pm.ry), rng.f(0.9, 1.3));
        if (nx < edgeM + q16(0.03) || nx > Q - edgeM - q16(0.03) || ny < edgeM + q16(0.03) || ny > Q - edgeM - q16(0.03) || openAt(nx, ny) > q12(0.45) || corner(nx, ny)) continue;
        masses.push({ x: nx, y: ny, rx: f12(pm.rx, rng.f(0.45, 0.75)), ry: f12(pm.ry, rng.f(0.45, 0.75)), role: pm.role, dens: f12(pm.dens, rng.f(0.5, 0.85)), pale: pm.pale, grey: pm.grey, hasDir: pm.hasDir, dir: pm.dir, rot: rng.ang(-0.8, 0.8), radial: pm.radial >> 1, loop: 0, kind: K_BUD, lumpS: rng.int16(), lumpA: rng.f(0.25, 0.5), spike: rng.f(0, 0.4) });
      }
    }
  }
  // long drags through the still-wet colour
  {
    {
      const c = samplePt(prim, 2048) ?? [prim.x, prim.y];
      const h = flowA + rng.ang(-0.35, 0.35) + (rng.ch(2048) ? HALF_A : 0), L = rng.f(650, 1050), W = rng.f(95, 165);
      const pale = lum(cD) > q12(0.6) ? tint(lerp3(cS[0]!, cP, q12(0.3)), q12(0.45)) : vary(rng.ch(q12(0.6)) ? cP : tint(colourFor(1), q12(0.78)), q12(0.2));
      T.drag(c[0]! * 75 - f12(f12(cosA(h) >> 2, L), q12(0.45)), c[1]! * 75 - f12(f12(sinA(h) >> 2, L), q12(0.45)), h, L, W, pale, { load: rng.f(1.0, 1.15), hero: true });
    }
    const nDr = rng.i(0, 2) + (energy > q12(0.7) ? 1 : 0);
    for (let k = 0; k < nDr; k++) {
      const m = rng.ch(q12(0.55)) ? prim : masses[rng.w(masses.map((mm) => f16(f16(mm.dens * 16, mm.rx), mm.ry)))]!; const c = samplePt(m, q12(0.9)); if (!c) continue;
      const h = flowA + rng.ang(-0.3, 0.3) + (rng.ch(2048) ? HALF_A : 0) + (handBias >> 1), L = rng.f(350, 850), W = rng.f(28, 85);
      const colr = rng.ch(q12(0.4)) ? vary(cP, q12(0.3)) : tint(colourFor(rng.i(0, 1)), rng.f(0.5, 0.85));
      T.drag(c[0]! * 75 - f12(f12(cosA(h) >> 2, L), q12(0.3)), c[1]! * 75 - f12(f12(sinA(h) >> 2, L), q12(0.3)), h, L, W, colr);
    }
    if (rng.ch(q12(0.4))) {
      const F = focal[0]!, F2 = focal[1]!; const h = atan2A(F2[1]! - F[1]!, F2[0]! - F[0]!) + rng.ang(-0.35, 0.35);
      const L = cl(f12(Math.floor((hypot(F2[0]! - F[0]!, F2[1]! - F[1]!) * 1200 * PX) / Q), rng.f(0.8, 1.2)), 300 * PX, 800 * PX);
      T.drag((F[0]! + f12(rng.g(), q16(0.03))) * 75, (F[1]! + f12(rng.g(), q16(0.03))) * 75, h, L, rng.f(16, 42), vary(cK, q12(0.4)), { role: 3, dark: true, load: rng.f(0.8, 1.05) });
    }
  }
  // corrections: a colour overpainted but still showing at the edges
  for (let k = 0; k < P.process[4]!; k++) {
    const m = rng.ch(q12(0.6)) ? prim : rng.pick(masses); const c = samplePt(m, q12(0.8)); if (!c) continue;
    const h = dirFor(m), W = f12(sizes[2]!, rng.f(0.8, 1.3)); const [x, y] = XY(c[0]!, c[1]!);
    const path = T.flat(x!, y!, h, W, f12(W, rng.f(3, 5)), colourFor(rng.i(0, 2)), { role: -1 });
    doStroke(base({ W: f12(W, q12(0.82)), col: colourFor(m.role, m.pale), load: q12(1.05), dryFrac: q12(1.4), pickup: q12(0.35), thick: 2048, round: q12(0.12), follow: q12(0.05), role: m.role, lip: 2048 }), path.map((q) => q + rng.f(-3, 3)));
  }
  // 3. long sweeping gestures along the flow
  for (let k = 0; k < rng.i(4, 9); k++) {
    const m = masses[rng.w(masses.map((mm) => f12(mm.dens, mm.rx)))]!; const c = samplePt(m, q12(1.1)); if (!c) continue;
    const L = f12(rng.f(240, 620), q12(0.8) + f12(q12(0.4), speed)), h = flowA + rng.ang(-0.35, 0.35) + (rng.ch(q12(0.4)) ? HALF_A : 0);
    const role = rng.ch(q12(0.25)) ? 3 : chooseRole(m.role, c[0]!, c[1]!); const [x, y] = XY(c[0]!, c[1]!);
    const s = along(x!, y!, h, L);
    if (rng.ch(f12(tools[T_RIGGER]!, 2048))) T.rigger(s[0]!, s[1]!, h, L, colourFor(role), { role });
    else doStroke(base({ W: rng.f(7, 22), col: colourFor(role), load: ONE, dryFrac: f12(rng.f(0.9, 1.7), speedDry), pickup: 2048, thick: q12(0.45), round: q12(0.55), follow: q12(0.25), press: press({ l: q12(0.35), e: q12(0.05) }), role, lip: q12(0.4) }), gesturePath(s[0]!, s[1]!, h, L, { kA: rng.r(kq(0.003), kq(0.008)), kF: Math.floor(Q / 220), k0: rng.r(kq(-0.004), kq(0.004)), kMax: kq(0.05) }));
  }
  // scraping back and repainting
  if (P.process[5]) {
    const c = samplePt(prim, q12(0.7));
    if (c) { const [x, y] = XY(c[0]!, c[1]!); for (let k = 0; k < rng.i(2, 4); k++) T.knife(x! + f12(rng.g(), 30 * PX), y! + f12(rng.g(), 30 * PX), flowA + rng.ang(-0.4, 0.4), rng.f(35, 70), rng.f(70, 150), colourFor(4), { role: -1 }); for (let k = 0; k < 6; k++) mark(prim, 3, { at: [c[0]! + f12(rng.g(), q16(0.04)), c[1]! + f12(rng.g(), q16(0.04))] }); }
  }
  if (P.sessions === 3) { session = 3; dryAll(); }
  // 4. darks: the strongest contrast lands at the primary focal point
  {
    const F = focal[0]!; const nd = Math.floor((f12(f12(rng.i(10, 16) * ONE, P.key === KEY_DARK ? q12(1.7) : P.key === KEY_LIGHT ? q12(0.8) : ONE), strategy === ST_QUIET ? q12(1.6) : ONE) + 2048) / ONE);
    for (let k = 0; k < nd; k++) {
      const near = rng.ch(q12(0.78));
      const cx = near ? F[0]! + f12(rng.g(), q16(0.07)) : prim.x + f12(f12(rng.g(), prim.rx), q12(0.6)), cy = near ? F[1]! + f12(rng.g(), q16(0.07)) : prim.y + f12(f12(rng.g(), prim.ry), q12(0.6));
      if (corner(cx, cy) || openAt(cx, cy) > q12(0.6)) continue;
      const e = energyAt(cx, cy); const colr = vary(cK, q12(0.6));
      const tool = [T_ROUND, T_FLAT, T_LOOP, T_SCRIBBLE, T_ZIGZAG, T_RIGGER][rng.w([ONE, q12(0.6), f12(tools[T_LOOP]!, q12(0.6)), f12(tools[T_SCRIBBLE]!, e), f12(tools[T_ZIGZAG]!, e), f12(tools[T_RIGGER]!, 2048)])]!;
      mark(prim, tool === T_FLAT ? 2 : 3, { at: [cx, cy], tool, role: 3, col: colr });
    }
  }
  // 4a. the painter steps back: if the value structure has no real dark yet, a few more darks go in at the focal point; the
  //     painter looks again after each dozen, three times at most (the sketch looked once, and a pale painting could end monotone)
  for (let look = 0; look < 3; look++) {
    const hist = new Int32Array(ONE + 1); let tot = 0; const st = (10 * S8) >> 8;
    for (let y = st >> 1; y < D; y += st) for (let x = st >> 1; x < D; x += st) { const o = (y * D + x) << 3; hist[minI(ONE, (871 * CAN[o]! + 2929 * CAN[o + 1]! + 296 * CAN[o + 2]!) >> 12)]++; tot++; }
    let acc = 0, p3 = 0; const lim = Math.floor((tot * 3) / 100); for (let i = 0; i <= ONE; i++) { acc += hist[i]!; if (acc > lim) { p3 = i; break; } }
    if (p3 <= q12(0.24)) break;
    const F = focal[0]!;
    for (let k = 0; k < 12; k++) mark(prim, rng.ch(2048) ? 2 : 3, { at: [cl(F[0]! + f12(rng.g(), q16(0.06)), q16(0.1), q16(0.9)), cl(F[1]! + f12(rng.g(), q16(0.06)), q16(0.1), q16(0.9))], tool: rng.ch(2048) ? T_ROUND : T_FLAT, role: 3, col: vary(shade(cK, q12(0.3)), q12(0.4)) });
  }
  // 4b. long calligraphic lines: a round brush crossing the masses, tangling near the focal point
  for (let k = 0; k < Math.floor((f12(rng.i(5, 16) * ONE, 2048 + tools[T_ROUND]!) + 2048) / ONE); k++) {
    const m = masses[rng.w(masses.map((mm) => f12(f12(mm.kind === K_PRIMARY ? 3 * ONE : ONE, mm.dens), mm.rx)))]!; const c = samplePt(m, q12(0.9)); if (!c) continue;
    const role = rng.ch(q12(0.45)) ? 3 : chooseRole(m.role, c[0]!, c[1]!); const h = dirFor(m, c[0]!, c[1]!); const L = rng.f(150, 480); const [x, y] = XY(c[0]!, c[1]!);
    const sw = rng.f(0.5, 1.5), ph = rng.r(0, A);
    const s = along(x!, y!, h, L);
    doStroke(base({ W: rng.f(3, 12), col: colourFor(role), load: rng.f(0.7, 1.1), dryFrac: f12(rng.f(0.7, 1.6), speedDry), pickup: q12(0.45), thick: f12(2048, impasto), round: q12(0.9), follow: q12(0.6), pf: PF_LINE, pfA: ph, pfB: sw, role, lip: q12(0.35), gaps: q12(0.02) }),
      gesturePath(s[0]!, s[1]!, h, L, { kA: f12(rng.r(kq(0.008), kq(0.025)), q12(0.6) + energyAt(c[0]!, c[1]!)), kF: Math.floor((Q * ONE) / rng.f(25, 80)), kMax: kq(0.08), hook: rng.ch(q12(0.3)) ? rng.r(kq(-0.05), kq(0.05)) : 0 }));
  }
  // 5. thick dabs and taps, weighted to the focal masses
  for (let k = 0; k < Math.floor((f12(rng.i(6, 16) * ONE, 2048 + tools[T_DAB]!) + 2048) / ONE); k++) {
    const m = masses[rng.w(masses.map((mm) => f12(mm.kind === K_PRIMARY ? 4 * ONE : mm.kind === K_SECONDARY ? 2 * ONE : q12(0.3), mm.dens)))]!;
    mark(m, 3, { tool: rng.ch(tools[T_TAP]!) ? T_TAP : T_DAB, spread: q12(0.8) });
  }
  // 6. rag wipes, then white scumbles over parts of the colour; lightest light beside the focal dark
  for (let k = 0; k < P.process[0]!; k++) { const m = rng.pick(masses); const c = samplePt(m, ONE); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!); T.wipe(x!, y!, dirFor(m), rng.f(50, 120), rng.f(80, 220)); }
  for (let k = 0; k < rng.i(4, 8); k++) {
    const m = masses[rng.w(masses.map((mm) => mm.dens))]!; const c = samplePt(m, q12(1.2)); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!);
    const sc = vary(rng.ch(q12(0.7)) ? cP : tint(col(0.75, 0.75, 0.78), q12(0.3)), q12(0.4));
    for (let q = 0; q < rng.i(2, 4); q++) {
      const h = dirFor(m), L = rng.f(70, 200), W = rng.f(30, 75); const xx = x! + f12(rng.g(), 30 * PX), yy = y! + f12(rng.g(), 30 * PX);
      const s = along(xx, yy, h, L);
      doStroke(base({ W, col: vary(sc, q12(0.3)), load: rng.f(0.45, 0.75), dryFrac: rng.f(0.6, 1.1), pickup: rng.f(0.5, 1), opacity: rng.f(0.8, 0.97), thick: q12(0.14), round: q12(0.35), follow: q12(0.08), role: 4, lip: q12(0.1), gaps: q12(0.2), glaze: 0, gloss: q12(0.2), broken: rng.f(0.2, 0.5), brokenScale: rng.f(3, 7), brokenAng: h }), gesturePath(s[0]!, s[1]!, h, L, { kA: kq(0.003), kMax: kq(0.02) }));
    }
  }
  {
    const F = focal[0]!;
    for (let k = 0; k < rng.i(3, 5); k++) {
      const a = rng.r(0, A), dd = rng.q(0.05, 0.09); const [x, y] = XY(F[0]! + f16(cosA(a) << 2, dd), F[1]! + f16(sinA(a) << 2, dd));
      T.dab(x!, y!, dirFor(prim), rng.f(14, 30), vary(cP, q12(0.2)), { role: 4 });
    }
  }
  // 7. glazes over dried paint
  if (P.glazes) { dryAll(); for (let k = 0; k < P.glazes; k++) { const m = rng.pick(masses); const c = samplePt(m, ONE); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!); T.glaze(x!, y!, dirFor(m), rng.f(60, 160), rng.f(120, 320), colourFor(m.role === 2 ? 2 : m.role, q12(0.2))); } }
  // 8. calligraphy: loops (accent and dark) near the focal point and in loop masses
  for (let k = 0; k < Math.floor((f12(rng.i(1, 4) * ONE, q12(0.3) + tools[T_LOOP]!) + 2048) / ONE); k++) {
    const loopM = masses.find((mm) => mm.loop); const m = loopM && rng.ch(q12(0.45)) ? loopM : prim;
    const c = samplePt(m, q12(0.7)); if (!c) continue; const role = m.loop ? 2 : rng.ch(q12(0.45)) ? 3 : chooseRole(m.role, c[0]!, c[1]!);
    const [x, y] = XY(c[0]!, c[1]!); T.loop(x!, y!, dirFor(m), colourFor(role), { role });
  }
  // accent top-up near the primary focal point if the accent share is short
  openFraction();
  for (let k = 0; k < 40; k++) {
    if (k % 8 === 0 && k) openFraction();
    const tot = chroma[0]! + chroma[1]! + chroma[2]!; if (tot > 0 && chroma[2]! * 100 >= tot * 8) break;
    const fake: V15Mass = { ...prim, x: focal[0]![0]!, y: focal[0]![1]!, rx: q16(0.15), ry: q16(0.15), radial: 0 };
    mark(fake, rng.w([1, 2, 1]) + 2, { role: 2, spread: q12(1.3) });
  }
  // sgraffito through the (still wet) top paint, finger smudges, pours
  for (let k = 0; k < P.process[1]!; k++) { const c = samplePt(prim, ONE); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!); T.sgraffito(x!, y!, dirFor(prim), rng.f(40, 160)); }
  for (let k = 0; k < P.process[2]!; k++) { const m = rng.pick(masses); const c = samplePt(m, q12(0.8)); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!); T.smudge(x!, y!, rng.r(0, A)); }
  for (let k = 0; k < P.process[3]!; k++) { const m = rng.pick(masses); const c = samplePt(m, q12(0.8)); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!); T.pour(x!, y!, rng.f(18, 45), tint(colourFor(chooseRole(m.role, c[0]!, c[1]!)), q12(0.1))); }

  // 9. drips (they lead the eye down from the masses and back), spatter thrown from the focal mass
  {
    const nd = f12([rng.i(6, 16), rng.i(20, 40), rng.i(45, 75)][P.drips]! * ONE, strategy === ST_BAND || strategy === ST_COLUMNS ? q12(1.3) : ONE); // Q12
    let made = 0;
    for (let tries = 0; tries * ONE < nd * 8 && made * ONE < nd; tries++) {
      const m = masses[rng.w(masses.map((mm) => f12(mm.kind === K_PRIMARY ? 3 * ONE : mm.kind === K_SECONDARY ? q12(1.5) : q12(0.6), mm.rx)))]!;
      const x = m.x + f12(f12(rng.g(), m.rx), q12(0.6)), y = m.y + f12(f12(absI(rng.g()), m.ry), 2048);
      if (x < q16(0.03) || x > q16(0.97) || y > q16(0.95)) continue;
      const p = pixAt([x, y]) << 3;
      if (CAN[p + 4]! < q12(0.6)) continue; const c: C3 = [CAN[p]!, CAN[p + 1]!, CAN[p + 2]!]; if (lum(c) > q12(0.8)) continue;
      const len = minI(Math.floor(((q16(0.985) - y) * 1200 * PX) / Q), 20 * PX + f12(520 * PX, pow12(rng.u(), q12(2.4)))); if (len < 15 * PX) continue;
      T.drip(x * 75, y * 75, c, len); made++;
    }
    const nsp = [0, rng.i(2, 4), rng.i(5, 9)][P.spatter]!;
    for (let cc = 0; cc < nsp; cc++) {
      const F = focal[0]!, F2 = focal[1]!; const ox = F[0]! + f12(rng.g(), q16(0.06)), oy = F[1]! + f12(rng.g(), q16(0.06));
      const toward = rng.ch(q12(0.55)) ? atan2A(F2[1]! - oy, F2[0]! - ox) : flowA + (rng.ch(2048) ? HALF_A : 0);
      const colr = rng.ch(q12(0.35)) ? vary(cK, 2048) : rng.ch(q12(0.2)) ? vary(cP, q12(0.2)) : colourFor(chooseRole(0, ox, oy));
      T.spatter(ox * 75, oy * 75, toward + rng.ang(-0.3, 0.3), colr, rng.i(30, 110), rng.f(40, 160));
    }
    for (let k = 0; k < rng.i(5, 12); k++) { const m = rng.pick(masses); const c = samplePt(m, q12(1.2)); if (!c) continue; const [x, y] = XY(c[0]!, c[1]!); T.hair(x!, y!, dirFor(m), colourFor(rng.ch(2048) ? 3 : rng.i(0, 1))); }
    { // dried specks and grit
      const disks: number[][] = [], cols: C3[] = [];
      for (let k = 0; k < rng.i(25, 60); k++) {
        const grit = rng.ch(q12(0.6)); const c = grit ? vary(col(0.22, 0.2, 0.18), 2 * ONE) : colourFor(rng.i(0, 3));
        disks.push([rng.f(36, 1164), rng.f(36, 1164), rng.f(0.35, grit ? 1.0 : 1.7), ONE, grit ? q12(1.8) : q12(2.4), ONE, 0]); cols.push(c);
      }
      lay({ k: 5, disks, cols, comp: { opacity: ONE, thick: ONE, wet: q12(0.2), gloss: 2048 } });
    }
  }
  // taped border
  if (P.edge === EDGE_TAPED) lay({ k: 6, tw: rng.q(0.014, 0.028), s0: (P.nseed + 31) & 0xffff });
  // staples along the turned edge (positions, Q16 of the side)
  const staples: number[] = [];
  if (P.edge === EDGE_STAPLES) { const step = rng.f(70, 110); for (let t = step >> 1; t < 1200 * PX; t += f12(step, rng.f(0.9, 1.1))) staples.push(toN(t)); }
  // measured, for the painter's own checks (the sweep)
  const measures = measure(ez, P, strokes, rounds);
  return { ez, score, staples, measures, prm };
}

/** What the painting measures, from its canvas (before the light): open space, mud, value range, saturated share. */
function measure(ez: Easel, P: V15Plan, strokes: number, rounds: number): V15Measures {
  const { D, CAN } = ez, step = (2 * ez.S8) >> 8;
  let open = 0, tot = 0, painted = 0, mud = 0, satd = 0;
  const hist = new Int32Array(101);
  for (let y = 0; y < D; y += step) for (let x = 0; x < D; x += step) {
    const o = (y * D + x) << 3, c = [CAN[o]!, CAN[o + 1]!, CAN[o + 2]!]; tot++;
    const l = lum(c), s = sat(c), isOpen = CAN[o + 4]! < 1024 || (l > 3195 && s < 737);
    if (isOpen) open++;
    else { painted++; const v = Math.max(c[0]!, c[1]!, c[2]!); if (s < 819 && v > 901 && v < 2949) mud++; if (s > 1024) satd++; }
    hist[minI(100, Math.floor((l * 100) / ONE))]++;
  }
  const pct = (qq: number): number => { let acc = 0; for (let i = 0; i <= 100; i++) { acc += hist[i]!; if (acc * 100 >= qq * tot) return i; } return 100; };
  const f = P.focal[0]!;
  return { open: Math.floor((open * 1000) / tot), mud: Math.floor((mud * 1000) / maxI(1, painted)), valueRange: pct(97) - pct(3), saturatedShare: Math.floor((satd * 1000) / maxI(1, painted)), focalEdge: Math.floor((Math.min(f[0]!, Q - f[0]!, f[1]!, Q - f[1]!) * 1000) / Q), openTarget: Math.floor((P.openTarget * 1000) / ONE), strokes, rounds: rounds + 1 };
}

/* ── The ground: primed linen (or raw), the threads kept out of the primed colour (they come back where paint is thin) ── */
const RAW_LINEN: C3 = col(0.71, 0.62, 0.49);
/** How primed the ground is at a pixel (Q12): raw linen everywhere for that ground, raw edges and stapled turns at the border. */
function primedPlane(P: V15Plan, D: number, S8: number): Uint8Array | null {
  if (P.ground === 5) return null; // raw linen: unprimed throughout
  if (P.edgeW <= 0) return null; // primed throughout
  const out = new Uint8Array(D * D).fill(255);
  const band = Math.floor(((P.edgeW * 3 + q16(0.004)) * D) / Q) + 2;
  const s = (P.nseed + 9) & 0xffff;
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const e = Math.min(x, D - 1 - x, y, D - 1 - y); if (e > band) continue;
    const ed = Math.floor((Math.min(x, D - x, y, D - y) * Q) / D);
    const lim = f16(P.edgeW, q16(0.5) + fbm(Math.floor((x * Q * 256) / (30 * S8)), Math.floor((y * Q * 256) / (30 * S8)), s, 3));
    out[y * D + x] = (sm(Math.floor(((ed - lim) * ONE) / q16(0.003))) * 255) >> 12;
  }
  return out;
}
const primedAt = (prm: Uint8Array | null, P: V15Plan, p: number): number => (P.ground === 5 ? 0 : prm === null ? ONE : (prm[p]! * 4112) >> 8);

function groundInit(ez: Easel, P: V15Plan, prm: Uint8Array | null): void {
  const { N, CAN } = ez, { T, TONE, SIZE } = ez.linen, gc = GROUND_COLS[P.ground]!;
  const rl2: C3 = [f12(RAW_LINEN[0], q12(1.06)), f12(RAW_LINEN[1], q12(1.04)), f12(RAW_LINEN[2], q12(1.02))];
  for (let p = 0; p < N; p++) {
    const t = T[p]!, size = SIZE[p]!, primed = primedAt(prm, P, p);
    const fill = f12(primed, q12(0.55) + f12(q12(0.45), size));
    const gap = f12(ONE - t, ONE - t);
    const thr = f12(q12(0.016), TONE[p]!) - f12(f12(q12(0.03), gap), ONE - f12(fill, q12(0.6)));
    const gt = ONE + f12(q12(0.03), size - 2048) + f12(thr, ONE - primed);
    for (let c = 0; c < 3; c++) {
      const raw = lerp(RAW_LINEN[c]!, rl2[c]!, t), base = lerp(raw, gc[c]!, primed);
      const v = f12(base, gt);
      CAN[(p << 3) + c] = v;
    }
  }
}

/* ── The finish: the relief lit from the top left, the subtle canvas, the photographed light ───────────────────────── */
/** Round 4 (the subtle canvas): what is left of the weave on bare primed ground, in the relief and in the colour, and the grain. */
const BARE_RELIEF = q12(0.4), BARE_COLOUR = q12(0.12), BARE_GRAIN = q12(1.5);
const LX = -2252, LY = -2539, LZ = 2293, HX = -1275, HY = -1437, HZ = 3617;
/** 1 / sqrt(1 + g^2) for g^2 in Q12 (index), Q12. */
const INV_SQ = (() => { const t = new Uint16Array(65536); for (let i = 0; i < 65536; i++) t[i] = Math.floor((ONE * ONE) / isqrt((ONE + i) * ONE)); return t; })();
/** x^18 for x in [0, 1] (Q12 index), Q12, by repeated squaring in Q16. */
const POW18 = (() => {
  const t = new Uint16Array(ONE + 1);
  for (let i = 0; i <= ONE; i++) { const x = i * 16, x2 = f16(x, x), x4 = f16(x2, x2), x8 = f16(x4, x4), x16 = f16(x8, x8); t[i] = f16(x16, x2) >> 4; }
  return t;
})();
const SPEC_FLAT = POW18[HZ]!;
/** exp(-1.6 h) for a height h (Q12) in steps of 8, Q12. */
const EXPH = (() => { const t = new Uint16Array(8193); for (let i = 0; i <= 8192; i++) t[i] = expN12(Math.floor((i * 8 * q12(1.6)) / ONE)); return t; })();

/** Separable box blur of radius r over a D x D Uint16 plane: src -> tmp (rows) -> out (columns). */
function boxBlur(src: Uint16Array, tmp: Uint16Array, out: Uint16Array, D: number, r: number): void {
  const k = 2 * r + 1;
  for (let y = 0; y < D; y++) {
    const o = y * D; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[o + cl(x, 0, D - 1)]!;
    for (let x = 0; x < D; x++) { tmp[o + x] = Math.floor(acc / k); acc += src[o + minI(D - 1, x + r + 1)]! - src[o + maxI(0, x - r)]!; }
  }
  for (let x = 0; x < D; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[cl(y, 0, D - 1) * D + x]!;
    for (let y = 0; y < D; y++) { out[y * D + x] = Math.floor(acc / k); acc += tmp[minI(D - 1, y + r + 1) * D + x]! - tmp[maxI(0, y - r) * D + x]!; }
  }
}

function finish(ez: Easel, P: V15Plan, prm: Uint8Array | null, staples: number[]): Uint8Array {
  const { D, N, S8, CAN } = ez, { T, TONE, SIZE, TOOTH } = ez.linen;
  // the planes the painting no longer needs hold the finish's fields
  const sA = new Uint16Array(ez.SLOT.buffer, 0, N), sB = new Uint16Array(ez.SLOT.buffer, N * 2, N);
  ez.release();
  const baseBuf = ez.BASE.length === N ? ez.BASE.buffer : new ArrayBuffer(N * 4);
  const bA = new Uint16Array(baseBuf, 0, N), bB = new Uint16Array(baseBuf, N * 2, N);
  const Ws = new Uint16Array(N), PAb = new Uint16Array(N);
  for (let p = 0; p < N; p++) PAb[p] = CAN[(p << 3) + 4]!;
  const raw = P.ground === 5;
  // the weave (Q12), softened for bare ground; the paint blurred over about 3 px
  for (let p = 0; p < N; p++) { const primed = raw ? 0 : prm === null ? ONE : (prm[p]! * 4112) >> 8, fill = (primed * (2253 + ((1843 * SIZE[p]!) >> 12))) >> 12; Ws[p] = ((T[p]! * (ONE - ((2253 * fill) >> 12))) >> 12) + 328; }
  boxBlur(Ws, sA, Ws, D, maxI(1, (3 * S8 + 256) >> 9));
  boxBlur(PAb, sA, PAb, D, (3 * S8) >> 8);
  // the total relief: paint, plus the weave where paint is thin or dry (damped as the paint thickens), a soft tooth on bare primed ground
  const Ht = sB;
  for (let p = 0; p < N; p++) {
    const primed = raw ? 0 : prm === null ? ONE : (prm[p]! * 4112) >> 8, t = T[p]!;
    let nq = (PAb[p]! * 13651) >> 12; nq = nq >= ONE ? ONE : SM12[nq]!; // smoothstep(PAb / 0.3)
    const nr = nq > ONE - primed ? nq : ONE - primed;
    const fill = (primed * (2253 + ((1843 * SIZE[p]!) >> 12))) >> 12, weave = ((t * (ONE - ((2253 * fill) >> 12))) >> 12) + 328;
    const grain = TOOTH[p]! - ((1229 * t) >> 12);
    const wv = ((((Ws[p]! + ((BARE_GRAIN * (grain - 1434)) >> 12)) * BARE_RELIEF) >> 12) * (ONE - nr) >> 12) + ((weave * nr) >> 12);
    const h = CAN[(p << 3) + 3]!, ht = h + ((((1024 * wv) >> 12) * EXPH[h >> 3]!) >> 12);
    Ht[p] = ht < 0 ? 0 : ht > 65535 ? 65535 : ht;
  }
  const Hb = bA, hs = bB;
  boxBlur(Ht, sA, Hb, D, (3 * S8) >> 8);
  boxBlur(Ht, sA, hs, D, maxI(1, S8 >> 9));
  for (let p = 0; p < N; p++) Ht[p] = ((Ht[p]! * 1638) >> 12) + ((hs[p]! * 2458) >> 12);
  // the photographed light: an uneven soft light (a slow field, sampled every 16 px), the vignette, grime at the very edge
  const s7 = (P.nseed + 7) & 0xffff, s8 = (P.nseed + 8) & 0xffff;
  const gn = (D >> 4) + 2, lg = new Int32Array(gn * gn);
  for (let gy = 0; gy < gn; gy++) for (let gx = 0; gx < gn; gx++) lg[gy * gn + gx] = f12(q12(0.022), n12(fbm(f16(Math.floor((gx * 16 * Q) / D), q16(2.2)), f16(Math.floor((gy * 16 * Q) / D), q16(2.2)), s7, 2)) - 2048);
  const out = new Uint8Array(N * 4);
  // the gradient's scale (x 1/256): the sketch's 0.5 x relief 3 / S at its scale of 2, kept the same slope per layout pixel at
  // any scale (the sketch's 3 / S made the relief stronger as the scale fell: 1.8 times at 1800)
  const gk = (3 * S8) >> 3;
  const edgeStaple = P.edge === EDGE_STAPLES ? f16(P.edgeW, q16(0.45)) : 0;
  const edgeBand = Math.floor((D * 2) / 100) + 1; // grime lives within 2 percent of the edge
  for (let y = 0; y < D; y++) {
    const yu = Math.floor((y * ONE) / D), gy = y >> 4, fy = y & 15, dy = yu - 2048, dy2 = (dy * dy) >> 12, ly = (2048 - yu) * 3277;
    for (let x = 0; x < D; x++) {
      const p = y * D + x, xu = Math.floor((x * ONE) / D);
      const xm = x > 0 ? p - 1 : p, xp = x < D - 1 ? p + 1 : p, ym = y > 0 ? p - D : p, yp = y < D - 1 ? p + D : p;
      let gx = ((Ht[xp]! - Ht[xm]!) * gk) >> 8, gy2 = ((Ht[yp]! - Ht[ym]!) * gk) >> 8;
      const gm2 = gx * gx + gy2 * gy2;
      if (gm2 > 1048576) { const gm = isqrt(gm2), nw = 1024 + (((gm - 1024) * 1229) >> 12); gx = Math.floor((gx * nw) / gm); gy2 = Math.floor((gy2 * nw) / gm); } // tame cliffs, keep grooves
      const g2 = (gx * gx + gy2 * gy2) >> 12, inv = INV_SQ[g2 > 65535 ? 65535 : g2]!;
      const ndl = ((((-gx * LX - gy2 * LY) >> 12) + LZ) * inv) >> 12;
      let sh = ONE + ((((ndl * 7316) >> 12) - ONE) >> 1);
      if (sh < 3277) sh = 3277 - (((3277 - sh) * 1638) >> 12);
      const cav = Ht[p]! - Hb[p]!; if (cav < 0) { sh = (sh * (ONE + ((cav * 1434) >> 12))) >> 12; if (sh < 0) sh = 0; }
      const o8 = p << 3, h = CAN[o8 + 3]!, pa = CAN[o8 + 4]!;
      let hq = (h * 5734) >> 12; if (hq > ONE) hq = ONE;
      const gloss = (((pa * (((CAN[o8 + 7]! & 255) * 4112) >> 8)) >> 12) * (1229 + ((2867 * hq) >> 12))) >> 12;
      let ndh = ((((-gx * HX - gy2 * HY) >> 12) + HZ) * inv) >> 12; if (ndh < 0) ndh = 0; else if (ndh > ONE) ndh = ONE;
      const sp0 = POW18[ndh]! - SPEC_FLAT, spec = sp0 > 0 ? (((gloss * 1720) >> 12) * sp0) >> 12 : 0;
      const dx = xu - 2048;
      const vig = ONE - ((492 * (((dx * dx) >> 12) + dy2)) >> 12);
      const gxq = x >> 4, fx = x & 15, o0 = gy * gn + gxq;
      const lgv = ((lg[o0]! * (16 - fx) + lg[o0 + 1]! * fx) * (16 - fy) + (lg[o0 + gn]! * (16 - fx) + lg[o0 + gn + 1]! * fx) * fy) >> 8;
      const lightG = ONE + ((123 * ((((2048 - xu) * 2458) + ly) >> 12)) >> 12) + lgv;
      let grime = 0;
      if (x < edgeBand || y < edgeBand || x >= D - edgeBand || y >= D - edgeBand) {
        const ed = Math.min(xu, ONE - xu, yu, ONE - yu);
        if (ed < q12(0.02)) grime = f12(f12(ONE - sm(Math.floor((ed * ONE) / q12(0.02))), q12(0.02) + f12(q12(0.06), maxI(0, n12(fbm(f16(Math.floor((x * Q) / D), q16(30)), f16(Math.floor((y * Q) / D), q16(30)), s8, 3)) - q12(0.35)))), ONE - f12(pa, q12(0.6)));
      }
      let m = (((sh * vig) >> 12) * lightG) >> 12;
      if (edgeStaple > 0) { const edq = Math.floor((Math.min(x, D - 1 - x, y, D - 1 - y) * Q) / D); if (edq < edgeStaple) m = f12(m, q12(0.82) + Math.floor((q12(0.18) * edq) / edgeStaple)); } // canvas turning over the stretcher
      { // the threads' colour only through thin paint (round 4)
        const primed = raw ? 0 : prm === null ? ONE : (prm[p]! * 4112) >> 8, t = T[p]!, fill = (primed * (2253 + ((1843 * SIZE[p]!) >> 12))) >> 12, it = ONE - t, gap = (it * it) >> 12;
        const thr = ((66 * TONE[p]!) >> 12) - ((((123 * gap) >> 12) * (ONE - ((fill * 2458) >> 12))) >> 12);
        let nq = (PAb[p]! * 13651) >> 12; nq = nq >= ONE ? ONE : SM12[nq]!;
        const nr = nq > ONE - primed ? nq : ONE - primed;
        m = (m * (ONE + ((((((thr * primed) >> 12) * (BARE_COLOUR + (((ONE - BARE_COLOUR) * nr) >> 12))) >> 12) * (ONE - pa)) >> 12))) >> 12;
      }
      const R0 = (CAN[o8]! * m) >> 12, G0 = (CAN[o8 + 1]! * m) >> 12, B0 = (((CAN[o8 + 2]! * m) >> 12) * 4063) >> 12;
      const r = grime ? ((R0 * (ONE - grime)) >> 12) + spec + ((grime * 82) >> 12) : R0 + spec;
      const g = grime ? ((G0 * (ONE - ((grime * 4424) >> 12))) >> 12) + spec : G0 + spec;
      const b = grime ? ((B0 * (ONE - ((grime * 5120) >> 12))) >> 12) + ((spec * 3973) >> 12) : B0 + ((spec * 3973) >> 12);
      const o = p * 4, r8 = (r * 255 + 2048) >> 12, g8 = (g * 255 + 2048) >> 12, b8 = (b * 255 + 2048) >> 12;
      out[o] = r8 < 0 ? 0 : r8 > 255 ? 255 : r8; out[o + 1] = g8 < 0 ? 0 : g8 > 255 ? 255 : g8; out[o + 2] = b8 < 0 ? 0 : b8 > 255 ? 255 : b8; out[o + 3] = 255;
    }
  }
  if (staples.length) { // staples along the turned edge
    const off = f16(f16(P.edgeW, q16(0.22)), D * 256) >> 8, L = (9 * S8) >> 8, w = maxI(1, (12 * S8) >> 11);
    const put = (cx: number, cy: number, horiz: boolean): void => {
      for (let y = cy - (horiz ? w : L); y <= cy + (horiz ? w : L); y++) for (let x = cx - (horiz ? L : w); x <= cx + (horiz ? L : w); x++) {
        if (x < 0 || y < 0 || x >= D || y >= D) continue;
        const t = Math.floor(((horiz ? y - cy + w : x - cx + w) * ONE) / (2 * w)), v = q12(0.5) + f12(q12(0.35), cosA(Math.floor((t * HALF_A) / ONE)) >> 2);
        const o = (y * D + x) * 4; out[o] = (v * 255) >> 12; out[o + 1] = (v * 255) >> 12; out[o + 2] = minI(255, (f12(v, q12(1.03)) * 255) >> 12);
      }
    };
    for (const s of staples) { const t = Math.floor((s * D) / Q); put(t, off, true); put(t, D - off, true); put(off, t, false); put(D - off, t, false); }
  }
  return out;
}

/* ── The code: 256 reading pixels, invisible in the paint ─────────────────────────────────────────────────────────────
 * A hidden grid of 16 x 16 tiles of 142 x 142 px from (64, 64), as versions 12 to 14; tile k (row-major) carries bit k
 * of the commitment, most significant bit of byte 0 first, in its reading pixel (64 + 142c + 71, 64 + 142r + 71). The
 * painting is continuous colour, so there is no palette colour and twin to choose between: the bit is the parity of
 * R + G + B at the reading pixel. The pixel keeps the exact colour the lit paint gave it when that parity is already
 * the bit; otherwise the lowest bit of its blue is flipped (one level of one channel, its one-level twin). */
/** The reading pixel of tile column or row c: the centre of version 11's tile (32 + 71 c + 35.5 on its 1200 px layout) at the recorded scale. */
const readAt = (c: number): number => Math.floor(((135 + 142 * c) * RS * 256) / 512);
function writeCode(px: Uint8Array, commitment: Uint8Array): void {
  for (let k = 0; k < 256; k++) {
    const bit = (commitment[k >> 3]! >> (7 - (k & 7))) & 1;
    const x = readAt(k & 15), y = readAt(k >> 4), i = (y * V15_WIDTH + x) * 4;
    if (((px[i]! + px[i + 1]! + px[i + 2]!) & 1) !== bit) px[i + 2] = px[i + 2]! ^ 1;
  }
}

/** Read the code from the art alone: the parity of each reading pixel. */
export function decodeV15(px: Uint8Array, width: number, height: number): Uint8Array | null {
  if (width !== V15_WIDTH || height !== V15_HEIGHT || px.length !== width * height * 4) return null;
  const out = new Uint8Array(32);
  for (let k = 0; k < 256; k++) {
    const x = readAt(k & 15), y = readAt(k >> 4), i = (y * width + x) * 4;
    if ((px[i]! + px[i + 1]! + px[i + 2]!) & 1) out[k >> 3]! |= 1 << (7 - (k & 7));
  }
  return out;
}

/** Paint the plan and light it at a scale (S8 = raster px a layout px, Q8). The painter decides at the recorded scale;
 *  any other scale lays the recorded scale's score again, mark for mark. */
function drawAt(plan: V15Plan, S8: number): { px: Uint8Array; measures: V15Measures } {
  const RS8 = RS * 256;
  let ez: Easel, staples: number[], measures: V15Measures, prm: Uint8Array | null;
  if (S8 === RS8) {
    const r = paint(plan, RS8, false); ez = r.ez; staples = r.staples; measures = r.measures; prm = r.prm;
  } else {
    const r = scoreOf(plan); const score = r.score; staples = r.staples; measures = r.measures; // the decision canvas is let go before the other one is made
    ez = makeEasel(plan, S8); prm = primedPlane(plan, ez.D, S8); groundInit(ez, plan, prm); ez.setTau(plan.sessions === 1 ? 1600 : 700); applyWindows(ez, plan);
    for (const op of score) layOp(ez, op);
  }
  return { px: finish(ez, plan, prm, staples), measures };
}
function scoreOf(plan: V15Plan): { score: Op[]; staples: number[]; measures: V15Measures } { const r = paint(plan, RS * 256, true); return { score: r.score, staples: r.staples, measures: r.measures }; }

/* ── The public face ─────────────────────────────────────────────────────────────────────────────────────────────── */
/** The recorded picture: 1800 x 1800 RGBA, the code in its 256 reading pixels. */
export function renderV15(plan: V15Plan, commitment: Uint8Array): Uint8Array {
  const { px } = drawAt(plan, RS * 256);
  writeCode(px, commitment);
  return px;
}
/** The same painting at S times the 1200 px layout (S = 2 is the recorded size), for print: the recorded scale's marks
 *  laid again at this scale, a redrawing, not the recorded file (it carries no code). */
export function renderV15At(plan: V15Plan, commitment: Uint8Array, S: number): Uint8Array {
  if (S === RS) return renderV15(plan, commitment);
  if (!Number.isInteger(S * 256) || S < 1 || S > 4) throw new RangeError("bitgraph-art/15 draws at 1 to 4 times its 1200 px layout, in 256ths");
  return drawAt(plan, S * 256).px;
}
/** The recorded picture and the painter's own measures of it (open space, mud, value range, saturation: the sweep's checks). */
export function renderV15Measured(plan: V15Plan, commitment: Uint8Array): { px: Uint8Array; measures: V15Measures } {
  const r = drawAt(plan, RS * 256);
  writeCode(r.px, commitment);
  return r;
}
/** The painter's own measures of a painting (the sweep's checks), with a 16 x 16 thumbnail of its colour (0..255 RGB). */
export function measureV15(plan: V15Plan): V15Measures & { thumb: number[] } {
  const r = paint(plan, RS * 256, false), { D, CAN } = r.ez, cell = Math.floor(D / 16), thumb: number[] = [];
  for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 16; tx++) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = ty * cell; y < (ty + 1) * cell; y += 3) for (let x = tx * cell; x < (tx + 1) * cell; x += 3) { const o = (y * D + x) << 3; sr += CAN[o]!; sg += CAN[o + 1]!; sb += CAN[o + 2]!; n++; }
    thumb.push(minI(255, Math.floor((sr * 255) / (n * ONE))), minI(255, Math.floor((sg * 255) / (n * ONE))), minI(255, Math.floor((sb * 255) / (n * ONE))));
  }
  return { ...r.measures, thumb };
}
/** The palette's name in plain words. */
export const paletteNameV15 = (plan: V15Plan): string => (plan.palette >= 0 ? REF_PALETTE_NAMES_V15[plan.palette]! : `${HARMONY_NAMES_V15[plan.harmony]} from hue ${plan.hue}`);
/** The composition's name in plain words. */
export const compositionNameV15 = (plan: V15Plan): string => STRATEGY_NAMES_V15[plan.strategy]!;
/** The five reference palettes as 8-bit RGB (roles D, S, A, K, P). */
export const PALETTES_V15: readonly { D: number[][]; S: number[][]; A: number[][]; K: number[]; P: number[] }[] = REF_PALETTES_V15.map((p) => {
  const b = (c: readonly number[]): number[] => c.map((v) => (v * 255 + 2048) >> 12);
  return { D: p.D.map(b), S: p.S.map(b), A: p.A.map(b), K: b(p.K), P: b(p.P) };
});
