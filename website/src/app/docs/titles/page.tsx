import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BitGraph Titles",
  description:
    "Possession messages and custody threads over BitGraph recordings: who has held a thing, hand to hand, on a record that never forgets.",
};

const GITHUB = "https://github.com/mikeargento/bitgraph";
const NPM = "https://www.npmjs.com/package/@mikeargento/bitgraph-titles";

/* A worked message, structurally faithful to bitgraph-pm/1: if it drifts
   from what parsePm accepts, the page teaches a message that does not
   parse. Edit only against SPEC-PM.md. */
const PM_EXAMPLE = `{
  "pm": "bitgraph-pm/1",
  "about": "sha256:…",
  "claim": "give",
  "re": "sha256:…",
  "to": { "alg": "ed25519", "publicKey": "…" },
  "body": "wedding set, delivered under our agreement",
  "salt": "…",
  "possession": "…",
  "alg": "ed25519",
  "publicKey": "…",
  "signature": "…"
}`;

export default function TitlesPage() {
  return (
    <div className="prose-doc">
      <h1 className="mb-2">BitGraph Titles</h1>
      {/* Subtitle: heading furniture, not body copy. No terminal period. */}
      <p style={{ color: "#1f2937", fontSize: 18, margin: "0 0 24px" }}>
        A Custody Layer for BitGraph
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        <strong>BitGraph records. Titles convey. Player evaluates.</strong>
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        A recording is public and unownable: anyone can verify it, and nobody can hold it. A version is the holdable object of the same work. The record is everyone&apos;s; the version is yours.
      </p>
      <p style={{ color: "#1f2937", marginBottom: 32 }}>
        Everything on this page proves what was held and where it stands. Nothing on it proves that a statement is true, who a person is, or who holds anything now.
      </p>

      <h2>Versions</h2>
      <p>
        A version is a small one-of-a-kind file that references a recorded work and, once recorded itself, sits at its own causal position forever. Minting one requires holding the work&apos;s full bytes: no file, no version. Every mint is distinct, so a work can have many versions, and the causal order numbers them without anyone administering editions: the earliest is first as a matter of public record.
      </p>
      <p>
        The entropy changes direction here. A recording&apos;s uniqueness comes from the enclave&apos;s randomness receiving your bytes; a version&apos;s comes from your own randomness, which the chain then places. The work is untouched, its recording unchanged: the version is a new recording that depends on it, one way, forever.
      </p>
      <p>
        On any proof page, supply the original file and the card offers <strong>Create a Version</strong>: the version is minted in your browser, downloaded to your hands first, then recorded. Only its digest ever leaves the browser, and the version stays sealed, unconfirmable by anyone who does not hold it, until you choose to show it. Or mint offline:
      </p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-titles mint gallery.zip --body "for the couple" --out bitgraph-version.json`}</pre>
      </div>
      <p>
        A version is a bearer object: whoever holds the salted file holds the version, the way whoever holds a print holds the print. When a version must provably change hands, the custody layer below carries it, because a version is a file like any other.
      </p>

      <h2>The custody layer</h2>
      <p>
        A possession message is a small file that states a claim about another file, proves its author held that file, is signed by a key, and, once recorded, occupies a position in the causal order. A chain of them is a custody thread: who has held a thing, hand to hand, on a record that cannot be rewritten.
      </p>
      <p>
        A title is the thread, never the bytes. The work stays freely copyable, exactly as before. What cannot be copied is the ability to sign, and that is what makes standing scarce: exactly one key can extend a thread, and it belongs to the current holder.
      </p>

      <h2>Four properties</h2>
      <p>Every possession message carries all four, each grounded in something checkable:</p>
      <ul>
        <li>
          <strong>Held.</strong> A possession hash derivable only from the subject&apos;s full bytes. A public digest scraped from a proof page cannot produce it. Writing about a file requires holding the file.
        </li>
        <li>
          <strong>Signed.</strong> A key&apos;s signature over the message&apos;s canonical bytes. The signature math is checkable by anyone; that a key belongs to a named person is always a human assertion, never derived.
        </li>
        <li>
          <strong>Placed.</strong> The message file is recorded like any file, so it holds one causal position, bracketed by anchors.
        </li>
        <li>
          <strong>Sealed.</strong> Only digests touch the chain, and a mandatory 128-bit salt makes a sealed message unconfirmable by guessing its contents. A message is readable only when its author presents it.
        </li>
      </ul>

      <h2>The ritual</h2>
      <p>
        Every exchange in commercial history reduces to two sentences: <em>I gave this to you</em>, and <em>you took this from me</em>. A conveyance is those two sentences as files.
      </p>
      <ul>
        <li>
          <strong>Open.</strong> The holder writes a <code>held</code> message about the work: the origin of the thread.
        </li>
        <li>
          <strong>Give.</strong> The holder writes a <code>give</code> naming the recipient&apos;s key. Only the current holder&apos;s signature can extend the thread, so showing a thread never confers the power to extend it.
        </li>
        <li>
          <strong>Take.</strong> The receiver reads, checks, and writes the <code>take</code>: signed by exactly the key the give named, replying to the give&apos;s digest, carrying the receiver&apos;s own possession hash. Writing it is the one act only a real receiver can perform. The taking is proven by performance.
        </li>
      </ul>
      <p>
        The work and the messages travel however files travel. Recording them, which gives them positions, happens through the ordinary surfaces: the drop, the Folder, the MCP.
      </p>

      <h2>A possession message</h2>
      <div className="code-block">
        <div className="code-block-header">give.pm.json</div>
        <pre>{PM_EXAMPLE}</pre>
      </div>

      <h2>The three answers of a title check</h2>
      <p>Proving a title is three questions, answered by three different tools, and none claims another&apos;s ground.</p>
      <p>
        <strong>The key story.</strong> Are the messages well formed, every signature verifying, every hop obeying the give-names-taker discipline? Checked offline by the Titles tool, from the message files alone.
      </p>
      <p>
        <strong>The chain story.</strong> Is every file recorded, in the claimed order? The Titles tool generates a Player rule, the title abstract, and any conforming <a href="/docs/player" className="text-[#0065A4] font-medium no-underline">Player</a> evaluates it over a proof bundle: offline, deterministic, byte-reproducible, forever.
      </p>
      <p>
        <strong>Currency.</strong> Has the head been consumed by a later conveyance? Every message has a deterministic consumption marker derivable only by its holders. Drop the marker: a fresh recording means the handoff is unclaimed as of the latest anchor, and a dedup hit means someone already claimed it. The chain can answer whether these exact bytes were recorded, and that is the one absence it can honestly decide.
      </p>
      <p>
        Competing conveyances are resolved by position: the earliest recorded reply wins, decided the same way on every machine that checks. Later links visibly lose, forks visibly conflict, and history cannot be rewritten to manufacture a holder.
      </p>

      <h2>What a title is not</h2>
      <p>
        It is not legal title: the thread is evidence, and what force it has comes from whoever recognizes it, which is true of every private registry that has ever mattered. It is not a claim about the bytes: copies of the work neither strengthen nor weaken anyone&apos;s thread. It is not a statement about the present: the record holds demonstrated events, and who holds something at this moment is a question no chain can answer. And nothing here touches the movement of money.
      </p>

      <h2>Run it</h2>
      <p>The tool is fully offline. It never records anything and never touches the network.</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-titles keygen --out alice.key.json

npx @mikeargento/bitgraph-titles open  gallery.zip --key alice.key.json --out origin.pm.json
npx @mikeargento/bitgraph-titles give  gallery.zip --key alice.key.json \\
    --re origin.pm.json --to <recipientPublicKey> --out give.pm.json
npx @mikeargento/bitgraph-titles take  gallery.zip --key bob.key.json \\
    --re give.pm.json --out take.pm.json

npx @mikeargento/bitgraph-titles thread origin.pm.json give.pm.json take.pm.json --work gallery.zip
npx @mikeargento/bitgraph-titles rule   origin.pm.json give.pm.json take.pm.json \\
    --floor assumption-dependent --out title.rule.json`}</pre>
      </div>
      <p>
        The vault seals every message under a key derived from the subject&apos;s own bytes: one file of sealed envelopes that only the exact original can match and open. A leaked vault reveals nothing; handing someone the vault plus one work opens exactly that work&apos;s messages. No file, no author.
      </p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-titles vault init --vault my.bgvault
npx @mikeargento/bitgraph-titles vault put  --vault my.bgvault --work gallery.zip origin.pm.json
npx @mikeargento/bitgraph-titles vault get  --vault my.bgvault --work gallery.zip`}</pre>
      </div>
      <p>
        Back up the vault, and back up the works: a lost message is a permanently mute digest, and a lost work seals its messages forever, including to their author.
      </p>

      <h2>Specification</h2>
      <p>
        The message format, thread discipline, and marker semantics are specified precisely enough to reimplement.{" "}
        <a href={`${GITHUB}/blob/main/packages/titles/SPEC-PM.md`} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">SPEC-PM.md</a>{" "}
        is normative, and the <a href={NPM} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">published package</a> is the MIT-licensed reference implementation. The title abstract it generates is an ordinary{" "}
        <a href="/docs/player" className="text-[#0065A4] font-medium no-underline">Player</a> rule, so the chain story of any title can be verified by anyone, on any machine, with no dependence on this package at all.
      </p>
    </div>
  );
}
