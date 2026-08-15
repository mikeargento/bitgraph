// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.
// Injected by build-verify-html.mjs: bitgraph-verify and bitgraph-audit
// spell base64 and hex through Node's Buffer, so the browser bundle carries
// the `buffer` package's implementation under the same global name.
import { Buffer } from "buffer";
globalThis.Buffer = Buffer;
export { Buffer };
