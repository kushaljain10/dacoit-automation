const { App } = require("@slack/bolt");
const { processTaskWithAI } = require("./ai");
const { SQLiteAuthStore } = require("./store");
const { bc } = require("./basecamp");

// Initialize Slack app with your credentials
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // Enable Socket Mode
  appToken: process.env.SLACK_APP_TOKEN,
});

// Store for Basecamp auth tokens, shared with Telegram bot
const store = new SQLiteAuthStore();

// Middleware to check Basecamp authentication
const requireAuth = async ({ client, body, next }) => {
  const userId = body.user_id;
  const auth = store.get(userId);

  if (!auth) {
    try {
      // Get the channel ID where the command was triggered
      const channelId = body.channel_id;

      // Create the OAuth URL
      const clientId = process.env.BASECAMP_CLIENT_ID;
      const redirectUri = `${process.env.APP_URL}/oauth/callback/slack`; // We'll create this endpoint
      const authUrl = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${clientId}&redirect_uri=${redirectUri}`;

      await client.chat.postMessage({
        channel: channelId,
        text: "You need to authenticate with Basecamp first!",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🔐 *Basecamp Authentication Required*\n\nYou need to connect your Basecamp account before creating tasks.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Connect Basecamp",
                  emoji: true,
                },
                url: authUrl,
                style: "primary",
              },
            ],
          },
        ],
      });
      return; // Stop processing
    } catch (error) {
      console.error("Error sending auth message:", error);
      await client.chat.postMessage({
        channel: body.channel_id,
        text: "❌ Error: Unable to start authentication process. Please try again.",
      });
      return;
    }
  }

  await next();
};

// Command to start task creation
slackApp.command("/task", requireAuth, async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "task_modal",
        title: {
          type: "plain_text",
          text: "Create Basecamp Task",
        },
        submit: {
          type: "plain_text",
          text: "Next",
        },
        blocks: [
          {
            type: "input",
            block_id: "task_description",
            label: {
              type: "plain_text",
              text: "Task Description",
            },
            element: {
              type: "plain_text_input",
              action_id: "description",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "Describe your task...",
              },
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error opening modal:", error);
    await client.chat.postMessage({
      channel: body.channel_id,
      text: "❌ Error: Unable to open task creation dialog. Please try again.",
    });
  }
});

// Handle task description submission
slackApp.view("task_modal", async ({ ack, body, view, client }) => {
  await ack();

  const userId = body.user.id;
  const description = view.state.values.task_description.description.value;

  try {
    // Process with AI
    const processedTask = await processTaskWithAI(description);

    // Get user's Basecamp auth
    const auth = store.get(userId);
    const { accountId, access } = auth;

    // Fetch projects
    const { data: projects } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/projects.json`
    );

    if (!projects.length) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: "No projects found in your Basecamp account.",
      });
      return;
    }

    // Show project selection
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "project_select_modal",
        title: {
          type: "plain_text",
          text: "Select Project",
        },
        submit: {
          type: "plain_text",
          text: "Next",
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                "*Task Details:*\n" +
                `*Title:* ${processedTask.title}\n` +
                `*Description:* ${processedTask.description}`,
            },
          },
          {
            type: "input",
            block_id: "project_select",
            label: {
              type: "plain_text",
              text: "Select Project",
            },
            element: {
              type: "static_select",
              action_id: "project",
              options: projects.map((p) => ({
                text: {
                  type: "plain_text",
                  text: p.name,
                },
                value: p.id.toString(),
              })),
            },
          },
        ],
        private_metadata: JSON.stringify({
          task: processedTask,
          step: "project_select",
        }),
      },
    });
  } catch (error) {
    console.error("Error processing task:", error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: "❌ Error: Unable to process task. Please try again.",
    });
  }
});

// Help command
slackApp.command("/task-help", async ({ ack, body, client }) => {
  await ack();

  await client.chat.postMessage({
    channel: body.channel_id,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🤖 Basecamp Task Bot Help",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Available Commands:*\n" +
            "• `/task` - Start creating a new task\n" +
            "• `/task-help` - Show this help message\n\n" +
            "_This bot helps you create tasks in Basecamp using AI-powered processing._",
        },
      },
    ],
  });
});

module.exports = { slackApp };
