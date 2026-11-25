import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { MechanismFigure } from "@/components/mechanism-figure";
import { CopiesTiles, HarborRow, RecordTiles } from "@/components/demo-row";

/** The components a page in content/docs can use: Fumadocs' own, and the site's figures and tiles. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, MechanismFigure, CopiesTiles, HarborRow, RecordTiles, ...components };
}
