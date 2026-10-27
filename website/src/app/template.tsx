/* Each page fades in as it arrives (globals.css, .bg-page-in). A template remounts on every navigation, so the fade
   plays on each route change, not only the first load. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="bg-page-in">{children}</div>;
}
