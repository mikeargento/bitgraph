// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.
//
// BitGraph Folder exporter.
//
// Runs under JavaScript for Automation (`osascript -l JavaScript`), which ships
// with every Mac. That is the whole reason it is written this way rather than
// for node: a folder that records photos should not require its owner to
// install a runtime first. Bundling node would have meant a 229 MB binary, a
// second Apple certificate, and taking on responsibility for shipping a runtime
// with its own CVEs. This has none of those and produces byte-identical output.
//
// Wraps one recorded drop into the same export layout the website produces, so
// the proof material in a folder built here and in a zip downloaded from a
// proof page is the same thing. One addition the zip does not carry: an
// index.html, written so the folder can be read in a browser. It is derived,
// rebuilt on every index pass, ignored by bitgraph-audit (which finds proofs by
// schema shape rather than by filename), and deletable with nothing lost.
//
//   Recordings/
//       2026-08-09/                             the UTC day the chain sealed it
//           BitGraph (random-494.txt)/
//               proof.json
//               random-494.txt                  the original bytes, moved in
//               ethereum-anchors/
//                   anchor-before.json          lower bound
//                   anchor-before-witness.json  its block header
//                   anchor-after.json           upper bound, the seal
//                   anchor-after-witness.json   its block header
//       BitGraph (just-dropped.jpg)/            no seal yet, so no day yet
//
//   DAY FOLDERS EXIST SO A DROP CAN BE SCOPED (1.13.0). Browsing is dropping
//   the folder on the site, and that was all or nothing: the whole archive or
//   one export. Drag one date on instead and you get that day's roll. It also
//   bounds drop time, which otherwise grows with the folder forever, and makes
//   a single day shareable without handing over everything.
//
//   The day comes from the CHAIN, never the filesystem: field 11 of the RLP
//   header in anchor-after-witness.json is the sealed block's timestamp. See
//   dayOfExport. An export with no seal yet has no day and waits at the
//   Recordings/ root until a tidy pass files it.
//
//   The top level is the drop zone and stays empty at rest: the shutter and
//   the archive are different places. Exports found flat at the top level
//   (an older layout, or an old export dragged back in) are tucked into
//   Recordings/ by the next tidy pass; discovery is by content everywhere,
//   so both shapes keep working throughout.
//
//   THE FOLDER GENERATES NO BROWSING LAYER (1.9.0, Mike: "no index file at
//   all. instead, you drag and drop the whole folder into the camera and it
//   loads the Roll"). No contact sheet, no day pages, no thumbnail cache:
//   dropping the folder on bitgraph.ing renders all of that, verified, with
//   one implementation instead of two. The ONE page kept is each export's
//   own index.html - the offline receipt that lets a folder read months
//   later, on a machine with no network, still explain itself.
//
// files/ is GONE (1.8.0, Mike's call). It held a parallel hard link per
// recorded file so everything could be dragged out at once; the site's drop
// zone walks a whole dropped folder now, so it lost its job. --tidy
// dissolves an existing one safely — see the migration there. What it also
// means: the export holds this folder's ONLY copy of the file, so deleting an
// export sends the file inside it to the Trash with it. The person who wants
// their original kept elsewhere keeps it elsewhere: a plain same-disk drag
// into any folder is a MOVE and that is Finder's rule, not ours — copy-paste
// or Option-drag is how a copy comes in (asked and settled 2026-08-05; a
// droplet app was offered and declined, "i want it to remain a folder").
//
// No archive is written: bitgraph-audit ingests a directory directly and
// discovers entries by schema shape rather than by filename, so the folder
// audits as-is with `npx @mikeargento/bitgraph-audit <folder>`.
//
// Read-only against the ledger. It assembles proof material that already
// exists, never commits, and the file bytes never leave the machine.
//
// Usage (always via osascript -l JavaScript):
//   export.js <file> <digestB64> <counter> <epochUrlSafe>   build one export
//   export.js --complete <folder>                           finish pending ones
//   export.js --tidy <folder>                               layout hygiene
//   export.js --verify <folder>                             re-hash every export
//   export.js --recover <folder> [destFolder]               rebuild lost exports
//   export.js --json batch|commit <responseFile>            parse a response
//
// --verify and --recover are the two a person runs by hand. Neither can record
// anything: --verify makes no request at all, and --recover only ever asks the
// ledger what it already holds.
//
// Responses are read from FILES rather than piped in. doShellScript carries
// output through a shell pipe, and proofs embed a multi-kilobyte attestation;
// reading a file has no such ceiling and cannot silently truncate.

'use strict';

var app = Application.currentApplication();
app.includeStandardAdditions = true;

// Unwrap the whole environment dictionary rather than calling objectForKey.
// An ObjC nil returned for a missing key is TRUTHY in JavaScript (it arrives as
// a function), so the obvious `objectForKey(k) ? ... : default` reads as "found"
// for a key that does not exist and yields undefined, which then silently
// becomes the string "undefined" in every URL.
var ENV = ObjC.unwrap($.NSProcessInfo.processInfo.environment) || {};

/**
 * One environment variable, as a real string.
 *
 * Unwrapping the dictionary gets the KEYS right but leaves every VALUE an ObjC
 * object: `typeof ENV.HOME` is "function" and String() on it yields
 * "[id Swift.__StringStorage]". So `ENV.X || default` takes the wrong branch
 * whenever X is set, and quietly hands back an object that concatenates into
 * nonsense. Unwrapping the value in turn gives the string, and undefined when
 * the key is genuinely absent, which is the whole reason to go through here.
 */
function env(name) {
  var v = ObjC.unwrap(ENV[name]);
  return typeof v === 'string' ? v : '';
}

var API = env('BITGRAPH_API') || 'https://bitgraph.ing';
// Where hotfolder.sh keeps its state, including the version string the site
// last advertised. Same default as hotfolder.sh, since either can be run alone.
var HOME_DIR = env('BITGRAPH_HOME') || (env('HOME') + '/.bitgraph');


// Anchors land within roughly 12-24s at the normal cadence, so the ceiling is
// about 2x that. It is a ceiling, not a delay: the wait returns the moment the
// anchor appears. Past it the export is written pending and a later run
// completes it, which is the path that carries a slow cadence and the daily
// rotation window. Keeping it short matters because the caller holds a lock.
var SEAL_WAIT_MS = 45000;
var POLL_MS = 3000;
var PENDING = '.bitgraph-pending.json';
var ANCHOR_DIR = 'ethereum-anchors';


// ---------------------------------------------------------------------------
// Shell and filesystem
// ---------------------------------------------------------------------------

function quote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function sh(cmd) {
  try {
    return app.doShellScript(cmd);
  } catch (e) {
    return null;
  }
}

// Path("") raises an ObjC exception, which a JavaScript try/catch cannot catch:
// it terminates the process outright rather than returning an error. So every
// entry point checks for an empty path before constructing a Path, and a
// missing argument produces a clean failure instead of a crash.
function badPath(p) {
  return typeof p !== 'string' || p.length === 0;
}

function readFile(path) {
  if (badPath(path)) return null;
  try {
    return app.read(Path(path));
  } catch (e) {
    return null;
  }
}

/**
 * Write text as UTF-8.
 *
 * StandardAdditions' `write` encodes in the system's legacy encoding, not
 * UTF-8: an em dash came back out as the single byte 0xD1, which is what it is
 * in Mac Roman, and `file` reported the result as ISO-8859 despite the
 * document declaring charset=utf-8. Any filename carrying an accent or an
 * emoji would have been mangled the same way, and proof.json shares this
 * function, so attribution text was exposed too.
 *
 * NSString writes the encoding we ask for. Atomically, so a reader never sees
 * a half-written file.
 */
function writeFile(path, text) {
  if (badPath(path)) throw new Error('refusing to write to an empty path');
  var ok = $.NSString.stringWithString(String(text)).writeToFileAtomicallyEncodingError(
    path,
    true,
    $.NSUTF8StringEncoding,
    $()
  );
  if (!ok) throw new Error('could not write ' + path);
}

function writeJson(path, value) {
  writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

function exists(path) {
  if (badPath(path)) return false;
  return sh('test -e ' + quote(path) + ' && echo yes') === 'yes';
}

function mkdirp(path) {
  if (badPath(path)) return;
  sh('mkdir -p ' + quote(path));
}

function sleepMs(ms) {
  sh('sleep ' + (ms / 1000));
}

function tempPath() {
  return sh('mktemp -t bitgraph-export') || '/tmp/bitgraph-export.json';
}

/**
 * Read a file as UTF-8 through NSString.
 *
 * StandardAdditions' `read` handles ordinary text, but it cannot carry a NUL
 * byte, and the recovery walk separates paths with NULs on purpose: a newline
 * is a legal character in a macOS filename, so a line-separated listing would
 * split one path into two. `find -print0` into a file and this reader is the
 * combination that survives every name the filesystem allows.
 */
function readFileUtf8(path) {
  if (badPath(path)) return null;
  try {
    var s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, $());
    var js = ObjC.unwrap(s);
    // An ObjC nil is TRUTHY here and arrives as a function, so the type is the
    // only honest test. Same trap as the environment dictionary above.
    return typeof js === 'string' ? js : null;
  } catch (e) {
    return null;
  }
}

/** GET a URL and parse it. Returns null on any failure, which callers treat as absent. */
function getJson(url) {
  var tmp = tempPath();
  try {
    sh('curl -s --max-time 25 -o ' + quote(tmp) + ' ' + quote(url));
    var body = readFile(tmp);
    if (!body) return null;
    var parsed = JSON.parse(body);
    return parsed && parsed.error ? null : parsed;
  } catch (e) {
    return null;
  } finally {
    sh('rm -f ' + quote(tmp));
  }
}

/**
 * POST a JSON body and parse the reply.
 *
 * Both directions go through files, for the reason stated at the top: response
 * bodies carry multi-kilobyte attestations and doShellScript pipes have a
 * ceiling that truncates silently. `--data-binary @file` keeps the request off
 * the command line too, which a batch of a few dozen digests would otherwise
 * fill.
 */
