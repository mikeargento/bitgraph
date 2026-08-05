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
//   BitGraph (random-494.txt)/
//       proof.json
//       random-494.txt                          the original bytes, moved in
//       index.html                              the recording's own page
//       ethereum-anchors/
//           anchor-before.json                  lower bound
//           anchor-before-witness.json          its block header
//           anchor-after.json                   upper bound, the seal
//           anchor-after-witness.json           its block header
//   files/
//       random-494.txt                          a hard link, not a copy
//   index.html                                  the contact sheet
//
// files/ exists so the recorded files can be taken back out in one go, without
// opening every export. Hard links, so it costs no disk and cannot drift.
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
//   export.js --index <folder>                              rebuild the sheet
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

// How many exports the folder holds, set by writeIndex before it walks them.
// A page only offers a way back when there is a sheet worth going back to:
// with one recording the contact sheet is that same recording, and with an
// export copied somewhere on its own there is no sheet at all.
var SIBLINGS = 0;

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
function fetchProof(digestB64, counter, epochUrlSafe) {
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
function fetchAnchors(counter, epochUrlSafe) {
  var q = 'counter=' + encodeURIComponent(counter) + '&epoch=' + encodeURIComponent(epochUrlSafe);
  var after = getJson(API + '/api/proofs/anchors?' + q + '&limit=1');
  var before = getJson(API + '/api/proofs/anchors?' + q + '&before=1');
  return {
    before: before && before.anchors && before.anchors[0] ? before.anchors[0] : null,
    after: after && after.anchors && after.anchors[0] ? after.anchors[0] : null,
  };
}

/**
 * The offline block-header witness for an anchor's block, or null.
 * The server self-checks it (returns it only when keccak256(header) equals the
 * signed block hash), so a miss just omits the file and the export stays valid.
 */
function fetchWitness(anchor) {
  var b = anchorBlockOf(anchor);
  if (!b) return null;
  return getJson(API + '/api/proofs/witness?block=' + b.number +
    '&hash=' + encodeURIComponent(b.hash));
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
 * writeIndex, which reads `stat` output one line at a time: a newline is a
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
  var base = folder + '/BitGraph' + suffix;
  var old = folder + '/bitgraph-proof-' + counter;
  var oldEpoch = old + '-' + String(epochUrlSafe).slice(0, 8);

  // Newest first, so a re-fire on a current export costs one read.
  var known = [base, old + suffix, old, oldEpoch + suffix, oldEpoch];
  for (var i = 0; i < known.length; i++) {
    if (builtHere(known[i], digestB64, counter, epochUrlSafe)) {
      return { dir: known[i], alreadyBuilt: true };
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

// ---- files/ ----------------------------------------------------------------
//
// A flat folder holding just the recorded files, so you can select them all and
// drag them into the website, or anywhere else, without opening every export in
// turn. That was the only way to get your own files back, and with a few
// hundred recordings it is not a way at all.
//
// HARD LINKS, not copies. A hard link is not a second file: it is a second name
// for the same bytes on disk, so this costs nothing, cannot drift, and what you
// drag out is exactly what was recorded. Deleting either name leaves the other
// whole, which means clearing out files/ never touches a proof, and deleting an
// export never takes your file with it.
//
// The one thing to know: an application that writes IN PLACE through the link
// would alter the export's bytes too. Almost nothing on macOS does; the normal
// save is a write-and-rename, which breaks the link and leaves the export
// untouched. And if bytes ever did change, the recording's own page says so in
// red, which is the product working rather than failing.
//
// Rebuilt by `--index` for every export still on disk, so deleting the folder
// costs nothing while the exports are there.
//
// NOT pruned when an export is deleted, and deliberately so: at that moment the
// link here is the LAST COPY of those bytes, because a drop moves the file in
// rather than copying it. Tidying it away would delete the user's photo to keep
// a derived folder neat. Losing a recording must never mean losing the file.
var FILES_DIR = 'files';

/** True when two paths are the same bytes on disk rather than two copies. */
function sameInode(a, b) {
  var out = sh('stat -f %i ' + quote(a) + ' ' + quote(b) + ' 2>/dev/null');
  if (!out) return false;
  var ids = out.split('\r').join('\n').split('\n').filter(Boolean);
  return ids.length === 2 && ids[0] === ids[1];
}

/** Link one recorded file into files/, numbering only on a real name clash. */
function linkIntoFiles(folder, dir, fileName) {
  var target = dir + '/' + fileName;
  if (!exists(target)) return;
  var files = folder + '/' + FILES_DIR;
  mkdirp(files);

  // `ln` without -f refuses to clobber, so the happy path is one call and an
  // existing entry can never be overwritten by accident.
  var link = files + '/' + fileName;
  if (sh('ln ' + quote(target) + ' ' + quote(link) + ' 2>/dev/null && echo ok') === 'ok') return;
  if (sameInode(link, target)) return; // already linked, nothing to do

  // Taken by something else. Two different photos are both allowed to be
  // called IMG_0001.jpg, so the name gets a number rather than the file getting
  // dropped. The extension survives, since it is what says what the thing is.
  var ext = extOf(fileName);
  var tail = ext ? '.' + ext : '';
  var stem = fileName.slice(0, fileName.length - tail.length);
  for (var n = 2; n < 100; n++) {
    var alt = files + '/' + stem + ' ' + n + tail;
    if (sh('ln ' + quote(target) + ' ' + quote(alt) + ' 2>/dev/null && echo ok') === 'ok') return;
    if (sameInode(alt, target)) return;
  }
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
 * now lives.
 *
 * A recovery must not, which is what `keepSource` is for: its source is the
 * user's own library or a backup, and emptying that out would be a second loss
 * on top of the one being repaired. It links instead, which is not a copy but a
 * second name for the same bytes, so it costs no disk and cannot drift. The
 * copy is the fallback for a source on another volume, which an external backup
 * drive always is.
 *
 * Never clobbers the artifact. If the export already holds the file then the
 * move this is finishing already happened, and in a recovery `from` and `to`
 * can even be the same path. Overwriting is how the 2026-08-04 feedback loop
 * destroyed six recorded files, so the rule here is that an artifact already in
 * place wins.
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

// writeIndex rebuilds every page and prunes thumbnails, so calling it once per
// file during a recovery of several hundred would redo that whole pass several
// hundred times. Set for the length of a recovery, with one index at the end.
var DEFER_INDEX = false;

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
    // A re-fired watch must not redo the work. Still finish the move: the
    // caller marks the digest handled before calling in, so a run that died
    // between writing the contents and moving the file would otherwise strand
    // it at the top level forever.
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
  var sealed = writeExportContents(r.dir, meta, proof, SEAL_WAIT_MS);
  markPending(r.dir, meta, sealed);

  // Moved in last, so a failure above never strands the file.
  placeArtifact(filePath, r.dir + '/' + fileName, keepSource);

  // Same treatment as the contact sheet: derived, and never allowed to turn a
  // successful recording into an error.
  try {
    linkIntoFiles(folder, r.dir, fileName);
  } catch (e) {
    /* relinked by the next --index pass */
  }

  // Refresh the contact sheet, and never let it break a recording. The proof
  // is already written and sealed by this point; index.html is a derived view,
  // so a failure here costs a stale listing that the next drop or `--index`
  // repairs, and must not turn a successful recording into an error.
  if (!DEFER_INDEX) {
    try {
      writeIndex(folder);
    } catch (e) {
      /* rebuilt on the next drop */
    }
  }

  return 'ok: ' + baseName(r.dir) + (sealed ? '' : ' (pending seal)');
}

/** Finish any export still waiting on the anchor that seals it. */
function completePending(folder) {
  var listing = sh('ls -1 ' + quote(folder) + ' 2>/dev/null');
  if (!listing) return 'ok: nothing pending';
  var names = listing.split('\r').join('\n').split('\n').filter(Boolean);
  var sealedCount = 0;

  names.forEach(function (name) {
    var dir = folder + '/' + name;
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
      // No waiting on a completion pass: take whatever has landed by now, so a
      // backlog of pending folders cannot stall the run.
      var sealed = writeExportContents(dir, meta, proof, 0);
      markPending(dir, meta, sealed);
      if (sealed) sealedCount++;
    } catch (e) {
      /* leave it pending; the next run tries again */
    }
  });
  // A completion pass turns pending exports into sealed ones, which changes
  // nothing the index shows today but keeps it correct if it ever surfaces
  // seal state. It also self-heals a folder whose index was never written,
  // e.g. one recorded before this version was installed.
  try {
    writeIndex(folder);
  } catch (e) {
    /* rebuilt on the next drop */
  }

  return 'ok: sealed ' + sealedCount;
}

// ---------------------------------------------------------------------------
// Response parsing for the shell script
// ---------------------------------------------------------------------------

function epochToUrlSafe(e) {
  return String(e || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    var proofs = results[keys[0]].proofs || [];
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

/**
 * One document, shared by the contact sheet and the per-export pages so they
 * cannot drift apart.
 *
 * Square corners, brand blue reserved for actions, no button slabs: the site's
 * rules, restated here because these files ship alone and can never reach a
 * stylesheet. The wrapper class is `wrap` rather than `w`, which previously
 * collided with the time line's class and silently cancelled the page's
 * `margin:0 auto`.
 */
function pageShell(title, extraCss, bodyHtml) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // These pages are rewritten in place at the same path every time a file is
    // dropped, which is the case a browser cache gets wrong: you reload and see
    // the sheet as it was before the drop. Nothing here is worth caching, and a
    // stale contact sheet is worse than no contact sheet.
    '<meta http-equiv="cache-control" content="no-cache, no-store, must-revalidate">' +
    '<meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="0">' +
    '<title>' + esc(title) + '</title><style>' +
    '*{box-sizing:border-box}' +
    // color-scheme, because this page frames content the BROWSER styles: a
    // recorded .txt in an <iframe> is rendered by the UA, which follows the
    // viewer's OS preference unless told otherwise. On a dark-mode Mac that
    // thumbnail came out white-on-black inside an otherwise light page. The
    // whole product is light only, so say so.
    ':root{color-scheme:light}' +
    'body{margin:0;padding:48px 24px 80px;background:#f5f5f5;color:#111827;' +
    'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;' +
    '-webkit-font-smoothing:antialiased}' +
    '.wrap{max-width:800px;margin:0 auto}' +
    'h1{margin:0 0 4px;font-size:28px;font-weight:600;letter-spacing:-.03em;overflow-wrap:anywhere}' +
    '.s{margin:0 0 40px;color:#4b5563;font-size:14px}' +
    // Sits inline at the end of the count, not in a banner or a bar. It is a
    // fact about the software, worth one sentence and no furniture, and it is
    // the only link on this page that leaves the machine.
    '.up{margin-left:10px;color:#0065A4;font-weight:600;text-decoration:none}' +
    '.l{margin:8px 0 0}' +
    '.l a{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}' +
    '.sep{display:inline-block;width:18px}' +
    '.a{display:inline-block;transition:transform .18s ease}' +
    '@media (hover:hover){.l a:hover .a{transform:translateX(3px)}}' +
    '@media (max-width:520px){body{padding:32px 16px 64px}}' +
    extraCss +
    '</style></head><body><div class="wrap">' +
    bodyHtml +
    '</div></body></html>\n'
  );
}

function esc(s) {
  return String(s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

/** Percent-encode each path segment, leaving the separators intact. */
function encodePath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

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

/**
 * A file as a data: URI, read in process.
 *
 * Never through a shell pipe. doShellScript carries output through one, and a
 * photo is hundreds of kilobytes of base64, which is exactly the ceiling the
 * response files at the top of this script exist to avoid.
 */
function dataUri(path, ext) {
  var mime = MIME[ext];
  if (!mime || !exists(path)) return null;
  try {
    // An ObjC nil is truthy here (it arrives as a function), so the result is
    // checked for being a real string rather than for being falsy.
    var b64 = ObjC.unwrap($.NSData.dataWithContentsOfFile(path)
      .base64EncodedStringWithOptions(0));
    if (typeof b64 !== 'string' || !b64.length) return null;
    return { uri: 'data:' + mime + ';base64,' + b64, len: b64.length };
  } catch (e) {
    return null;
  }
}

/** The picture as a data: URI, or null to fall back to a plain relative src. */
function embedImage(dir, file, digestB64) {
  var ext = extOf(file);
  var src = dir + '/' + file;
  var direct = dataUri(src, ext);
  if (direct && direct.len <= EMBED_BUDGET) return direct.uri;
  // SVG is text, already small, and sips cannot rasterise it usefully here.
  if (ext === 'svg') return direct ? direct.uri : null;

  var tmp = '/tmp/bitgraph-embed-' + toUrlSafe(String(digestB64)).slice(0, 16) + '.jpg';
  var best = null;
  for (var i = 0; i < EMBED_WIDTHS.length; i++) {
    // `-s format jpeg` is NOT optional. With `-Z` alone sips infers the output
    // format from the .jpg extension for some inputs and not others: a PNG
    // converts, a WEBP silently writes nothing at all and the budget is then
    // quietly skipped. Naming the output format explicitly makes every input
    // sips can read behave the same way.
    sh('sips -s format jpeg -Z ' + EMBED_WIDTHS[i] +
      ' --out ' + quote(tmp) + ' ' + quote(src) + ' >/dev/null 2>&1');
    var small = dataUri(tmp, 'jpg');
    if (!small) break;
    best = small;
    if (small.len <= EMBED_BUDGET) break;
  }
  sh('rm -f ' + quote(tmp));
  if (best) return best.uri;

  // sips produced nothing, so the budget cannot be met by shrinking. ⚠️ THIS
  // HAPPENS: sips cannot read WebP at all, silently writing no output file, and
  // the same is true of any format ImageIO does not decode. Falling through to
  // the original was the old behaviour and it made the budget a lie.
  //
  // Embedding oversize still beats not embedding, because not embedding is the
  // bug this whole thing exists to fix: no picture at all in a sandboxed
  // viewer. So the original goes in, up to a hard ceiling that keeps one page
  // from becoming tens of megabytes.
  if (direct && direct.len <= EMBED_HARD_MAX) return direct.uri;
  return null;
}

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
var THUMBS_DIR = '.thumbs';
// 600px for a cell that packs to roughly 230-300px, so it still holds up on a
// retina display without carrying a full-size photo to do it.
var THUMB_WIDTH = 600;

/**
 * A small copy of an export's image for the sheet, made once and reused.
 *
 * Returns a path relative to the folder, or null to fall back to the original,
 * which is what happens for a format sips cannot read.
 */
function thumbFor(folder, name, file) {
  if (IMAGE_EXT.indexOf(extOf(file)) === -1) return null;
  var rel = THUMBS_DIR + '/' + name + '.jpg';
  var abs = folder + '/' + rel;
  if (!exists(abs)) {
    mkdirp(folder + '/' + THUMBS_DIR);
    // `-s format jpeg` for the reason embedImage carries it: without it sips
    // silently writes nothing for a WEBP.
    sh('sips -s format jpeg -Z ' + THUMB_WIDTH + ' --out ' + quote(abs) + ' ' +
      quote(folder + '/' + name + '/' + file) + ' >/dev/null 2>&1');
    if (!exists(abs)) return null;
  }
  return encodePath(rel);
}

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
  ['before', 'after'].forEach(function (side) {
    var anchorPath = dir + '/' + ANCHOR_DIR + '/anchor-' + side + '.json';
    var witnessPath = dir + '/' + ANCHOR_DIR + '/anchor-' + side + '-witness.json';
    if (exists(witnessPath) || !exists(anchorPath)) return;
    var raw = readFile(anchorPath);
    if (raw === null) return;
    try {
      var witness = fetchWitness(JSON.parse(raw));
      if (witness) writeJson(witnessPath, witness);
    } catch (e) {
      /* tried again on the next pass */
    }
  });
}

/** Drop thumbnails whose export no longer exists. One call, after the scan. */
function pruneThumbs(folder) {
  sh('cd ' + quote(folder + '/' + THUMBS_DIR) + ' 2>/dev/null && for t in *.jpg; do ' +
    '[ -e "$t" ] || continue; d="${t%.jpg}"; [ -d "../$d" ] || rm -f "$t"; done; true');
}

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

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Time ------------------------------------------------------------------
//
// A BitGraph proof carries no clock reading. Its time statement is the pair of
// Ethereum anchors that bracket it, so the only honest rendering is a window:
// recorded after one block was mined and before the next. Printing a single
// instant would be the "proves when it was taken" claim this project refuses to
// make, which is why the row says "between ... and ..." and never "at".
//
// The block times are not stored as fields anywhere in the export. They live
// inside headerRlpHex in ethereum-anchors/*-witness.json, as field 12 of the
// RLP block header, so getting them means decoding the header here. That is
// what the three functions below do, walking only as far as item 11 rather
// than decoding the whole structure.
//
// Deriving it from the witness rather than trusting a stored number is also
// the stronger construction: the witness is the block header itself, and its
// hash is the anchor the proof commits to.

function hexToBytes(hex) {
  var s = String(hex).replace(/^0x/, '');
  if (s.length % 2 !== 0) return null;
  var out = [];
  for (var i = 0; i < s.length; i += 2) {
    var b = parseInt(s.substr(i, 2), 16);
    if (isNaN(b)) return null;
    out.push(b);
  }
  return out;
}

/**
 * Bounds of the RLP item starting at i: where its payload begins, how long it
 * is, and where the next item starts. A byte under 0x80 encodes itself, so its
 * payload is the byte at i and its length is 1, which lets callers read every
 * item the same way.
 */
function rlpItemAt(b, i) {
  var p = b[i];
  if (p === undefined) return null;
  if (p < 0x80) return { start: i, len: 1, next: i + 1, list: false };
  if (p <= 0xb7) return { start: i + 1, len: p - 0x80, next: i + 1 + (p - 0x80), list: false };
  if (p <= 0xbf) {
    var n = p - 0xb7, len = 0;
    for (var k = 0; k < n; k++) len = len * 256 + b[i + 1 + k];
    return { start: i + 1 + n, len: len, next: i + 1 + n + len, list: false };
  }
  if (p <= 0xf7) return { start: i + 1, len: p - 0xc0, next: i + 1 + (p - 0xc0), list: true };
  var m = p - 0xf7, plen = 0;
  for (var j = 0; j < m; j++) plen = plen * 256 + b[i + 1 + j];
  return { start: i + 1 + m, len: plen, next: i + 1 + m + plen, list: true };
}

/**
 * Unix seconds from an RLP-encoded Ethereum block header, or 0.
 *
 * Header field order is fixed and the first twelve have never changed across
 * forks: parentHash, uncleHash, coinbase, stateRoot, txRoot, receiptRoot,
 * logsBloom, difficulty, number, gasLimit, gasUsed, timestamp. So walk eleven
 * items and read the twelfth. A timestamp is about 1.7e9, far inside the
 * range JavaScript integers hold exactly.
 */
function rlpHeaderTimestamp(hex) {
  var b = hexToBytes(hex);
  if (!b) return 0;
  var outer = rlpItemAt(b, 0);
  if (!outer || !outer.list) return 0;

  var i = outer.start;
  for (var idx = 0; idx < 11; idx++) {
    var it = rlpItemAt(b, i);
    if (!it) return 0;
    i = it.next;
  }
  var ts = rlpItemAt(b, i);
  if (!ts || ts.len > 8) return 0;

  var v = 0;
  for (var q = 0; q < ts.len; q++) v = v * 256 + b[ts.start + q];
  return v;
}

/**
 * The anchors bracketing this export: block time and block number for each.
 * Either side may be absent, which is what a pending seal looks like.
 *
 * The time is decoded from the witness header rather than read from a field,
 * because the witness IS the block header and its hash is what the proof
 * commits to. The block number is taken from the witness too, so both numbers
 * on a row come from the same artifact.
 */
function anchorInfo(dir) {
  function read(which) {
    var raw = readFile(dir + '/' + ANCHOR_DIR + '/anchor-' + which + '-witness.json');
    if (raw === null) return { ts: 0, block: 0 };
    try {
      var w = JSON.parse(raw);
      return {
        ts: w && w.headerRlpHex ? rlpHeaderTimestamp(w.headerRlpHex) : 0,
        block: (w && w.blockNumber) || 0,
      };
    } catch (e) {
      return { ts: 0, block: 0 };
    }
  }
  return { before: read('before'), after: read('after') };
}

/**
 * Where a recording sits in causal order, which is the only order this folder
 * has an opinion about.
 *
 * The key is the Ethereum block of its lower-bound anchor, then the counter
 * inside that block. mtime used to do this job and it is the FILESYSTEM's
 * opinion, not the ledger's: copying the folder, restoring a backup or touching
 * a file rewrites it, and it never said anything about when a recording
 * actually happened.
 *
 * Counters alone genuinely cannot do it, which is why they were not used: they
 * restart every UTC day, so #22 from today and #13000 from last week are not
 * comparable. Anchors are exactly the mechanism that relates one epoch to
 * another, because a block number is globally ordered and cannot be predicted
 * before it is mined. So (block, counter) IS causal order across the whole
 * folder, including across epochs, and it is already sitting in each export.
 *
 * A recording with no anchor has not sealed yet, which can only mean it was
 * just made, so it sorts newest.
 */
function causalKey(folder, name) {
  var dir = folder + '/' + name;
  var block = 0;
  var counter = 0;
  try {
    var info = anchorInfo(dir);
    block = info.before.block || info.after.block || 0;
  } catch (e) {
    /* unordered beats unlisted */
  }
  var raw = readFile(dir + '/proof.json');
  if (raw !== null) {
    try {
      var p = JSON.parse(raw);
      counter = parseInt((p.commit && p.commit.counter) || 0, 10) || 0;
    } catch (e) {
      /* as above */
    }
  }
  return { block: block, counter: counter };
}

function clockOf(d) {
  var h = d.getHours();
  var h12 = h % 12 === 0 ? 12 : h % 12;
  var mm = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
  // Seconds are not optional. Anchors land every 12 seconds, so both bounds of
  // a window usually fall inside the same minute and would print identically
  // without them, making a real interval look like a rendering fault.
  var ss = d.getSeconds() < 10 ? '0' + d.getSeconds() : String(d.getSeconds());
  return h12 + ':' + mm + ':' + ss + (h >= 12 ? 'pm' : 'am');
}

// The site prints "12:54:11 PM EDT": uppercase meridiem, spaced, with the
// zone named. clockOf's compact "12:54:11pm" is for the contact sheet's cells,
// where the row has to fit on one line.
var TZ = sh('date +%Z') || '';

function clock12(d) {
  var h = d.getHours();
  var h12 = h % 12 === 0 ? 12 : h % 12;
  var mm = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
  var ss = d.getSeconds() < 10 ? '0' + d.getSeconds() : String(d.getSeconds());
  return h12 + ':' + mm + ':' + ss + ' ' + (h >= 12 ? 'PM' : 'AM');
}

function dateOf(d) {
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

// The row carried a date and a counter here too. A cell is three things now:
// the picture, its filename, and the two ways to open it. Everything else was
// the proof page leaking into a contact sheet. The window and the counter are
// both one click away and stated in full there, the counter under Artifact
// Commit and the window at the top of the page.


function indexRow(folder, name, mtime) {
  var dir = folder + '/' + name;
  var raw = readFile(dir + '/proof.json');
  if (raw === null) return null;

  var proof;
  try {
    proof = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  var digest = proof && proof.artifact && proof.artifact.digestB64;
  if (!digest) return null;

  var counter = (proof.commit && proof.commit.counter) || '';
  var file = artifactIn(dir);
  var rel = file ? encodePath(name + '/' + file) : null;
  var isImage = file && IMAGE_EXT.indexOf(extOf(file)) !== -1;

  var isPdf = file && extOf(file) === 'pdf';

  // The thumbnail opens the file's own page, not the raw bytes. Everything
  // about a recording lives on that page, the file among it, so sending the
  // most obvious click straight to the artifact skipped past the thing you
  // actually wanted.
  var page = encodePath(name) + '/index.html';

  // A small copy where one can be made, the original where it cannot. The
  // difference is the whole page's weight: originals meant pulling megabytes to
  // draw 230px cells.
  var shown = (isImage && thumbFor(folder, name, file)) || rel;

  var thumb = isImage
    // loading=lazy so a folder with hundreds of recordings still opens at once.
    ? '<a class="t" href="' + page + '"><img src="' + shown + '" alt="" loading="lazy"></a>'
    : isPdf
      ? '<a class="t pdf" href="' + page + '"><embed src="' + rel + PDF_VIEW + '" type="application/pdf"></a>'
      : file && VIDEO_EXT.indexOf(extOf(file)) !== -1
        ? '<a class="t" href="' + page + '"><video src="' + rel +
          '" preload="metadata" muted playsinline tabindex="-1"></video></a>'
      : file && TEXT_EXT.indexOf(extOf(file)) !== -1
        ? '<a class="t doc" href="' + page + '"><iframe src="' + rel +
          '" sandbox loading="lazy" tabindex="-1" scrolling="no"></iframe></a>'
        // An empty box when there is no artifact to name, not a dash. The house
        // rule is no em dashes anywhere, and this one was also the character
        // that exposed the encoding bug above.
        : '<a class="t none" href="' + page + '">' + esc(file ? (extOf(file) || 'FILE').toUpperCase() : '') + '</a>';

  // Two links, in the order you would use them: the file first, because that
  // is what you came to look at, then the proof. A third link straight to the
  // raw bytes was cut, since the file's page already lists them along with
  // proof.json and the anchors.
  //
  // It points at index.html rather than at the directory on purpose. A browser
  // given a `file:` directory link renders its own unstyleable listing,
  // "Index of /private/tmp/…" in Times, headed by the absolute path. Naming
  // the file is what lets our page win. It still opens in a browser rather
  // than revealing the folder in Finder, which nothing in a web page can do
  // without a registered URL scheme, which needs an app bundle, which is the
  // one thing "a folder, not an app" rules out.
  // Just "Open" now. It was "Open locally", which earned the qualifier only
  // while a second link to the site sat under it; with that gone, "locally" is
  // answering a question nobody is asking.
  var openFile = '<a href="' + page + '">Open <span class="a">&rarr;</span></a>';

  var info = anchorInfo(dir);

  // Written here rather than at export time so it is rebuilt on every index
  // pass: a folder recorded before this version existed gets its page on the
  // next drop, and a deleted one comes back.
  try {
    writeProofPage(folder, name, file, digest, counter, info, mtime);
  } catch (e) {
    /* the row still works without it */
  }

  return (
    '<li>' +
    thumb +
    '<div class="m">' +
    // title carries the full name, since a long one is clipped to keep every
    // cell the same height.
    '<p class="n" title="' + esc(file || name) + '">' + esc(file || name) + '</p>' +
    '<div class="l">' + openFile + '</div>' +
    '</div></li>'
  );
}

/**
 * The page one export opens to, written inside the export as index.html.
 *
 * It exists because a browser handed a `file:` directory link renders its own
 * listing, and there is no styling it: "Index of /private/tmp/…" in Times, with
 * the full absolute path as a heading. Pointing the link at index.html instead
 * of at the directory means the browser renders this rather than that.
 *
 * ⚠️ This is the one thing in the export that the website's zip does not
 * contain, so a Folder export and a downloaded one are no longer byte-identical.
 * It is inert: derived, rewritten on every index pass, ignored by the auditor
 * (which finds proofs by schema shape, not by filename), and deletable with no
 * loss. Nothing verifies against it.
 */
function writeProofPage(folder, name, file, digest, counter, info, mtime) {
  var dir = folder + '/' + name;

  // NEVER write over the artifact. The page has to be called index.html, since
  // that is what makes a browser render it instead of generating its own
  // directory listing, so an export whose recorded file is itself named
  // index.html cannot have one: writing it would destroy the very bytes the
  // proof describes. The 2026-08-04 feedback loop recorded the sheet six times
  // and this function overwrote all six artifacts before the collision was
  // noticed. The hot folder now skips index.html so nothing new can land in
  // that state, and this guard means the generator cannot do the damage even
  // if something does.
  if (exists(dir + '/index.html')) {
    var existingHash = digestOfFile(dir + '/index.html');
    if (existingHash && existingHash === String(digest).trim()) return;
  }

  var proofRaw = readFile(dir + '/proof.json');
  var proof = null;
  try { proof = proofRaw ? JSON.parse(proofRaw) : null; } catch (e) { proof = null; }

  var ext = file ? extOf(file) : '';
  var isImage = file && IMAGE_EXT.indexOf(ext) !== -1;
  var isPdf = file && ext === 'pdf';
  var isVideo = file && VIDEO_EXT.indexOf(ext) !== -1;
  var isAudio = file && AUDIO_EXT.indexOf(ext) !== -1;
  var isText = file && TEXT_EXT.indexOf(ext) !== -1;

  // Answered here rather than by sending someone to the site to drop the file
  // in by hand: this script has the bytes, so it hashes them and compares
  // against what the proof commits to. Silent when they match, which is every
  // normal page; announcing a match would promise a contrast the page cannot
  // show and train the reader to skim past the one time it mattered.
  var binding = null;
  if (file) {
    var got = digestOfFile(dir + '/' + file);
    if (got) binding = got === String(digest).trim();
  }

  var sizeStr = '';
  if (file) {
    var b = parseInt(sh('stat -f%z ' + quote(dir + '/' + file) + ' 2>/dev/null'), 10);
    if (isFinite(b) && b > 0) {
      sizeStr = b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB'
        : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' bytes';
    }
  }

  /* ---- the proof page's own components, rebuilt in plain HTML ---- */

  // Every field is tap-to-copy and swaps its value for "Copied!", which is what
  // that page does and the reason neither has a copy button.
  function field(label, value, opts) {
    if (value === undefined || value === null || value === '') return '';
    opts = opts || {};
    var cls = 'f' + (opts.mono ? ' mono' : '') + (opts.hl ? ' hl' : '');
    if (opts.link) {
      return '<div class="f"><span class="fl">' + esc(label) + '</span>' +
        '<a class="fv lnk" href="' + esc(value) + '" target="_blank" rel="noopener noreferrer">' +
        esc(value) + '</a></div>';
    }
    return '<div class="' + cls + '" data-copy="' + esc(value) + '">' +
      '<span class="fl">' + esc(label) + '</span>' +
      '<span class="fv">' + esc(value) + '</span></div>';
  }

  function card(title, inner, plain) {
    if (!inner) return '';
    // A plain card has NO header. The proof page passes a title and then
    // renders nothing for it, because the h1 above already says it and the
    // card's contents are the point of the page. Drawing the header here
    // printed "BitGraph Recorded" twice, once as the heading and once in blue
    // inside the box beneath it.
    if (plain) return '<section class="cd">' + inner + '</section>';
    return '<section class="cd"><details><summary class="hd">' +
      '<span>' + esc(title) + '</span>' +
      '<span class="chev" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" ' +
      'stroke-linejoin="miter"><path d="M9 6 L15 12 L9 18"/></svg></span>' +
      '</summary><div class="bd">' + inner + '</div></details></section>';
  }

  var rel = file ? encodePath(file) : null;
  // The src is embedded where it can be; the href stays the real file, which is
  // what a browser that can reach it should open. In a sandbox that link is
  // blocked either way, and the embedded src is what carries the page.
  var src = isImage ? (embedImage(dir, file, digest) || rel) : rel;
  var media = isImage
    ? '<div class="hero"><a href="' + rel + '"><img src="' + src + '" alt=""></a></div>'
    : isPdf
      ? '<div class="hero"><embed class="doc" src="' + rel + '" type="application/pdf"></div>'
      : isVideo
        ? '<div class="hero"><video class="av" src="' + rel + '" controls preload="metadata" playsinline></video></div>'
        : isAudio
          ? '<div class="hero"><audio class="au" src="' + rel + '" controls preload="metadata"></audio></div>'
          : isText
            ? '<div class="hero"><iframe class="doc" src="' + rel + '" sandbox></iframe></div>'
            : '';

  // "BitGraph Recorded", the page's one always-open card, exactly as the proof
  // page treats it: the artifact, what it is called, and the hash that binds
  // them. Everything else is collapsed beneath it.
  // The window, written the way that page writes it: the date as the heading,
  // the interval beneath it in the data font. It leads the card rather than
  // being a section of its own, because it is what the recording IS.
  var whenRow = '';
  if (info.before.ts && info.after.ts) {
    var wb = new Date(info.before.ts * 1000);
    var wa = new Date(info.after.ts * 1000);
    whenRow = '<div class="when"><div class="wd">' + dateOf(wb) + '</div>' +
      '<div class="wt">between ' + clock12(wb) + ' and ' + clock12(wa) + ' ' + TZ + '</div></div>';
  } else if (info.before.ts) {
    var wo = new Date(info.before.ts * 1000);
    whenRow = '<div class="when"><div class="wd">' + dateOf(wo) + '</div>' +
      '<div class="wt">after ' + clock12(wo) + ' ' + TZ + ', sealing</div></div>';
  }

  var head =
    whenRow +
    media +
    '<div class="fn">' +
    '<span>' + esc(file || name) + (sizeStr ? ' &middot; ' + esc(sizeStr) : '') + '</span>' +
    (rel ? '<a class="op" href="' + rel + '">Open <span class="arrow">&rarr;</span></a>' : '') +
    '</div>' +
    field('File Hash', digest, { mono: true });

  var slot = (proof && proof.slotAllocation) || null;
  var commit = (proof && proof.commit) || {};
  var signer = (proof && proof.signer) || {};
  var env = (proof && proof.environment) || {};
  var attr = (proof && proof.attribution) || null;

  function anchorCard(title, side) {
    if (!side.block && !side.ts) return '';
    var inner = field('Block', side.block ? '#' + side.block : '', { hl: true });
    if (side.ts) {
      var d = new Date(side.ts * 1000);
      inner += field('Block Time', clockOf(d) + ' on ' + dateOf(d));
    }
    if (side.block) inner += field('Etherscan', 'https://etherscan.io/block/' + side.block, { link: true });
    return card(title, inner);
  }

  // The proof page's order, which is the construction's order: what was
  // reserved, what was committed into it, who signed it, where it ran, and only
  // then the blocks that bracket it. The anchors are a bound placed on the
  // whole thing afterwards, so they come after the thing they bound, not first.
  //
  // Two of that page's cards cannot exist here: Content Credentials needs the
  // C2PA toolkit, and Recordings needs the ledger to know the other positions.
  var body =
    card('BitGraph Recorded', head, true) +
    (slot
      ? card('Reserved Slot',
          field('Slot Counter', slot.counter ? '#' + slot.counter : '', { hl: true }) +
          field('Nonce', slot.nonceB64, { mono: true }) +
          field('Slot Signature', slot.signatureB64, { mono: true }) +
          field('Epoch ID', slot.epochId, { mono: true }))
      : '') +
    card('Artifact Commit',
      field('Artifact Counter', commit.counter ? '#' + commit.counter : '', { hl: true }) +
      field('Epoch ID', slot ? '' : commit.epochId, { mono: true }) +
      field('Previous Hash', commit.prevB64, { mono: true }) +
      field('Slot Hash', commit.slotHashB64, { mono: true })) +
    card('Signature',
      field("This BitGraph's Hash", proof && proof.proofHash, { mono: true }) +
      field('Signature', signer.signatureB64, { mono: true }) +
      field('Public Key', signer.publicKeyB64, { mono: true })) +
    card(env.enforcement === 'software' ? 'Software' : 'Hardware Enclave',
      field('PCR0 Measurement', env.measurement, { mono: true }) +
      field('Attestation Format', env.attestation && env.attestation.format)) +
    anchorCard('Recorded after this block', info.before) +
    anchorCard('Recorded before this block', info.after) +
    (attr
      ? card("Submitter's Note",
          field('Submitted by', attr.name) +
          field('Note', attr.message, { mono: true }))
      : '') +
    (proofRaw ? card('Raw JSON', '<pre class="copy" title="Click to copy">' + esc(proofRaw) + '</pre>') : '');

  writeFile(
    dir + '/index.html',
    pageShell(
      file || name,
      proofPageCss(),
      // ❄️ There is no link to the site here, and there should not be one.
      //
      // It was tried, moved twice, and cut. Two reasons. The site is already
      // reachable by the thing the reader is holding: dropping a recorded file
      // on bitgraph.ing goes straight to its proof, and the file is right here
      // in this folder and again in files/. A link is a second way to do what
      // the product's one gesture already does.
      //
      // And it was quietly wrong. Pinning a causal position needs counter and
      // epoch in the query; the link carried neither, so on the second
      // recording of the same bytes it opened the first one. A link that can
      // point at a different recording than the page it sits on is worse than
      // no link.
      //
      // The way back is the only navigation this page needs, and only when
      // there is a sheet to go back to.
      (SIBLINGS > 1
        ? '<nav class="nv"><a class="hm bk" href="../index.html">' +
          '<span class="arrow">&larr;</span> All recordings</a></nav>'
        : '') +
        '<h1>BitGraph Recorded</h1>' +
        (binding === false
          ? '<p class="bind"><b>This file does not match the proof.</b> Its SHA-256 differs from the ' +
            'file hash below, so these are not the same bytes. Either the file changed after it was ' +
            'recorded, or it is not the file this proof describes.' +
            '<span class="audit">' + esc(auditCommand(name)) + '</span></p>'
          : '') +
        body +
        // ❄️ An "audit this yourself" block sat here and was CUT. Do not add it
        // back. The page already re-hashes the artifact and says so in red when
        // the bytes disagree, which is the check anyone actually needs, so a
        // standing note telling the reader not to trust the page taxes every
        // reader to serve a rare adversarial one who can find the command in
        // the README. Mike: "its like not trusting something you dont have to
        // trust". It also failed in practice: the command it printed was
        // relative to the parent folder, and following it landed you in
        // ~/BitGraph where bitgraph-audit writes audit-report.json and
        // audit-report.md, which the watcher would then record. Two permanent
        // proofs for reading a page.
        //
        // The command still appears on a MISMATCH, which is the one moment the
        // reader has a reason to want it.
        '<div id="c">Copied!</div>' +
        copyScript()
    )
  );
}

/** "In this folder", as one more card in the stack. */
function filesCard(dir, artifact) {
  var listed = [];
  var seen = {};
  function add(rel) {
    if (seen[rel] || !exists(dir + '/' + rel)) return;
    seen[rel] = true;
    listed.push(rel);
  }
  // Ordered by what each thing IS, not by name: the recorded file, then its
  // proof, then the anchor evidence, lower bound first with each witness after
  // the anchor it witnesses.
  if (artifact) add(artifact);
  add('proof.json');
  ['anchor-before.json', 'anchor-before-witness.json', 'anchor-after.json', 'anchor-after-witness.json']
    .forEach(function (a) { add(ANCHOR_DIR + '/' + a); });

  var out = listed.map(function (rel) {
    return '<div class="f"><span class="fl">' + esc(rel) + '</span>' +
      '<a class="fv lnk" href="' + encodePath(rel) + '">Open</a></div>';
  }).join('');
  return out ? cardStatic('In this folder', out) : '';
}

function cardStatic(title, inner) {
  return '<section class="cd"><details><summary class="hd">' +
    '<span>' + esc(title) + '</span>' +
    '<span class="chev" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" ' +
    'stroke-linejoin="miter"><path d="M9 6 L15 12 L9 18"/></svg></span>' +
    '</summary><div class="bd">' + inner + '</div></details></section>';
}

/** Values lifted from the proof page so the two read as one design. */
function proofPageCss() {
  return (
    '.nv{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 34px}' +
    '.hm{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}' +
    // An arrow leans the way it points, always outward. .hm carries both the
    // back link and the forward one now, so the direction cannot sit on .hm:
    // it was written when .hm was only the way out, and the forward arrow
    // inherited the leftward pull and appeared to retreat into the page.
    '@media (hover:hover){.hm:hover .arrow{transform:translateX(3px)}' +
    '.hm.bk:hover .arrow{transform:translateX(-3px)}}' +
    '.nn{color:#4b5563;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    // The proof page's own values for this heading, which is a 20px/800 line
    // rather than the shell's 28px/600 page title: it asserts the recording
    // happened, it does not name the document.
    'h1{margin:0 0 10px;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#111827}' +
    '.when{display:flex;flex-direction:column;gap:5px;padding:14px 16px;' +
    'border-bottom:1px solid #e2e5e9}' +
    '.wd{font-size:14px;font-weight:700;color:#111827;letter-spacing:-.01em}' +
    '.wt{font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f2937}' +
    '.cd{background:#fff;border:1px solid #d0d5dd;overflow:hidden;margin:0 0 10px}' +
    '.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;' +
    'font-size:14px;font-weight:700;letter-spacing:.04em;color:#0065A4;padding:14px 16px;' +
    'background:#fff;cursor:pointer;list-style:none}' +
    '.hd::-webkit-details-marker{display:none}' +
    '.hd.plain{cursor:default}' +
    'details[open]>.hd{background:rgba(0,101,164,.07);border-bottom:1px solid #e2e5e9}' +
    '@media (hover:hover){summary.hd:hover{background:rgba(0,101,164,.07)}}' +
    '.chev{flex-shrink:0;display:inline-flex;transition:transform .18s}' +
    'details[open]>.hd .chev{transform:rotate(90deg)}' +
    '.f{display:flex;flex-direction:column;gap:5px;padding:14px 16px;' +
    'border-bottom:1px solid #e2e5e9;cursor:pointer}' +
    '.f:last-child{border-bottom:0}' +
    '.fl{font-size:14px;color:#374151;font-weight:700}' +
    '.fv{font-size:14px;color:#1f2937;line-height:1.6;word-break:break-all}' +
    // Long fixed-length strings stay on one line and scroll, rather than being
    // shredded across ragged wrapped lines. Still tap-to-copy, so nobody has to
    // scroll to grab one.
    '.mono .fv{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'white-space:nowrap;overflow-x:auto;word-break:normal}' +
    '.hl .fv{color:#0065A4;font-weight:700}' +
    '.lnk{color:#0065A4;text-decoration:none;font-size:13px}' +
    // The proof page's PhotoCard, values and all: 20px of padding inside the
    // card, the artwork centred in it, and a min(70vh,640px) ceiling with
    // object-fit contain. Edge-to-edge at a smaller cap was the difference
    // that made this look like a different page.
    '.hero{background:#fff;padding:20px;display:flex;align-items:center;justify-content:center}' +
    '.hero img{max-width:100%;max-height:min(70vh,640px);width:auto;height:auto;' +
    'display:block;object-fit:contain}' +
    '.hero .doc{width:100%;height:min(70vh,640px);border:0;display:block;background:#fff}' +
    '.hero .av{max-width:100%;max-height:min(70vh,640px);display:block;background:#111827}' +
    '.hero .au{width:100%;display:block}' +
    '.fn{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
    'padding:14px 16px;border-top:1px solid #e2e5e9;font-size:14px;font-weight:600;color:#111827}' +
    '.op{color:#0065A4;font-weight:600;text-decoration:none;flex-shrink:0}' +
    '.arrow{display:inline-block;transition:transform .18s}' +
    '@media (hover:hover){.op:hover .arrow{transform:translateX(3px)}}' +
    '.bd pre.copy{margin:0;padding:14px 16px;background:#fff;border:0;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#374151;' +
    'white-space:pre-wrap;word-break:break-all;cursor:pointer;max-height:420px;overflow:auto}' +
    '.bind{margin:0 0 16px;padding:14px 16px;border:1px solid #dc2626;font-size:14px;color:#111827}' +
    '.bind b{font-weight:600;color:#dc2626}' +
    '.bind .audit{display:block;margin-top:8px;color:#4b5563;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}' +
    '#c{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:50;' +
    'padding:10px 22px;font-size:14px;font-weight:700;color:#fff;background:#0065A4;' +
    'pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.22)}'
  );
}

/**
 * The command that checks an export without trusting the page inside it.
 *
 * ⚠️ The folder name is SHELL-QUOTED. Exports are called `BitGraph (sunset.jpg)`,
 * and both the parentheses and the space are shell syntax: pasted bare, as the
 * mismatch warning used to print it, that line is a syntax error in bash and
 * zsh rather than an audit. `quote` is the same single-quoting doShellScript
 * gets, because it is the same job, one string into one shell word.
 */
function auditCommand(name) {
  return 'npx @mikeargento/bitgraph-audit ' + quote(name);
}

/** Tap a field or a JSON block to copy it, the proof page's own affordance. */
function copyScript() {
  return '<script>(function(){var c=document.getElementById("c");' +
    'function ok(){c.style.display="block";setTimeout(function(){c.style.display="none"},1500)}' +
    'function put(t){if(navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(t).then(ok,function(){ok()})}else{ok()}}' +
    'Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"),function(f){' +
    'f.addEventListener("click",function(){var v=f.querySelector(".fv");var o=v.textContent;' +
    'put(f.getAttribute("data-copy"));v.textContent="Copied!";v.style.color="#0065A4";' +
    'setTimeout(function(){v.textContent=o;v.style.color=""},1500)})});' +
    'Array.prototype.forEach.call(document.querySelectorAll("pre.copy"),function(p){' +
    'p.addEventListener("click",function(){put(p.textContent)})});' +
    '})();</script>';
}

/**
 * "A newer version exists", when one does, as one sentence on the sheet.
 *
 * There is no update check here and there must never be one. A folder-watching
 * tool has no business phoning home on a schedule, which is the reason
 * auto-update was declined in the first place and the reason the download page
 * can say nothing leaves your Mac. What happens instead is that the site states
 * its current release in a header on the commit you already asked for by
 * dropping a file; hotfolder.sh stashes that string, and this compares it to
 * the installed version. Nothing about this machine is sent upward, no timer
 * runs, and no host is contacted that was not already being contacted.
 *
 * Silent unless there is genuinely something newer. An unknown version, an
 * unreadable file, or a match all render nothing: a folder that has never
 * recorded anything must not accuse itself of being out of date.
 *
 * The comparison is numeric per component, so 1.3.10 correctly beats 1.3.9,
 * which a string compare gets backwards.
 */
function newerThan(a, b) {
  var x = String(a).split('.');
  var y = String(b).split('.');
  for (var i = 0; i < Math.max(x.length, y.length); i++) {
    var p = parseInt(x[i], 10) || 0;
    var q = parseInt(y[i], 10) || 0;
    if (p !== q) return p > q;
  }
  return false;
}

function updateNote() {
  var mine = env('BITGRAPH_VERSION');
  var latest = String(readFile(HOME_DIR + '/latest') || '').replace(/\s+/g, '');
  if (!mine || !latest || mine === 'unknown') return '';
  if (!/^\d/.test(mine) || !/^\d/.test(latest)) return '';
  if (!newerThan(latest, mine)) return '';
  return ' <a class="up" href="' + API + '/docs/folder">BitGraph Folder ' +
    esc(latest) + ' is available <span class="a">&rarr;</span></a>';
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
 * mtime is the FILESYSTEM's opinion and no longer orders anything (see
 * causalKey); it survives only as a tiebreak. Ends in `true` because the loop's
 * last iteration sets the exit status, and a non-zero one makes doShellScript
 * throw away the entire listing.
 *
 * One implementation on purpose. The sheet and `--verify` have to agree on what
 * counts as an export, or a recording could be listed and never checked.
 */
function exportDirs(folder) {
  var listing = sh('cd ' + quote(folder) +
    ' && for d in */; do if [ -f "$d/proof.json" ]; then stat -f "%m %N" "$d"; fi; done 2>/dev/null; true');
  var lines = listing ? listing.split('\r').join('\n').split('\n').filter(Boolean) : [];

  var entries = [];
  lines.forEach(function (line) {
    var gap = line.indexOf(' ');
    if (gap === -1) return;
    // `stat` prints the name as given, and the glob gives it with a trailing slash.
    var name = line.slice(gap + 1).replace(/\/+$/, '');
    if (!name || name === FILES_DIR) return;
    entries.push({ name: name, mtime: parseInt(line.slice(0, gap), 10) || 0 });
  });
  return entries;
}

/** Rebuild index.html from whatever is on disk, newest first. */
function writeIndex(folder) {
  var entries = exportDirs(folder);
  // Causal order, newest first: the ledger's order, not the filesystem's.
  // See causalKey. mtime survives only as the tiebreak for two recordings that
  // share a block and a counter, which nothing real does.
  entries.forEach(function (e) {
    var k = causalKey(folder, e.name);
    e.block = k.block;
    e.counter = k.counter;
  });
  entries.sort(function (x, y) {
    // Unsealed means just recorded, so it leads regardless of block.
    if (!x.block !== !y.block) return x.block ? 1 : -1;
    if (x.block !== y.block) return y.block - x.block;
    if (x.counter !== y.counter) return y.counter - x.counter;
    return y.mtime - x.mtime;
  });

  SIBLINGS = entries.length;

  var rows = [];
  entries.forEach(function (e) {
    // Repair FIRST. indexRow reads the anchor window and rewrites the
    // recording's page from it, so a witness fetched after that call would not
    // show until the pass after this one.
    try {
      repairWitnesses(folder + '/' + e.name);
    } catch (err) {
      /* tried again on the next pass */
    }
    var row = indexRow(folder, e.name, e.mtime);
    if (row) rows.push(row);
    // Backfill files/ for anything recorded before this existed, or after
    // someone emptied it. linkIntoFiles is a no-op once the link is there.
    try {
      var art = artifactIn(folder + '/' + e.name);
      if (art) linkIntoFiles(folder, folder + '/' + e.name, art);
    } catch (err) {
      /* the sheet is the job here; a missing link costs nothing */
    }
  });
  // Derived folders are only honest if they are also tidied.
  try {
    pruneThumbs(folder);
  } catch (err) {
    /* a stale thumbnail is harmless and goes on the next pass */
  }

  var body = rows.length
    ? '<ul>' + rows.join('') + '</ul>'
    : '<p class="empty">Nothing recorded yet. Drop a file into this folder.</p>';

  writeFile(
    folder + '/index.html',
    pageShell(
      // The product's own name, not just "BitGraph". This is the one page that
      // names it, since each export page is titled by its filename, and the
      // string is the browser tab too: with the site and a few proof pages
      // open, half the tabs otherwise read "BitGraph" and none of them are
      // this. Not "BitGraph Desktop Folder", which was rejected because
      // "Desktop" reads as desktop app.
      'BitGraph Folder',
      // A contact sheet, so it reflows: auto-fill with a 230px minimum gives
      // three across the 800px column, two around 520px, one on a phone, with
      // no breakpoints to maintain. A single column was fine at nine
      // recordings and unusable at several hundred.
      //
      // The thumbnail goes on top at the cell's full width rather than beside
      // the text, because at 230px a side-by-side row leaves the filename
      // about eleven characters.
      // The contact sheet ignores the 800px reading column the rest of the
      // site keeps. 800px is a measure for prose; this page is pictures, and
      // capping it wasted most of a wide display while forcing the text under
      // each one to wrap.
      '.wrap{max-width:none}' +
        // Back to 230px. It was raised to 300px to hold the full time window on
        // one line, and with the window and the side-by-side links both gone
        // nothing in the cell needs that width: the filename ellipsizes and the
        // links are stacked. The narrower minimum buys another column or two,
        // which on a contact sheet is the whole point.
        'ul{list-style:none;margin:0;padding:0;display:grid;gap:34px 24px;' +
        'grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}' +
        // Each cell is the site's card: white, 1px #d0d5dd, square corners.
        // At five or seven columns the caption needs something tying it to its
        // own thumbnail, and the page background alone was not doing it.
        'li{display:block;min-width:0;background:#fff;border:1px solid #d0d5dd}' +
        // Nothing wraps. Long filenames get an ellipsis rather than a second
        // line, so every cell is the same height and the grid stays a grid;
        // the full name is on the element's title for hovering.
        '.n,.l a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        // Overrides the shared 88px square: fills the cell, fixed aspect so
        // the grid stays even whatever shape the pictures are.
        // The thumbnail. Only this page has one, which is why these live here
        // rather than in the shared shell. Flush to the card's edges so the
        // card's border is the only one and the picture is not a framed thing
        // inside a framed thing; a bottom rule divides picture from caption.
        '.t{display:flex;align-items:center;justify-content:center;overflow:hidden;' +
        'width:100%;aspect-ratio:4/3;background:#fff;border-bottom:1px solid #d0d5dd}' +
        // No backdrop on an image. object-fit:cover means an opaque one fills
        // the box and the colour behind it never shows, so the only things it
        // ever painted were the two cases where it does harm: a PNG with
        // transparency, whose dark parts vanish into it, and an image that has
        // not loaded, which then reads as a broken black block rather than an
        // empty card. QuickLook is the second case every time, since it
        // sandboxes the page and never fetches the file beside it, which is why
        // a folder's icon in Finder was a grid of black squares. The card is
        // white and .t inherits that, so transparency now composites onto the
        // card it sits in.
        '.t img{width:100%;height:100%;object-fit:cover;display:block}' +
        // Video keeps it. It paints its first frame only once metadata loads,
        // and dark is what an unpainted frame should look like.
        '.t video{width:100%;height:100%;object-fit:cover;display:block;background:#111827}' +
        // A PDF cannot go in an <img>, but the browser's own viewer renders it
        // through <embed>, fitted to width with its controls off so it reads
        // as the document rather than as an application.
        '.t.pdf,.t.doc{position:relative;display:block}' +
        '.t.pdf embed{position:absolute;top:0;left:0;width:100%;height:100%;border:0}' +
        // Text renders at the browser's own default size, which in a 330px box
        // is two or three words. Laid out wide and scaled down instead, so the
        // cell shows the opening of the file rather than its first line
        // chopped. pointer-events off so the click reaches the link.
        '.t.doc iframe{position:absolute;top:0;left:0;width:780px;height:590px;border:0;' +
        'background:#fff;transform:scale(.42);transform-origin:top left;pointer-events:none}' +
        // Sized for the cell it now sits in. 11px was set when this box was an
        // 88px square; in a 330px card it read as a stray word floating in
        // white rather than as the label for the thing.
        '.none{color:#6b7280;font:600 17px/1 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'letter-spacing:.14em;text-decoration:none}' +
        // The scaled-down PDF trick is for an 88px box. At cell width the
        // viewer can simply fill it, fitted to width, which also adapts as the
        // column count changes.
        '.t.pdf embed{position:absolute;top:0;left:0;width:100%;height:100%;transform:none}' +
        // The caption's spacing is its own, not the proof page's 14px/16px
        // field scale. A field there is one line in a dense stack; this is
        // three lines standing alone under a picture, and at the field's
        // spacing they bunched into a single grey block. The horizontal 16px
        // stays, so a cell still lines up with a card.
        '.m{min-width:0;padding:16px 16px 18px}' +
        '.n{margin:0;font-weight:600}' +
        // The two links are the cell's actions and want daylight from the name
        // above them and from each other. line-height is set rather than
        // inherited so the gap is the gap, not the gap plus whatever the body
        // font leaves around a 13.5px line.
        '.l{margin:15px 0 0}' +
        '.l a{display:block;font-size:13.5px;line-height:1.5}' +
        '.l a+a{margin-top:9px}' +
        '.empty{color:#4b5563}',
      '<h1>BitGraph Folder</h1>' +
        '<p class="s">' + rows.length + (rows.length === 1 ? ' recording' : ' recordings') + ', newest first.' +
        updateNote() + '</p>' +
        body
    )
  );
  return rows.length;
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
  try {
    sh('find ' + quote(dir) + ' -mindepth 1 ' +
      '\\( -name ' + quote('.*') +
      ' -o -name ' + quote(FILES_DIR) +
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

  DEFER_INDEX = true;
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
        var proofs = (data.results[key] && data.results[key].proofs) || [];
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
    DEFER_INDEX = false;
  }

  // The one index pass the whole recovery gets.
  try {
    writeIndex(folder);
  } catch (e) {
    /* rebuilt on the next drop */
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

function run(argv) {
  try {
    if (argv[0] === '--index') {
      return 'ok: indexed ' + writeIndex(argv[1]);
    }
    if (argv[0] === '--json') {
      var body = readFile(argv[2]);
      if (body === null) return argv[1] === 'commit' ? 'fail' : 'error';
      return argv[1] === 'batch' ? parseBatch(body) : parseCommit(body);
    }
    if (argv[0] === '--complete') {
      return completePending(argv[1]);
    }
    if (argv[0] === '--verify') {
      return verifyFolder(argv[1]);
    }
    if (argv[0] === '--recover') {
      return recoverInto(argv[1], argv[2]);
    }
    if (argv.length < 4) {
      return 'error: usage: export.js <file> <digestB64> <counter> <epochUrlSafe> [destFolder]';
    }
    return buildExport(argv[0], argv[1], argv[2], argv[3], argv[4]);
  } catch (e) {
    return 'error: ' + (e && e.message ? e.message : String(e));
  }
}
