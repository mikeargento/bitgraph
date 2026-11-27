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
      {/* A hyphenated word in a title never splits at its hyphen. */}
      <DocsTitle>{page.data.title.replace(/-/g, "\u2011")}</DocsTitle>
      {/* Home's two sentences, the second set a little apart: on phones the first breaks before "a one-of-a-kind
          record.", which never splits. */}
      <DocsDescription className="whitespace-pre-line">
        {!slug?.length && page.data.description?.includes(" a one-of-a-kind record.")
          ? <>
              {page.data.description.split(" a one-of-a-kind record.")[0]} <br className="md:hidden" />
              <span className="whitespace-nowrap">a one-of-a-kind record.</span>
              <span className="block mt-3">{page.data.description.split(" a one-of-a-kind record.").slice(1).join("").trim()}</span>
            </>
          : page.data.description}
      </DocsDescription>
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
