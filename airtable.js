const Airtable = require("airtable");

// Initialize Airtable with Personal Access Token
const base = new Airtable({
  apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN,
}).base(process.env.AIRTABLE_BASE_ID);

// Cache for Airtable data
let cachedPeople = null;
let cachedProjectMappings = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch people data from Airtable
 * Expected columns: Name, Email, Slack User ID, Basecamp ID
 */
const fetchPeople = async (forceRefresh = false) => {
  const now = Date.now();

  // Return cached data if still valid
  if (
    !forceRefresh &&
    cachedPeople &&
    cacheTimestamp &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    console.log("Using cached people data from Airtable");
    return cachedPeople;
  }

  console.log("Fetching people from Airtable...");

  try {
    const records = await base(process.env.AIRTABLE_PEOPLE_TABLE || "people")
      .select({
        view: process.env.AIRTABLE_PEOPLE_VIEW || "Grid view",
      })
      .all();

    cachedPeople = records
      .map((record) => ({
        name: record.get("name"),
        email: record.get("email"),
        slack_id: record.get("slack_id"),
        basecamp_id: record.get("basecamp_id"),
      }))
      .filter((person) => person.name && person.email); // Filter out incomplete records

    cacheTimestamp = now;
    console.log(`✅ Fetched ${cachedPeople.length} people from Airtable`);

    return cachedPeople;
  } catch (error) {
    console.error("Error fetching people from Airtable:", error.message);

    // Return cached data if available, even if expired
    if (cachedPeople) {
      console.log("⚠️ Using stale cached data due to Airtable error");
      return cachedPeople;
    }

    throw error;
  }
};

/**
 * Fetch project-to-Slack channel mappings from Airtable
 * Expected columns: Basecamp Project ID, Slack Channel ID
 */
const fetchProjectMappings = async (forceRefresh = false) => {
  const now = Date.now();

  // Return cached data if still valid
  if (
    !forceRefresh &&
    cachedProjectMappings &&
    cacheTimestamp &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    console.log("Using cached project mappings from Airtable");
    return cachedProjectMappings;
  }

  console.log("Fetching project mappings from Airtable...");

  try {
    const records = await base(
      process.env.AIRTABLE_PROJECTS_TABLE || "projects"
    )
      .select({
        view: process.env.AIRTABLE_PROJECTS_VIEW || "Grid view",
      })
      .all();

    const mappings = {};
    records.forEach((record) => {
      const basecampId = record.get("basecamp_id");
      const slackChannelId = record.get("slack_id");

      if (basecampId && slackChannelId) {
        mappings[basecampId] = slackChannelId;
      }
    });

    cachedProjectMappings = mappings;
    cacheTimestamp = now;
    console.log(
      `✅ Fetched ${
        Object.keys(cachedProjectMappings).length
      } project mappings from Airtable`
    );

    return cachedProjectMappings;
  } catch (error) {
    console.error(
      "Error fetching project mappings from Airtable:",
      error.message
    );

    // Return cached data if available, even if expired
    if (cachedProjectMappings) {
      console.log("⚠️ Using stale cached data due to Airtable error");
      return cachedProjectMappings;
    }

    throw error;
  }
};

/**
 * Clear cache (useful for testing or when data is updated)
 */
const clearCache = () => {
  cachedPeople = null;
  cachedProjectMappings = null;
  cacheTimestamp = null;
  console.log("🗑️ Airtable cache cleared");
};

module.exports = {
  fetchPeople,
  fetchProjectMappings,
  clearCache,
};
