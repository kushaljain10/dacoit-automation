// Test Railway deployment locally to simulate production environment
require("dotenv").config();

// Simulate Railway environment
process.env.NODE_ENV = "production";
process.env.RAILWAY_ENVIRONMENT = "true";
process.env.PORT = process.env.PORT || 3000;

// Mock Railway domain if not set
if (!process.env.WEBHOOK_URL && !process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.WEBHOOK_URL = "https://test-domain.railway.app/webhook";
}

console.log("🚂 Testing Railway configuration...");
console.log("Environment variables:");
console.log("  NODE_ENV:", process.env.NODE_ENV);
console.log("  RAILWAY_ENVIRONMENT:", process.env.RAILWAY_ENVIRONMENT);
console.log("  PORT:", process.env.PORT);
console.log("  WEBHOOK_URL:", process.env.WEBHOOK_URL);

try {
  console.log("\n🔄 Starting server with Railway config...");
  require("./index.js");
} catch (error) {
  console.error("❌ Server startup failed:", error.message);
  console.error("Stack:", error.stack);
  process.exit(1);
}
