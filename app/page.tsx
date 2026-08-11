import { Suspense } from "react";

import { FlowRails, FlowRailsSkeleton } from "@/components/flow-rails";

export default function HomePage() {
  return (
    <>
      <Suspense fallback={<FlowRailsSkeleton />}>
        <FlowRails />
      </Suspense>
    </>
  );
}
