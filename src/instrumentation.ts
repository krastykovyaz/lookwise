// Next.js's officially sanctioned "run once when the server process
// starts" hook (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
// Used here for exactly one thing: a same-process fallback scheduler
// for the daily cleanup sweep (section 12), so a plain `next start`
// self-hosted deployment gets retention out of the box, without
// requiring an external cron to be configured first. See
// api/maintenance/cleanup/route.ts for the externally-triggerable
// counterpart — real production deployments should prefer pointing a
// proper cron/scheduler at that route instead, since a long-lived
// setInterval only helps if the process itself stays up for a full
// day, which isn't guaranteed on serverless/edge platforms. Both call
// the exact same runCleanup(), so there is only ONE cleanup
// implementation (section 12: "do not introduce multiple competing
// schedulers") — this file just offers a second way to trigger it.
export async function register() {
  // Edge and browser instrumentation also import this file — the
  // interval (and the DB access inside runCleanup) only make sense in
  // the Node.js server runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Skip during `next build`'s page-data collection pass, which also
  // loads this module — there's no long-lived process to schedule
  // against at build time.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { runCleanup } = await import("@/lib/maintenance/cleanup");
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // A short initial delay rather than firing immediately on every
  // server start/restart (dev hot-reloads restart this fairly often).
  const STARTUP_DELAY_MS = 60_000;

  setTimeout(() => {
    runCleanup().catch((err) => console.error("[instrumentation] initial cleanup run failed:", err));
    setInterval(() => {
      runCleanup().catch((err) => console.error("[instrumentation] scheduled cleanup run failed:", err));
    }, ONE_DAY_MS);
  }, STARTUP_DELAY_MS);
}
