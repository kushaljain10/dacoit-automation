// Reset Telegram Bot - Clear webhooks and conflicts
require("dotenv").config();
const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function resetBot() {
  try {
    console.log("🧹 Clearing existing webhook...");

    // Delete any existing webhook
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log("✅ Webhook cleared successfully");

    // Get webhook info to verify
    const webhookInfo = await bot.telegram.getWebhookInfo();
    console.log("📊 Current webhook info:", {
      url: webhookInfo.url,
      has_custom_certificate: webhookInfo.has_custom_certificate,
      pending_update_count: webhookInfo.pending_update_count,
      max_connections: webhookInfo.max_connections,
    });

    // Get bot info
    const botInfo = await bot.telegram.getMe();
    console.log("🤖 Bot info:", {
      id: botInfo.id,
      username: botInfo.username,
      first_name: botInfo.first_name,
    });

    console.log("\n✅ Bot reset complete!");
    console.log("💡 Your bot is now ready for webhook setup on Railway.");
    console.log("🔍 To debug Railway deployment, check:");
    console.log("   - https://your-app.railway.app/test (basic connectivity)");
    console.log("   - https://your-app.railway.app/health (detailed status)");
    console.log(
      "   - https://your-app.railway.app/debug/webhook (webhook info)"
    );
    console.log("   - Railway deployment logs");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error resetting bot:", error.message);
    process.exit(1);
  }
}

// Also provide manual webhook setup
async function setupWebhook(url) {
  if (!url) {
    console.error("❌ Please provide webhook URL as argument");
    console.error(
      "Usage: node reset-bot.js setup https://your-domain.com/webhook"
    );
    process.exit(1);
  }

  try {
    console.log(`🔗 Setting webhook to: ${url}`);
    await bot.telegram.setWebhook(url, {
      max_connections: 40,
      drop_pending_updates: true,
    });

    const webhookInfo = await bot.telegram.getWebhookInfo();
    console.log("✅ Webhook set successfully!");
    console.log("📊 Webhook info:", {
      url: webhookInfo.url,
      has_custom_certificate: webhookInfo.has_custom_certificate,
      pending_update_count: webhookInfo.pending_update_count,
      max_connections: webhookInfo.max_connections,
    });
    process.exit(0);
  } catch (error) {
    console.error("❌ Error setting webhook:", error.message);
    process.exit(1);
  }
}

// Check command line arguments
const command = process.argv[2];
const arg = process.argv[3];

if (command === "setup" && arg) {
  setupWebhook(arg);
} else {
  resetBot();
}
