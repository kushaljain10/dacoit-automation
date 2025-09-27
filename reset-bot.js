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
    console.log("📊 Current webhook info:", webhookInfo);

    // Get bot info
    const botInfo = await bot.telegram.getMe();
    console.log("🤖 Bot info:", botInfo.username);

    console.log("✨ Bot reset complete! You can now deploy to Railway.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error resetting bot:", error.message);
    process.exit(1);
  }
}

resetBot();
