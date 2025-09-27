// Check production webhook status and test connectivity
require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function checkProduction() {
  try {
    console.log("🔍 Checking production deployment...");

    // 1. Check bot connectivity
    const botInfo = await bot.telegram.getMe();
    console.log("✅ Bot connected:", botInfo.username);

    // 2. Get current webhook info
    const webhookInfo = await bot.telegram.getWebhookInfo();
    console.log("\n📊 Current webhook status:");
    console.log("  URL:", webhookInfo.url || "❌ Not set");
    console.log("  Pending updates:", webhookInfo.pending_update_count);
    console.log("  Last error:", webhookInfo.last_error_message || "None");

    if (webhookInfo.last_error_date) {
      const errorDate = new Date(webhookInfo.last_error_date * 1000);
      console.log("  Last error date:", errorDate.toISOString());
    }

    // 3. Test your Railway endpoint
    const railwayDomain = "https://dacoit-automation-production.up.railway.app";

    try {
      console.log(`\n🌐 Testing Railway endpoint: ${railwayDomain}`);

      // Test main endpoint
      const healthResponse = await axios.get(railwayDomain, { timeout: 10000 });
      console.log("✅ Main endpoint responding:", healthResponse.data);

      // Test webhook endpoint (GET)
      const webhookResponse = await axios.get(`${railwayDomain}/webhook`, {
        timeout: 10000,
      });
      console.log("✅ Webhook endpoint responding:", webhookResponse.data);
    } catch (error) {
      console.log("❌ Railway endpoint error:", error.message);
      if (error.code === "ECONNREFUSED") {
        console.log("  - Server might not be running");
      } else if (error.code === "ETIMEDOUT") {
        console.log("  - Server is not responding (timeout)");
      }
    }

    // 4. Check webhook URL format
    const expectedWebhook = `${railwayDomain}/webhook`;
    if (webhookInfo.url === expectedWebhook) {
      console.log("✅ Webhook URL matches expected URL");
    } else {
      console.log("❌ Webhook URL mismatch:");
      console.log("  Expected:", expectedWebhook);
      console.log("  Actual:", webhookInfo.url);
    }

    // 5. Manual update check
    console.log("\n📨 Getting recent updates...");
    try {
      const updates = await bot.telegram.getUpdates({ limit: 1 });
      console.log(
        "Recent updates:",
        updates.length > 0 ? updates : "No recent updates"
      );
    } catch (err) {
      console.log("Updates check failed:", err.message);
    }

    console.log("\n💡 Troubleshooting tips:");
    console.log("1. Try sending a message to your bot on Telegram");
    console.log("2. Check Railway logs for webhook receive messages");
    console.log("3. Verify all environment variables are set correctly");
    console.log("4. Make sure Railway app is deployed and running");
  } catch (error) {
    console.error("❌ Check failed:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
  }

  process.exit(0);
}

checkProduction();
