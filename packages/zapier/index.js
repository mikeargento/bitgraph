// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Lambda entry point. This file must exist, at this exact path and name, or
 * the deployed integration cannot start at all.
 *
 * The generated zapierwrapper.js hardcodes its target and ignores package.json
 * `main` completely:
 *
 *   const appPath = path.resolve(__dirname, 'index.js');
 *
 * so the runtime always requires /var/task/index.js. Without this file the
 * deployed app fails on every call with
 * "Cannot find module '/var/task/index.js'", which surfaces in the Zap editor
 * as "authentication failed" and looks like a credentials problem rather than
 * a packaging one.
 *
 * It also fixes what goes INTO the build. `zapier push` does not zip the
 * working directory; it traces requires with esbuild starting from
 * zapierwrapper.js, and the wrapper's require is computed from a variable that
 * esbuild cannot follow. The CLI compensates by adding a root index.js as a
 * second entry point, but only when one exists. With no root index.js nothing
 * downstream was reachable, and the uploaded zip contained only
 * definition.json, package.json, zapierwrapper.js and node_modules — no dist/
 * at all. The literal require below is statically analysable, so it pulls the
 * whole compiled tree in.
 *
 * definition.json is uploaded separately and is only data, which is why the
 * connection dialog rendered its fields and help text correctly while the
 * executable app was missing entirely. A correct-looking dialog is not
 * evidence that the integration was deployed.
 *
 * The unwrap is required because src/index.ts uses `export default`, which
 * TypeScript emits as `exports.default`. Zapier expects the app object itself,
 * not a module namespace wrapping it. The fallback keeps this working if the
 * export style ever changes.
 */

const app = require('./dist/src/index.js');

module.exports = app && app.default ? app.default : app;
