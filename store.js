const Database = require("better-sqlite3");
const path = require("path");

class SQLiteAuthStore {
  constructor() {
    this.dbFile = path.join(__dirname, "auth.db");
    this.db = null;
    this.initialize();
  }

  initialize() {
    try {
      this.db = new Database(this.dbFile);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_auth (
          user_id TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          account_id INTEGER NOT NULL,
          platform TEXT NOT NULL DEFAULT 'telegram',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_user_auth_user_id
        ON user_auth(user_id)
      `);
      console.log("SQLite auth store initialized");
    } catch (error) {
      console.error("Error initializing SQLite store:", error.message);
      throw error;
    }
  }

  get(userId) {
    if (!this.db) return null;
    try {
      const stmt = this.db.prepare("SELECT * FROM user_auth WHERE user_id = ?");
      const result = stmt.get(userId);
      if (result) {
        return {
          access: result.access_token,
          refresh: result.refresh_token,
          accountId: result.account_id,
          platform: result.platform,
        };
      }
      return null;
    } catch (error) {
      console.error("Error getting auth data:", error.message);
      return null;
    }
  }

  set(userId, authData, platform = "telegram") {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO user_auth 
        (user_id, access_token, refresh_token, account_id, platform, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(
        userId,
        authData.access,
        authData.refresh,
        authData.accountId,
        platform
      );
      console.log(
        `Authentication data saved for user: ${userId} (${platform})`
      );
    } catch (error) {
      console.error("Error saving auth data:", error.message);
    }
  }

  delete(userId) {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare("DELETE FROM user_auth WHERE user_id = ?");
      stmt.run(userId);
      console.log(`Authentication data deleted for user: ${userId}`);
    } catch (error) {
      console.error("Error deleting auth data:", error.message);
    }
  }

  getAllUsers() {
    if (!this.db) return [];
    try {
      const stmt = this.db.prepare("SELECT user_id, platform FROM user_auth");
      return stmt.all();
    } catch (error) {
      console.error("Error getting all users:", error.message);
      return [];
    }
  }

  size() {
    if (!this.db) return 0;
    try {
      const stmt = this.db.prepare("SELECT COUNT(*) as count FROM user_auth");
      const result = stmt.get();
      return result.count;
    } catch (error) {
      console.error("Error getting size:", error.message);
      return 0;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { SQLiteAuthStore };
