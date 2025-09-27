// Test webhook setup for debugging production issues
require("dotenv").config();
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function testWebhook() {
  try {
    console.log("🔍 Testing webhook configuration...");

    // Get bot info
    const botInfo = await bot.telegram.getMe();
    console.log("✅ Bot connected:", botInfo.username);

    // Check current webhook
    const webhookInfo = await bot.telegram.getWebhookInfo();
    console.log("📊 Current webhook info:");
    console.log("  URL:", webhookInfo.url || "Not set");
    console.log("  Certificate:", webhookInfo.has_custom_certificate);
    console.log("  Pending updates:", webhookInfo.pending_update_count);
    console.log("  Last error:", webhookInfo.last_error_message || "None");
    console.log("  Last error date:", webhookInfo.last_error_date || "None");

    // Test webhook URL format
    const webhookUrl =
      process.env.WEBHOOK_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`
        : null);

    console.log(
      "\n🔗 Expected webhook URL:",
      webhookUrl || "❌ NOT CONFIGURED"
    );

    if (webhookUrl) {
      if (!webhookUrl.startsWith("https://")) {
        console.log("❌ ERROR: Webhook URL must use HTTPS");
      } else {
        console.log("✅ Webhook URL format is correct");
      }
    }

    // Environment check
    console.log("\n🌍 Environment variables:");
    console.log("  NODE_ENV:", process.env.NODE_ENV || "not set");
    console.log(
      "  RAILWAY_ENVIRONMENT:",
      process.env.RAILWAY_ENVIRONMENT || "not set"
    );
    console.log(
      "  RAILWAY_PUBLIC_DOMAIN:",
      process.env.RAILWAY_PUBLIC_DOMAIN || "not set"
    );
    console.log("  WEBHOOK_URL:", process.env.WEBHOOK_URL || "not set");

    // Production mode check
    const isProduction =
      process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT;
    console.log("  Production mode:", isProduction ? "✅ YES" : "❌ NO");

    console.log("\n✨ Test complete!");
  } catch (error) {
    console.error("❌ Error testing webhook:", error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
    }
  }

  process.exit(0);
}

testWebhook();
