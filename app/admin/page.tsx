import { connection } from "next/server";
import { Suspense } from "react";

import { getAdminStatus } from "@/lib/queries";
import { listPluginTokens } from "@/lib/plugin-auth";
import { RevokeButton } from "./revoke-button";
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

      <header className="mt-12 mb-4">
        <h2 className="text-lg font-semibold tracking-tight">Figma plugins</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Each row is one person who connected the publish plugin. Revoking
          takes effect on their next publish.
        </p>
      </header>

      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <PluginTokenTable />
      </Suspense>
    </>
  );
}

async function PluginTokenTable() {
  await connection();
  const tokens = await listPluginTokens();

  if (tokens.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nobody has connected the plugin yet. See SETUP.md for how to install it.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Person</th>
            <th className="px-4 py-3 font-medium">Connected</th>
            <th className="px-4 py-3 font-medium">Last published</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id} className="border-t border-border align-top">
              <td className="px-4 py-3">
                <span className={token.revokedAt ? "text-muted" : ""}>
                  {token.email}
                </span>
                {token.revokedAt && (
                  <span className="ml-2 text-xs text-muted">(revoked)</span>
                )}
                {!token.revokedAt && !token.pairedAt && (
                  <span className="ml-2 text-xs text-muted">
                    (pairing not completed)
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-muted">
                {token.pairedAt?.toLocaleString() ?? "—"}
              </td>
              <td className="px-4 py-3 text-muted">
                {token.lastUsedAt?.toLocaleString() ?? "never"}
              </td>
              <td className="px-4 py-3">
                {!token.revokedAt && <RevokeButton id={token.id} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
