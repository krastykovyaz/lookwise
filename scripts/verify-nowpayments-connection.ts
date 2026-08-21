// One-off connectivity check against the REAL NOWPayments API (not a
// repeatable CI-style check like the other scripts/verify-*.ts files —
// this needs real NOWPAYMENTS_API_KEY/NOWPAYMENTS_API_URL in the
// environment and makes live network calls). Run with
// `npm run check:nowpayments`.
//
// Confirms: (1) the configured base URL is reachable, (2) the API key
// actually authenticates (a bad/missing key gets a 401 from
// /v1/currencies, not a silent pass). Never prints the key or IPN
// secret — only their presence/absence and the resolved environment.

async function main() {
  const { checkNowPaymentsConfig } = await import("../src/lib/payments/nowpayments/env");
  const { getApiStatus, getSupportedCurrencies, NowPaymentsApiError } = await import(
    "../src/lib/payments/nowpayments/client"
  );

  const status = checkNowPaymentsConfig();
  console.log(`Environment: ${status.environment}`);
  console.log(`API base URL: ${status.apiBaseUrl}`);
  console.log(`Configured: ${status.configured}`);
  if (!status.configured) {
    console.error(`Missing environment variables: ${status.missing.join(", ")}`);
    console.error("Add them to .env.local (see .env.example) and re-run.");
    process.exit(1);
  }

  console.log("\n--- GET /v1/status (no auth) ---");
  try {
    const apiStatus = await getApiStatus();
    console.log("OK:", apiStatus);
  } catch (err) {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log("\n--- GET /v1/currencies (authenticated) ---");
  try {
    const currencies = await getSupportedCurrencies();
    const count = currencies.currencies?.length ?? 0;
    console.log(`OK: authenticated successfully, ${count} supported currencies.`);
    console.log("Sample:", currencies.currencies?.slice(0, 10));
  } catch (err) {
    if (err instanceof NowPaymentsApiError && err.status === 401) {
      console.error("FAILED: 401 Unauthorized — NOWPAYMENTS_API_KEY is set but invalid for this environment.");
    } else {
      console.error("FAILED:", err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
