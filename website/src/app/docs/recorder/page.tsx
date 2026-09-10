import type { Metadata } from "next";
import feed from "../../../../public/recorder/latest.json";

export const metadata: Metadata = {
  title: "BitGraph Recorder",
  description:
    "The Mac app that records BitGraphs. Drop files or a folder on it and each drop becomes a recording: one folder holding the files, the proof, and the Ethereum anchors.",
};

/* The software's page, first in TOOLS (Mike, 2026-09-09: "we will just add
   software as a download from the tools section using a menu item and
   separate page"). Written from recorder/README.md; keep the two in step.

   The download is the one action on the page. It is grey with "Coming soon"
   until there is a signed build to link: set DOWNLOAD_URL to the DMG's path
   and the link goes live. A button for this at the top of home was built
   and removed the same evening; this page is the door. */
/* The GitHub Release's versionless asset: the URL never changes between
   versions, so this page never goes stale on a release (the lesson Folder
   taught). Version and checksum live on the release itself. A package, not
   a DMG, since 2026-09-10 ("there's no installer?"): the standard Installer
   puts the app in Applications and replaces it on update. */
const DOWNLOAD_URL: string | null = "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraph-Recorder.pkg";

export default function RecorderPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">BitGraph Recorder</h1>
      <p className="text-[#1f2937] mb-6">
        A macOS app. Drop files or a folder on it and each drop becomes a <strong>recording</strong>: one self-contained folder holding the files, the proof, and the Ethereum anchors. Hand somebody the folder and they have the whole BitGraph.
      </p>

      {/* The site's action link (.bg-action-link) on the h2 scale
          (.bg-download-link in globals.css): the download reads like every
          other link on the site, only bigger. It was the app's filled pill
          for a day (2026-09-09/10) and Mike asked for the site's own link:
          "match the other links on the website but just be a bigger font". */}
      {DOWNLOAD_URL !== null ? (
        <p className="mb-10" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <a className="bg-action-link bg-download-link" href={DOWNLOAD_URL}>Download for Mac <span className="arrow" aria-hidden="true">→</span></a>
          {/* The version comes from the feed the release script wrote, the
              same file the app reads, so this line and the app can never
              disagree. The link's label never changes. Its own line at every
              width (Mike, 2026-09-10: "this should be next line under even
              on desktop"). */}
          <span className="text-[#4b5563]" style={{ fontSize: 14 }}>Version {feed.version}. macOS 14 or later, Apple silicon. <a href="https://github.com/mikeargento/bitgraph/releases/latest" style={{ color: "#0065A4", textDecoration: "none", fontWeight: 600 }}>Release notes and checksum</a></span>
        </p>
      ) : (
        <p className="mb-10" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <button className="bg-action-link bg-download-link" type="button" disabled aria-describedby="recorder-soon">
            Download for Mac <span className="arrow" aria-hidden="true">→</span>
          </button>
          <span id="recorder-soon" className="text-[#4b5563]" style={{ fontSize: 14 }}>Coming soon. macOS 14 or later, Apple silicon.</span>
        </p>
      )}

      {/* The terms, in the Terms' own words (sections 6 and 8): who owns the
          software, what is free, what is licensed. One line, so nobody
          downloads without having been told (Mike, 2026-09-10). */}
      <p className="text-[#4b5563]" style={{ fontSize: 14, margin: "6px 0 40px" }}>
        BitGraph Recorder is software of Argento Computing Inc., provided under the <a href="/terms" style={{ color: "#0065A4", textDecoration: "none", fontWeight: 600 }}>Terms</a>. Ordinary individual use and verification are free. Recording inside your own product, service or internal systems is licensed by separate agreement; <a href="/contact" style={{ color: "#0065A4", textDecoration: "none", fontWeight: 600 }}>get in touch</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">What a recording is</h2>
      <div className="code-block">
        <div className="code-block-header"><span>~/BitGraph/Recordings/2026-09-09/</span></div>
        <pre>{`BitGraph (IMG_4021.png)/
  IMG_4021.png            a hard link to your file
  proof.json              bitgraph/1
  ethereum-anchors/       when they land

BitGraph (Photos 2026, 412 files)/
  ...the tree, mirrored...
  proof.json
  manifest.json           the set's manifest
  members.jsonl           every member's row and inclusion path`}</pre>
      </div>
      <p className="text-[#1f2937] mb-8">
        Nothing points at anything. The proof file <em>is</em> the proof, and a recording checks on its own: no library, no index, no settings, no network.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">What it does not do</h2>
      <ul>
        <li><strong>It never writes into your folders.</strong> The folder you dragged out of is left exactly as it was.</li>
        <li><strong>It never moves your files.</strong> Your file does appear inside the recording folder. On the same disk it is a hard link: the same bytes under a second name, no new disk used, so editing the original in place changes what the recording holds and a check then says so. Where a link is not possible, another drive or a filesystem without links, it copies instead, and the recording says which it did. Your original stays where it was either way.</li>
        <li><strong>It never writes the fused bytes.</strong> They are virtual: the original plus the proof rebuilds them exactly, so they are only written when you export. The export checks the rebuilt bytes against the committed digest as it writes them, and if they do not match, no file is handed over. A new file that does not match its proof is worse than no new file.</li>
        <li><strong>No login, no account, no upload.</strong> Files are hashed on your Mac. Two HTTPS calls leave the machine, and neither carries your file: digests, sizes, a file&rsquo;s first bytes for the placement choice, the slot record and the placement id.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">Setting up</h2>
      <p className="text-[#1f2937] mb-4">
        The first run asks one thing: what to call your BitGraph folder and where it lives. <code>~/BitGraph</code> is offered. Put it on the Desktop or in Documents and macOS asks once whether the app may use that folder; the app cannot record until it is allowed. An existing folder is continued, never replaced.
      </p>
      <p className="text-[#1f2937] mb-8">
        The app lives in the menu bar and opens one window. Move or rename the folder later and the app says so and asks where it went; <strong>Change folder&hellip;</strong> does the same on purpose. Pointing at a folder that already has recordings in it carries on with everything in it.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">The gesture</h2>
      <ul>
        <li><strong>One new file</strong> is recorded on landing.</li>
        <li><strong>One file already on record</strong> opens its BitGraph instead.</li>
        <li><strong>Two or more</strong> are listed first, then made as one BitGraph at one position, each file a member. Only a batch gets asked.</li>
      </ul>
      <p className="text-[#1f2937] mb-4">
        Two files with the same bytes in one drop are one member: the record is by content, and the second name is covered by the first. Your BitGraph folder itself can never be dropped, and a drop of the folder above it walks around it.
      </p>
      <p className="text-[#1f2937] mb-8">
        The window has two sections. <strong>Record</strong> is where things are recorded and checked; <strong>New</strong> holds the two ways in that are not a drag, <strong>Record a BitGraph&hellip;</strong> and <strong>Check a folder&hellip;</strong>. <strong>Calendar</strong> is the library: the month&rsquo;s days, each a row saying how many recordings it holds, and a day opens to its recordings. A recording opens to its proof, read off the disk.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Export</h2>
      <p className="text-[#1f2937] mb-8">
        <strong>Export BitGraph</strong> on a recording&rsquo;s page writes a folder to hand to somebody: the original exactly as it is, <code>proof.json</code>, the new fused file rebuilt from the two and checked against the committed digest on the way out, and the Ethereum anchors that have landed. It carries everything a check needs.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">The reader</h2>
      <p className="text-[#1f2937] mb-4">
        <strong>Check a folder</strong> reads and records nothing. A folder somebody sends you checks on its own, because a recording carries everything a check asks for. Four outcomes, and the differences between them are the point.
      </p>
      <table>
        <tbody>
          <tr><td><strong>verified</strong></td><td>the bytes rebuild the artifact this position committed</td></tr>
          <tr><td><strong>failed</strong></td><td>something contradicted; it names which side</td></tr>
          <tr><td><strong>could not be checked</strong></td><td>a gap on this side, never counted as a failure</td></tr>
          <tr><td><strong>not recorded</strong></td><td>these bytes have no BitGraph, which is not a fault</td></tr>
        </tbody>
      </table>
      <p className="text-[#1f2937] mt-4">
        Bytes alone cannot tell a file that was altered from one that was never recorded, so neither is called a failure. The same check runs anywhere with <code>npx @mikeargento/bitgraph-audit</code>; see <a href="/docs/verification">Verification</a>.
      </p>
    </article>
  );
}
