const { WebClient } = require("@slack/web-api");

// Initialize Slack Web Client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Helper function to format Basecamp updates for Slack
const formatBasecampUpdate = (type, data) => {
  switch (type) {
    case "todo_created":
      // Build assignees text with Slack mentions
      let assigneesText = "Not assigned";

      if (
        data.assignees &&
        Array.isArray(data.assignees) &&
        data.assignees.length > 0
      ) {
        assigneesText = data.assignees
          .map((a) => {
            // If we have a slack_id, use Slack mention format
            if (a.slack_id) {
              console.log(
                `Using Slack mention for ${a.name}: <@${a.slack_id}>`
              );
              return `<@${a.slack_id}>`;
            }
            console.log(`No slack_id found for ${a.name}, using name instead`);
            return a.name || a.email_address || "Unknown";
          })
          .join(", ");
      } else if (data.slack_id) {
        // Use slack_id from webhook data if available
        assigneesText = `<@${data.slack_id}>`;
      }

      console.log("Final assignees text for Slack:", assigneesText);

      // Format due date nicely
      let dueDateText = "No due date";
      if (data.due_date) {
        // Basecamp sends dates in YYYY-MM-DD format
        const date = new Date(data.due_date);
        if (!isNaN(date.getTime())) {
          dueDateText = date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        } else {
          dueDateText = data.due_date; // Use as-is if parsing fails
        }
      }

      console.log("Due date formatting:", {
        raw: data.due_date,
        formatted: dueDateText,
      });

      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🆕 New Task Created",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${data.title}*`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: data.description || "_No description provided_",
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Project:* ${data.project_name}`,
              },
              {
                type: "mrkdwn",
                text: `*Due Date:* ${dueDateText}`,
              },
              {
                type: "mrkdwn",
                text: `*Assigned to:* ${assigneesText}`,
              },
              {
                type: "mrkdwn",
                text: `*Created by:* ${data.creator_name}`,
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
        ],
      };

    case "todo_completed":
      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "✅ Task Completed",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${data.title}*`,
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
                text: `*Completed by:*\n${data.completer_name}`,
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
        ],
      };

    case "comment_created":
      return {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "💬 New Comment",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*On task:* ${data.title}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: data.content || "_No comment text_",
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
                text: `*Commented by:*\n${data.creator_name}`,
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
        ],
      };

    default:
      return {
        text: `Basecamp Update: ${type}\n${JSON.stringify(data, null, 2)}`,
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
      `Successfully sent ${type} notification to Slack channel ${channelId}`
    );
  } catch (error) {
    console.error("Error sending message to Slack:", error);
    throw error;
  }
};

module.exports = { sendToSlack };
