/* Each page sits in .bg-page-in, which globals.css uses to fade in a page's wait; the page itself appears at once. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="bg-page-in">{children}</div>;
}
