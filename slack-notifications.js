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
            type: "header",
            text: {
              type: "plain_text",
              text: "🆕 New Task Created in Basecamp",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Project:* ${data.project_name}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Task:* ${data.title}\n${
                data.description || "_No description provided_"
              }`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Due Date:*\n${data.due_date || "_Not set_"}`,
              },
              {
                type: "mrkdwn",
                text: `*Created By:*\n${data.creator_name}`,
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View in Basecamp",
                  emoji: true,
                },
                url: data.url,
                style: "primary",
              },
            ],
          },
          {
            type: "divider",
          },
        ],
      };

    case "todo_completed":
      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "✅ Task Completed in Basecamp",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Project:* ${data.project_name}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Task:* ${data.title}`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Completed By:*\n${
                  data.completer_name || data.creator_name
                }`,
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View in Basecamp",
                  emoji: true,
                },
                url: data.url,
              },
            ],
          },
          {
            type: "divider",
          },
        ],
      };

    case "comment_created":
      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "💬 New Comment in Basecamp",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Project:* ${data.project_name}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*On Task:* ${data.title}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Comment:*\n${data.description || "_No content_"}`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Commented By:*\n${data.creator_name}`,
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View in Basecamp",
                  emoji: true,
                },
                url: data.url,
              },
            ],
          },
          {
            type: "divider",
          },
        ],
      };

    default:
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Basecamp Update:* ${type}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "```" + JSON.stringify(data, null, 2) + "```",
            },
          },
        ],
      };
  }
};

// Send notification to Slack
const sendToSlack = async (channelId, type, data) => {
  try {
    const message = formatBasecampUpdate(type, data);
    await slack.chat.postMessage({
      channel: channelId,
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
