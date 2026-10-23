/*
 * Turbopack/webpack loader: minifies CSS inside JSX <style>{`...`}</style>
 * template-literal blocks at build time.
 *
 * The source files keep their commented CSS (the comments are the design
 * documentation); this loader strips comments and collapses whitespace from
 * the string BEFORE it reaches the bundler, so neither the prerendered HTML
 * nor the client JS chunks carry them. Blocks containing `${` interpolations
 * are left untouched.
 *
 * The minifier is deliberately conservative, so the emitted CSS is
 * semantically identical to the source:
 *  - quoted strings are copied verbatim
 *  - comments become a single space (a comment is a token separator)
 *  - whitespace runs collapse to one space
 *  - the space is dropped only next to `{` `}` `;` `,` — never around `:`,
 *    because `.a :not(x)` and `.a:not(x)` are different selectors
 */

function minifyCss(css) {
  let out = "";
  let pendingSpace = false;
  const dropAround = new Set(["{", "}", ";", ","]);
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      if (pendingSpace) {
        out += " ";
        pendingSpace = false;
      }
      const quote = ch;
      out += ch;
      i++;
      while (i < css.length) {
        out += css[i];
        if (css[i] === "\\" && i + 1 < css.length) {
          out += css[i + 1];
          i += 2;
          continue;
        }
        if (css[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i += 2;
      pendingSpace = true;
      continue;
    }
    if (/\s/.test(ch)) {
      while (i < css.length && /\s/.test(css[i])) i++;
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      const prev = out[out.length - 1];
      if (!dropAround.has(prev) && !dropAround.has(ch) && out.length > 0) {
        out += " ";
      }
      pendingSpace = false;
    }
    out += ch;
    i++;
  }
  return out;
}

const STYLE_BLOCK = /(<style(?:\s[^>]*)?>\{`)([\s\S]*?)(`\}<\/style>)/g;

module.exports = function minifyStyleBlocks(source) {
  if (typeof source !== "string" || !source.includes("<style")) return source;
  return source.replace(STYLE_BLOCK, (match, open, css, close) => {
    if (css.includes("${") || css.includes("\\")) return match;
    return open + minifyCss(css) + close;
  });
};

module.exports.minifyCss = minifyCss;
