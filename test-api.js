#!/usr/bin/env node

/**
 * Standalone script to test CopperX API connectivity
 * Usage: node test-api.js
 */

import dotenv from "dotenv";
import { testCopperXAPI } from "./copperx.js";

dotenv.config();

async function runApiTest() {
  console.log("🧪 CopperX API Test");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const results = await testCopperXAPI();

    const formatStatus = (status, error) => {
      if (status === "success") return "✅ Working";
      if (status === "failed") return `❌ Failed${error ? `: ${error}` : ""}`;
      return "⚠️ Unknown";
    };

    console.log(
      `GET /customers:  ${formatStatus(
        results.customersGet.status,
        results.customersGet.error
      )}`
    );
    console.log(
      `POST /customers: ${formatStatus(
        results.customersPost.status,
        results.customersPost.error
      )}`
    );
    console.log(
      `POST /invoices:  ${formatStatus(
        results.invoicesPost.status,
        results.invoicesPost.error
      )}`
    );
    console.log(
      `Authentication: ${formatStatus(
        results.authMe.status,
        results.authMe.error
      )}`
    );

    if (results.error) {
      console.log(`General Error: ${results.error}`);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Exit with appropriate code
    const hasFailures = Object.values(results).some(
      (endpoint) =>
        endpoint.status === "failed" || endpoint.status === "unknown"
    );

    if (hasFailures) {
      console.log("❌ API test completed with failures");
      process.exit(1);
    } else {
      console.log("✅ All API tests passed");
      process.exit(0);
    }
  } catch (error) {
    console.error("❌ API test failed:", error.message);
    process.exit(1);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runApiTest();
}

export { testCopperXAPI };
