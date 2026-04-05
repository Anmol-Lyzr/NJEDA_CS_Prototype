"use client";

import dynamic from "next/dynamic";

const ProgramAdvisor = dynamic(
  () =>
    import("@/components/program-advisor/ProgramAdvisor").then((m) => m.ProgramAdvisor),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
        <div
          className="h-9 w-9 animate-pulse rounded-full bg-[#0F7C8C]/30"
          aria-hidden
        />
      </div>
    ),
  },
);

export function AdvisorClient() {
  return (
    <div className="fixed inset-0">
      <ProgramAdvisor variant="panel" defaultOpen />
    </div>
  );
}
