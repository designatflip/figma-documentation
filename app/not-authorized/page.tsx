import { allowedEmailDomain } from "@/lib/env";

export default function NotAuthorizedPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Not authorised</h1>
      <p className="mt-2 text-sm text-muted">
        This documentation is limited to @{allowedEmailDomain()} accounts. Sign
        in with your work account, or ask a design system maintainer for access.
      </p>
    </div>
  );
}
