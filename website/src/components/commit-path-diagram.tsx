"use client";


const properties = [
  {
    label: "One route",
    note: "Every authenticated artifact corresponds to exactly one authorized commit. State that did not traverse the commit path cannot acquire a valid proof, however the bytes were made.",
  },
  {
    label: "Closure",
    note: "The set of authenticated artifacts is exactly the set produced by authorized commits. There is no second route into the authenticated set.",
  },
  {
    label: "Atomicity",
    note: "Authorization, binding, and commit are a single indivisible transition. There is no observable intermediate state in which authorization holds but binding has not occurred, or in which binding holds but commit has not.",
  },
  {
    label: "Uniqueness",
    note: "Each authorization event produces a distinct proof. No two commits collide, and the same bytes committed twice occupy two different places.",
  },
];

export function CommitPathDiagram() {
  return (
    <div className="mt-10 grid gap-4">
      {properties.map((p) => (
        <div
          key={p.label}
          className="border border-[color:var(--line)] border-l-[3px] border-l-[color:var(--line)] bg-[color:var(--panel)] p-4 sm:p-5"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-[color:var(--ink)] mb-3">
            {p.label}
          </div>
          <p className="text-base text-[color:var(--text)] leading-relaxed">
            {p.note}
          </p>
        </div>
      ))}
    </div>
  );
}
