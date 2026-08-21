// Next.js's officially sanctioned "run once when the server process
// starts" hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
// Used here as a same-process fallback scheduler for the daily
// maintenance sweep — retention cleanup (section 12) plus the
// proactive availability check for favorited/saved items and saved
// Looks — so a plain `next start` self-hosted deployment gets both
// out of the box, without requiring an external cron to be configured
// first. See api/maintenance/cleanup/route.ts for the
// externally-triggerable counterpart — real production deployments
// should prefer pointing a proper cron/scheduler at that route
// instead, since a long-lived setInterval only helps if the process
// itself stays up for a full day, which isn't guaranteed on
// serverless/edge platforms. Both call the exact same runCleanup()
// and runAvailabilitySweep(), so there is only ONE implementation of
// each (section 12: "do not introduce multiple competing
// schedulers") — this file just offers a second way to trigger them.
// Also runs a one-time NOWPayments config presence check on boot (see
// below) — unrelated to the scheduler, just piggybacking on the same
// "runs once when the server starts" hook.
export async function register() {
  // Edge and browser instrumentation also import this file — the
  // interval (and the DB access inside runCleanup) only make sense in
  // the Node.js server runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Skip during `next build`'s page-data collection pass, which also
  // loads this module — there's no long-lived process to schedule
  // against at build time.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // NOWPayments (crypto payments, section 1 of the payments spec —
  // config/connectivity foundation only, no subscription/checkout flow
  // yet). A local env-presence check only (no network call, so this is
  // cheap and safe on every boot, including dev hot-reloads) — never
  // logs the key/secret values themselves, only which are missing.
  const { checkNowPaymentsConfig } = await import("@/lib/payments/nowpayments/env");
  const nowPaymentsStatus = checkNowPaymentsConfig();
  if (nowPaymentsStatus.configured) {
    console.log(
      `[instrumentation] NOWPayments configured (${nowPaymentsStatus.environment}, ${nowPaymentsStatus.apiBaseUrl})`,
    );
  } else {
    console.warn(
      `[instrumentation] NOWPayments not fully configured — missing: ${nowPaymentsStatus.missing.join(", ")}. ` +
        "Payment features will be unavailable until these are set (see .env.example).",
    );
  }

  const { runCleanup } = await import("@/lib/maintenance/cleanup");
  const { runAvailabilitySweep } = await import("@/lib/products/availability");
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // A short initial delay rather than firing immediately on every
  // server start/restart (dev hot-reloads restart this fairly often).
  const STARTUP_DELAY_MS = 60_000;

  // Sequential, not Promise.all: two independent background jobs
  // (delete old rows / call eBay for saved items) have no reason to
  // contend for eBay rate limit or the DB at the exact same instant.
  // One failing never blocks the other (each has its own catch).
  const runMaintenance = async () => {
    await runCleanup().catch((err) => console.error("[instrumentation] scheduled cleanup run failed:", err));
    await runAvailabilitySweep().catch((err) =>
      console.error("[instrumentation] scheduled availability sweep failed:", err),
    );
  };

  setTimeout(() => {
    void runMaintenance();
    setInterval(() => {
      void runMaintenance();
    }, ONE_DAY_MS);
  }, STARTUP_DELAY_MS);
}
