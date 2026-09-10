import type { Metadata } from "next";

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
const DOWNLOAD_URL: string | null = null;

export default function RecorderPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">BitGraph Recorder</h1>
      <p className="text-[#1f2937] mb-6">
        A macOS app. Drop files or a folder on it and each drop becomes a <strong>recording</strong>: one self-contained folder holding the files, the proof, and the Ethereum anchors. Hand somebody the folder and they have the whole BitGraph.
      </p>

      {DOWNLOAD_URL !== null ? (
        <p className="mb-10">
          <a className="bg-action-link" href={DOWNLOAD_URL}>
            Download for Mac <span className="arrow" aria-hidden="true">&rarr;</span>
          </a>
        </p>
      ) : (
        <p className="mb-10" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button className="bg-action-link" type="button" disabled aria-describedby="recorder-soon">
            Download for Mac <span className="arrow" aria-hidden="true">&rarr;</span>
          </button>
          <span id="recorder-soon" className="text-[#4b5563]" style={{ fontSize: 14 }}>Coming soon. macOS 14 or later.</span>
        </p>
      )}

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
  manifest.json           the committed artifact
  members.jsonl           every member's row and inclusion path`}</pre>
      </div>
      <p className="text-[#1f2937] mb-8">
        Nothing points at anything. The proof file <em>is</em> the proof, and a recording checks on its own: no library, no index, no settings, no network.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">What it does not do</h2>
      <ul>
        <li><strong>It never writes into your folders.</strong> The folder you dragged out of is left exactly as it was.</li>
        <li><strong>It never moves or copies your files.</strong> On the same volume a recording&rsquo;s files are hard links: one copy of the bytes, two names. Across volumes it copies, and the recording says which it did.</li>
        <li><strong>It never writes the fused bytes.</strong> They are virtual, rebuilt from the original and the proof when you export, and refused if they do not match what was committed.</li>
        <li><strong>No login, no account, no upload.</strong> Files are hashed on your Mac. Two HTTPS calls leave the machine and neither carries file content.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">The gesture</h2>
      <ul>
        <li><strong>One new file</strong> is recorded on landing. The drop is the shutter.</li>
        <li><strong>One file already on record</strong> opens its BitGraph instead.</li>
        <li><strong>Two or more</strong> are listed first, then made as one BitGraph at one position, each file a member. Only a batch gets asked.</li>
      </ul>
      <p className="text-[#1f2937] mb-8">
        The window has two sections. <strong>Record</strong> is where things are recorded and checked. <strong>Calendar</strong> is the library: the month&rsquo;s days, each a row saying how many recordings it holds, and a day opens to its recordings.
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
