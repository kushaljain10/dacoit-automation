import Airtable from "airtable";
import CryptoJS from "crypto-js";

/**
 * AirtableAuthStore - Securely stores Basecamp authentication data in Airtable
 *
 * Tokens are encrypted with AES-256 before storage for security
 */
class AirtableAuthStore {
  constructor() {
    // Initialize Airtable
    this.base = new Airtable({
      apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN,
    }).base(process.env.AIRTABLE_BASE_ID);

    this.tableName = process.env.AIRTABLE_AUTH_TABLE || "auth";
    this.encryptionKey = process.env.ENCRYPTION_KEY;

    if (!this.encryptionKey) {
      console.warn(
        "⚠️ ENCRYPTION_KEY not set! Tokens will be stored unencrypted!"
      );
    }

    // Cache for auth data to reduce API calls
    this.cache = new Map();
    this.cacheTimestamp = new Map();
    this.cacheDuration = 60 * 1000; // 1 minute cache

    console.log("✅ AirtableAuthStore initialized");
  }

  /**
   * Encrypt sensitive data before storing
   */
  encrypt(text) {
    if (!this.encryptionKey) return text;
    return CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
  }

  /**
   * Decrypt data when retrieving
   */
  decrypt(encryptedText) {
    if (!this.encryptionKey) return encryptedText;
    if (!encryptedText) return null;

    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error("Error decrypting data:", error.message);
      return null;
    }
  }

  /**
   * Store auth data for a user
   */
  async set(userId, authData) {
    try {
      console.log(`Storing auth for user ${userId} in Airtable...`);

      // Encrypt sensitive tokens
      const encryptedData = {
        user_id: userId,
        access_token: this.encrypt(authData.access),
        refresh_token: this.encrypt(authData.refresh),
        account_id: authData.accountId,
        platform: authData.platform || "telegram",
        updated_at: new Date().toISOString(),
      };

      // Check if record exists
      const existingRecords = await this.base(this.tableName)
        .select({
          filterByFormula: `{user_id} = '${userId}'`,
          maxRecords: 1,
        })
        .firstPage();

      if (existingRecords.length > 0) {
        // Update existing record
        const recordId = existingRecords[0].id;
        await this.base(this.tableName).update(recordId, encryptedData);
        console.log(`✅ Updated auth for user ${userId}`);
      } else {
        // Create new record
        await this.base(this.tableName).create(encryptedData);
        console.log(`✅ Created auth for user ${userId}`);
      }

      // Update cache
      this.cache.set(userId, authData);
      this.cacheTimestamp.set(userId, Date.now());

      return true;
    } catch (error) {
      console.error(`Error storing auth for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get auth data for a user
   */
  async get(userId) {
    try {
      // Check cache first
      const cachedData = this.cache.get(userId);
      const cacheTime = this.cacheTimestamp.get(userId);

      if (
        cachedData &&
        cacheTime &&
        Date.now() - cacheTime < this.cacheDuration
      ) {
        console.log(`Using cached auth for user ${userId}`);
        return cachedData;
      }

      // Fetch from Airtable
      const records = await this.base(this.tableName)
        .select({
          filterByFormula: `{user_id} = '${userId}'`,
          maxRecords: 1,
        })
        .firstPage();

      if (records.length === 0) {
        console.log(`No auth found for user ${userId}`);
        return null;
      }

      const record = records[0];
      const authData = {
        access: this.decrypt(record.get("access_token")),
        refresh: this.decrypt(record.get("refresh_token")),
        accountId: record.get("account_id"),
        platform: record.get("platform") || "telegram",
      };

      // Update cache
      this.cache.set(userId, authData);
      this.cacheTimestamp.set(userId, Date.now());

      return authData;
    } catch (error) {
      console.error(`Error fetching auth for user ${userId}:`, error.message);

      // Return cached data if available, even if expired
      if (this.cache.has(userId)) {
        console.log(`⚠️ Using stale cached auth for user ${userId}`);
        return this.cache.get(userId);
      }

      return null;
    }
  }

  /**
   * Delete auth data for a user
   */
  async delete(userId) {
    try {
      const records = await this.base(this.tableName)
        .select({
          filterByFormula: `{user_id} = '${userId}'`,
        })
        .firstPage();

      for (const record of records) {
        await this.base(this.tableName).destroy(record.id);
      }

      // Clear cache
      this.cache.delete(userId);
      this.cacheTimestamp.delete(userId);

      console.log(`✅ Deleted auth for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`Error deleting auth for user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Get all user IDs who have auth stored
   */
  async getAllUsers() {
    try {
      const records = await this.base(this.tableName)
        .select({
          fields: ["user_id"],
        })
        .all();

      return records.map((record) => record.get("user_id"));
    } catch (error) {
      console.error("Error fetching all users:", error.message);
      return [];
    }
  }

  /**
   * Get the number of stored authentications
   */
  async size() {
    try {
      const records = await this.base(this.tableName)
        .select({
          fields: ["user_id"],
        })
        .all();

      return records.length;
    } catch (error) {
      console.error("Error getting auth count:", error.message);
      return 0;
    }
  }

  /**
   * Clear all cached data (doesn't delete from Airtable)
   */
  clearCache() {
    this.cache.clear();
    this.cacheTimestamp.clear();
    console.log("🗑️ Auth cache cleared");
  }

  /**
   * Close/cleanup (for compatibility with SQLite store)
   */
  close() {
    this.clearCache();
    console.log("✅ AirtableAuthStore closed");
  }
}

export { AirtableAuthStore };
