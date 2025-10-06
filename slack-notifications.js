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
              text: "🆕 Task Created",
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
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: data.creator_slack_id
                  ? `cc: <@${data.creator_slack_id}>`
                  : `cc: ${data.creator_name}`,
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
              text:
                (data.content
                  ? data.content.replace(/<div>/g, "").replace(/<\/div>/g, "")
                  : null) || "_No comment text_",
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Commented by:* ${data.creator_name}`,
            },
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
const sendToSlack = async (channelId, type, data, threadTs = null) => {
  try {
    const message = formatBasecampUpdate(type, data);
    const postParams = {
      channel: channelId,
      ...message,
    };

    // If threadTs is provided, reply to that thread
    if (threadTs) {
      postParams.thread_ts = threadTs;
      postParams.reply_broadcast = true; // Also send to channel
      console.log(`Replying to thread ${threadTs} in channel ${channelId}`);
    }

    const response = await slack.chat.postMessage(postParams);

    console.log(
      `Successfully sent ${type} notification to Slack channel ${channelId}${
        threadTs ? ` (thread: ${threadTs})` : ""
      }`
    );

    // Return the message timestamp (used for thread replies)
    return {
      ts: response.ts,
      channel: response.channel,
    };
  } catch (error) {
    console.error("Error sending message to Slack:", error);
    throw error;
  }
};

// Send a direct message to an assignee about their task assignment
const sendAssigneeDM = async (
  assigneeSlackId,
  taskData,
  isExistingTask = false
) => {
  try {
    if (!assigneeSlackId) {
      console.log("No Slack ID provided, skipping DM");
      return null;
    }

    console.log(`Sending DM to ${assigneeSlackId} about task assignment`);

    // Format due date nicely
    let dueDateText = "No due date";
    if (taskData.due_date) {
      const date = new Date(taskData.due_date);
      if (!isNaN(date.getTime())) {
        dueDateText = date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      } else {
        dueDateText = taskData.due_date;
      }
    }

    const headerText = isExistingTask
      ? "📌 You've been assigned to a task"
      : "🆕 You've been assigned to a new task";

    console.log("Building DM blocks with data:", {
      title: taskData.title,
      description: taskData.description,
      project_name: taskData.project_name,
      due_date: dueDateText,
      creator_name: taskData.creator_name,
      url: taskData.url,
    });

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: headerText,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${taskData.title.replace(/[*_~>`]/g, "\\$&")}*`,
        },
      },
    ];

    // Add description if available
    if (taskData.description) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: taskData.description.replace(/[*_~>`]/g, "\\$&"),
        },
      });
    }

    // Add task details
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Project:* ${(taskData.project_name || "N/A").replace(
            /[*_~>`]/g,
            "\\$&"
          )}`,
        },
        {
          type: "mrkdwn",
          text: `*Due Date:* ${dueDateText.replace(/[*_~>`]/g, "\\$&")}`,
        },
        {
          type: "mrkdwn",
          text: `*Created by:* ${(taskData.creator_name || "Unknown").replace(
            /[*_~>`]/g,
            "\\$&"
          )}`,
        },
      ],
    });

    // Add link to task
    if (taskData.url) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Task in Basecamp",
              emoji: true,
            },
            url: taskData.url,
            style: "primary",
          },
        ],
      });
    }

    const response = await slack.chat.postMessage({
      channel: assigneeSlackId,
      text: `${headerText}: ${taskData.title}`,
      blocks: blocks,
    });

    console.log(
      `✅ DM sent to ${assigneeSlackId} about task: ${taskData.title}`
    );
    return response;
  } catch (error) {
    console.error(`Error sending DM to ${assigneeSlackId}:`, error.message);
    // Don't throw - DM is nice-to-have, not critical
    return null;
  }
};

// Send assignment notification to thread/channel
const sendAssignmentToThread = async (
  channelId,
  threadTs,
  assigneeSlackId,
  taskData
) => {
  try {
    const assigneeMention = assigneeSlackId
      ? `<@${assigneeSlackId}>`
      : "Someone";

    const message = {
      channel: channelId,
      text: `${assigneeMention} has been assigned to this task`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `👤 ${assigneeMention} has been assigned to this task`,
          },
        },
      ],
    };

    // If we have a thread, reply to it and broadcast to channel
    if (threadTs) {
      message.thread_ts = threadTs;
      message.reply_broadcast = true;
      console.log(
        `Replying to thread ${threadTs} with assignment notification`
      );
    } else {
      console.log(
        `No thread found, sending assignment notification to channel ${channelId}`
      );
    }

    const response = await slack.chat.postMessage(message);
    console.log(`✅ Assignment notification sent to channel ${channelId}`);
    return response;
  } catch (error) {
    console.error(`Error sending assignment notification:`, error.message);
    return null;
  }
};

module.exports = { sendToSlack, sendAssigneeDM, sendAssignmentToThread };
