import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/components/mdx";
import { ShortLink } from "@/components/short-link";
import { OldAnchors } from "@/components/old-anchors";
import { SiteFoot } from "@/components/site-foot";

/**
 * A page of the site from content/docs. A one-segment address that is not a page is a short link
 * (bitgraph.ing/<the first characters of a record's digest>), which opens that record or says it was not found.
 */
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) {
    if (slug?.length === 1) return <ShortLink code={slug[0]!} bare />;
    notFound();
  }
  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full} tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }}>
      {!slug?.length && <OldAnchors />}
      {/* Home's headline breaks before "for the artificial era." on phones; one line from the md width up. */}
      <DocsTitle>
        {!slug?.length && page.data.title.includes(" for ")
          ? <>{page.data.title.split(" for ")[0]} <br className="md:hidden" />for {page.data.title.split(" for ").slice(1).join(" for ")}</>
          : page.data.title}
      </DocsTitle>
      <DocsDescription className="whitespace-pre-line">{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      <SiteFoot />
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) return { title: "Not found", robots: { index: false } };
  if (!slug?.length) return { title: { absolute: "BitGraph" }, description: page.data.description };
  return { title: page.data.title, description: page.data.description };
}
