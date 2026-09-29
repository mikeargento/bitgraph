// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Make a writer key: node --import tsx/esm keygen.ts <path>
 * Writes the key to <path> with mode 600 and refuses to overwrite. Prints the
 * ADDRESS only. The key itself is never printed.
 */

import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = process.argv[2];
if (!path) { console.error("usage: keygen.ts <path>"); process.exit(2); }
if (existsSync(path)) { console.error(`${path} exists; refusing to overwrite a key`); process.exit(2); }
const key = generatePrivateKey();
writeFileSync(path, key + "\n", { mode: 0o600, flag: "wx" });
console.log(privateKeyToAccount(key).address);
