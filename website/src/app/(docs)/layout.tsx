import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";

/** Every page of the site stands in this frame: the sidebar of every page at the left, search, and the page. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{ title: <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>BitGraph</span>, url: "/" }}
      githubUrl="https://github.com/mikeargento/bitgraph"
    >
      {children}
    </DocsLayout>
  );
}
