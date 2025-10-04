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

/**
 * Store Slack message mapping for a Basecamp task
 * This allows us to reply to threads when tasks are updated
 */
const storeTaskMessage = async (
  basecampTaskId,
  slackMessageTs,
  slackChannelId,
  projectId,
  taskTitle
) => {
  try {
    console.log(`Storing task message mapping in Airtable:`, {
      basecampTaskId,
      slackMessageTs,
      slackChannelId,
      projectId,
      taskTitle,
    });

    await base(
      process.env.AIRTABLE_TASK_MESSAGES_TABLE || "task_messages"
    ).create({
      basecamp_task_id: basecampTaskId,
      slack_message_ts: slackMessageTs,
      slack_channel_id: slackChannelId,
      project_id: projectId,
      task_title: taskTitle,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ Stored task message mapping for task ${basecampTaskId}`);
  } catch (error) {
    console.error("Error storing task message mapping:", error.message);
    // Don't throw - this is not critical
  }
};

/**
 * Get Slack message info for a Basecamp task
 * Returns the thread_ts and channel_id to reply to
 */
const getTaskMessage = async (basecampTaskId) => {
  try {
    console.log(`Fetching task message mapping for task ${basecampTaskId}...`);

    const records = await base(
      process.env.AIRTABLE_TASK_MESSAGES_TABLE || "task_messages"
    )
      .select({
        filterByFormula: `{basecamp_task_id} = ${basecampTaskId}`,
        maxRecords: 1,
        sort: [{ field: "created_at", direction: "desc" }], // Get most recent if duplicates
      })
      .firstPage();

    if (records.length > 0) {
      const record = records[0];
      const result = {
        thread_ts: record.get("slack_message_ts"),
        channel_id: record.get("slack_channel_id"),
        task_title: record.get("task_title"),
      };
      console.log(`✅ Found task message mapping:`, result);
      return result;
    }

    console.log(`⚠️ No task message mapping found for task ${basecampTaskId}`);
    return null;
  } catch (error) {
    console.error("Error fetching task message mapping:", error.message);
    return null;
  }
};

module.exports = {
  fetchPeople,
  fetchProjectMappings,
  clearCache,
  storeTaskMessage,
  getTaskMessage,
};
