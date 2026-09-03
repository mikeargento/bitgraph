import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BitGraph Folder is retired",
  description:
    "BitGraph Folder was a beta macOS recorder, retired on 2026-09-01. Uninstall it. Your recordings are unaffected and still verify offline.",
  robots: { index: false, follow: false },
};

/* ── Why this route still exists ────────────────────────────────────────────
   Folder was removed from the repo on 2026-09-01 and every release was
   delisted. This page is NOT a leftover: it is the URL the retirement has to
   land on.

   Every copy of verify.html ever shipped carries
   href="https://bitgraph.ing/docs/folder" behind a "Check for updates" link,
   baked into a static page on somebody's disk that we cannot reach or rewrite.
   Anyone still running Folder who goes looking arrives HERE. A 404 would meet
   them with nothing, which is the one thing this page exists to prevent.

   Noindexed, out of the nav, and out of docs-sections: findable by the people
   holding the link, invisible to everyone else. Delete it when the installed
   base is gone, not before. ── */

const NOTICE = "https://github.com/mikeargento/bitgraph/blob/main/docs/FOLDER-RETIRED.md";

const UNINSTALL = `launchctl bootout "gui/$UID/com.bitgraph.hotfolder"
rm -f "$HOME/Library/LaunchAgents/com.bitgraph.hotfolder.plist"
rm -f "$HOME/.bitgraph/hotfolder.sh" "$HOME/.bitgraph/export.js" \\
      "$HOME/.bitgraph/config" "$HOME/.bitgraph/hotfolder.err"
rm -f "$HOME/Desktop/BitGraph"`;

export default function FolderRetiredPage() {
  return (
    <div className="prose-doc">
      <h1 className="mb-2">BitGraph Folder is retired</h1>
      <p style={{ color: "#1f2937", fontSize: 18, margin: "0 0 24px" }}>
        Retired 1 September 2026
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        <strong>Folder was a beta. It is no longer developed or distributed, and it should be uninstalled.</strong>
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        It proved the shape of the idea: hash locally, send only the digest, keep the proof beside the file. It was never the shape of the product. A recorder belongs inside the workflows people already have, not in a folder they have to remember to use. That is what replaces it.
      </p>

      <h2>Uninstall it</h2>
      <p>
        Every release has been delisted, so <code>uninstall.sh</code> is no longer downloadable. These commands are exactly what it did. They do not touch your recordings.
      </p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{UNINSTALL}</pre>
      </div>
      <p>
        The last line removes a symlink, not a folder. If <code>~/Desktop/BitGraph</code> is a real directory on your machine rather than a link, leave it alone.
      </p>

      <h2>Your recordings are unaffected</h2>
      <p>
        Nothing about retiring the tool touches what it recorded. Positions on the ledger are permanent and public, and each export is self-contained: <code>proof.json</code>, the file itself, and the Ethereum anchors that bracket its position. They verify with no network, no account, and no BitGraph software running anywhere.
      </p>
      <p>Three ways to check them, none of which need Folder:</p>
      <ul>
        <li>
          <a href="/verify.html" className="text-[#0065A4] font-medium no-underline">verify.html</a> is the offline verifier that used to ship inside the installer. Save it and open it from disk. It makes no network request of any kind.
        </li>
        <li>
          <code>npx @mikeargento/bitgraph-audit &lt;folder&gt;</code> audits a whole archive. It finds proofs by schema shape rather than by filename, so the layout does not matter.
        </li>
        <li>
          Drag your <code>Recordings</code> folder onto <a href="/" className="text-[#0065A4] font-medium no-underline">bitgraph.ing</a> to read it as a day, every row checked against the public ledger. Dragging a single day folder scopes it, which is much faster on a large archive.
        </li>
      </ul>
      <p>
        A <code>verify.html</code> that predates this change still works. It carries its own copy of the code and always did.
      </p>

      <h2>Why the installers were withdrawn</h2>
      <p>
        The shipped notification code built an AppleScript string by interpolating values into its source. A filename containing a double quote, or an API response carrying one, could execute code as the logged-in user when a drop was announced. It was present in every release.
      </p>
      <p>
        Rather than ship a fix to a tool being retired the same week, the installers were withdrawn so nobody else installs a vulnerable copy. The remediation is to uninstall, not to update. To check whether it ever fired on your machine, look for filenames containing a double quote anywhere under your BitGraph folder, and for AppleScript errors in <code>~/.bitgraph/hotfolder.err</code>.
      </p>
      <p>
        Fuller notes, including how to read the source of any released version from its git tag, are in the{" "}
        <a href={NOTICE} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">
          retirement notice
        </a>.
      </p>
    </div>
  );
}
