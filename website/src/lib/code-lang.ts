/** The label a code block carries in its corner: what kind of text it is, guessed from how it starts. */
export function codeLang(src: string): string {
  const s = src.trimStart();
  if (/^(curl|npm|npx|node|git|bitgraph|cd|export|#!)\b/.test(s)) return "Shell";
  if (/^(import|const|let|await|function|type|interface)\b/.test(s)) return "TypeScript";
  if (/^[\[{]/.test(s)) return "JSON";
  return "Text";
}
