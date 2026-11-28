import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { MechanismFigure } from "@/components/mechanism-figure";
import { CopiesTiles, HarborRow, RecordTiles } from "@/components/demo-row";

/** The technology a use case sits beside, as a small label over its heading. Styles: .tech in app/site.css. */
function Tech({ children }: { children: React.ReactNode }) {
  return <div className="tech not-prose">{children}</div>;
}

/** Three cards side by side, stacked on a narrow page. Styles: .pillars in app/site.css. */
function Pillars({ children }: { children: React.ReactNode }) {
  return <div className="pillars">{children}</div>;
}

/** The components a page in content/docs can use: Fumadocs' own, and the site's figures and tiles. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, MechanismFigure, CopiesTiles, HarborRow, RecordTiles, Tech, Pillars, ...components };
}
