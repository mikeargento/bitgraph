import type { Metadata } from "next";

// The folder page is a client component, so its tab title lives here.
export const metadata: Metadata = { title: "Your BitGraph Folder" };

export default function FolderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
