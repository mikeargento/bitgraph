#!/usr/bin/env python3
"""
An independent BitGraph checker, written from spec/SPEC.md, not from the
TypeScript. It exists to show the spec is complete: a second implementation in
a second language reaches the same answers on every vector.

Requirements: Python 3.9+ and the `cryptography` package (Ed25519, ECDSA P-384,
X.509, AES-GCM). Keccak-256, RLP, Merkle-Patricia proofs, CBOR, canonical JSON,
the placements, tree/1 and secp256k1 public-key recovery are implemented here.

    python3 spec/tools/check.py            # runs every vector in spec/vectors and the legacy fixtures

Exit code 0 when every check matches its expected result.
"""

import base64
import hashlib
import json
import os
import struct
import sys
from datetime import datetime, timezone

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


# --------------------------------------------------------------------------- Keccak-256 (Ethereum's, not SHA3-256)

_RC = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
    0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
]
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_M = (1 << 64) - 1


def _rol(x, n):
    return ((x << n) | (x >> (64 - n))) & _M if n else x


def _keccak_f(a):
    for rc in _RC:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        a = [[a[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(a[x][y], _ROT[x][y])
        a = [[b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        a[0][0] ^= rc
    return a


def keccak256(data: bytes) -> bytes:
    rate = 136
    msg = bytearray(data) + b"\x01"
    while len(msg) % rate:
        msg += b"\x00"
    msg[-1] |= 0x80
    a = [[0] * 5 for _ in range(5)]
    for off in range(0, len(msg), rate):
        block = msg[off:off + rate]
        for i in range(rate // 8):
            x, y = i % 5, i // 5
            a[x][y] ^= int.from_bytes(block[i * 8:i * 8 + 8], "little")
        a = _keccak_f(a)
    out = b"".join(a[i % 5][i // 5].to_bytes(8, "little") for i in range(4))
    return out


# --------------------------------------------------------------------------- RLP

def rlp_decode(b: bytes):
    item, end = _rlp_at(b, 0)
    if end != len(b):
        raise ValueError("rlp: trailing bytes")
    return item


def _rlp_at(b, p):
    if p >= len(b):
        raise ValueError("rlp: truncated")
    t = b[p]
    if t < 0x80:
        return bytes([t]), p + 1
    if t < 0xB8:
        n = t - 0x80
        return bytes(b[p + 1:p + 1 + n]), p + 1 + n
    if t < 0xC0:
        ll = t - 0xB7
        n = int.from_bytes(b[p + 1:p + 1 + ll], "big")
        return bytes(b[p + 1 + ll:p + 1 + ll + n]), p + 1 + ll + n
    if t < 0xF8:
        n = t - 0xC0
        start, stop = p + 1, p + 1 + n
    else:
        ll = t - 0xF7
        n = int.from_bytes(b[p + 1:p + 1 + ll], "big")
        start, stop = p + 1 + ll, p + 1 + ll + n
    out, q = [], start
    while q < stop:
        it, q = _rlp_at(b, q)
        out.append(it)
    if q != stop:
        raise ValueError("rlp: list overrun")
    return out, stop


def rlp_encode(x) -> bytes:
    def length(n, off):
        if n < 56:
            return bytes([off + n])
        nb = n.to_bytes((n.bit_length() + 7) // 8, "big")
        return bytes([off + 55 + len(nb)]) + nb
    if isinstance(x, (bytes, bytearray)):
        if len(x) == 1 and x[0] < 0x80:
            return bytes(x)
        return length(len(x), 0x80) + bytes(x)
    body = b"".join(rlp_encode(i) for i in x)
    return length(len(body), 0xC0) + body


def rlp_int(b: bytes) -> int:
    return int.from_bytes(b, "big") if b else 0


# --------------------------------------------------------------------------- Merkle-Patricia inclusion proofs

def _nibbles(b):
    out = []
    for x in b:
        out += [x >> 4, x & 15]
    return out


def mpt_get(root: bytes, key: bytes, proof):
    path = _nibbles(key)
    want, depth, i = root, 0, 0
    while True:
        if len(want) == 32:
            if i >= len(proof) or keccak256(proof[i]) != want:
                return None
            node_rlp = proof[i]
            i += 1
        else:
            node_rlp = want
        node = rlp_decode(node_rlp)
        if not isinstance(node, list):
            return None
        if len(node) == 17:
            if depth == len(path):
                v = node[16]
                return v if isinstance(v, bytes) and v else None
            child = node[path[depth]]
            depth += 1
            if isinstance(child, bytes):
                if not child:
                    return None
                want = child
            else:
                want = rlp_encode(child)
            continue
        if len(node) == 2:
            enc = _nibbles(node[0])
            flag = enc[0]
            leaf = flag >= 2
            seg = enc[1:] if flag % 2 == 1 else enc[2:]
            if path[depth:depth + len(seg)] != seg:
                return None
            depth += len(seg)
            if leaf:
                return node[1] if depth == len(path) else None
            child = node[1]
            want = child if isinstance(child, bytes) else rlp_encode(child)
            continue
        return None


def tx_trie_key(index: int) -> bytes:
    return rlp_encode(b"" if index == 0 else index.to_bytes((index.bit_length() + 7) // 8, "big"))


def decode_header(h: bytes):
    f = rlp_decode(h)
    return {"hash": keccak256(h), "parentHash": f[0], "stateRoot": f[3], "transactionsRoot": f[4], "number": rlp_int(f[8]), "timestamp": rlp_int(f[11])}


# --------------------------------------------------------------------------- Canonical JSON, exactly as the reference serializer behaves

def _js_number(v):
    if isinstance(v, bool):
        raise TypeError("bool is not a number")
    if isinstance(v, int):
        return str(v)
    if v != v or v in (float("inf"), float("-inf")):
        return "null"
    if v == 0:
        return "0"
    r = repr(abs(v))
    if "e" in r:
        mant, e = r.split("e")
        exp = int(e)
    else:
        mant, exp = r, 0
    if "." in mant:
        ip, fp = mant.split(".")
    else:
        ip, fp = mant, ""
    digits = (ip + fp).lstrip("0")
    point = len(ip) + exp  # decimal point position relative to digits of ip+fp
    lead = len(ip + fp) - len((ip + fp).lstrip("0"))
    n = point - lead
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        s = digits + "0" * (n - k)
    elif 0 < n <= 21:
        s = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        s = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        s = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return ("-" if v < 0 else "") + s


def _js_string(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _is_index(k):
    return k.isdigit() and str(int(k)) == k and int(k) <= 2**32 - 2


def canonical(v) -> bytes:
    def ser(x):
        if x is None:
            return "null"
        if x is True:
            return "true"
        if x is False:
            return "false"
        if isinstance(x, (int, float)):
            return _js_number(x)
        if isinstance(x, str):
            return _js_string(x)
        if isinstance(x, list):
            return "[" + ",".join(ser(i) for i in x) + "]"
        if isinstance(x, dict):
            idx = sorted((k for k in x if _is_index(k)), key=lambda k: int(k))
            rest = sorted((k for k in x if not _is_index(k)), key=lambda k: k.encode("utf-16-be"))
            return "{" + ",".join(_js_string(k) + ":" + ser(x[k]) for k in idx + rest) + "}"
        raise TypeError(type(x))
    return ser(v).encode("utf-8")


def b64d(s: str) -> bytes:
    if not isinstance(s, str) or len(s) % 4:
        raise ValueError("base64 length")
    b = base64.b64decode(s, validate=True)
    if base64.b64encode(b).decode() != s:
        raise ValueError("non-canonical base64")
    return b


def hx(s: str) -> bytes:
    return bytes.fromhex(s[2:] if s.startswith("0x") else s)


# --------------------------------------------------------------------------- The signed proof

def signed_body(p):
    s = {
        "version": p["version"],
        "artifact": p["artifact"],
        "commit": p["commit"],
        "publicKeyB64": p["signer"]["publicKeyB64"],
        "enforcement": p["environment"]["enforcement"],
        "measurement": p["environment"]["measurement"],
    }
    if "attestation" in p["environment"]:
        s["attestationFormat"] = p["environment"]["attestation"]["format"]
    if "agency" in p:
        s["actor"] = p["agency"]["actor"]
    if "policy" in p:
        s["policy"] = p["policy"]
    if "attribution" in p:
        s["attribution"] = p["attribution"]
    return s


def proof_hash(p) -> bytes:
    h = {
        "version": p["version"], "artifact": p["artifact"], "commit": p["commit"],
        "publicKeyB64": p["signer"]["publicKeyB64"], "enforcement": p["environment"]["enforcement"],
        "measurement": p["environment"]["measurement"],
    }
    if p.get("attribution"):
        h["attribution"] = p["attribution"]
    if p["environment"].get("attestation"):
        h["attestationFormat"] = p["environment"]["attestation"]["format"]
    return sha256(canonical(h))


def slot_body(s):
    b = {"version": s["version"], "nonceB64": s["nonceB64"], "counter": s["counter"]}
    if "time" in s:
        b["time"] = s["time"]
    b["epochId"] = s["epochId"]
    b["publicKeyB64"] = s["publicKeyB64"]
    if s.get("chainId"):
        b["chainId"] = s["chainId"]
    return b


def ed25519_ok(pub: bytes, msg: bytes, sig: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(pub).verify(sig, msg)
        return True
    except (InvalidSignature, ValueError):
        return False


def check_proof(p):
    """Signature over the canonical signed body, then the eight position-record checks. Returns None or a reason."""
    if p.get("version") != "bitgraph/1" or p["artifact"].get("hashAlg") != "sha256":
        return "structure"
    if not ed25519_ok(b64d(p["signer"]["publicKeyB64"]), canonical(signed_body(p)), b64d(p["signer"]["signatureB64"])):
        return "signature"
    s, c = p.get("slotAllocation"), p["commit"]
    if s is None:
        return None
    if s.get("version") != "bitgraph/slot/1":
        return "slot structure"
    if not ed25519_ok(b64d(s["publicKeyB64"]), canonical(slot_body(s)), b64d(s["signatureB64"])):
        return "slot signature"
    if sha256(canonical(slot_body(s))) != b64d(c["slotHashB64"]):
        return "slot binding"
    if s["nonceB64"] != c["nonceB64"]:
        return "slot nonce"
    if c.get("slotCounter") != s["counter"] or not int(s["counter"]) < int(c["counter"]):
        return "slot order"
    if s["publicKeyB64"] != p["signer"]["publicKeyB64"]:
        return "slot key"
    if c.get("epochId") is not None and s["epochId"] != c["epochId"]:
        return "slot epoch"
    return None


BASE_GENESIS = 1686789347  # Base mainnet: block n is stamped BASE_GENESIS + 2n (SPEC v2 section 9)


def signed_floor(p):
    """The floor a proof signs: ("base", slotFloor) or ("ethereum", slotAnchor), or None. Both is ambiguous (SPEC v2 section 6)."""
    c = p.get("commit") or {}
    a, f = c.get("slotAnchor"), c.get("slotFloor")
    if a and f:
        raise ValueError("the proof signs two floors")
    if f:
        if f.get("chain") != "base" or f.get("evmChainId") != 8453:
            raise ValueError("slotFloor does not name Base mainnet")
        return "base", f
    if a:
        return "ethereum", a
    return None


def commitment_for(p) -> bytes:
    s = p["slotAllocation"]
    srh = sha256(canonical(slot_body(s)))
    nonce = b64d(s["nonceB64"])
    name = (p.get("attribution") or {}).get("name")
    if name in ("bitgraph-fuse/2", "bitgraph-fuse/3"):
        floor = signed_floor(p)
        want = "ethereum" if name == "bitgraph-fuse/2" else "base"
        if floor is None or floor[0] != want:
            raise ValueError(f"{name} needs a signed {want} floor")
        return sha256(name.encode() + b"\x00" + srh + nonce + hx(floor[1]["blockHash"].lower()))
    return sha256(b"bitgraph-fuse/1\x00" + srh + nonce)


def check_floor_header(p, header: bytes, chain="ethereum"):
    """SPEC v2 section 9: the header is the signed floor block; a Base floor also by its signed time and Base's schedule."""
    kind, f = signed_floor(p)
    if kind != chain:
        return False
    hd = decode_header(header)
    if "0x" + hd["hash"].hex() != f["blockHash"].lower() or hd["number"] != f["blockNumber"]:
        return False
    if kind == "base" and (hd["timestamp"] != f["blockTimestamp"] or hd["timestamp"] != BASE_GENESIS + 2 * hd["number"]):
        return False
    return True


# --------------------------------------------------------------------------- Placements

def _payload(commitment: bytes, origin: bytes) -> bytes:
    return canonical({"origin": {"algorithm": "sha256", "digest": origin.hex()}, "slotCommitment": {"algorithm": "sha256", "digest": commitment.hex()}, "type": "bitgraph-fuse/1"})


def _ustar(name: str, size: int) -> bytes:
    h = bytearray(512)
    nb = name.encode()
    h[0:len(nb)] = nb
    h[100:108] = b"0000644\x00"
    h[108:116] = b"0000000\x00"
    h[116:124] = b"0000000\x00"
    h[124:136] = ("%011o" % size).encode() + b"\x00"
    h[136:148] = b"00000000000\x00"
    h[148:156] = b"        "
    h[156] = 0x30
    h[257:263] = b"ustar\x00"
    h[263:265] = b"00"
    h[148:156] = ("%06o" % sum(h)).encode() + b"\x00 "
    return bytes(h)


def _pad(n):
    return b"\x00" * ((512 - n % 512) % 512)


def place(code: int, original: bytes, commitment: bytes) -> bytes:
    if code == 0x00:
        return original
    if code == 0x01:
        return original + b"BGFUSE01" + b"\x00" * 8 + commitment
    m = _payload(commitment, sha256(original))
    M, O = "bitgraph-fuse/manifest.json", "bitgraph-fuse/original"
    if code == 0x02:
        return _ustar(M, len(m)) + m + _pad(len(m)) + _ustar(O, len(original)) + original + _pad(len(original)) + b"\x00" * 1024
    if code == 0x03:
        return _ustar(O, len(original)) + original + _pad(len(original)) + _ustar(M, len(m)) + m + _pad(len(m)) + b"\x00" * 1024
    raise ValueError("unknown placement code")


# --------------------------------------------------------------------------- tree/1

def leaf_hash(leaf: bytes) -> bytes:
    return sha256(b"\x00" + leaf)


def node(l, r):
    return sha256(b"\x01" + l + r)


def mth(hs):
    if len(hs) == 1:
        return hs[0]
    k = 1
    while k * 2 < len(hs):
        k *= 2
    return node(mth(hs[:k]), mth(hs[k:]))


def root_from_path(leafh, index, size, path):
    if not (0 <= index < size):
        return None
    fn, sn, r = index, size - 1, leafh
    for p in path:
        if sn == 0:
            return None
        if fn % 2 == 1 or fn == sn:
            r = node(p, r)
            if fn % 2 == 0:
                while fn % 2 == 0 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = node(r, p)
        fn >>= 1
        sn >>= 1
    return r if sn == 0 else None


def parse_root_doc(b: bytes):
    if len(b) != 84 or b[:16] != b"bitgraph-tree/1\x00":
        return None
    count = struct.unpack(">I", b[16:20])[0]
    if not (1 <= count <= 1_000_000):
        return None
    return count, b[20:52], b[52:84]


def spec_hash_b64(name="SPEC.md"):
    with open(os.path.join(ROOT, "spec", name), "rb") as f:
        return base64.b64encode(sha256(f.read())).decode()


def spec_markers():
    """Each spec version requires its own marker: v1 (SPEC.md) fuse/2, v2 (SPEC-v2.md) fuse/3."""
    return {spec_hash_b64("SPEC.md"): "bitgraph-fuse/2", spec_hash_b64("SPEC-v2.md"): "bitgraph-fuse/3"}


def check_frozen():
    """spec/FROZEN.json records v1's hash; the file must still hash to it (an edit is a new version, beside v1)."""
    with open(os.path.join(ROOT, "spec", "FROZEN.json")) as f:
        frozen = json.load(f)
    return frozen["v1"]["sha256_b64"] == spec_hash_b64()


def check_tree_member(p, root_doc: bytes, ev, file_bytes):
    """Returns (category, floor_covers)."""
    a = p.get("attribution") or {}
    if a.get("title") != "tree/1":
        return "NOT_TREE", None
    if a.get("name") not in ("bitgraph-fuse/2", "bitgraph-fuse/3"):
        return "INVALID_TREE_MARKER", None
    markers = spec_markers()
    if a.get("message") not in markers:
        return "UNKNOWN_SPEC", None
    if markers[a["message"]] != a["name"]:
        return "INVALID_TREE_MARKER", None
    c = commitment_for(p)
    doc = parse_root_doc(root_doc)
    if doc is None or sha256(root_doc) != b64d(p["artifact"]["digestB64"]):
        return "INVALID_TREE_ROOT", None
    count, root, doc_c = doc
    if doc_c != c:
        return "INVALID_SLOT_COMMITMENT", None
    leaf = hx(ev["leaf"])
    if ev["count"] != count or len(leaf) != 65 or leaf[0] > 3 or (leaf[0] == 0 and leaf[1:33] != leaf[33:65]):
        return "INVALID_TREE_PATH", None
    if root_from_path(leaf_hash(leaf), ev["index"], ev["count"], [hx(x) for x in ev["path"]]) != root:
        return "INVALID_TREE_PATH", None
    code, artifact, origin = leaf[0], leaf[1:33], leaf[33:65]
    d = sha256(file_bytes)
    if code == 0 and d == artifact:
        return "TREE_MEMBER_AS_IS", "record"
    if d == origin and code != 0:
        return ("TREE_MEMBER_FROM_ORIGIN", "content") if sha256(place(code, file_bytes, c)) == artifact else ("RECONSTRUCTION_MISMATCH", None)
    if d == artifact:
        # Committed bytes in hand: strip the placement back to the original and rebuild.
        if code == 0x01:
            orig = file_bytes[:-48]
        else:
            orig = None
            for cand in _tar_entries(file_bytes):
                if cand[0] == "bitgraph-fuse/original":
                    orig = cand[1]
        if orig is not None and place(code, orig, c) == file_bytes and sha256(orig) == origin:
            return "TREE_MEMBER_DIRECT", "content"
        return "INVALID_SLOT_COMMITMENT", None
    return "NO_MATCH", None


def _tar_entries(b):
    out, off = [], 0
    while off + 512 <= len(b):
        h = b[off:off + 512]
        if h == b"\x00" * 512:
            break
        name = h[:100].split(b"\x00")[0].decode()
        size = int(h[124:135].decode(), 8)
        out.append((name, b[off + 512:off + 512 + size]))
        off += 512 + size + (512 - size % 512) % 512
    return out


# --------------------------------------------------------------------------- output-root/1

HISTORY = "0x0000f90827f1c53a10cb7a02335b175320002935"


def _tx_chain_id(raw: bytes):
    """The chain a raw transaction is signed for: field 0 of a typed one, EIP-155's v for a legacy one; None when it names none."""
    try:
        if raw[0] <= 0x7f:
            f = rlp_decode(raw[1:])
            return int.from_bytes(f[0], "big") if isinstance(f, list) and isinstance(f[0], bytes) else None
        f = rlp_decode(raw)
        if not isinstance(f, list) or len(f) != 9:
            return None
        v = int.from_bytes(f[6], "big")
        return (v - 35) // 2 if v >= 35 else None
    except Exception:
        return None


def check_output_root(s, base_chain=8453, l1_chain=1):
    o = s["outputRoot"]
    if s["version"] != "bitgraph-output-root/1" or hx(o["version"]) != b"\x00" * 32:
        return False, "format"
    if s["base"].get("chainId") != base_chain or s["ethereum"].get("chainId") != l1_chain:
        return False, "chain"
    out_root = keccak256(hx(o["version"]) + hx(o["stateRoot"]) + hx(o["messagePasserStorageRoot"]) + hx(o["blockHash"]))
    B, P = s["base"]["blockNumber"], o["blockNumber"]
    bhash = hx(s["base"]["blockHash"])
    if B == P:
        if s["history"] is not None or hx(o["blockHash"]) != bhash:
            return False, "B = P"
    else:
        if not (1 <= P - B <= 8191) or s["history"] is None:
            return False, "window"
        h = s["history"]
        if h["address"].lower() != HISTORY or hx(h["slot"]) != (B % 8191).to_bytes(32, "big"):
            return False, "history slot"
        acct = mpt_get(hx(o["stateRoot"]), keccak256(hx(HISTORY)), [hx(x) for x in h["accountProof"]])
        if acct is None:
            return False, "account proof"
        storage_root = rlp_decode(acct)[2]
        raw = mpt_get(storage_root, keccak256(hx(h["slot"])), [hx(x) for x in h["storageProof"]])
        if raw is None or rlp_decode(raw).rjust(32, b"\x00") != bhash:
            return False, "storage proof"
    e = s["ethereum"]
    hd = decode_header(hx(e["header"]))
    if hd["hash"] != hx(e["blockHash"]) or hd["number"] != e["blockNumber"] or hd["timestamp"] != e["blockTimestamp"]:
        return False, "ethereum header"
    raw_tx = hx(e["rawTx"])
    if keccak256(raw_tx) != hx(e["txHash"]):
        return False, "tx hash"
    if _tx_chain_id(raw_tx) != l1_chain:
        return False, "tx chain"
    if mpt_get(hd["transactionsRoot"], tx_trie_key(e["txIndex"]), [hx(x) for x in e["txInclusionProof"]]) != raw_tx:
        return False, "tx inclusion"
    if out_root not in raw_tx:
        return False, "claim"
    return True, "0x" + out_root.hex()


# --------------------------------------------------------------------------- secp256k1 recovery (for the ceiling writer's signature)

_P = 2**256 - 2**32 - 977
_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def _add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % _P == 0:
        return None
    if a == b:
        lam = 3 * a[0] * a[0] * pow(2 * a[1], -1, _P) % _P
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], -1, _P) % _P
    x = (lam * lam - a[0] - b[0]) % _P
    return (x, (lam * (a[0] - x) - a[1]) % _P)


def _mul(k, pt):
    r = None
    while k:
        if k & 1:
            r = _add(r, pt)
        pt = _add(pt, pt)
        k >>= 1
    return r


def recover_address(msg_hash: bytes, r: int, s: int, parity: int) -> bytes:
    x = r
    y2 = (pow(x, 3, _P) + 7) % _P
    y = pow(y2, (_P + 1) // 4, _P)
    if y % 2 != parity:
        y = _P - y
    R = (x, y)
    e = int.from_bytes(msg_hash, "big")
    rinv = pow(r, -1, _N)
    Q = _add(_mul(s * rinv % _N, R), _mul((-e * rinv) % _N, _G))
    pub = Q[0].to_bytes(32, "big") + Q[1].to_bytes(32, "big")
    return keccak256(pub)[12:]


def decode_1559(raw: bytes):
    if raw[0] != 0x02:
        raise ValueError("not an EIP-1559 transaction")
    f = rlp_decode(raw[1:])
    unsigned = b"\x02" + rlp_encode(f[:9])
    sender = recover_address(keccak256(unsigned), rlp_int(f[10]), rlp_int(f[11]), rlp_int(f[9]))
    return {"chainId": rlp_int(f[0]), "to": f[5], "data": f[7], "from": sender}


# --------------------------------------------------------------------------- bitgraph-ceiling/1

WRITER = bytes.fromhex("f3972408d853c975f86351c311f4310220bbf2a3")


def check_ceiling(p, sc):
    ph = proof_hash(p)
    if base64.b64encode(ph).decode() != sc["proofHash"]:
        return False, "record"
    root = root_from_path(leaf_hash(ph), sc["leafIndex"], sc["leafCount"], [hx(x) for x in sc["merklePath"]])
    if root is None or root != hx(sc["root"]):
        return False, "merkle"
    a = sc["anchor"]
    payload = hx(a["payload"])
    if len(payload) != 84 or payload[:4] != b"BGC1" or payload[4:36] != root:
        return False, "payload"
    tx = decode_1559(hx(a["rawTx"]))
    if tx["from"] != WRITER or tx["to"] != WRITER or tx["chainId"] != 8453 or tx["data"] != payload:
        return False, "sender"
    hd = decode_header(hx(a["blockHeader"]))
    if hd["hash"] != hx(a["blockHash"]) or hd["number"] != a["blockNumber"] or hd["timestamp"] != a["blockTimestamp"]:
        return False, "header"
    if mpt_get(hd["transactionsRoot"], tx_trie_key(a["txIndex"]), [hx(x) for x in a["txInclusionProof"]]) != hx(a["rawTx"]):
        return False, "inclusion"
    return True, {"blockNumber": hd["number"], "timestamp": hd["timestamp"]}


# --------------------------------------------------------------------------- AWS Nitro attestation (COSE_Sign1 over CBOR)

AWS_ROOT_SHA256 = "641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b"
AWS_ROOT_PEM = None  # read from the verify package's published constant below and checked against AWS_ROOT_SHA256


def _cbor(b, p=0):
    ib = b[p]
    mt, ai = ib >> 5, ib & 31
    p += 1
    if ai < 24:
        val = ai
    elif ai in (24, 25, 26, 27):
        n = 1 << (ai - 24)
        val = int.from_bytes(b[p:p + n], "big")
        p += n
    elif ai == 31:
        val = None
    else:
        raise ValueError("cbor: bad additional info")
    if mt == 0:
        return val, p
    if mt == 1:
        return -1 - val, p
    if mt in (2, 3):
        if val is None:
            chunks = []
            while b[p] != 0xFF:
                c, p = _cbor(b, p)
                chunks.append(c)
            p += 1
            data = b"".join(c if isinstance(c, bytes) else c.encode() for c in chunks)
        else:
            data = bytes(b[p:p + val])
            p += val
        return (data if mt == 2 else data.decode()), p
    if mt == 4:
        out = []
        if val is None:
            while b[p] != 0xFF:
                it, p = _cbor(b, p)
                out.append(it)
            p += 1
        else:
            for _ in range(val):
                it, p = _cbor(b, p)
                out.append(it)
        return out, p
    if mt == 5:
        out = {}
        if val is None:
            while b[p] != 0xFF:
                k, p = _cbor(b, p)
                v, p = _cbor(b, p)
                out[k] = v
            p += 1
        else:
            for _ in range(val):
                k, p = _cbor(b, p)
                v, p = _cbor(b, p)
                out[k] = v
        return out, p
    if mt == 6:
        return _cbor(b, p)
    if mt == 7:
        return {20: False, 21: True, 22: None}.get(ai, None), p
    raise ValueError("cbor")


def _cbor_head(mt, n):
    if n < 24:
        return bytes([mt << 5 | n])
    for ai, size in ((24, 1), (25, 2), (26, 4), (27, 8)):
        if n < 1 << (8 * size):
            return bytes([mt << 5 | ai]) + n.to_bytes(size, "big")
    raise ValueError("cbor length")


def check_attestation(p):
    """Returns a list of (check, ok)."""
    global AWS_ROOT_PEM
    if AWS_ROOT_PEM is None:
        src = open(os.path.join(ROOT, "packages", "verify", "src", "nitro.ts")).read()
        start = src.index("-----BEGIN CERTIFICATE-----")
        end = src.index("-----END CERTIFICATE-----") + len("-----END CERTIFICATE-----")
        AWS_ROOT_PEM = "\n".join(line.strip() for line in src[start:end].splitlines())
    root = x509.load_pem_x509_certificate(AWS_ROOT_PEM.encode())
    from cryptography.hazmat.primitives.serialization import Encoding
    if hashlib.sha256(root.public_bytes(Encoding.DER)).hexdigest() != AWS_ROOT_SHA256:
        return [("root constant", False)]
    raw = base64.b64decode(p["environment"]["attestation"]["reportB64"])
    cose, _ = _cbor(raw)
    protected, payload, sig = cose[0], cose[2], cose[3]
    doc, _ = _cbor(payload)
    sig_structure = _cbor_head(4, 4) + _cbor_head(3, 10) + b"Signature1" + _cbor_head(2, len(protected)) + protected + _cbor_head(2, 0) + _cbor_head(2, len(payload)) + payload
    leaf = x509.load_der_x509_certificate(doc["certificate"])
    res = []
    try:
        r, s = int.from_bytes(sig[:48], "big"), int.from_bytes(sig[48:], "big")
        leaf.public_key().verify(utils.encode_dss_signature(r, s), sig_structure, ec.ECDSA(hashes.SHA384()))
        res.append(("aws signature", True))
    except InvalidSignature:
        res.append(("aws signature", False))
    chain = [x509.load_der_x509_certificate(c) for c in doc["cabundle"]] + [leaf]
    ok = True
    issuer = root
    for cert in chain:
        try:
            issuer.public_key().verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
        except InvalidSignature:
            ok = False
        issuer = cert
    res.append(("chain to the AWS root", ok))
    t = datetime.fromtimestamp(doc["timestamp"] / 1000, tz=timezone.utc)
    res.append(("validity at the document's instant", all(c.not_valid_before_utc <= t <= c.not_valid_after_utc for c in chain)))
    res.append(("pcr0", doc["pcrs"][0].hex() == p["environment"]["measurement"].lower()))
    res.append(("user_data binding", doc.get("user_data") == sha256(canonical(signed_body(p)))))
    return res


# --------------------------------------------------------------------------- Run every vector

FAILS = []


def expect(label, got, want):
    ok = got == want
    print(("ok    " if ok else "FAIL  ") + label + ("" if ok else f"   got {got!r}, want {want!r}"))
    if not ok:
        FAILS.append(label)


def main():
    vec = lambda n: json.load(open(os.path.join(ROOT, "spec", "vectors", n)))

    # The frozen version: spec/FROZEN.json names v1's hash and the file still hashes to it.
    expect("spec: v1 is frozen (spec/FROZEN.json) and SPEC.md still hashes to it", check_frozen(), True)

    # Canonical JSON quirks the spec pins down.
    expect("canonical: integer-like keys first, numerically", canonical({"10": 0, "2": 0, "b": 0, "a": 0}), b'{"2":0,"10":0,"a":0,"b":0}')
    expect("canonical: UTF-16 code-unit order", canonical({"�": 0, "\U0001F600": 0}), '{"\U0001F600":0,"�":0}'.encode())
    expect("canonical: escapes", canonical({"s": "q\"b\\n\nl c\u0007eé"}), bytes.fromhex("7b2273223a22715c22625c5c6e5c6e6ce280a8635c753030303765c3a9227d"))
    expect("canonical: numbers", [_js_number(x) for x in (1, 1.0, 0.1, 1e21, -0.0, 1e-7, 123456789012345680000.0)], ["1", "1", "0.1", "1e+21", "0", "1e-7", "123456789012345680000"])
    expect("keccak256('')", keccak256(b"").hex(), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")

    # tree/1
    t = vec("tree-1.json")
    slot = t["slot"]["record"]
    expect("tree: slot body bytes", canonical(slot_body(slot)).hex(), t["slot"]["canonicalBodyHex"])
    srh = sha256(canonical(slot_body(slot)))
    c2 = sha256(b"bitgraph-fuse/2\x00" + srh + b64d(slot["nonceB64"]) + hx(t["floor"]["blockHash"]))
    expect("tree: commitment/2", c2.hex(), t["commitment"]["hex"])
    expect("tree: floor header hashes to the floor block", "0x" + keccak256(hx(t["floor"]["headerHex"])).hex(), t["floor"]["blockHash"])
    leaves = []
    for f in t["files"]:
        orig = hx(f["originalHex"])
        committed = place(f["placementCode"], orig, c2)
        expect(f"tree: {f['name']} committed bytes", committed.hex(), f["committedHex"])
        artifact = sha256(orig) if f["placementCode"] == 0 else sha256(committed)
        leaf = bytes([f["placementCode"]]) + artifact + sha256(orig)
        expect(f"tree: {f['name']} leaf", leaf.hex(), f["leafHex"])
        leaves.append(leaf)
    leaves.sort(key=lambda l: l[1:33])
    expect("tree: sorted leaves", [l.hex() for l in leaves], t["tree"]["sortedLeavesHex"])
    root = mth([leaf_hash(l) for l in leaves])
    expect("tree: root", root.hex(), t["tree"]["rootHex"])
    doc = b"bitgraph-tree/1\x00" + struct.pack(">I", len(leaves)) + root + c2
    expect("tree: root document", doc.hex(), t["tree"]["rootDocumentHex"])
    expect("tree: artifact digest", base64.b64encode(sha256(doc)).decode(), t["tree"]["artifactDigestB64"])
    for f in t["files"]:
        ev = f["evidence"]
        expect(f"tree: {f['name']} path reaches the root", root_from_path(leaf_hash(hx(ev["leaf"])), ev["index"], ev["count"], [hx(x) for x in ev["path"]]), root)

    # export/1 (test key)
    e = vec("export-1.json")
    me = e["memberExport"]
    p = me["proof"]
    expect("export: signed body bytes", canonical(signed_body(p)).hex(), e["signedBodyCanonicalHex"])
    expect("export: proofHash", base64.b64encode(proof_hash(p)).decode(), e["proofHashB64"])
    expect("export: proof and position record", check_proof(p), None)
    file_bytes = hx(e["memberFileHex"])
    expect("export: member from its original", check_tree_member(p, hx(me["tree"]["rootDocument"]), me["tree"]["member"], file_bytes), ("TREE_MEMBER_FROM_ORIGIN", "content"))
    hd = decode_header(hx(me["floor"]["header"]))
    expect("export: floor header is the signed floor block", ("0x" + hd["hash"].hex(), hd["number"]), (p["commit"]["slotAnchor"]["blockHash"], p["commit"]["slotAnchor"]["blockNumber"]))
    tampered = bytearray(file_bytes + b"x")
    expect("export: a different file is not the member", check_tree_member(p, hx(me["tree"]["rootDocument"]), me["tree"]["member"], bytes(tampered))[0], "NO_MATCH")
    bad_ev = dict(me["tree"]["member"], index=(me["tree"]["member"]["index"] + 1) % me["tree"]["member"]["count"])
    expect("export: a wrong index fails the path", check_tree_member(p, hx(me["tree"]["rootDocument"]), bad_ev, file_bytes)[0], "INVALID_TREE_PATH")
    forged = dict(p, attribution=dict(p["attribution"], message=base64.b64encode(b"\x00" * 32).decode()))
    expect("export: a changed spec pin breaks the signature", check_proof(forged), "signature")
    # Every file through the owner's list.
    ow = e["ownerExport"]
    owner_leaves = base64.b64decode(ow["tree"]["leaves"])
    ls = [owner_leaves[i:i + 65] for i in range(0, len(owner_leaves), 65)]
    expect("export: owner's list is sorted, unique, and rebuilds the root", (all(ls[i][1:33] < ls[i + 1][1:33] for i in range(len(ls) - 1)), mth([leaf_hash(l) for l in ls]).hex()), (True, t["tree"]["rootHex"]))
    for f in t["files"]:
        k = next(i for i, l in enumerate(ls) if l[33:65] == bytes.fromhex(f["originSha256"]) and l[1:33] == bytes.fromhex(f["committedSha256"] if f["placementCode"] else f["originSha256"]))
        want = "TREE_MEMBER_AS_IS" if f["placementCode"] == 0 else "TREE_MEMBER_FROM_ORIGIN"
        expect(f"export: {f['name']} via the owner's list", check_tree_member(p, hx(ow["tree"]["rootDocument"]), f["evidence"], hx(f["originalHex"]))[0], want)
        expect(f"export: {f['name']} committed bytes", check_tree_member(p, hx(ow["tree"]["rootDocument"]), f["evidence"], hx(f["committedHex"]))[0], "TREE_MEMBER_AS_IS" if f["placementCode"] == 0 else "TREE_MEMBER_DIRECT")

    # tree/1 negative cases: containers that name one original and hold another
    ng = vec("tree-1-negative.json")
    np_ = ng["proof"]
    expect("negative: the tree's proof verifies", check_proof(np_), None)
    for c in ng["cases"]:
        got = check_tree_member(np_, hx(ng["rootDocumentHex"]), c["evidence"], hx(c["bytesHex"]))[0]
        expect(f"negative: {c['placement']}, {c['file']}", got, c["expect"])

    # output-root/1 (live chains)
    o = vec("output-root-1.json")
    ok, out = check_output_root(o["settlement"])
    expect("output-root: live settlement verifies", (ok, out), (True, o["expected"]["outputRoot"]))
    ct = o["ceilingTx"]
    hb = decode_header(hx(ct["header"]))
    expect("output-root: ceiling tx is in Base block B", mpt_get(hb["transactionsRoot"], tx_trie_key(ct["txIndex"]), [hx(x) for x in ct["txInclusionProof"]]) == hx(ct["rawTx"]), True)
    tx = decode_1559(hx(ct["rawTx"]))
    expect("output-root: ceiling tx signed by the writer (secp256k1 recovery)", tx["from"].hex(), WRITER.hex())
    expect("output-root: payload root", "0x" + tx["data"][4:36].hex(), ct["payloadRoot"])
    for label, mut in [
        ("state root", lambda s: s["outputRoot"].update(stateRoot="0x" + "00" * 32)),
        ("B's hash", lambda s: s["base"].update(blockHash="0x" + "11" * 32)),
        ("P - B = 8192", lambda s: s["base"].update(blockNumber=s["outputRoot"]["blockNumber"] - 8192)),
        ("claim tx", lambda s: s["ethereum"].update(rawTx=s["ethereum"]["rawTx"][:-4] + "0000")),
        ("the Base chain label", lambda s: s["base"].update(chainId=999999)),
        ("the Ethereum chain label", lambda s: s["ethereum"].update(chainId=999999)),
    ]:
        s = json.loads(json.dumps(o["settlement"]))
        mut(s)
        expect(f"output-root: changing {label} fails", check_output_root(s)[0], False)
    s = json.loads(json.dumps(o["settlement"]))
    s["base"] = {"chainId": 8453, "blockNumber": s["outputRoot"]["blockNumber"], "blockHash": s["outputRoot"]["blockHash"]}
    s["history"] = None
    expect("output-root: B = P passes without a history proof", check_output_root(s)[0], True)
    expect("output-root: the claim transaction is signed for Ethereum (chain 1)", _tx_chain_id(hx(o["settlement"]["ethereum"]["rawTx"])), 1)

    # Legacy: the production proof #4,546 with its real attestation and Base ceiling.
    fx = os.path.join(ROOT, "packages", "verify", "src", "__tests__", "fixtures", "carrier2")
    p = json.load(open(os.path.join(fx, "demo4546.proof.json")))
    expect("legacy #4546: proof and position record", check_proof(p), None)
    for name, ok in check_attestation(p):
        expect(f"legacy #4546: attestation {name}", ok, True)
    ok, at = check_ceiling(p, json.load(open(os.path.join(fx, "demo4546.ceiling.json"))))
    expect("legacy #4546: Base ceiling (record, payload, writer signature, inclusion, header)", ok, True)
    artifact = open(os.path.join(fx, "demo4546.txt"), "rb").read()
    expect("legacy #4546: the file is the committed artifact", base64.b64encode(sha256(artifact)).decode(), p["artifact"]["digestB64"])
    expect("legacy #4546: it is carried inline as base64url", p["attribution"]["title"], "base64url")
    needle = base64.urlsafe_b64encode(commitment_for(p)).decode().rstrip("=").encode()
    expect("legacy #4546: the text carries commitment/2 (floor-bound) in base64url", needle in artifact, True)

    # SPEC v2: the Base floor and commitment/3, from proofs the enclave v10 code signed.
    f3 = os.path.join(ROOT, "src", "__tests__", "fuse3-fixtures")
    v3 = json.load(open(os.path.join(f3, "trailer3.vector.json")))
    srh3 = sha256(canonical(slot_body(v3["slot"])))
    pre3 = b"bitgraph-fuse/3\x00" + srh3 + b64d(v3["slot"]["nonceB64"]) + hx(v3["floorBlockHash"])
    expect("v2: commitment/3 preimage", pre3.hex(), v3["preimageHex"])
    expect("v2: commitment/3", sha256(pre3).hex(), v3["commitmentHex"])
    expect("v2: commitment/3 differs from commitment/2 over the same block", sha256(pre3).hex() != v3["fuse2CommitmentHex"], True)
    synth = json.load(open(os.path.join(ROOT, "src", "__tests__", "fuse-fixtures", "vectors.json")))["synthetic"]["slot"]
    expect("v2: commitment/3 vector with floor 0x22*32", sha256(b"bitgraph-fuse/3\x00" + sha256(canonical(slot_body(synth))) + b64d(synth["nonceB64"]) + b"\x22" * 32).hex(), "8e44c4eae6be9cfd184209bb763081326182979970d24af8c0e3305886038dbd")
    p3 = json.load(open(os.path.join(f3, "trailer3.proof.json")))
    expect("v2: a Base-floored proof and its position record", check_proof(p3), None)
    expect("v2: the proof signs one floor, a Base block", signed_floor(p3)[0], "base")
    expect("v2: the trailer file carries commitment/3", open(os.path.join(f3, "fused3-trailer.bin"), "rb").read()[-32:] == commitment_for(p3) or commitment_for(p3) in open(os.path.join(f3, "fused3-trailer.bin"), "rb").read(), True)
    hdr = hx(open(os.path.join(f3, "floor-base-52271417.rlp.hex")).read().strip())
    expect("v2: the floor header is the signed Base block (hash, number, time, schedule)", check_floor_header(p3, hdr, "base"), True)
    expect("v2: the same header given as an Ethereum block fails", check_floor_header(p3, hdr, "ethereum"), False)
    both = json.loads(json.dumps(p3))
    both["commit"]["slotAnchor"] = {"counter": "1", "blockNumber": 1, "blockHash": "0x" + "22" * 32}
    try:
        commitment_for(both)
        amb = "computed"
    except ValueError:
        amb = "refused"
    expect("v2: a proof signing both floors is ambiguous", amb, "refused")
    off = json.loads(json.dumps(p3))
    off["commit"]["slotFloor"]["blockTimestamp"] += 1
    expect("v2: a signed time off Base's schedule fails the header check", check_floor_header(off, hdr, "base"), False)
    as2 = json.load(open(os.path.join(f3, "as-fuse2.proof.json")))
    try:
        commitment_for(as2)
        m2 = "computed"
    except ValueError:
        m2 = "refused"
    expect("v2: a fuse/2 marker over a Base floor is refused", m2, "refused")

    print()
    print(f"{'FAILED' if FAILS else 'All checks match'}: {len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
