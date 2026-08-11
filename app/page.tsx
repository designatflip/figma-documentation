import { Suspense } from "react";

import { StreamRails, StreamRailsSkeleton } from "@/components/stream-rails";

export default function HomePage() {
  return (
    <>
      <Suspense fallback={<StreamRailsSkeleton />}>
        <StreamRails />
      </Suspense>
    </>
  );
}
