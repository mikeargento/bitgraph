"use client";

interface TerminalWindowProps {
  title?: string;
  children: React.ReactNode;
}

export function TerminalWindow({ title = "proof.json", children }: TerminalWindowProps) {
  return (
    <div className="border border-border-subtle overflow-hidden">
      {/* macOS title bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-bg-elevated border-b border-border-subtle">
        <div className="flex items-center gap-[6px]">
          <span className="w-3 h-3 bg-[color:var(--err)]" />
          <span className="w-3 h-3 bg-[color:var(--warn)]" />
          <span className="w-3 h-3 bg-[color:var(--ok)]" />
        </div>
        <span className="flex-1 text-center text-xs font-mono text-text-tertiary -ml-[54px]">
          {title}
        </span>
      </div>
      {/* Content */}
      <div className="bg-bg px-4 py-3 overflow-x-auto">
        {children}
      </div>
    </div>
  );
}
