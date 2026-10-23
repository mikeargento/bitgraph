import type { ReactNode } from "react";
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * A highlighted code listing, for the inside of a `.code-block` (Mike,
 * 2026-09-17, of GitHub's syntax colouring: "do it").
 *
 * A server component: Shiki tokenises at build time for the static pages, so
 * what ships is plain spans and no client script. The theme is Shiki's
 * CSS-variables theme, so every colour is a `--syn-*` token in globals.css
 * like the rest of the site's colours, and nothing here names a colour.
 * The JavaScript regex engine keeps WebAssembly out of the build, and only
 * the six grammars the site uses are loaded.
 *
 * `pre.textContent` is still exactly the source, which is what the copy
 * control in the block's header reads.
 */
export type CodeLang = "bash" | "typescript" | "json" | "jsonc" | "http" | "yaml" | "text";

const theme = createCssVariablesTheme({ name: "bitgraph", variablePrefix: "--syn-", fontStyle: true });

let core: Promise<HighlighterCore> | null = null;
function highlighter(): Promise<HighlighterCore> {
  return (core ??= createHighlighterCore({
    themes: [theme],
    langs: [
      import("shiki/langs/bash.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/jsonc.mjs"),
      import("shiki/langs/http.mjs"),
      import("shiki/langs/yaml.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  }));
}

/** For a block whose language is only known from its label and its text. */
export function guessLang(label: string, code: string): CodeLang {
  const head = code.trimStart();
  if (/shell|curl|cli/i.test(label) || /^(curl|npx|npm|git|node|sudo|#)\b/.test(head)) return "bash";
  if (/^(GET|POST|PUT|DELETE|PATCH|HEAD)\s+\S+/.test(head)) return "http";
  if (head.startsWith("{") || head.startsWith("[")) return /^\s*\/\/|[^:"]\/\/ /m.test(code) ? "jsonc" : "json";
  if (/typescript/i.test(label)) return "typescript";
  return "text";
}

const FOREGROUND = "var(--syn-foreground)";

export async function Code({ lang = "text", children }: { lang?: CodeLang; children: string }) {
  if (lang === "text") return <pre>{children}</pre>;
  const h = await highlighter();
  const { tokens } = h.codeToTokens(children, { lang, theme: "bitgraph" });
  const lines: ReactNode[] = tokens.map((line, i) => (
    <span key={i}>
      {line.map((t, j) => {
        const italic = ((t.fontStyle ?? 0) & 1) === 1;
        const bold = ((t.fontStyle ?? 0) & 2) === 2;
        if ((!t.color || t.color === FOREGROUND) && !italic && !bold) return t.content;
        return (
          <span key={j} style={{ color: t.color, fontStyle: italic ? "italic" : undefined, fontWeight: bold ? 700 : undefined }}>
            {t.content}
          </span>
        );
      })}
      {i < tokens.length - 1 ? "\n" : null}
    </span>
  ));
  return <pre data-lang={lang}>{lines}</pre>;
}
