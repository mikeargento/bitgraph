// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Loading what marking and reading need, once per page and only when first needed: ONNX Runtime Web (pinned, from
 * its CDN build), Adobe's BCH library and each model (public/trustmark), each model checked against its SHA-256
 * (models.ts). TrustMark's reader is fetched only when a copy has no Pixel Seal pointer.
 */

import { MODELS, type ModelName } from "./models.ts";
import type { Bch, Ort, OrtSession } from "./tm.ts";

const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

const scripts = new Map<string, Promise<void>>();
function script(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((ok, fail) => {
      const el = document.createElement("script");
      el.src = src; el.async = true;
      el.onload = () => ok();
      el.onerror = () => { scripts.delete(src); fail(new Error(`could not load ${src}`)); };
      document.head.appendChild(el);
    });
    scripts.set(src, p);
  }
  return p;
}

type Globals = { ort?: Ort; BCH?: Bch["BCH"]; BCH_Encode?: Bch["BCH_Encode"]; BCH_Decode?: Bch["BCH_Decode"] };

async function libraries(): Promise<{ ort: Ort; bch: Bch }> {
  await Promise.all([script(`${ORT_BASE}ort.min.js`), script("/trustmark/bch_ecc.min.js")]);
  const g = globalThis as unknown as Globals;
  if (!g.ort || !g.BCH || !g.BCH_Encode || !g.BCH_Decode) throw new Error("the pointer's reader did not load");
  g.ort.env.wasm.wasmPaths = ORT_BASE;
  return { ort: g.ort, bch: { BCH: g.BCH, BCH_Encode: g.BCH_Encode, BCH_Decode: g.BCH_Decode } };
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function modelBytes(m: ModelName): Promise<Uint8Array> {
  const res = await fetch(MODELS[m].url);
  if (!res.ok) throw new Error(`the pointer's ${m === "embedder" ? "writer" : "reader"} could not be fetched (${res.status})`);
  const out = new Uint8Array(await res.arrayBuffer());
  const got = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", out as BufferSource)));
  if (got !== MODELS[m].sha256) throw new Error(`the pointer's ${m === "embedder" ? "writer" : "reader"} did not match its published hash`);
  return out;
}

const sessions = new Map<ModelName, Promise<OrtSession>>();
function session(m: ModelName, ort: Ort): Promise<OrtSession> {
  let s = sessions.get(m);
  if (!s) {
    s = modelBytes(m).then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] }));
    s.catch(() => sessions.delete(m));
    sessions.set(m, s);
  }
  return s;
}

export async function markRuntime() {
  const { ort, bch } = await libraries();
  return { ort, bch, embedder: await session("embedder", ort) };
}
export async function readRuntime() {
  const { ort, bch } = await libraries();
  return { ort, bch, extractor: await session("extractor", ort) };
}
/** TrustMark's reader, for copies marked before Pixel Seal. */
export async function legacyReadRuntime() {
  const { ort, bch } = await libraries();
  return { ort, bch, decoder: await session("decoder", ort) };
}
