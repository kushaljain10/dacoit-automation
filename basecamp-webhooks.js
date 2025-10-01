const axios = require("axios");
const { bc } = require("./basecamp");

// Function to create a webhook for a project
const createWebhookForProject = async (accountId, projectId, access_token) => {
  try {
    const payload = {
      webhook: {
        payload_url: `${process.env.APP_URL}/basecamp/webhook`,
        types: ["todo_created"], // We only want todo creation events
      },
    };

    const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/webhooks.json`;

    const response = await bc(access_token).post(url, JSON.stringify(payload));
    console.log(`✅ Created webhook for project ${projectId}:`, response.data);
    return response.data;
  } catch (error) {
    console.error(
      `❌ Failed to create webhook for project ${projectId}:`,
      error.response?.data || error.message
    );
    throw error;
  }
};

// Function to set up webhooks for all projects
const setupWebhooksForAllProjects = async (accountId, access_token) => {
  try {
    // 1. Get all projects
    const { data: projects } = await bc(access_token).get(
      `https://3.basecampapi.com/${accountId}/projects.json`
    );

    console.log(`Found ${projects.length} projects`);

    // 2. Create webhooks for each project
    const results = await Promise.allSettled(
      projects.map((project) =>
        createWebhookForProject(accountId, project.id, access_token)
      )
    );

    // 3. Log results
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    console.log(`Webhook setup complete:
      - Total projects: ${projects.length}
      - Successfully created: ${successful}
      - Failed: ${failed}
    `);

    return {
      total: projects.length,
      successful,
      failed,
      results,
    };
  } catch (error) {
    console.error("Failed to set up webhooks:", error);
    throw error;
  }
};

// Function to list existing webhooks for a project
const listProjectWebhooks = async (accountId, projectId, access_token) => {
  try {
    const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/webhooks.json`;
    const response = await bc(access_token).get(url);
    return response.data;
  } catch (error) {
    console.error(`Failed to list webhooks for project ${projectId}:`, error);
    throw error;
  }
};

module.exports = {
  setupWebhooksForAllProjects,
  createWebhookForProject,
  listProjectWebhooks,
};
