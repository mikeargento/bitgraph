"use client";

const properties = [
  {
    label: "Origin",
    note: "Every authenticated artifact corresponds to exactly one authorized commit. State that did not traverse the commit path cannot acquire a valid proof, regardless of how it was constructed elsewhere.",
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
          className="border border-[#e5e7eb] border-l-[3px] border-l-[#d0d5dd] bg-[#f9fafb] p-4 sm:p-5"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-[#111827] mb-3">
            {p.label}
          </div>
          <p className="text-base text-[#1f2937] leading-relaxed">
            {p.note}
          </p>
        </div>
      ))}
    </div>
  );
}
