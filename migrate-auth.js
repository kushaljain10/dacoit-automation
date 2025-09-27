#!/usr/bin/env node

// Migration script to transfer auth data from JSON file to SQLite database
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const JSON_FILE = path.join(__dirname, "auth_store.json");
const DB_FILE = path.join(__dirname, "auth.db");

function migrateAuthData() {
  console.log("🔄 Starting authentication data migration...");

  // Check if JSON file exists
  if (!fs.existsSync(JSON_FILE)) {
    console.log("ℹ️  No JSON auth file found. Migration not needed.");
    return;
  }

  // Check if database already exists and has data
  let existingUsers = [];
  if (fs.existsSync(DB_FILE)) {
    try {
      const db = new Database(DB_FILE);
      const stmt = db.prepare("SELECT user_id FROM user_auth");
      existingUsers = stmt.all().map((row) => row.user_id);
      db.close();
    } catch (error) {
      console.log(
        "ℹ️  Database doesn't exist yet or is empty. Continuing migration..."
      );
    }
  }

  // Read JSON data
  let jsonData;
  try {
    const jsonContent = fs.readFileSync(JSON_FILE, "utf8");
    jsonData = JSON.parse(jsonContent);
  } catch (error) {
    console.error("❌ Error reading JSON auth file:", error.message);
    return;
  }

  if (!jsonData || Object.keys(jsonData).length === 0) {
    console.log("ℹ️  JSON auth file is empty. Migration not needed.");
    return;
  }

  // Initialize SQLite database
  let db;
  try {
    db = new Database(DB_FILE);

    // Create table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_auth (
        user_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        account_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log(`📊 Found ${Object.keys(jsonData).length} user(s) to migrate`);

    let migrated = 0;
    let skipped = 0;

    for (const [userId, authData] of Object.entries(jsonData)) {
      // Skip if user already exists in database
      if (existingUsers.includes(userId)) {
        console.log(`⏭️  Skipping user ${userId} (already exists in database)`);
        skipped++;
        continue;
      }

      // Validate auth data structure
      if (!authData.access || !authData.accountId) {
        console.log(`⚠️  Skipping user ${userId} (incomplete auth data)`);
        skipped++;
        continue;
      }

      // Insert into database
      const stmt = db.prepare(`
        INSERT INTO user_auth (user_id, access_token, refresh_token, account_id)
        VALUES (?, ?, ?, ?)
      `);

      try {
        stmt.run(
          userId,
          authData.access,
          authData.refresh || null,
          authData.accountId
        );
        migrated++;
        console.log(`✅ Migrated user: ${userId}`);
      } catch (error) {
        console.error(`❌ Error migrating user ${userId}:`, error.message);
        skipped++;
      }
    }

    console.log(`\n📈 Migration Summary:`);
    console.log(`   • Successfully migrated: ${migrated} user(s)`);
    console.log(`   • Skipped: ${skipped} user(s)`);
    console.log(`   • Total: ${migrated + skipped} user(s)`);

    if (migrated > 0) {
      console.log(
        "\n💡 Migration completed! You can now delete auth_store.json if desired."
      );
      console.log(
        "   The database file (auth.db) will persist your authentication data across deployments."
      );
    }
  } catch (error) {
    console.error("❌ Database error during migration:", error.message);
  } finally {
    if (db) {
      db.close();
    }
  }
}

// Run migration
migrateAuthData();
