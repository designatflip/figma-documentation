import { connection } from "next/server";
import { Suspense } from "react";

import { getAdminStatus } from "@/lib/queries";
import { SyncButton } from "./sync-button";

export default function AdminPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sync status</h1>
        <p className="mt-1 text-sm text-muted">
          One row per file in the Figma documentation project. Publishing is
          controlled entirely in Figma — there is no publish toggle here by
          design.
        </p>
      </header>

      <div className="mb-8">
        <SyncButton />
      </div>

      <Suspense fallback={<p className="text-sm text-muted">Loading status…</p>}>
        <StatusTable />
      </Suspense>
    </>
  );
}

async function StatusTable() {
  await connection();
  const rows = await getAdminStatus();

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        No flows yet. Run a sync to populate the catalogue.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Flow</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Screens</th>
            <th className="px-4 py-3 font-medium">Drift</th>
            <th className="px-4 py-3 font-medium">Figma modified</th>
            <th className="px-4 py-3 font-medium">Last synced</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border align-top">
              <td className="px-4 py-3">
                <span className={row.archivedAt ? "text-muted" : ""}>
                  {row.name}
                </span>
                {row.archivedAt && (
                  <span className="ml-2 text-xs text-muted">(archived)</span>
                )}
                {row.syncError && (
                  <p className="mt-1 max-w-md text-xs text-warning">
                    {row.syncError}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">{row.syncStatus}</td>
              <td className="px-4 py-3">{row.screenCount}</td>
              <td className="px-4 py-3">
                {row.driftCount > 0 ? (
                  <span className="text-warning">{row.driftCount}</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-muted">
                {row.lastModified?.toLocaleString() ?? "—"}
              </td>
              <td className="px-4 py-3 text-muted">
                {row.lastSyncedAt?.toLocaleString() ?? "never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
