const { WebClient } = require("@slack/web-api");

// Initialize Slack Web Client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// The specific Slack channel to send notifications to
const SLACK_CHANNEL = "C09GW2PEFF0";

// Helper function to format Basecamp updates for Slack
const formatBasecampUpdate = (type, data) => {
  switch (type) {
    case "todo_created":
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🆕 *New Task Created*\n*${data.title}*\n${
                data.description || "No description provided"
              }`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Project:*\n${data.project_name}`,
              },
              {
                type: "mrkdwn",
                text: `*Due:*\n${data.due_date || "No due date"}`,
              },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `👤 Created by ${data.creator_name} • <${data.url}|View in Basecamp>`,
              },
            ],
          },
        ],
      };

    default:
      return {
        text: `Basecamp Update: ${type}\n${JSON.stringify(data, null, 2)}`,
      };
  }
};

// Send notification to Slack
const sendToSlack = async (type, data) => {
  try {
    const message = formatBasecampUpdate(type, data);
    await slack.chat.postMessage({
      channel: SLACK_CHANNEL,
      ...message,
    });
    console.log(
      `Successfully sent ${type} notification to Slack channel ${SLACK_CHANNEL}`
    );
  } catch (error) {
    console.error("Error sending message to Slack:", error);
    throw error;
  }
};

module.exports = { sendToSlack };
