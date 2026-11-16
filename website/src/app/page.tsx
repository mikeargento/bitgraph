import type { Metadata } from "next";
import { TechnologyBody } from "@/components/technology-body";

/**
 * The home page is one run of numbered sections with a contents list (components/technology-body.tsx). The first
 * section is the headline, what BitGraph is for, with two sentences on what it does and which records it is built for;
 * the mechanism follows from the second. There are no buttons on the page itself: making a BitGraph is the bar's button.
 * The example of one record in three versions is on the Demos page.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

const TITLE = "BitGraph";
const DESCRIPTION =
  "Any file or record gets a numbered place in line, with a proof anyone can check offline, in seconds.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function HomePage() {
  return (
    <>
      <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-tech">
        <TechnologyBody />
      </div>
    </>
  );
}