function postJson(url, body) {
  var reply = tempPath();
  var payload = tempPath();
  try {
    writeFile(payload, JSON.stringify(body));
    sh('curl -s --max-time 60 -X POST ' + quote(url) +
      ' -H ' + quote('Content-Type: application/json') +
      ' --data-binary ' + quote('@' + payload) +
      ' -o ' + quote(reply));
    var raw = readFile(reply);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.error ? null : parsed;
  } catch (e) {
    return null;
  } finally {
    sh('rm -f ' + quote(reply) + ' ' + quote(payload));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toUrlSafe(b64) {
  return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * SHA-256 of a file, STANDARD base64, which is the form proof.json stores.
 *
 * The URL-safe alphabet is for URLs only; comparing one against the other reads
 * as a mismatch for any digest that happens to contain a + or a /, which is
 * most of them.
 *
 * `openssl base64 -A` rather than plain `base64`: -A refuses to wrap, and a
 * wrapped digest arriving through doShellScript would compare unequal to a
 * proof that stores it on one line. 32 bytes encodes to 44 characters, far
 * under any pipe's ceiling, so this one is safe to read through the shell.
 */
function digestOfFile(path) {
  if (badPath(path)) return null;
  var out = sh('openssl dgst -sha256 -binary ' + quote(path) +
    ' 2>/dev/null | openssl base64 -A 2>/dev/null');
  return out ? String(out).trim() || null : null;
}

// ---------------------------------------------------------------------------
// Ledger reads
// ---------------------------------------------------------------------------

/** The proof at this exact causal position, or null. */
/**
 * The proof at one causal position.
 *
 * ⚠️ THE POSITION MUST BE ASKED FOR. This endpoint answers with exactly one
 * proof, `{proofs:[{proof}]}`, and without ?counter= that one is the server's
 * own earliest. Searching that single-element array for some other position
 * therefore always missed, which is what produced "no proof at #22" and left a
 * file permanently unexportable. The batch endpoint is the one that returns
 * every position; this one selects.
 *
 * The epoch goes too when it is known, because a counter alone does not name a
 * position: counters restart every UTC day.
 */
// Proofs the watcher already received, from the lookup and commit responses it
// made anyway. Filled by --drop; empty otherwise, so a single build is
// unchanged. See indexResponses.
var PROOF_CACHE = {};

function fetchProof(digestB64, counter, epochUrlSafe) {
  // ⚠️ Still checked against the position asked for, exactly as a fetched proof
  // is. A cached proof is only usable when it is the RIGHT one: the same bytes
  // can sit at several causal positions, and handing back the wrong one would
  // build an export around a recording that is not the one being exported.
  var held = PROOF_CACHE[toUrlSafe(digestB64)];
  if (held) {
    for (var i = 0; i < held.length; i++) {
      var c = held[i];
      if (String(c.commit.counter) !== String(counter)) continue;
      if (epochUrlSafe && toUrlSafe(String(c.commit.epochId || '')) !== String(epochUrlSafe)) continue;
      return c;
    }
  }

  var url = API + '/api/proofs/digest/' + toUrlSafe(digestB64) +
    '?counter=' + encodeURIComponent(counter) +
    (epochUrlSafe ? '&epoch=' + encodeURIComponent(epochUrlSafe) : '');
  var data = getJson(url);
  if (!data || !data.proofs || !data.proofs.length) return null;
  var p = data.proofs[0].proof || data.proofs[0];
  if (!p || !p.commit) return null;
  // The server falls back to its earliest when the position is unknown to it,
  // so confirm we were given what we asked for rather than something else.
  return String(p.commit.counter) === String(counter) ? p : null;
}

/** { before, after } anchor proofs bracketing a position. Either may be null. */
/**
 * Bracketing anchors, remembered as SPANS rather than per counter.
 *
 * ⚠️ This is the single biggest cost in a batch. Each call is two requests, and
 * a hundred-file drop made two hundred of them to learn the same answer over
 * and over: a batch commits within seconds, so every proof in it sits between
 * the same two anchors.
 *
 * A span is exact, not a guess. If the nearest anchor before counter X is at
 * `lo` and the nearest after is at `hi`, then for ANY counter strictly between
 * lo and hi the nearest anchors are those same two, because by definition there
 * is no anchor in between. So one answer covers the whole span, and a hundred
 * files collapse to one or two lookups.
 *
 * Only cached when both sides are known and carry counters, since a span with
 * an open end says nothing about what might land in it later.
 */
var ANCHOR_SPANS = [];

function anchorCounterOf(anchor) {
  var c = anchor && anchor.commit && anchor.commit.counter;
  if (c === undefined || c === null) return null;
  var n = parseInt(c, 10);
  return isNaN(n) ? null : n;
}

function fetchAnchors(counter, epochUrlSafe) {
  var n = parseInt(counter, 10);
  var epoch = String(epochUrlSafe);
  if (!isNaN(n)) {
    for (var i = 0; i < ANCHOR_SPANS.length; i++) {
      var s = ANCHOR_SPANS[i];
      if (s.epoch === epoch && n > s.lo && n < s.hi) {
        return { before: s.before, after: s.after };
      }
    }
  }

  var q = 'counter=' + encodeURIComponent(counter) + '&epoch=' + encodeURIComponent(epoch);
  var after = getJson(API + '/api/proofs/anchors?' + q + '&limit=1');
  var before = getJson(API + '/api/proofs/anchors?' + q + '&before=1');
  var out = {
    before: before && before.anchors && before.anchors[0] ? before.anchors[0] : null,
    after: after && after.anchors && after.anchors[0] ? after.anchors[0] : null,
  };

  var lo = anchorCounterOf(out.before);
  var hi = anchorCounterOf(out.after);
  if (lo !== null && hi !== null && lo < hi) {
    ANCHOR_SPANS.push({ epoch: epoch, lo: lo, hi: hi, before: out.before, after: out.after });
  }
  return out;
}

/**
 * The offline block-header witness for an anchor's block, or null.
 * The server self-checks it (returns it only when keccak256(header) equals the
 * signed block hash), so a miss just omits the file and the export stays valid.
 */
// A block header is immutable, and a whole batch shares the same two anchors,
// so this went from two requests per file to two per drop. Negative results are
// cached too: a witness that is not there for a block will not appear during
// one run, and re-asking per file is what made it expensive.
var WITNESS_CACHE = {};

function fetchWitness(anchor) {
  var b = anchorBlockOf(anchor);
  if (!b) return null;
  var key = String(b.number) + '|' + String(b.hash);
  if (Object.prototype.hasOwnProperty.call(WITNESS_CACHE, key)) return WITNESS_CACHE[key];
  var w = getJson(API + '/api/proofs/witness?block=' + b.number +
    '&hash=' + encodeURIComponent(b.hash));
  WITNESS_CACHE[key] = w;
  return w;
}

/**
 * An anchor's Ethereum block, from either shape it has ever been written in.
 *
 * ⚠️ THE `ethereum` OBJECT IS NOT ALWAYS THERE. Anchors written before it was
 * added carry the block in attribution: the number inside an etherscan URL in
 * `title`, the hash in `message`. Reading only `ethereum` meant no witness, so
 * no block time, so the export page said "sealing" forever for anything
 * recorded in that era. The recording was sealed the whole time; the export
 * simply could not see it.
 *
 * The website's own export builder has always had this fallback. The Folder is
 * the second implementation of that page and never got it.
 */
function anchorBlockOf(anchor) {
  if (!anchor) return null;
  var eth = anchor.ethereum;
  if (eth && typeof eth.blockNumber === 'number' && typeof eth.blockHash === 'string') {
    return { number: eth.blockNumber, hash: eth.blockHash };
  }
  var attr = anchor.attribution;
  if (!attr || typeof attr.title !== 'string' || typeof attr.message !== 'string') return null;
  var m = attr.title.match(/\/block\/(\d+)/);
  if (!m) return null;
  var n = parseInt(m[1], 10);
  return isFinite(n) && attr.message ? { number: n, hash: attr.message } : null;
}

/** Wait for the sealing anchor, returning as soon as it appears or at the deadline. */
function awaitSeal(counter, epochUrlSafe, deadlineMs) {
  var waited = 0;
  var anchors = fetchAnchors(counter, epochUrlSafe);
  while (!anchors.after && waited < deadlineMs) {
    sleepMs(POLL_MS);
    waited += POLL_MS;
    anchors = fetchAnchors(counter, epochUrlSafe);
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Export assembly
// ---------------------------------------------------------------------------

/** Write the proof material into an export directory. True once sealed. */
function writeExportContents(dir, meta, proof, waitMs) {
  var anchors = awaitSeal(meta.counter, meta.epochUrlSafe, waitMs);

  writeJson(dir + '/proof.json', proof);

  // Rebuilt wholesale each pass so a completion run cannot leave a stale
  // half-set behind.
  sh('rm -rf ' + quote(dir + '/' + ANCHOR_DIR));
  var sides = ['before', 'after'].filter(function (s) { return anchors[s]; });
  if (sides.length) {
    mkdirp(dir + '/' + ANCHOR_DIR);
    sides.forEach(function (side) {
      var anchor = anchors[side];
      writeJson(dir + '/' + ANCHOR_DIR + '/anchor-' + side + '.json', anchor);
      var witness = fetchWitness(anchor);
      if (witness) {
        writeJson(dir + '/' + ANCHOR_DIR + '/anchor-' + side + '-witness.json', witness);
      }
    });
  }
  return Boolean(anchors.after);
}

function markPending(dir, meta, sealed) {
  if (sealed) sh('rm -f ' + quote(dir + '/' + PENDING));
  else writeJson(dir + '/' + PENDING, meta);
}

// A path component is capped at 255 bytes. `bitgraph-proof-`, the counter, a
// possible `-epoch8` and the two parentheses account for about forty of them,
// so the label takes the rest with room to spare.
var LABEL_BYTES = 200;

/**
 * The filename, made safe to sit inside a directory name.
 *
 * Two hazards, both rare and both real. A control character would break
 * the old sheet pass, which read `stat` output one line at a time: a newline is a
 * legal character in a macOS filename and would split one entry into two. And
 * a component over 255 bytes fails mkdir outright, which would turn a
 * successful recording into no folder at all, so the cut is by byte rather
 * than by character (one emoji is four bytes). The extension survives the cut,
 * being the part that says what the file is.
 *
 * Returns '' when nothing usable is left, and the caller falls back to the
 * bare counter.
 */
function labelFor(fileName) {
  // Runs of plain spaces, not \s+. macOS names its own screenshots with a
  // NARROW NO-BREAK SPACE (U+202F) before "PM", which \s matches, so collapsing
  // by \s would quietly retype every screenshot's name into something that
  // looks the same and is not. The label should read exactly like the file.
  var clean = String(fileName).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (utf8Len(clean) <= LABEL_BYTES) return clean;
  var ext = extOf(clean);
  var tail = ext ? '.' + ext : '';
  var head = clean.slice(0, clean.length - tail.length);
  while (head.length && utf8Len(head + tail) > LABEL_BYTES) head = head.slice(0, -1);
  return head ? head + tail : '';
}

function utf8Len(s) {
  return $.NSString.stringWithString(String(s)).lengthOfBytesUsingEncoding($.NSUTF8StringEncoding);
}

/**
 * True when this directory already holds THIS recording.
 *
 * All three of digest, counter and epoch, not the digest alone. The same bytes
 * can be recorded at more than one causal position on purpose (BitGraph
 * Again), and once the counter left the folder name the digest stopped being
 * enough to tell a re-fired watch from a genuine second recording. Matching on
 * the digest alone would have silently folded the second one into the first.
 * The counter needs the epoch with it for the reason the number search was
 * removed: counters restart every UTC day.
 */
function builtHere(dir, digestB64, counter, epochUrlSafe) {
  var raw = readFile(dir + '/proof.json');
  if (raw === null) return false;
  try {
    var p = JSON.parse(raw);
    if (!p || !p.artifact || p.artifact.digestB64 !== digestB64) return false;
    if (!p.commit || String(p.commit.counter) !== String(counter)) return false;
    return toUrlSafe(String(p.commit.epochId || '')) === String(epochUrlSafe);
  } catch (e) {
    return false; /* unreadable, treat as a collision */
  }
}

/**
 * Pick the export directory: `BitGraph (kitchen-reno.jpg)`.
 *
 * The counter used to lead, and it was noise dressed as an identifier. A
 * counter is a position within one epoch, an epoch is one UTC day, and the
 * chain runs to roughly twelve thousand of them before the day ends, so
 * `bitgraph-proof-1345` names a different recording most days and identifies
 * none of them. It is still in proof.json and on the recording's own page under
 * Artifact Commit, which is where a number that needs its epoch belongs.
 *
 * Dropping it also moves this closer to the website rather than further: a
 * batch exported from the site already names each folder after its file.
 *
 * The name is decoration and is never read back. Everything downstream reads
 * proof.json, which is what lets a folder be renamed by hand without breaking
 * anything, and it is how bitgraph-audit finds proofs too.
 *
 * THREE naming schemes have shipped in a day, so all of them are checked before
 * this decides an export is missing. A re-fired watch has to land on the folder
 * it already built rather than making a second one beside it. Old folders keep
 * their old names: renaming them is not this function's job.
 */
function resolveDir(folder, counter, epochUrlSafe, digestB64, fileName) {
  var label = labelFor(fileName);
  var suffix = label ? ' (' + label + ')' : '';
  var base = folder + '/' + REC_DIR + '/BitGraph' + suffix;
  // Every layout that has ever shipped, flat at the top level: the 1.2.4-1.6.x
  // name, then the counter-era ones. A re-fired watch has to land on the
  // folder it already built wherever an older version built it.
  var flat = folder + '/BitGraph' + suffix;
  var old = folder + '/bitgraph-proof-' + counter;
  var oldEpoch = old + '-' + String(epochUrlSafe).slice(0, 8);

  // Newest first, so a re-fire on a current export costs one read.
  var known = [base, flat, old + suffix, old, oldEpoch + suffix, oldEpoch];
  for (var i = 0; i < known.length; i++) {
    if (builtHere(known[i], digestB64, counter, epochUrlSafe)) {
      return { dir: known[i], alreadyBuilt: true };
    }
  }
  /* Then the day folders. A new export cannot know its day (the seal lands
     ~40s later), so it is always BUILT at the Recordings/ root and FILED by a
     later tidy pass. That means a re-fire after filing would look at the root,
     find nothing, and build a second copy of a recording that already exists.
     Checked after the direct paths so the ordinary re-fire still costs one
     read, and only the names a day folder could hold are considered. */
  var days = sh('ls -1 ' + quote(folder + '/' + REC_DIR) + ' 2>/dev/null');
  if (days) {
    var names = days.split('\r').join('\n').split('\n').filter(isDayName);
    for (var d = names.length - 1; d >= 0; d--) {
      var filed = folder + '/' + REC_DIR + '/' + names[d] + '/BitGraph' + suffix;
      if (builtHere(filed, digestB64, counter, epochUrlSafe)) {
        return { dir: filed, alreadyBuilt: true };
      }
    }
  }
  if (!exists(base + '/proof.json')) return { dir: base, alreadyBuilt: false };

  // The name is taken by a different recording. Two distinct files are both
  // allowed to be called IMG_0001.jpg, and the same file recorded at a second
  // causal position (BitGraph Again) is two recordings and wants two folders.
  for (var n = 2; n < 1000; n++) {
    var alt = base + ' ' + n;
    if (builtHere(alt, digestB64, counter, epochUrlSafe)) return { dir: alt, alreadyBuilt: true };
    if (!exists(alt + '/proof.json')) return { dir: alt, alreadyBuilt: false };
  }
  // A thousand recordings sharing one filename. Fall back to something that
  // cannot collide rather than looping forever.
  return { dir: base + ' ' + String(epochUrlSafe).slice(0, 6) + '-' + counter, alreadyBuilt: false };
}

function baseName(p) {
  var parts = String(p).split('/');
  return parts[parts.length - 1];
}

// ---- files/ (legacy, dissolved by --tidy) ----------------------------------
//
// The name survives only so the migration and the walkers can recognise the
// directory in folders built before 1.8.0. It held a flat set of hard links
// to every recorded file, because a drop used to MOVE the file into its
// export and this was the one way to get everything back out in one go. Drops
// no longer consume the file (it stays where the person put it, the export
// links to it), so the parallel tree lost its purpose, and the site's drop
// zone walking a whole dropped folder took the other half of the job.
var FILES_DIR = 'files';

// Where exports live: one level down, so the folder a person drops into stays
// EMPTY at rest. The top level is the shutter, Recordings/ is the roll, and
// the reason the folder used to read as messy is that they were the same
// place. The machinery (.thumbs, the caches) is dotfile-hidden.
//
// ⚠️ The website's export ZIP stays FLAT, deliberately. A zip is a snapshot
// that never grows; this container exists to keep a LIVING folder calm. That
// is the one structural asymmetry between the two implementations, and it is
// documented in both headers.
var REC_DIR = 'Recordings';

// ---- The day an export belongs to -----------------------------------------
//
// Recordings/ went flat and stayed flat, and a flat folder is a wall: this
// machine holds 2,261 exports in one directory. Filing them by day is not
// housekeeping, it is what lets a DROP BE SCOPED — drag one date onto
// bitgraph.ing and you get that day's roll, without the Folder growing a
// browsing layer it deliberately does not have (1.9.0). Finder is the browser.
//
// THE DATE COMES FROM THE CHAIN, NOT THE FILESYSTEM. mtime is the filesystem's
// opinion and orders nothing (see listExports), and a system clock at export
// time cannot date the 2,261 recordings already on disk. Every export carries
// ethereum-anchors/anchor-after-witness.json, whose headerRlpHex is the sealed
// block header, and field 11 of an Ethereum header is its timestamp. Verified
// against this machine's folder: 2,261 of 2,261 exports carry that witness, so
// every recording that exists can be filed by what Ethereum says rather than
// by a guess.
//
// UTC, and not as a preference: an epoch IS a UTC calendar day, so a date
// folder is the protocol's own partition made visible. A local date would cut
// across a boundary the protocol does not have.
//
// ⚠️ APPROXIMATELY, NOT EXACTLY, AN EPOCH. Rotation is at 23:59 UTC, not
// midnight, so a UTC date catches a one-minute sliver of the next epoch. Every
// day in the site's archive spans two epochs for this reason. Date is still the
// right unit because epochs have no names to put on a folder, but do not read
// "one folder, one epoch" into this.
var ANCHOR_DIR_NAME = 'ethereum-anchors';

/**
 * Field `want` of an RLP list, as bytes. Enough of RLP to walk a header and no
 * more: headers are a flat list of byte strings, so there is no nesting to
 * recurse into and nothing here needs to encode.
 *
 * Deliberately not a verifier. bitgraph-verify and the proof page already
 * recompute the header hash and check it against the signed block hash; this
 * only needs to know which day to file a folder under, and a wrong answer files
 * a recording under the wrong date rather than asserting anything false about
 * it.
 */
function rlpField(bytes, want) {
  var i = 0;
  var p = bytes[0];
  if (p >= 0xf8) i = 1 + (p - 0xf7);
  else if (p >= 0xc0) i = 1;
  else return null; /* not a list */
  for (var n = 0; i < bytes.length; n++) {
    var h = bytes[i], start, len;
    if (h < 0x80) { start = i; len = 1; }
    else if (h < 0xb8) { start = i + 1; len = h - 0x80; }
    else {
      var k = h - 0xb7, size = 0;
      for (var j = 0; j < k; j++) size = size * 256 + bytes[i + 1 + j];
      start = i + 1 + k; len = size;
    }
    if (n === want) return bytes.slice(start, start + len);
    i = start + len;
  }
  return null;
}

function hexToBytes(hex) {
  var h = String(hex || '').replace(/^0x/, '');
  if (h.length % 2) h = '0' + h;
  var out = [];
  for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return out;
}

/**
 * Move an export under the day the chain sealed it. Returns the new path, or
 * the old one when it did not move.
 *
 * THIS IS WHERE FILING HAS TO HAPPEN, not only in --tidy. The hot folder runs
 * tidy on a narrow trigger (an export flat at the TOP level), because tidy ends
 * up grepping every export and that is a third of a drop on a large folder. A
 * newly recorded export never lands at the top level, so widening the trigger
 * to catch it would have made every drop pay that grep. Sealing is the honest
 * moment anyway: the day is unknowable before it and exact after it, and this
 * costs one witness read on an export already open in front of us.
 *
 * Never overwrites and never deletes: an export holds the ONLY copy of its file
 * (1.8.0), so a name already taken in the destination is left for --tidy to
 * disambiguate rather than resolved by clobbering.
 */
function fileUnderDay(folder, dir) {
  var day = dayOfExport(dir);
  if (!day) return dir;
  var destDir = folder + '/' + REC_DIR + '/' + day;
  var dest = destDir + '/' + baseName(dir);
  if (dest === dir || exists(dest)) return dir;
  mkdirp(destDir);
  var moved = sh('mv ' + quote(dir) + ' ' + quote(dest) + ' 2>/dev/null && echo ok');
  return moved === 'ok' ? dest : dir;
}

/** UTC `YYYY-MM-DD` for an export, or null when it cannot be known yet.
 *
 *  NULL IS A REAL ANSWER. The seal lands about forty seconds after the drop, so
 *  a just-recorded export has no anchor-after witness and genuinely has no day
 *  yet. It waits at the Recordings/ root and the next tidy pass files it, which
 *  is the same shape as the flat-export tuck that already lives there. Guessing
 *  a date from the clock would file it under the wrong day whenever a drop
 *  straddles 23:59 UTC. */
function dayOfExport(dir) {
  var raw = readFileUtf8(dir + '/' + ANCHOR_DIR_NAME + '/anchor-after-witness.json');
  if (!raw) return null;
  var hex;
  try { hex = JSON.parse(raw).headerRlpHex; } catch (e) { return null; }
  if (!hex) return null;
  var ts = rlpField(hexToBytes(hex), 11);
  if (!ts || !ts.length) return null;
  var secs = 0;
  for (var i = 0; i < ts.length; i++) secs = secs * 256 + ts[i];
  if (!secs) return null;
  return new Date(secs * 1000).toISOString().slice(0, 10);
}


function dirName(p) {
  var parts = String(p).split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * Put the recorded file into its export.
 *
 * A drop MOVES. The file was handed to the folder, and the export is where it
 * now lives. (Settled twice, 2026-08-05: what Mike wanted preserved was the
 * ORIGIN the file was dragged FROM, and by the time the watcher sees a file
 * Finder has already moved it off its origin — a same-disk drag into any
 * folder is a move, and that is Finder's rule, not ours. Copy-paste or
 * Option-drag is how a copy comes in; a droplet app that would have made
 * drops copy was offered and declined, "i want it to remain a folder". So
 * the folder absorbs what actually enters it, and "stays where dropped" —
 * briefly shipped between those two decisions — was a misreading.)
 *
 * A recovery must not move, which is what `keepSource` is for: its source is
 * the user's own library or a backup, and emptying that out would be a second
 * loss on top of the one being repaired. It links instead, which is not a
 * copy but a second name for the same bytes, so it costs no disk and cannot
 * drift. The copy is the fallback for a source on another volume, which an
 * external backup drive always is.
 *
 * Never clobbers the artifact. If the export already holds the file then the
 * move this is finishing already happened, and in a recovery `from` and `to`
 * can even be the same path. Overwriting is how the 2026-08-04 feedback loop
 * destroyed six recorded files, so the rule here is that an artifact already
 * in place wins.
 */
function placeArtifact(from, to, keepSource) {
  if (!exists(from)) return;
  if (exists(to)) {
    // Two names, same bytes: a drop that arrived twice. The export already has
    // what it needs, so the duplicate at the top level is just litter and goes.
    // Only ever when the digests agree, because deleting a file that is NOT
    // already safely inside the export would be losing it.
    if (!keepSource && digestOfFile(from) === digestOfFile(to)) {
      sh('rm -f ' + quote(from));
    }
    return;
  }
  if (!keepSource) {
    sh('mv ' + quote(from) + ' ' + quote(to));
    return;
  }
  if (sh('ln ' + quote(from) + ' ' + quote(to) + ' 2>/dev/null && echo ok') === 'ok') return;
  sh('cp -p ' + quote(from) + ' ' + quote(to));
}


/**
 * Set by `--batch`: this export is one file of a whole drop, and the caller
 * will seal and index once at the end.
 *
 * ⚠️ The seal wait is what made batches slow, not the hashing. Hashing a
 * hundred files takes half a second; waiting for each one's anchor takes about
 * twelve, because that is the anchor interval. Waiting per file made a drop
 * O(n) in anchor intervals for information that ONE wait answers: anchors are
 * time-based, so the single anchor that lands after the last commit seals every
 * proof in the batch at once.
 *
 * Nothing is lost by not waiting. The export is written and marked pending, and
 * `--complete` finishes it, which the watcher already runs.
 */
var BATCH_DROP = false;

/** Build a fresh export folder for one recorded file. */
/**
 * Build the export for one recorded file.
 *
 * `destFolder` is where the export goes, which is normally the directory the
 * file sits in and is not when the file came from a folder someone dragged in.
 * Without it a photo at BitGraph/vacation/001.jpg would have its export built
 * inside vacation/, complete with its own contact sheet, instead of joining the
 * others at the top level.
 *
 * `keepSource` leaves the original where it is instead of moving it in, which
 * is what a recovery needs and a drop must never do. See placeArtifact.
 */
function buildExport(filePath, digestB64, counter, epochUrlSafe, destFolder, keepSource) {
  var fileName = baseName(filePath);
  var folder = destFolder || dirName(filePath);

  var proof = fetchProof(digestB64, counter, epochUrlSafe);
  if (!proof) return 'error: no proof at #' + counter + ' for ' + fileName + ', file left in place';

  var r = resolveDir(folder, counter, epochUrlSafe, digestB64, fileName);
  if (r.alreadyBuilt) {
    // A re-fired watch must not redo the work. Still finish the move: an
    // export whose artifact went missing (a run that died mid-build, a hand
    // deletion) is made whole by the next drop of the same bytes, and a
    // duplicate of bytes already inside is cleaned up as litter.
    placeArtifact(filePath, r.dir + '/' + fileName, keepSource);
    return 'ok: already exported';
  }
  mkdirp(r.dir);

  var meta = {
    fileName: fileName,
    digestB64: digestB64,
    counter: String(counter),
    epochUrlSafe: String(epochUrlSafe),
  };
  var sealed = writeExportContents(r.dir, meta, proof, BATCH_DROP ? 0 : SEAL_WAIT_MS);
  markPending(r.dir, meta, sealed);

  // Moved in last, so a failure above never strands the file.
  placeArtifact(filePath, r.dir + '/' + fileName, keepSource);

  // No receipt is written (1.12.0: the folder writes no HTML). This drops one
  // an older version left behind, so a folder cleans itself out as it is used
  // rather than needing a migration.
  try {
    dropPage(r.dir);
  } catch (e) {
    /* the evidence stands; the next completion pass rebuilds the page */
  }

  return 'ok: ' + baseName(r.dir) + (sealed ? '' : ' (pending seal)');
}

/**
 * Finish any export still waiting on the anchor that seals it.
 *
 * `waitMs` is per export and yet costs ONE wait for a whole batch, which is the
 * property that makes deferring the seal free. Anchors are time-based, so the
 * first pending export blocks until the next anchor lands and every later one
 * in the same drop then finds that same anchor already there and returns at
 * once. A hundred pending exports cost one anchor interval, not a hundred.
 *
 * Defaults to 0 so the watcher's opening sweep stays instant.
 */
function completePending(folder, waitMs) {
  var wait = parseInt(waitMs, 10);
  if (!(wait >= 0)) wait = 0;
  // Both places: Recordings/ is where exports live, the top level is where an
  // older layout left them or a dragged-back export sits until the next index
  // pass tucks it in. A pending file rides inside its export either way.
  var names = [];
  [[folder + '/' + REC_DIR, REC_DIR + '/'], [folder, '']].forEach(function (pair) {
    var listing = sh('ls -1 ' + quote(pair[0]) + ' 2>/dev/null');
    if (!listing) return;
    listing.split('\r').join('\n').split('\n').filter(Boolean).forEach(function (n) {
      names.push(pair[1] + n);
    });
  });
  if (!names.length) return 'ok: nothing pending';
  var sealedCount = 0;

  names.forEach(function (name) {
    var dir = folder + '/' + name;
    // Witness self-repair used to ride the sheet pass; with no sheet pass it
    // rides here. Narrow as ever: fires only when an anchor sits without its
    // witness. It no longer has a page to rebuild afterwards, but the repair
    // itself is the point: the witness file is evidence, not chrome.
    try {
      repairWitnesses(dir);
    } catch (e) {
      /* tried again next pass */
    }
    var raw = readFile(dir + '/' + PENDING);
    if (raw === null) return;

    var meta;
    try {
      meta = JSON.parse(raw);
    } catch (e) {
      return;
    }
    var proof = fetchProof(meta.digestB64, meta.counter, meta.epochUrlSafe);
    if (!proof) return;
    try {
      // One wait per PASS, not per export. Anchors are time-based, so the
      // anchor the first pending export waits for seals every other one in the
      // same pass; and when anchoring is idle (the TEE at rest), one timeout
      // must not become one per export.
      var sealed = writeExportContents(dir, meta, proof, wait);
      wait = 0;
      markPending(dir, meta, sealed);
      dropPage(dir);
      if (sealed) {
        sealedCount++;
        // The anchor just landed, so the day is knowable for the first time.
        // File it now rather than leaving it for a tidy pass that the hot
        // folder has no reason to run.
        dir = fileUnderDay(folder, dir);
      }
    } catch (e) {
      /* leave it pending; the next run tries again */
    }
  });

  return 'ok: sealed ' + sealedCount;
}

// ---------------------------------------------------------------------------
// Response parsing for the shell script
// ---------------------------------------------------------------------------

function epochToUrlSafe(e) {
  return String(e || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* "On record" means on the chain this tool can verify. The ledger is
 * append-only and still answers with pre-cutover occ/1 proofs for bytes
 * recorded before 2026-05-15; every verifier in the product is bitgraph/1
 * only, so treating those as "on record" produced exports that can never
 * check out (16 of them, found 2026-08-05). Filtered HERE, at the response
 * edge, so every consumer — the drop gate, recovery, the export builder's
 * position pick — agrees on what exists. The ledger's earliest-first order
 * is preserved within the filter: the earliest bitgraph/1 proof is the
 * canonical one, and bytes with only occ/1 proofs are simply not on record,
 * so dropping them records them properly. */
function currentChainProofs(proofs) {
  return (proofs || []).filter(function (e) {
    var p = (e && e.proof) || e;
    return p && p.version === 'bitgraph/1';
  });
}

/**
 * Batch-check response to `yes\t<counter>\t<epoch>` / `no` / `error`.
 * Reports the EARLIEST position so an already-on-record drop is exported from
 * its originating proof rather than a later BitGraph Again position.
 */
function parseBatch(body) {
  try {
    var results = JSON.parse(body).results || {};
    var keys = Object.keys(results);
    if (!keys.length) return 'no';
    var proofs = currentChainProofs(results[keys[0]].proofs);
    if (!proofs.length) return 'no';

    // ⚠️ TAKE THE SERVER'S FIRST. This used to pick the numerically smallest
    // counter, which compares positions ACROSS EPOCHS and is meaningless:
    // counters restart every UTC day, so a #22 recorded tonight looks "earlier"
    // than a #13000 recorded last week. The ledger returns these earliest-first
    // using write times it has and this does not, so re-deriving the order here
    // could only ever get it wrong.
    //
    // It did. A file recorded on two different days reported #22, the export
    // then asked for a position the digest lookup did not answer with, and the
    // drop failed with "no proof at #22" every single time.
    var first = (proofs[0].proof || proofs[0]).commit || {};
    return 'yes\t' + (first.counter || '') + '\t' + epochToUrlSafe(first.epochId);
  } catch (e) {
    return 'error';
  }
}

/** Commit response to `ok\t<counter>\t<epoch>` / `retry` / `fail`. */
/**
 * The same lookup, for MANY digests at once: one line of
 * `digestB64<TAB>counter<TAB>epoch` per digest the ledger knows.
 *
 * The watcher used to ask about one digest per HTTP request. A round trip to
 * the ledger costs about the same whether it carries one digest or twenty-five
 * (measured: 1.32s for one, 0.72s for twenty-five), so a hundred-file drop was
 * paying a hundred round trips for work that fits in four.
 *
 * ⚠️ KEYED BY THE DIGEST INSIDE EACH PROOF, never by position in the response.
 * The caller matches lines back to files by digest, so a server that reorders,
 * omits or dedupes results cannot silently hand a file the proof of a different
 * file. Position-matching is the same mistake that produced "no proof at #22".
 *
 * Digests are emitted in the STANDARD base64 the caller hashed with, whatever
 * alphabet the response keyed on.
 */
function parseBatchMany(body) {
  try {
    var results = JSON.parse(body).results || {};
    var lines = [];
    Object.keys(results).forEach(function (key) {
      var proofs = currentChainProofs(results[key] && results[key].proofs);
      if (!proofs.length) return;
      // proofs[0] is the ledger's earliest, by write times this does not have.
      // Never re-derive it; see parseBatch.
      var p = proofs[0].proof || proofs[0];
      var commit = p && p.commit;
      var digest = p && p.artifact && p.artifact.digestB64;
      if (!commit || !digest) return;
      lines.push(digest + '\t' + (commit.counter || '') + '\t' + epochToUrlSafe(commit.epochId));
    });
    return lines.join('\n');
  } catch (e) {
    return 'error';
  }
}

/**
 * A batch commit's reply: one `digestB64<TAB>counter<TAB>epoch` line per proof.
 *
 * `/api/commit` has always taken `digests` as an ARRAY and answered with one
 * proof per digest; the website's batch path uses it. The watcher sent one
 * digest per request anyway, so a hundred-file drop made a hundred commits.
 *
 * ⚠️ Matched back by each proof's OWN artifact digest, for the reason in
 * parseBatchMany, and it matters more here: this is the path that mints
 * permanent proofs, so mispairing a file with a counter would bind a recording
 * to the wrong bytes on a ledger that cannot be rewritten.
 */
function parseCommitMany(body) {
  try {
    var parsed = JSON.parse(body);
    var proofs = Array.isArray(parsed) ? parsed : [parsed];
    var lines = [];
    for (var i = 0; i < proofs.length; i++) {
      var p = proofs[i];
      // The service holds drops rather than failing them during the daily
      // epoch rotation. One retry answer applies to the whole request.
      if (p && p.code === 'tee-restarting') return 'retry';
      var commit = p && p.commit;
      var digest = p && p.artifact && p.artifact.digestB64;
      if (!commit || commit.counter === undefined || commit.counter === null || !digest) continue;
      lines.push(digest + '\t' + commit.counter + '\t' + epochToUrlSafe(commit.epochId));
    }
    return lines.length ? lines.join('\n') : 'fail';
  } catch (e) {
    return 'fail';
  }
}

function parseCommit(body) {
  try {
    var parsed = JSON.parse(body);
    var p = Array.isArray(parsed) ? parsed[0] : parsed;
    var commit = (p && p.commit) || {};
    if (commit.counter !== undefined && commit.counter !== null) {
      return 'ok\t' + commit.counter + '\t' + epochToUrlSafe(commit.epochId);
    }
    // The service holds drops rather than failing them during epoch rotation.
    return p && p.code === 'tee-restarting' ? 'retry' : 'fail';
  } catch (e) {
    return 'fail';
  }
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------
//
// A contact sheet for the folder, written to index.html beside the proofs.
//
// It exists because a name is not a picture. The folder name does carry the
// filename (see resolveDir), and that was never going to be enough on its own:
// camera files are IMG_4032.jpg and downloads are HO1zC4UWMAAIqx0.jpg, so
// reading the name is still not seeing the photo.
//
// Custom Finder icons were prototyped first and rejected. NSWorkspace can set
// one from an image in a single call, but every non-image needs a raster
// thumbnail generated for it, and `qlmanage -t` hung for over three minutes on
// a plain text file during that test. Thumbnail generation sits directly in the
// drop path here, so a hang there stalls recording. The browser has no such
// problem: it renders the image straight out of the folder, and a file that has
// no preview simply shows its name and type.
//
// DERIVED, never authoritative. Everything here is read back off disk each
// time, so this is a view rather than a second copy of anything. It cannot
// misreport a proof, because every row points at the real folder and the real
// proof page. If it is deleted, stale, or never written, nothing is lost and
// `--index` rebuilds it from scratch. That is what separates it from the
// .bitgraph.log that was removed: a log accumulates its own history and can
// drift, a view cannot.
//
// Offline by construction: relative paths, no webfont, no script, no network.
// The folder's whole claim is that nothing leaves the machine, so its index
// must not phone anywhere either. That is also why the type is a system stack
// rather than the site's Acumin Pro, which would need Typekit.

// svg goes here rather than with the text types: a browser renders it as a
// picture in an <img>, which is what it is.
var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tiff', 'tif', 'svg'];

// Anything the browser will display as text on its own. No thumbnail has to be
// generated for these either: an <iframe> shows the top of the file, which for
// a note or a CSV is a better identifier than the extension in grey capitals.
// Always sandboxed, so a recorded .html or .svg cannot run script in the page
// that embeds it.
var TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'html', 'htm', 'rtf'];

// A <video> paints its first frame once metadata loads, which is a real
// thumbnail for free. preload=metadata so a folder of films does not pull whole
// files in just to draw the sheet.
var VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv'];

// Audio has no frame to show, so the cell keeps a label; the export's own page
// gets a player, where listening is the point.
var AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif', 'flac', 'oga', 'ogg'];

// Viewer controls off, so an embedded PDF reads as the document rather than as
// an application. Ampersands are escaped because this goes in an attribute.
var PDF_VIEW = '#toolbar=0&amp;navpanes=0&amp;scrollbar=0&amp;view=FitH';

function extOf(name) {
  var i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i + 1).toLowerCase();
}

// ---- Embedding the picture -------------------------------------------------
//
// The proof page carries its image inside itself rather than pointing at the
// file beside it. A sandboxed viewer renders the HTML with no access to its
// siblings, so a plain src= resolves to nothing: iOS Files shows a broken-image
// glyph, macOS QuickLook shows an empty card, and the reader has no way to
// reach the photo, because the "Open" link is blocked by the same rule. What is
// embedded is the only version of the picture such a viewer will ever show.
//
// A budget rather than a blanket rule. Under it the real bytes go in and the
// picture is exact, which covers screenshots and ordinary photos. Over it, sips
// downscales until it fits. sips ships with macOS, ran in 44-68ms when this was
// measured, and unlike qlmanage (which hung for over three minutes on a plain
// text file) it is safe to sit in the drop path.
//
// Images only. A PDF or a video would blow any budget, and the point here is
// the hero picture rather than every attachment.
var EMBED_BUDGET = 400 * 1024; // base64 characters, not source bytes
// The ceiling when the budget cannot be met because sips could not read the
// file. Generous, because one large page beats a page with no picture, but
// finite, because a 20MB raw photo should not become a 27MB HTML file.
var EMBED_HARD_MAX = 3 * 1024 * 1024;
var EMBED_WIDTHS = [2000, 1400, 1000, 700, 450];

var MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
  bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', svg: 'image/svg+xml',
};

// ---- Thumbnails -----------------------------------------------------------
//
// The contact sheet drew its cells from the full-resolution originals, scaled
// down by CSS. Measured on a three-recording folder: index.html is under 4KB
// and pulled 425KB of image to draw three 230px cells. At eighteen phone photos
// that is roughly 50MB decoded to fill a grid, and it grows with the folder.
//
// So each image gets one small copy here, and the sheet points at that instead.
// A separate file rather than a data: URI in the page, because index.html is
// rewritten on EVERY drop: embedding would mean rewriting a multi-megabyte file
// each time, growing without bound. The page stays about 4KB and the browser
// pulls roughly 40KB per visible cell, lazily.
//
// Hidden, derived, and deletable as a group. Nothing verifies against these,
// `--index` rebuilds any that are missing, and the export folders themselves
// are untouched: a thumbnail never goes inside the thing being proved.
//
// Named for the export folder, which is already unique, so two photos that
// share a filename cannot collide here either.
// Where the sheet's derived machinery (thumbs, cache, siblings stamp, day
// pages) used to live. The browsing layer is GONE (1.9.0 - a dropped folder
// loads the Roll on the site instead); the name survives only so --tidy can
// purge the directory from folders built before that.
var STATE_DIR = '.bitgraph';
// 600px for a cell that packs to roughly 230-300px, so it still holds up on a
// retina display without carrying a full-size photo to do it.
var THUMB_WIDTH = 600;

/**
 * Fetch a witness that was never written, for an export already on disk.
 *
 * An anchor whose block could not be read left `anchor-<side>.json` there with
 * no witness beside it. That export counts as SEALED, because the anchor itself
 * was found, so `--complete` never looks at it again: its page said "sealing"
 * permanently for a recording that had in fact sealed months earlier. Fixing
 * fetchWitness only helped exports built afterwards, which left every existing
 * one wrong with no way back.
 *
 * Narrow on purpose. It fires only when the anchor is present and the witness
 * is not, which is exactly the broken state and nothing else. A genuinely
 * unsealed export has no anchor file to read, so it is never touched here and
 * stays with `--complete` where it belongs. One request, once, and never again
 * for that side after it lands.
 */
function repairWitnesses(dir) {
  var wrote = 0;
  ['before', 'after'].forEach(function (side) {
    var anchorPath = dir + '/' + ANCHOR_DIR + '/anchor-' + side + '.json';
    var witnessPath = dir + '/' + ANCHOR_DIR + '/anchor-' + side + '-witness.json';
    if (exists(witnessPath) || !exists(anchorPath)) return;
    var raw = readFile(anchorPath);
    if (raw === null) return;
    try {
      var witness = fetchWitness(JSON.parse(raw));
      if (witness) {
        writeJson(witnessPath, witness);
        wrote++;
      }
    } catch (e) {
      /* tried again on the next pass */
    }
  });
  // How many landed, so the caller knows the window it is about to render just
  // changed and the recording's page needs to be written again.
  return wrote;
}

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The recorded file in an export: not the proof, the anchors, or a marker. */
function artifactIn(dir) {
  var listing = sh('ls -1 ' + quote(dir) + ' 2>/dev/null');
  if (!listing) return null;
  var names = listing.split('\r').join('\n').split('\n').filter(Boolean);
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    // index.html is written BY this script, so it must never be mistaken for
    // the thing that was recorded. Held aside rather than discarded: see below.
    if (n === 'proof.json' || n === ANCHOR_DIR || n === PENDING || n === 'index.html') continue;
    if (n.charAt(0) === '.' || n.indexOf('Icon') === 0) continue;
    return n;
  }
  return null;
}

// The site prints "12:54:11 PM EDT": uppercase meridiem, spaced, with the
// zone named. clockOf's compact "12:54:11pm" is for the contact sheet's cells,
// where the row has to fit on one line.
var TZ = sh('date +%Z') || '';

// The row carried a date and a counter here too. A cell is three things now:
// the picture, its filename, and the two ways to open it. Everything else was
// the proof page leaking into a contact sheet. The window and the counter are
// both one click away and stated in full there, the counter under Artifact
// Commit and the window at the top of the page.


/**
 * Remove one export's receipt page. THE FOLDER WRITES NO HTML (1.12.0, Mike's
 * call). Every caller that used to rebuild a page now drops it instead: build,
 * completion, witness repair and --tidy all come through here, so a folder
 * cleans itself out on the next pass over it rather than needing a migration.
 *
 * Why the page went: it was a SECOND implementation of the proof page, and it
 * drifted. Its own comment said the type was "lifted from the proof page so
 * the two read as one design"; the site later moved to one title size
 * everywhere and this copy sat at the old values until someone noticed the
 * mismatch. That is the standing cost of a duplicate, and the page was not
 * buying enough to keep paying it: the binding verdict it displayed was
 * computed HERE, on the machine that wrote the folder, so a recipient opening
 * it was reading the sender's own assertion rather than performing a check.
 * The check that means something is dropping the folder on bitgraph.ing,
 * which re-hashes in the reader's browser and goes to the ledger.
 *
 * ⚠️ The artifact guard is the same one writeProofPage carried and must stay.
 * A recording whose file is genuinely NAMED index.html keeps it: deleting
 * that would destroy the very bytes the proof describes. Only a page whose
 * hash differs from the proof's digest is ours to remove.
 */
function dropPage(dir) {
  var page = dir + '/index.html';
  if (!exists(page)) return;
  var raw = readFile(dir + '/proof.json');
  if (raw === null) return;
  var digest = null;
  try {
    var p = JSON.parse(raw);
    digest = p && p.artifact && p.artifact.digestB64;
  } catch (e) {
    return;
  }
  // No proof digest to compare against means we cannot prove the page is
  // ours, so it stays. A stray index.html costs nothing; a deleted artifact
  // is unrecoverable.
  if (!digest) return;
  var existing = digestOfFile(page);
  if (existing && existing === String(digest).trim()) return; // it IS the file
  sh('rm -f ' + quote(page));
}

/**
 * Every export in a folder, as `{ name, mtime }`.
 *
 * Discovery is by CONTENT, not by name: a directory is an export when it holds
 * a proof.json. Three naming schemes have shipped, and a folder can be renamed
 * by hand at any time, so matching a name prefix would quietly drop recordings
 * out of the sheet. It is the rule bitgraph-audit uses too.
 *
 * One shell call for the whole scan, giving name and fallback time together.
 * mtime is the FILESYSTEM's opinion and orders nothing; it rides along only
 * as a tiebreak. Ends in `true` because the loop's last iteration sets the
 * exit status, and a non-zero one makes doShellScript throw away the entire
 * listing.
 *
 * --verify's discovery, and --tidy applies the same holds-a-proof.json rule,
 * so the two cannot disagree about what counts as an export.
 */
function exportDirs(folder) {
  // THREE depths, because three layouts are legitimately live at once:
  // Recordings/<day>/<export> (filed), Recordings/<export> (recorded but not
  // yet sealed, so it has no day), and <export> flat at the top (pre-1.7, or an
  // old export dragged back in). Missing the day depth made --verify answer "no
  // exports" for a folder that had just been filed, which is the worst possible
  // answer from a tool whose entire job is saying what is there.
  // Names keep their prefix; every caller joins them onto `folder`.
  var listing = sh('cd ' + quote(folder) +
    ' && for d in ' + REC_DIR + '/*/*/ ' + REC_DIR + '/*/ */; do if [ -f "$d/proof.json" ]; then stat -f "%m %N" "$d"; fi; done 2>/dev/null; true');
  var lines = listing ? listing.split('\r').join('\n').split('\n').filter(Boolean) : [];

  var entries = [];
  var seen = {};
  lines.forEach(function (line) {
    var gap = line.indexOf(' ');
    if (gap === -1) return;
    // `stat` prints the name as given, and the glob gives it with a trailing slash.
    var name = line.slice(gap + 1).replace(/\/+$/, '');
    if (!name || name === FILES_DIR || seen[name]) return;
    seen[name] = true;
    entries.push({ name: name, mtime: parseInt(line.slice(0, gap), 10) || 0 });
  });
  return entries;
}

// ---------------------------------------------------------------------------
// --tidy: layout hygiene
// ---------------------------------------------------------------------------
//
// The side jobs the sheet pass used to carry, without the sheet: exports
// found flat at the top level are tucked into Recordings/, a pre-1.8 files/
// tree is dissolved, and the browsing layer a pre-1.9 install generated (the
// contact sheet, day pages, thumbs, caches) is purged once. Cheap when there
// is nothing to do, which is every ordinary run.

function exportDirsUnder(folder) {
  var dirs = [];
  var roots = [[folder + '/' + REC_DIR, REC_DIR + '/'], [folder, '']];
  // Day folders are a third place an export can be, so Recordings/ is walked
  // one deeper. Everything is still identified by holding a proof.json, never
  // by its name, so a hand-renamed day folder keeps working.
  var listing = sh('ls -1 ' + quote(folder + '/' + REC_DIR) + ' 2>/dev/null');
  if (listing) {
    listing.split('\r').join('\n').split('\n').filter(Boolean).forEach(function (d) {
      if (isDayName(d) && !exists(folder + '/' + REC_DIR + '/' + d + '/proof.json')) {
        roots.push([folder + '/' + REC_DIR + '/' + d, REC_DIR + '/' + d + '/']);
      }
    });
  }
  roots.forEach(function (pair) {
    var l = sh('ls -1 ' + quote(pair[0]) + ' 2>/dev/null');
    if (!l) return;
    l.split('\r').join('\n').split('\n').filter(Boolean).forEach(function (n) {
      if (exists(pair[0] + '/' + n + '/proof.json')) dirs.push(pair[1] + n);
    });
  });
  return dirs;
}

/** `2026-08-09`. Shape only: a day folder is recognised by looking like one,
 *  so nothing has to be recorded anywhere about which folders are days. */
function isDayName(n) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(n));
}

/**
 * Export directories whose proof.json is NOT a bitgraph/1 proof.
 *
 * Two passes, because the fast way to ASK is not a safe way to be ANSWERED.
 *
 * ⚠️ BSD grep ignores -Z for -l/-L: it terminates every path with a newline
 * whatever you ask for, and a newline is a byte a filename can legally
 * contain. Splitting that output would corrupt the very names this has to
 * move, and it silently did the first time: both paths arrived as one blob,
 * the trailing-newline match failed, and nothing was reclaimed at all.
 *
 * So the batched `-exec grep -L ... {} +` is used only as a DETECTOR, where
 * "any output at all" is the whole answer and delimiting does not matter. It
 * costs one grep for the whole folder (~0.5s at 2000 recordings). Only when
 * that finds something does the precise enumeration run: find's own negated
 * -exec with -print0, which is NUL-safe but pays a grep per export (~2.4s at
 * 2000). The slow pass therefore runs about once in a folder's life, and the
 * ordinary answer of "nothing to reclaim" stays cheap.
 */
function staleExportProofs(folder) {
  // maxdepth 3: Recordings/<day>/<export>/proof.json is one deeper than
  // Recordings/<export>/proof.json, and both layouts coexist during filing.
  var roots = quote(folder + '/' + REC_DIR) + ' ' + quote(folder) +
    ' -mindepth 2 -maxdepth 3 -name ' + quote('proof.json');
  var pattern = quote('"version": "bitgraph/1"');

  var any = sh('find ' + roots + ' -exec grep -L ' + pattern + ' {} + 2>/dev/null | head -c 1');
  if (!any) return [];

  var list = tempPath();
  try {
    sh('find ' + roots + ' ! -exec grep -q ' + pattern + ' {} ' + quote(';') +
      ' -print0 > ' + quote(list) + ' 2>/dev/null; true');
    var raw = readFileUtf8(list);
    return raw ? raw.split('\u0000').filter(Boolean) : [];
  } finally {
    sh('rm -f ' + quote(list));
  }
}

function tidyFolder(folder) {
  var did = [];

  // 1. Tuck flat exports into Recordings/, by content, never merging: two
  //    distinct recordings are allowed to share a filename.
  var flat = exportDirsUnder(folder).filter(function (n) { return n.indexOf(REC_DIR + '/') !== 0; });
  if (flat.length) {
    mkdirp(folder + '/' + REC_DIR);
    flat.forEach(function (name) {
      var dest = name;
      for (var n = 2; exists(folder + '/' + REC_DIR + '/' + dest) && n < 1000; n++) dest = name + ' ' + n;
      if (exists(folder + '/' + REC_DIR + '/' + dest)) return; /* next pass */
      var ok = sh('mv ' + quote(folder + '/' + name) + ' ' +
        quote(folder + '/' + REC_DIR + '/' + dest) + ' 2>/dev/null && echo ok');
      if (ok === 'ok') {
        // A tucked export may still carry a page an older version wrote.
        try { dropPage(folder + '/' + REC_DIR + '/' + dest); } catch (e) { /* next pass */ }
        did.push('tucked ' + name);
      }
    });
  }

  // 1b. File exports under the day the CHAIN says they were sealed. Undated
  //     ones (seal not landed yet) stay at the Recordings/ root and are filed
  //     by a later pass, which is the same shape as the tuck above.
  //
  //     Moves one at a time with an existence check before each, so an
  //     interrupted run leaves a folder half-filed rather than damaged, and the
  //     next run continues. An export holds the ONLY copy of its file (1.8.0),
  //     so nothing here deletes and nothing overwrites: a name already taken in
  //     the destination is skipped for the next pass to disambiguate.
  var loose = exportDirsUnder(folder).filter(function (n) {
    return n.indexOf(REC_DIR + '/') === 0 && n.slice(REC_DIR.length + 1).indexOf('/') < 0;
  });
  var filed = 0;
  for (var li = 0; li < loose.length; li++) {
    var src = folder + '/' + loose[li];
    if (fileUnderDay(folder, src) !== src) filed++;
  }
  if (filed) did.push('filed ' + filed + ' by day');

  // 2. files/ dissolves, once (1.8.0). An entry with more than one link is a
  //    second name for bytes still safe inside an export and is removed. An
  //    entry whose link count is 1 is the LAST COPY of those bytes - its
  //    export was deleted back when a drop moved the file in - and is rescued
  //    to the top level, because losing a recording must never mean losing
  //    the file.
  if (exists(folder + '/' + FILES_DIR)) {
    sh('find ' + quote(folder + '/' + FILES_DIR) + ' -type f -links +1 -delete 2>/dev/null; true');
    var left = sh('ls -1 ' + quote(folder + '/' + FILES_DIR) + ' 2>/dev/null');
    (left ? left.split('\r').join('\n').split('\n').filter(Boolean) : []).forEach(function (n) {
      var src = folder + '/' + FILES_DIR + '/' + n;
      var dst = folder + '/' + n;
      if (exists(dst)) {
        var ext = extOf(n);
        var tail = ext ? '.' + ext : '';
        var stem = n.slice(0, n.length - tail.length);
        for (var k = 2; k < 100 && exists(dst); k++) dst = folder + '/' + stem + ' ' + k + tail;
      }
      if (!exists(dst)) sh('mv ' + quote(src) + ' ' + quote(dst) + ' 2>/dev/null; true');
    });
    sh('rmdir ' + quote(folder + '/' + FILES_DIR) + ' 2>/dev/null; true');
    did.push('dissolved files/');
  }

  // 2b. Reclaim anything sitting in the folder that is not a BitGraph.
  //
  //     A file whose proof is not a bitgraph/1 proof is not a recording: it
  //     cannot be verified by this tool, by the site, or by the audit
  //     package, so leaving it in place means a permanent red row and a file
  //     the owner believes is recorded when it is not. Pre-cutover occ/1
  //     exports are the whole of this population today, and they arrive by
  //     being MIGRATED in: dragging an old folder into the drop zone tucks
  //     its export directories into Recordings/ by content, and content is
  //     all the tuck looks at.
  //
  //     So the artifact goes back to the drop zone, where the ordinary path
  //     records it properly, and the stale proof material is set aside
  //     rather than deleted. Nothing is lost either way: those proofs remain
  //     on the ledger permanently, which is the only place they were ever
  //     authoritative.
  var stale = staleExportProofs(folder);
  if (stale.length) {
    var aside = env('HOME') + '/.bitgraph/superseded';
    mkdirp(aside);
    var reclaimed = 0;
    stale.forEach(function (proofPath) {
      var dir = proofPath.replace(/\/proof\.json$/, '');
      if (dir === proofPath || !exists(dir)) return;
      var base = dir.split('/').pop();
      // The artifact first: it is the only thing here that cannot be
      // regenerated, so it moves before anything is set aside.
      var listing = sh('ls -1 ' + quote(dir) + ' 2>/dev/null');
      var names = listing ? listing.split('\r').join('\n').split('\n').filter(Boolean) : [];
      names.forEach(function (n) {
        if (n === 'proof.json' || n === 'index.html' || n === ANCHOR_DIR || n.charAt(0) === '.') return;
        var dst = folder + '/' + n;
        if (exists(dst)) {
          var ext = extOf(n);
          var tail = ext ? '.' + ext : '';
          var stem = n.slice(0, n.length - tail.length);
          for (var k = 2; k < 1000 && exists(dst); k++) dst = folder + '/' + stem + ' ' + k + tail;
        }
        if (!exists(dst)) sh('mv ' + quote(dir + '/' + n) + ' ' + quote(dst) + ' 2>/dev/null; true');
      });
      var park = aside + '/' + base;
      for (var m = 2; exists(park) && m < 1000; m++) park = aside + '/' + base + ' ' + m;
      if (sh('mv ' + quote(dir) + ' ' + quote(park) + ' 2>/dev/null && echo ok') === 'ok') reclaimed++;
    });
    if (reclaimed) did.push('reclaimed ' + reclaimed + ' not-a-BitGraph ' +
      (reclaimed === 1 ? 'export' : 'exports'));
  }

  // 3. Purge every page an older install generated: the pre-1.9 top-level
  //    sheet, and since 1.12.0 the per-export receipts too. Both are deleted
  //    only when provably OURS (the sheet named the product; a receipt hashes
  //    differently from the artifact beside it). A person's own index.html,
  //    dropped in and recorded, is a recorded file and untouchable.
  var sheet = folder + '/index.html';
  if (exists(sheet)) {
    var head = String(readFile(sheet) || '').slice(0, 2000);
    if (head.indexOf('BitGraph Folder') !== -1) {
      sh('rm -f ' + quote(sheet));
      did.push('removed the sheet');
    }
  }
  if (exists(folder + '/' + STATE_DIR)) {
    sh('rm -rf ' + quote(folder + '/' + STATE_DIR));
    did.push('purged ' + STATE_DIR + '/');
  }
  // Sweep the per-export receipts unconditionally, not just when a legacy
  // sheet turned up: an install that upgraded straight from 1.9 to 1.12 has
  // no sheet to find but a page in every export. dropPage is a no-op where
  // there is nothing to drop, so this costs a stat per export.
  var dropped = 0;
  exportDirsUnder(folder).forEach(function (name) {
    var d = folder + '/' + name;
    if (!exists(d + '/index.html')) return;
    try { dropPage(d); if (!exists(d + '/index.html')) dropped++; } catch (e) { /* next pass */ }
  });
  if (dropped) did.push('removed ' + dropped + ' receipt' + (dropped === 1 ? '' : 's'));

  return did.length ? 'ok: ' + did.join(', ') : 'ok: nothing to tidy';
}

// ---------------------------------------------------------------------------
// --drop
// ---------------------------------------------------------------------------
//
// Build every export of one drop in ONE process.
//
// ⚠️ This exists entirely so the caches above can work. Each export needs the
// proof, the two bracketing anchors and a witness for each, which is five
// requests; running one process per file made a hundred-file drop issue five
// hundred of them, and about four hundred and ninety asked for something
// already in hand. A batch commits within seconds, so it shares one anchor span
// and two block headers, and the proofs came back in the responses the watcher
// already had.
//
// One process, so: anchors resolve to a span after the first file, witnesses
// are fetched twice for the whole drop, proofs are read from the responses, and
// the contact sheet is written once at the end.
//
// The manifest is NUL-separated fields, four per record: path, digest, counter,
// epoch. NUL because it is the one byte a filename cannot contain, and a
// newline is a byte it can.

/**
 * Index every proof the watcher already received, by URL-safe digest.
 *
 * The responses are whatever came back from /api/proofs/batch (keyed results,
 * each holding a proofs array) and /api/commit (a bare array of proofs, or one
 * proof). Both shapes are read, and each proof is filed under the digest it
 * states about itself rather than under whatever key it arrived beside.
 */
function indexResponses(dir) {
  var map = {};
  if (badPath(dir) || !exists(dir)) return map;
  var listing = sh('ls -1 ' + quote(dir) + ' 2>/dev/null');
  var names = listing ? listing.split('\r').join('\n').split('\n').filter(Boolean) : [];

  function file(p) {
    if (!p || !p.commit || !p.artifact || !p.artifact.digestB64) return;
    var k = toUrlSafe(p.artifact.digestB64);
    if (!map[k]) map[k] = [];
    map[k].push(p);
  }

  names.forEach(function (n) {
    var raw = readFile(dir + '/' + n);
    if (raw === null) return;
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (Array.isArray(parsed)) {
      parsed.forEach(function (p) { file(p && p.proof ? p.proof : p); });
    } else if (parsed && parsed.results) {
      Object.keys(parsed.results).forEach(function (key) {
        var proofs = (parsed.results[key] && parsed.results[key].proofs) || [];
        proofs.forEach(function (e) { file(e && e.proof ? e.proof : e); });
      });
    } else {
      file(parsed && parsed.proof ? parsed.proof : parsed);
    }
  });
  return map;
}

function buildDrop(manifestPath, folder, responsesDir) {
  if (badPath(manifestPath) || badPath(folder)) {
    return 'error: usage: export.js --drop <manifest> <folder> [responsesDir]';
  }
  var raw = readFileUtf8(manifestPath);
  if (raw === null) return 'error: cannot read the drop manifest';
  var f = raw.split('\u0000');

  PROOF_CACHE = indexResponses(responsesDir);

  // The caller handles the seal, once, after this returns.
  BATCH_DROP = true;

  var built = 0, failed = 0;
  for (var i = 0; i + 3 < f.length; i += 4) {
    var path = f[i];
    if (!path) continue;
    var out;
    try {
      out = String(buildExport(path, f[i + 1], f[i + 2], f[i + 3], folder, false));
    } catch (e) {
      out = 'error: ' + (e && e.message ? e.message : String(e));
    }
    if (out.indexOf('ok:') === 0) {
      built++;
    } else {
      failed++;
      // Named, because the watcher can no longer report per file: it made one
      // call for the whole drop.
      note('export failed: ' + baseName(path) + ': ' + out);
    }
  }
  return 'ok: built ' + built + (failed ? ', ' + failed + ' failed' : '');
}

// ---------------------------------------------------------------------------
// --recover
// ---------------------------------------------------------------------------
//
// Point it at files you still have. It hashes each one, asks the ledger which
// of them are already recorded, and rebuilds the export for every position it
// finds.
//
// The case it exists for: a recording lives on the ledger permanently, but the
// export is an ordinary folder on an ordinary disk. Delete ~/BitGraph and the
// proofs are all still there, unreachable, with nothing that puts them back.
// That happened on 2026-08-04 and cost 21 exports.
//
// ⚠️ READ-ONLY AGAINST THE LEDGER, and it has to stay that way. It asks
// /api/proofs/batch and /api/proofs/digest, both lookups, and never touches
// /api/commit. Anything it cannot find was never recorded, and recovery is not
// the place to decide otherwise: a file that turns out to be unrecorded is
// reported and left alone, because recording it here would mint a permanent
// proof at today's position for something the user believed was already on
// record from months ago. Dropping it in is a deliberate act and stays one.
//
// ⚠️ It does NOT move the source files. See placeArtifact.

/**
 * Every candidate file under a directory, NUL-separated so no filename can
 * split one path into two.
 *
 * Pruned like the hot folder's own walker and for the same reasons: files/
 * holds a hard link to every artifact, so without it each recovery would be
 * found twice, and hidden directories are ours or the system's. Anchors are
 * skipped because they are proof material, not recordings.
 *
 * ⚠️ The one deliberate difference: EXPORT DIRECTORIES ARE NOT PRUNED. The
 * likeliest source there is is an old copy of ~/BitGraph, and the artifacts
 * worth recovering are sitting inside those very folders. Rebuilding an export
 * that already exists is free (buildExport answers `already exported`), so
 * descending costs nothing and skipping would miss the main case.
 */
function droppableUnder(dir) {
  var list = tempPath();
  // The legacy files/ is pruned by its exact top-level path, not by name: a
  // user's own subfolder named "files" deeper down holds recordings worth
  // recovering (pruning it by name is the bug that left a dropped folder
  // stuck in the hot folder, fixed in 1.9.2). Hard links under a top-level
  // files/ would only be found twice anyway, and dedup-by-digest absorbs
  // even that. ethereum-anchors/ stays name-based on purpose: it is proof
  // material wherever it sits, because exports are deliberately descended.
  var top = String(dir).replace(/\/+$/, '');
  try {
    sh('find ' + quote(top) + ' -mindepth 1 ' +
      '\\( -name ' + quote('.*') +
      ' -o -path ' + quote(top + '/' + FILES_DIR) +
      ' -o -name ' + quote(ANCHOR_DIR) + ' \\) -prune -o ' +
      '-type f ! -name ' + quote('index.html') +
      ' ! -name ' + quote('proof.json') +
      ' -print0 > ' + quote(list) + ' 2>/dev/null; true');
    var raw = readFileUtf8(list);
    return raw ? raw.split('\u0000').filter(Boolean) : [];
  } finally {
    sh('rm -f ' + quote(list));
  }
}

// A batch big enough to matter and small enough to stay a normal request. Each
// answer carries whole proofs, attestations included, so this is kilobytes per
// digest rather than bytes.
var RECOVER_CHUNK = 25;

function recoverInto(source, destFolder) {
  if (badPath(source)) return 'error: usage: export.js --recover <folder> [destFolder]';
  if (!exists(source)) return 'error: no such folder: ' + source;
  var folder = destFolder || (env('HOME') + '/BitGraph');
  mkdirp(folder);

  var paths = droppableUnder(source);
  if (!paths.length) return 'ok: no files under ' + source;

  note('Hashing ' + paths.length + '...');
  // Keyed by digest, because two copies of one photo are ONE recording. Asking
  // about it twice and building it twice would be wrong on both counts.
  var byDigest = {};
  var order = [];
  paths.forEach(function (p) {
    var d = digestOfFile(p);
    if (!d) return;
    var k = toUrlSafe(d);
    if (!byDigest[k]) {
      byDigest[k] = { digestB64: d, paths: [] };
      order.push(k);
    }
    byDigest[k].paths.push(p);
  });
  if (!order.length) return 'ok: nothing readable under ' + source;

  var onRecord = 0, built = 0, already = 0, absent = 0, failed = 0;

  try {
    for (var i = 0; i < order.length; i += RECOVER_CHUNK) {
      var slice = order.slice(i, i + RECOVER_CHUNK);
      note('Asking the ledger about ' + (i + 1) + '-' +
        Math.min(i + RECOVER_CHUNK, order.length) + ' of ' + order.length + '...');
      var data = postJson(API + '/api/proofs/batch', { digests: slice });
      if (!data || !data.results) {
        // A failed lookup is not an absent recording. Saying "not on record"
        // here would tell someone their proofs are gone when the network is
        // simply down, so it is counted separately and the run can be repeated.
        failed += slice.length;
        note('  lookup failed for ' + slice.length + ', run it again');
        continue;
      }

      // Matched back by the digest INSIDE each proof rather than by the
      // response's own keys, so whichever base64 alphabet the server keys on
      // cannot silently drop a result on the floor.
      var positions = {};
      Object.keys(data.results).forEach(function (key) {
        var proofs = currentChainProofs(data.results[key] && data.results[key].proofs);
        proofs.forEach(function (entry) {
          var p = (entry && entry.proof) || entry;
          if (!p || !p.commit || !p.artifact || !p.artifact.digestB64) return;
          var k = toUrlSafe(p.artifact.digestB64);
          if (!positions[k]) positions[k] = [];
          positions[k].push({
            counter: String(p.commit.counter),
            epoch: toUrlSafe(String(p.commit.epochId || '')),
          });
        });
      });

      slice.forEach(function (k) {
        var rec = byDigest[k];
        var name = baseName(rec.paths[0]);
        var found = positions[k] || [];
        if (!found.length) {
          absent++;
          note('  not on record  ' + name);
          return;
        }
        onRecord++;
        // EVERY position, not just the earliest. The same bytes at two causal
        // positions is BitGraph Again, which is two recordings and was two
        // exports before they were lost.
        found.forEach(function (q) {
          var out = String(buildExport(rec.paths[0], rec.digestB64, q.counter, q.epoch, folder, true));
          if (out.indexOf('ok: already exported') === 0) {
            already++;
            note('  already here   ' + name + '  #' + q.counter);
          } else if (out.indexOf('ok:') === 0) {
            built++;
            note('  recovered      ' + name + '  #' + q.counter);
          } else {
            failed++;
            note('  failed         ' + name + '  #' + q.counter + '  ' + out);
          }
        });
      });
    }
  } finally {
    // Cleared even on a throw, or an ordinary drop afterwards would silently
    // stop rebuilding the sheet.
  }

  // Recovered exports may have landed flat; one tidy pass homes them.
  try {
    tidyFolder(folder);
  } catch (e) {
    /* the watcher's next tidy homes them */
  }

  // Paths and recordings are different numbers and both are worth saying: a
  // library with three copies of one photo is three files and one recording,
  // and a summary that conflated them would look like it had lost two.
  return 'ok: ' + paths.length + (paths.length === 1 ? ' file' : ' files') +
    (order.length === paths.length ? '' : ', ' + order.length + ' distinct') +
    ', ' + onRecord + ' on record, ' + built + ' recovered' +
    (already ? ', ' + already + ' already here' : '') +
    (absent ? ', ' + absent + ' not on record' : '') +
    (failed ? ', ' + failed + ' failed' : '');
}

// ---------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------
//
// Re-hash every export's artifact and compare it against the digest inside that
// export's own proof.json.
//
// Entirely local. It makes no request, needs no network and writes nothing: the
// proof already states what the bytes were, so the only question is whether the
// file sitting beside it still hashes to that. Nothing asked until now unless
// someone happened to open a recording's page in a browser, one page at a time,
// which is not a thing anyone does to an archive of several hundred.
//
// ⚠️ What a pass does NOT mean. It says the file beside a proof is the file
// that proof describes. It says nothing about whether the proof itself is
// genuine, which takes the signature, the enclave attestation and the anchors:
// `npx @mikeargento/bitgraph-audit <folder>`, and that one needs the ledger.
// This is the cheap local check, not a replacement for that one.

/**
 * A line of progress, to stderr.
 *
 * `run` returns a single string and osascript prints it only once everything is
 * finished, so a long pass would sit completely silent. console.log goes to
 * stderr, which keeps it clear of the result a caller parses on stdout.
 */
function note(line) {
  try {
    console.log(line);
  } catch (e) {
    /* progress is not worth failing a run over */
  }
}

function verifyFolder(folder) {
  if (badPath(folder)) return 'error: usage: export.js --verify <folder>';
  var entries = exportDirs(folder);
  if (!entries.length) return 'ok: no exports in ' + folder;
  note('Checking ' + entries.length + '...');

  var problems = [];
  var intact = 0;

  entries.forEach(function (e) {
    var dir = folder + '/' + e.name;

    var want = null;
    var raw = readFile(dir + '/proof.json');
    if (raw !== null) {
      try {
        var p = JSON.parse(raw);
        want = (p && p.artifact && p.artifact.digestB64) || null;
      } catch (err) {
        /* falls through to the unreadable case below */
      }
    }
    if (!want) {
      problems.push('unreadable  ' + e.name + '  (proof.json)');
      return;
    }

    var file = artifactIn(dir);
    if (!file) {
      // Still evidence without it: the proof, the anchors and the page are all
      // here, and files/ may well hold the bytes under a hard link. It is worth
      // saying anyway, because an export is meant to be self-contained.
      problems.push('no file     ' + e.name);
      return;
    }

    var got = digestOfFile(dir + '/' + file);
    if (!got) {
      problems.push('unreadable  ' + e.name + '  (' + file + ')');
      return;
    }
    if (got === want) {
      intact++;
      return;
    }
    // Both digests printed, because "changed" on its own invites the reader to
    // assume a bug in this tool. Two strings that differ are checkable by hand.
    problems.push('CHANGED     ' + e.name + '  (' + file + ')');
    problems.push('              recorded  ' + want);
    problems.push('              on disk   ' + got);
  });

  var n = entries.length;
  var head = n + (n === 1 ? ' export' : ' exports') + ' checked, ' + intact + ' intact';
  if (!problems.length) return 'ok: ' + head;
  // Summary first, detail under it. A folder with sixty problems should say so
  // before it starts listing them.
  return head + ', ' + (n - intact) + ' to look at\n\n' + problems.join('\n');
}

// ---------------------------------------------------------------------------

/**
 * What this thing can do, in the tool's own words.
 *
 * ⚠️ The usage string used to list ONLY the positional build form, so asking
 * the tool anything at all, including `--help`, was told that --verify and
 * --recover did not exist. A command documented in a source comment and denied
 * by the program is not a command anyone will find. Any new entry point goes
 * here as well as in the dispatch below.
 */
function usage() {
  var v = env('BITGRAPH_VERSION');
  return [
    'BitGraph Folder' + (v && v !== 'unknown' ? ' ' + v : ''),
    '',
    '  osascript -l JavaScript ' + '~/.bitgraph/export.js <command>',
    '',
    'Run by hand. Neither of these can record anything:',
    '  --verify <folder>            re-hash every export against its own proof',
    '  --recover <folder> [dest]    rebuild exports the ledger still has',
    '',
    'Run by the watcher:',
    '  --drop <manifest> <folder> [responses]   build a whole drop, one process',
    '  --tidy <folder>              tuck stray exports, purge legacy layout',
    '  --complete <folder> [waitMs] finish exports still awaiting their seal',
    '  <file> <digest> <counter> <epoch> [dest] [--batch]   build one export',
  ].join('\n');
}

function run(argv) {
  try {
    if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
      return usage();
    }
    if (argv[0] === '--tidy') {
      return tidyFolder(argv[1]);
    }
    if (argv[0] === '--json') {
      var body = readFile(argv[2]);
      if (body === null) {
        return argv[1] === 'commit' || argv[1] === 'commitmany' ? 'fail' : 'error';
      }
      if (argv[1] === 'batch') return parseBatch(body);
      if (argv[1] === 'batchmany') return parseBatchMany(body);
      if (argv[1] === 'commitmany') return parseCommitMany(body);
      return parseCommit(body);
    }
    if (argv[0] === '--complete') {
      return completePending(argv[1], argv[2]);
    }
    if (argv[0] === '--verify') {
      return verifyFolder(argv[1]);
    }
    if (argv[0] === '--recover') {
      return recoverInto(argv[1], argv[2]);
    }
    if (argv[0] === '--drop') {
      return buildDrop(argv[1], argv[2], argv[3]);
    }
    if (String(argv[0]).indexOf('--') === 0) {
      return 'error: no such command: ' + argv[0] + '\n\n' + usage();
    }
    if (argv.length < 4) {
      return 'error: not enough arguments\n\n' + usage();
    }
    // One file of a whole drop. The caller seals and indexes once at the end,
    // so this export does neither. See BATCH_DROP.
    if (argv[5] === '--batch') {
      BATCH_DROP = true;
      }
    return buildExport(argv[0], argv[1], argv[2], argv[3], argv[4]);
  } catch (e) {
    return 'error: ' + (e && e.message ? e.message : String(e));
  }
}
