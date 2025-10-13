import express from "express";
import axios from "axios";
import qs from "qs";
import { Telegraf, Markup, session } from "telegraf";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import fs from "fs";
import path from "path";
import { processTaskWithAI } from "./ai.js";
import { AirtableAuthStore } from "./airtable-store.js";
import { bc } from "./basecamp.js";
import {
  sendToSlack,
  sendAssigneeDM,
  sendAssignmentToThread,
} from "./slack-notifications.js";
import {
  setupWebhooksForAllProjects,
  listProjectWebhooks,
} from "./basecamp-webhooks.js";
import {
  fetchPeople,
  fetchProjectMappings,
  storeTaskMessage,
  getTaskMessage,
  updatePersonStatus,
  getTelegramWhitelist,
} from "./airtable.js";
import {
  getCustomers,
  createCustomer,
  createInvoice,
  invoiceController_create,
  testCopperXAPI,
} from "./copperx.js";
import copperx from "@api/copperx/index.js";
import dotenv from "dotenv";
dotenv.config();
dayjs.extend(customParseFormat);

// Test CopperX API at startup
(async () => {
  console.log("\n🔧 Testing CopperX API connectivity...");
  try {
    const apiTestResults = await testCopperXAPI();

    console.log("\n📊 CopperX API Status:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const formatStatus = (status, error) => {
      if (status === "success") return "✅ Working";
      if (status === "failed") return `❌ Failed${error ? `: ${error}` : ""}`;
      return "⚠️ Unknown";
    };

    console.log(
      `GET /customers:  ${formatStatus(
        apiTestResults.customersGet.status,
        apiTestResults.customersGet.error
      )}`
    );
    console.log(
      `POST /customers: ${formatStatus(
        apiTestResults.customersPost.status,
        apiTestResults.customersPost.error
      )}`
    );
    console.log(
      `POST /invoices:  ${formatStatus(
        apiTestResults.invoicesPost.status,
        apiTestResults.invoicesPost.error
      )}`
    );
    console.log(
      `Authentication: ${formatStatus(
        apiTestResults.authMe.status,
        apiTestResults.authMe.error
      )}`
    );

    if (apiTestResults.error) {
      console.log(`General Error: ${apiTestResults.error}`);
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("❌ Failed to test CopperX API:", error.message);
  }
})();

const {
  TELEGRAM_BOT_TOKEN,
  BASECAMP_CLIENT_ID,
  BASECAMP_CLIENT_SECRET,
  REDIRECT_URI,
  USER_AGENT,
  WHITELIST,
  OPENROUTER_API_KEY,
  OPENROUTER_API_URL,
  PORT = process.env.PORT || 3000,
} = process.env;

// Whitelist will be fetched from Airtable dynamically
let whitelist = new Set();

// Initialize whitelist from Airtable on startup
(async () => {
  try {
    whitelist = await getTelegramWhitelist();
    console.log(`✅ Telegram whitelist loaded: ${whitelist.size} users`);
  } catch (error) {
    console.error("❌ Failed to load telegram whitelist:", error.message);
    // Fallback to env variable if Airtable fails
    whitelist = new Set(
      String(WHITELIST || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    console.log(
      `⚠️ Using fallback whitelist from env: ${whitelist.size} users`
    );
  }
})();

const app = express();
app.use(express.json()); // Add JSON body parser middleware
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Set up bot commands
const commands = [
  { command: "start", description: "Start the bot and connect Basecamp" },
  { command: "stop", description: "Cancel current task creation" },
  { command: "help", description: "Show help and usage instructions" },
  { command: "create_invoice", description: "Create a new invoice" },
  { command: "test_api", description: "Test CopperX API connectivity" },
  { command: "update_status", description: "Update your availability status" },
];

// Set bot commands
(async () => {
  try {
    await bot.telegram.setMyCommands(commands);
    console.log(
      "✅ Bot commands registered:",
      commands.map((c) => c.command).join(", ")
    );
  } catch (error) {
    console.error("❌ Failed to register bot commands:", error.message);
  }
})();

// Debug middleware to log all updates
bot.use((ctx, next) => {
  const update = {
    update_id: ctx.update.update_id,
    type: ctx.updateType,
    chat_type: ctx.chat?.type,
    message: ctx.message
      ? {
          text: ctx.message.text,
          entities: ctx.message.entities?.map((e) => ({
            type: e.type,
            offset: e.offset,
            length: e.length,
            user: e.user
              ? {
                  id: e.user.id,
                  username: e.user.username,
                  first_name: e.user.first_name,
                }
              : undefined,
          })),
          from: {
            id: ctx.message.from?.id,
            username: ctx.message.from?.username,
            first_name: ctx.message.from?.first_name,
          },
          chat: {
            id: ctx.message.chat?.id,
            type: ctx.message.chat?.type,
            title: ctx.message.chat?.title,
          },
        }
      : undefined,
    callback_query: ctx.callbackQuery
      ? {
          id: ctx.callbackQuery.id,
          data: ctx.callbackQuery.data,
          from: {
            id: ctx.callbackQuery.from?.id,
            username: ctx.callbackQuery.from?.username,
          },
        }
      : undefined,
  };

  console.log("\n📨 Raw update received:", JSON.stringify(update, null, 2));
  return next();
});

// Log all errors
bot.catch((err, ctx) => {
  console.error("❌ Bot error:", {
    error: err.message,
    stack: err.stack,
    update: ctx.update,
  });
});

bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.flow) ctx.session.flow = { step: 0, selections: {} };
  return next();
});

bot.catch((err, ctx) => {
  console.error("Bot error for update", ctx.update, err);
});

// Catch-all handler for debugging
bot.use(async (ctx, next) => {
  console.log("🔍 Update received:", {
    update_type: Object.keys(ctx.update)[0],
    from: ctx.from,
    chat: ctx.chat,
  });
  await next();
});

// Initialize Airtable auth store
const store = new AirtableAuthStore();
console.log("✅ Using Airtable for authentication storage");
// Get count asynchronously
store
  .size()
  .then((count) => {
    console.log(`Loaded ${count} authentication(s) from Airtable`);
  })
  .catch((err) => {
    console.error("Error getting auth count:", err.message);
  });

/** ------------ Helpers ------------ **/
// Use shared Basecamp client

// Use shared AI processing

/**
 * Generate AI response for offline user auto-reply
 */
const generateOfflineResponse = async (personName, messageText, senderName) => {
  try {
    const prompt = `Generate a brief, professional auto-reply message (2-3 sentences max) for this scenario:

${personName} is currently unavailable (offline status).
${senderName} sent them a message: "${messageText}"

Write a polite auto-reply that:
1. Informs the sender that ${personName} is currently unavailable
2. Assures them ${personName} will get back to them soon
3. Is contextually relevant to the message content
4. Is friendly and professional

Just provide the response text, no quotes or formatting.`;

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: "anthropic/claude-3.5-sonnet",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiReply = response.data.choices[0].message.content.trim();
    console.log("AI generated offline response:", aiReply);

    return aiReply;
  } catch (error) {
    console.error("Error generating AI response:", error.message);
    // Fallback to generic message
    return `${personName} is currently unavailable and will get back to you soon. Your message has been forwarded to them.`;
  }
};

const requireAuth = async (ctx, next) => {
  const uid = String(ctx.from.id);

  // Refresh whitelist from Airtable periodically (every request for now)
  try {
    whitelist = await getTelegramWhitelist();
  } catch (error) {
    console.error("Error refreshing whitelist:", error.message);
    // Continue with cached whitelist
  }

  if (!whitelist.has(uid)) {
    return ctx.reply("Sorry, you are not authorised to use this bot.");
  }
  const saved = await store.get(uid);
  if (!saved) {
    const link = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${BASECAMP_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&state=${uid}`;
    return ctx.reply(`Connect your Basecamp:\n${link}`);
  }
  return next();
};

// Simple in-chat wizard state
const resetFlow = async (ctx) => {
  // Clean up any remaining messages
  if (ctx.session.flow) {
    if (ctx.session.flow.projectMessages) {
      await cleanupMessages(ctx, ctx.session.flow.projectMessages);
    }
    if (ctx.session.flow.todoListMessages) {
      await cleanupMessages(ctx, ctx.session.flow.todoListMessages);
    }
    if (ctx.session.flow.assigneeMessages) {
      await cleanupMessages(ctx, ctx.session.flow.assigneeMessages);
    }
    if (ctx.session.flow.confirmationMessages) {
      await cleanupMessages(ctx, ctx.session.flow.confirmationMessages);
    }
  }

  ctx.session.flow = { step: 0, selections: {} };
};

// Reset invoice creation flow
const resetInvoiceFlow = (ctx) => {
  if (ctx.session.invoiceFlow) {
    console.log("🛑 Resetting invoice creation flow");
    delete ctx.session.invoiceFlow;
  }
};

const cleanupMessages = async (ctx, messageIds) => {
  if (!messageIds || !Array.isArray(messageIds)) return;

  for (const messageId of messageIds) {
    try {
      await ctx.deleteMessage(messageId);
    } catch (error) {
      // Ignore errors if message is already deleted or can't be deleted
      console.log(`Could not delete message ${messageId}:`, error.message);
    }
  }
};

const askTaskDescription = async (ctx) =>
  ctx.reply(
    "What's the task? (Describe the work to be done, client request, or copy/paste any message)"
  );

// Helper function to match and process task data
const processTaskData = async (
  taskData,
  context,
  access,
  accountId,
  basecampPeople = null
) => {
  const result = {
    title: taskData.title,
    description: taskData.description,
    projectId: null,
    assigneeId: null,
    assigneeEmail: null,
    slackUserId: null,
    dueOn: null,
  };

  // Try to match project name to project ID
  if (taskData.project_name && context.projects.length > 0) {
    const matchedProject = context.projects.find(
      (p) =>
        p.name.toLowerCase() === taskData.project_name.toLowerCase() ||
        p.name.toLowerCase().includes(taskData.project_name.toLowerCase())
    );
    if (matchedProject) {
      result.projectId = matchedProject.id;
      console.log(
        `AI matched project: ${matchedProject.name} (${matchedProject.id})`
      );
    }
  }

  // Try to match assignee names to person
  if (
    taskData.assignee_names &&
    taskData.assignee_names.length > 0 &&
    context.people.length > 0
  ) {
    const name = taskData.assignee_names[0]; // Use first assignee
    console.log(`Trying to match assignee: "${name}"`);
    console.log(
      `Available people:`,
      context.people.map((p) => p.name)
    );

    const matchedPerson = context.people.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() ||
        p.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(p.name.toLowerCase())
    );

    if (matchedPerson) {
      result.assigneeEmail = matchedPerson.email;
      result.slackUserId = matchedPerson.slack_id;

      console.log(
        `✅ AI matched assignee: ${matchedPerson.name} (${matchedPerson.email})`
      );

      // Check if Airtable has basecamp_id directly
      if (matchedPerson.basecamp_id) {
        result.assigneeId = matchedPerson.basecamp_id;
        console.log(`✅ Using Basecamp ID from Airtable: ${result.assigneeId}`);
        console.log(`   assigneeEmail: ${result.assigneeEmail}`);
        console.log(`   assigneeId: ${result.assigneeId}`);
        console.log(`   ⚡ Skipped email matching - using direct ID mapping`);
      } else {
        // Fallback: Find Basecamp user ID by email matching
        console.log(
          `⚠️ No basecamp_id in Airtable for ${matchedPerson.name}, falling back to email matching`
        );

        try {
          // Fetch Basecamp people only if not already provided
          if (!basecampPeople) {
            const { data } = await bc(access).get(
              `https://3.basecampapi.com/${accountId}/people.json`
            );
            basecampPeople = data;
            console.log(
              `Fetched ${basecampPeople.length} Basecamp people for ID matching`
            );
          }

          console.log(
            `Looking for Basecamp user with email: ${matchedPerson.email}`
          );

          const basecampPerson = basecampPeople.find(
            (bp) =>
              bp.email_address &&
              bp.email_address.toLowerCase() ===
                matchedPerson.email.toLowerCase()
          );

          if (basecampPerson) {
            result.assigneeId = basecampPerson.id;
            console.log(
              `✅ EMAIL MATCHED! Basecamp user ID: ${basecampPerson.id} (${basecampPerson.name})`
            );
            console.log(
              `   Recommendation: Add basecamp_id ${basecampPerson.id} to Airtable for ${matchedPerson.name}`
            );
          } else {
            console.error(
              `❌ EMAIL NOT FOUND! No Basecamp user with email: "${matchedPerson.email}"`
            );
            console.error(
              `   Add basecamp_id to Airtable to avoid email matching`
            );
          }
        } catch (error) {
          console.error(
            "Error fetching Basecamp people for email match:",
            error.message
          );
        }
      }
    } else {
      console.log(`❌ No match found for assignee: "${name}"`);
    }
  } else {
    console.log(`No assignee to match:`, {
      has_assignee_names: !!taskData.assignee_names,
      assignee_names_length: taskData.assignee_names?.length,
      has_people: context.people.length > 0,
      people_count: context.people.length,
    });
  }

  // Parse and store due date if extracted
  if (taskData.due_date) {
    const parsedDue = parseDue(taskData.due_date);
    if (parsedDue) {
      result.dueOn = parsedDue;
      console.log(`AI extracted due date: ${taskData.due_date} → ${parsedDue}`);
    }
  }

  // Final summary of what was extracted/matched
  console.log(`\n📋 FINAL TASK DATA:`);
  console.log(`   Title: ${result.title}`);
  console.log(`   Project ID: ${result.projectId || "NOT SET"}`);
  console.log(`   Assignee Email: ${result.assigneeEmail || "NOT SET"}`);
  console.log(
    `   Assignee ID (Basecamp): ${result.assigneeId || "NOT SET ⚠️"}`
  );
  console.log(`   Due Date: ${result.dueOn || "NOT SET"}`);

  if (result.assigneeEmail && !result.assigneeId) {
    console.error(
      `\n⚠️⚠️⚠️ CRITICAL ISSUE: Email found but Basecamp ID missing!`
    );
    console.error(
      `   This means the email in Airtable doesn't match any Basecamp user`
    );
    console.error(
      `   Check for typos or case differences in the email address in Airtable`
    );
  }

  return result;
};

const showTaskConfirmation = async (ctx, title, description) => {
  try {
    console.log("📝 Showing task confirmation for:", { title, description });

    // Clean up any existing confirmation messages
    if (ctx.session.flow?.confirmationMessages?.length) {
      console.log(
        "🧹 Cleaning up old confirmation messages:",
        ctx.session.flow.confirmationMessages
      );
      await cleanupMessages(ctx, ctx.session.flow.confirmationMessages);
      ctx.session.flow.confirmationMessages = [];
    }

    // Store task details in session
    if (!ctx.session.flow) {
      ctx.session.flow = { step: 0, selections: {} };
    }
    ctx.session.flow.selections = {
      ...ctx.session.flow.selections,
      title,
      description,
    };

    const confirmationText = `🤖 *AI Processed Task:*\n\n*Title:* ${title.replace(
      /[_*[\]()~`>#+\-=|{}.!]/g,
      "\\$&"
    )}\n\n*Description:* ${description.replace(
      /[_*[\]()~`>#+\-=|{}.!]/g,
      "\\$&"
    )}\n\nIs this correct?`;

    console.log("💬 Sending confirmation message with buttons");
    const message = await ctx.reply(confirmationText, {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm", callback_data: "confirm_task" },
            { text: "🔄 Rewrite", callback_data: "rewrite_task" },
          ],
        ],
      },
    });
    console.log("✅ Confirmation message sent:", message.message_id);

    // Track this message for cleanup
    if (!ctx.session.flow.confirmationMessages) {
      ctx.session.flow.confirmationMessages = [];
    }
    ctx.session.flow.confirmationMessages.push(message.message_id);

    return message;
  } catch (error) {
    console.error("Error showing task confirmation:", error);
    // Try without markdown
    const message = await ctx.reply(
      `🤖 AI Processed Task:\n\nTitle: ${title}\n\nDescription: ${description}\n\nIs this correct?`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Confirm", "confirm_task")],
          [Markup.button.callback("🔄 Rewrite", "rewrite_task")],
        ]),
      }
    );

    if (!ctx.session.flow.confirmationMessages) {
      ctx.session.flow.confirmationMessages = [];
    }
    ctx.session.flow.confirmationMessages.push(message.message_id);

    return message;
  }
};

const askProject = async (ctx, page = 0) => {
  console.log("\n📂 Showing project selection, page:", page);
  const { access, accountId } = await store.get(String(ctx.from.id));

  try {
    const { data: projects } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/projects.json`
    );

    console.log(
      `Available projects for account ${accountId}:`,
      projects.map((p) => ({ id: p.id, name: p.name, status: p.status }))
    );

    if (!projects.length) {
      console.log("❌ No projects found in Basecamp");
      return ctx.reply(
        "No projects found in your Basecamp account. Please make sure you have access to at least one project."
      );
    }

    console.log("Storing projects in session");
    ctx.session.flow.projects = projects.map((p) => ({
      id: p.id,
      name: p.name,
    }));
    console.log("Projects stored in session:", ctx.session.flow.projects);

    // Pagination logic
    const itemsPerPage = 8; // Show 8 projects + navigation buttons
    const startIndex = page * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentPageProjects = projects.slice(startIndex, endIndex);
    const hasMore = endIndex < projects.length;
    const hasPrevious = page > 0;

    // Create project buttons
    const buttons = currentPageProjects.map((p) => [
      Markup.button.callback(p.name, `proj_${p.id}`),
    ]);

    // Add navigation buttons
    const navButtons = [];
    if (hasPrevious) {
      navButtons.push(
        Markup.button.callback("⬅️ Previous", `proj_page_${page - 1}`)
      );
    }
    if (hasMore) {
      navButtons.push(
        Markup.button.callback("➡️ Show More", `proj_page_${page + 1}`)
      );
    }

    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }

    const pageInfo =
      projects.length > itemsPerPage
        ? ` (${startIndex + 1}-${Math.min(endIndex, projects.length)} of ${
            projects.length
          })`
        : "";

    console.log("Sending project selection message with buttons:", buttons);
    try {
      const message = await ctx.reply(
        `Choose a project${pageInfo}:`,
        Markup.inlineKeyboard(buttons)
      );

      console.log("Project selection message sent:", {
        message_id: message.message_id,
        chat_id: message.chat.id,
      });

      // Track this message for cleanup later
      if (!ctx.session.flow.projectMessages) {
        ctx.session.flow.projectMessages = [];
      }
      ctx.session.flow.projectMessages.push(message.message_id);
      console.log("Message ID stored for cleanup:", message.message_id);

      return message;
    } catch (error) {
      console.error("❌ Failed to send project selection message:", error);
      await ctx.reply(
        "Sorry, there was an error showing the project list. Please try again or contact support."
      );
      throw error;
    }
  } catch (error) {
    console.error(`Error fetching projects:`, {
      status: error.response?.status,
      error: error.response?.data,
    });
    return ctx.reply(
      "Error fetching projects. Please check your Basecamp permissions."
    );
  }
};

const askTodoList = async (ctx, page = 0) => {
  const f = ctx.session.flow;

  // Get projectId based on flow type
  let projectId;
  if (f.step === 8) {
    // Batch task flow - get projectId from the current batch task
    const needingInfo =
      f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
    const taskIndex = needingInfo.index;
    projectId = f.selections.batchTasks[taskIndex].projectId;
    console.log(
      `[Batch Task] Getting todo lists for project ${projectId}, task index ${taskIndex}`
    );
  } else {
    // Single task flow
    projectId = f.selections.projectId;
    console.log(`[Single Task] Getting todo lists for project ${projectId}`);
  }

  if (!projectId) {
    console.error("❌ No projectId found in session:", {
      step: f.step,
      selections: f.selections,
    });
    return ctx.reply("❌ Error: No project selected. Please try again.");
  }

  try {
    // Fetch all todo lists for the project
    const { lists } = await fetchTodoLists(ctx, projectId);

    if (!lists || lists.length === 0) {
      return ctx.reply("No to-do lists found in this project.");
    }

    // Store lists in session for later use
    f.todoLists = lists.map((l) => ({
      id: l.id,
      name: l.name,
      status: l.status,
    }));

    console.log(
      `Found ${lists.length} todo lists in project ${projectId}:`,
      f.todoLists
    );

    // If only one list, auto-select it and move to next step
    if (lists.length === 1) {
      console.log(`Only one todo list found, auto-selecting: ${lists[0].name}`);
      f.selections.todoListId = lists[0].id;
      f.step = 5; // Move to assignee selection
      return askAssignee(ctx);
    }

    // Multiple lists - show pagination
    const itemsPerPage = 8;
    const startIndex = page * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentPageLists = lists.slice(startIndex, endIndex);
    const hasMore = endIndex < lists.length;
    const hasPrevious = page > 0;

    // Create list buttons
    const buttons = currentPageLists.map((l) => {
      const displayName =
        l.status === "archived" ? `${l.name} (archived)` : l.name;
      return [Markup.button.callback(displayName, `list_${l.id}`)];
    });

    // Add navigation buttons
    const navButtons = [];
    if (hasPrevious) {
      navButtons.push(
        Markup.button.callback("⬅️ Previous", `list_page_${page - 1}`)
      );
    }
    if (hasMore) {
      navButtons.push(
        Markup.button.callback("➡️ Show More", `list_page_${page + 1}`)
      );
    }

    if (navButtons.length > 0) {
      buttons.push(navButtons);
    }

    const pageInfo =
      lists.length > itemsPerPage
        ? ` (${startIndex + 1}-${Math.min(endIndex, lists.length)} of ${
            lists.length
          })`
        : "";

    const message = await ctx.reply(
      `Which to-do list should this task be added to?${pageInfo}:`,
      Markup.inlineKeyboard(buttons)
    );

    // Track this message for cleanup later
    if (!f.todoListMessages) {
      f.todoListMessages = [];
    }
    f.todoListMessages.push(message.message_id);

    return message;
  } catch (error) {
    console.error(`Error fetching todo lists:`, {
      status: error.response?.status,
      error: error.response?.data,
      projectId,
    });
    return ctx.reply(
      "Error fetching to-do lists. Please check your Basecamp permissions."
    );
  }
};

const askAssignee = async (ctx, page = 0) => {
  const { access, accountId } = await store.get(String(ctx.from.id));
  const projectId = ctx.session.flow.selections.projectId;

  try {
    // Fetch people who are part of the selected project
    const { data: people } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/projects/${projectId}/people.json`
    );

    console.log(
      `Found ${people.length} people in project ${projectId}:`,
      people.map((p) => ({ id: p.id, name: p.name, email: p.email_address }))
    );

    if (!people.length) {
      return ctx.reply(
        "No people found in this project. You can still create the task without an assignee."
      );
    }

    ctx.session.flow.people = people.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email_address,
    }));

    return await buildAssigneeKeyboard(ctx, people, page, false);
  } catch (error) {
    console.error(`Error fetching project people:`, {
      status: error.response?.status,
      error: error.response?.data,
      projectId,
    });

    // Fallback to account-wide people if project-specific fails
    console.log(`Falling back to account-wide people...`);
    const { data: people } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/people.json`
    );

    ctx.session.flow.people = people.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email_address,
    }));

    return await buildAssigneeKeyboard(ctx, people, page, true);
  }
};

const buildAssigneeKeyboard = async (ctx, people, page, isAccountWide) => {
  // Pagination logic
  const itemsPerPage = 7; // Show 7 people + "No assignee" + navigation buttons
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPagePeople = people.slice(startIndex, endIndex);
  const hasMore = endIndex < people.length;
  const hasPrevious = page > 0;

  // Always add "No assignee" option at the top
  const buttons = [[Markup.button.callback("➡️ No assignee", `person_none`)]];

  // Add people buttons
  currentPagePeople.forEach((p) => {
    buttons.push([Markup.button.callback(p.name, `person_${p.id}`)]);
  });

  // Add navigation buttons
  const navButtons = [];
  if (hasPrevious) {
    navButtons.push(
      Markup.button.callback("⬅️ Previous", `person_page_${page - 1}`)
    );
  }
  if (hasMore) {
    navButtons.push(
      Markup.button.callback("➡️ Show More", `person_page_${page + 1}`)
    );
  }

  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  const pageInfo =
    people.length > itemsPerPage
      ? ` (${startIndex + 1}-${Math.min(endIndex, people.length)} of ${
          people.length
        })`
      : "";

  const message = isAccountWide
    ? `Who should this be assigned to? (showing all account members)${pageInfo}:`
    : `Who should this be assigned to?${pageInfo}:`;

  const replyMessage = await ctx.reply(message, Markup.inlineKeyboard(buttons));

  // Track this message for cleanup later
  if (!ctx.session.flow.assigneeMessages) {
    ctx.session.flow.assigneeMessages = [];
  }
  ctx.session.flow.assigneeMessages.push(replyMessage.message_id);

  return replyMessage;
};

const askDueDate = async (ctx) =>
  ctx.reply(
    'Due date? (e.g. 2025-10-12, "today", "tomorrow", "in 3 days", or type "skip" to skip)'
  );

// Helper functions for batch task processing
const askBatchTaskInfo = async (ctx) => {
  const f = ctx.session.flow;
  const needingInfo =
    f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
  const task = needingInfo.task;

  // Store what we're asking for - updated to include todo list selection
  if (needingInfo.needsProject) {
    f.selections.currentBatchTaskQuestion = "project";
  } else if (needingInfo.needsTodoList) {
    f.selections.currentBatchTaskQuestion = "todoList";
  } else if (needingInfo.needsDueDate) {
    f.selections.currentBatchTaskQuestion = "dueDate";
  }

  if (needingInfo.needsProject) {
    await ctx.reply(
      `📋 **Task ${needingInfo.index + 1}:** ${
        task.title
      }\n\nProject not found. Please select a project:`,
      { parse_mode: "Markdown" }
    );
    f.step = 7; // Batch project selection
    return askProject(ctx);
  } else if (needingInfo.needsTodoList) {
    await ctx.reply(
      `📋 **Task ${needingInfo.index + 1}:** ${
        task.title
      }\n\nPlease select a to-do list:`,
      { parse_mode: "Markdown" }
    );
    f.step = 8; // Batch todo list selection
    return askTodoList(ctx);
  } else if (needingInfo.needsDueDate) {
    await ctx.reply(
      `📋 **Task ${needingInfo.index + 1}:** ${
        task.title
      }\n\nDue date? (e.g. 2025-10-12, "today", "tomorrow", "in 3 days", or type "skip" to skip)`,
      { parse_mode: "Markdown" }
    );
    f.step = 9; // Batch due date input
    return;
  }
};

const createBatchTasks = async (ctx, processedTasks, basecampPeople) => {
  const results = [];

  for (const processedTask of processedTasks) {
    console.log(`\n🔄 Processing task for creation:`, {
      title: processedTask.title,
      projectId: processedTask.projectId,
      assigneeId: processedTask.assigneeId,
      assigneeEmail: processedTask.assigneeEmail,
      dueOn: processedTask.dueOn,
    });

    // Skip tasks without project
    if (!processedTask.projectId) {
      results.push({
        success: false,
        title: processedTask.title,
        error: "No project specified",
      });
      continue;
    }

    try {
      // Get todo list for the project
      let list;
      if (processedTask.todoListId) {
        // Use the pre-selected todo list
        list = { id: processedTask.todoListId };
        console.log(
          `Using pre-selected todo list ${processedTask.todoListId} for task ${processedTask.title}`
        );
      } else {
        // Choose default todo list
        list = await chooseDefaultTodoList(ctx, processedTask.projectId);
      }

      // Verify assignee is part of the project if assigneeId is provided
      if (processedTask.assigneeId) {
        try {
          const { access, accountId } = await store.get(String(ctx.from.id));
          const { data: projectPeople } = await bc(access).get(
            `https://3.basecampapi.com/${accountId}/projects/${processedTask.projectId}/people.json`
          );

          console.log(
            `\n🔍 Verifying assignee ${
              processedTask.assigneeId
            } (type: ${typeof processedTask.assigneeId}) is in project ${
              processedTask.projectId
            }`
          );
          console.log(
            `Project people:`,
            projectPeople.map(
              (p) => `${p.name} (ID: ${p.id}, type: ${typeof p.id})`
            )
          );

          // Use loose equality (==) to handle string vs number comparison
          const isInProject = projectPeople.some((p) => {
            const match = p.id == processedTask.assigneeId;
            if (match) {
              console.log(
                `   ✅ Match found: ${p.id} (${typeof p.id}) == ${
                  processedTask.assigneeId
                } (${typeof processedTask.assigneeId})`
              );
            }
            return match;
          });

          if (!isInProject) {
            console.error(
              `\n⚠️ WARNING: Assignee ID ${processedTask.assigneeId} is NOT part of project ${processedTask.projectId}!`
            );
            console.error(
              `Available people in project:`,
              projectPeople.map((p) => `${p.name} (ID: ${p.id})`)
            );
            console.error(
              `⚠️ HOWEVER, we'll still try to assign - Basecamp will reject if truly invalid`
            );
            // DON'T set to null - let Basecamp API handle validation
            // The check might be wrong due to caching or API inconsistencies
          } else {
            const assigneePerson = projectPeople.find(
              (p) => p.id == processedTask.assigneeId
            );
            console.log(
              `✅ Assignee verified: ${assigneePerson.name} (ID: ${assigneePerson.id}) is in the project`
            );
          }
        } catch (verifyError) {
          console.error(
            `Error verifying assignee in project:`,
            verifyError.message
          );
          // Continue anyway - let Basecamp handle it
        }
      }

      // Create the task
      const todo = await createTodo(ctx, {
        projectId: processedTask.projectId,
        todoListId: list.id,
        title: processedTask.title,
        description: processedTask.description,
        assigneeId: processedTask.assigneeId,
        dueOn: processedTask.dueOn,
      });

      // Get project name for notification
      const { access, accountId } = await store.get(String(ctx.from.id));
      let projectName = "Unknown Project";
      try {
        const { data: project } = await bc(access).get(
          `https://3.basecampapi.com/${accountId}/projects/${processedTask.projectId}.json`
        );
        projectName = project.name;
      } catch (error) {
        console.error("Error fetching project name:", error.message);
      }

      const creatorName =
        ctx.from?.first_name || ctx.from?.username || "Unknown";

      // Send DM to assignee if assigned
      if (processedTask.slackUserId) {
        await notifyAssignees(
          todo,
          projectName,
          creatorName,
          processedTask.slackUserId
        );
      } else if (processedTask.assigneeId) {
        await notifyAssignees(todo, projectName, creatorName);
      }

      results.push({
        success: true,
        title: processedTask.title,
        url: todo.app_url,
        assigneeEmail: processedTask.assigneeEmail,
        assigneeId: processedTask.assigneeId,
      });
    } catch (error) {
      console.error(
        `Error creating task "${processedTask.title}":`,
        error.message
      );
      results.push({
        success: false,
        title: processedTask.title,
        error: error.message,
      });
    }
  }

  return results;
};

const sendBatchTaskSummary = async (ctx, results) => {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  let summaryText = `✅ **Batch Task Creation Complete**\n\n`;
  summaryText += `📊 Created ${successCount} task(s), ${failCount} failed\n\n`;

  results.forEach((result, index) => {
    if (result.success) {
      summaryText += `✅ ${index + 1}. ${result.title}\n   ${result.url}`;
      if (result.assigneeEmail) {
        summaryText += `\n   👤 Assigned to: ${result.assigneeEmail}`;
      } else {
        summaryText += `\n   ⚠️ No assignee`;
      }
      summaryText += `\n\n`;
    } else {
      summaryText += `❌ ${index + 1}. ${result.title}\n   Error: ${
        result.error
      }\n\n`;
    }
  });

  return ctx.reply(summaryText, { parse_mode: "Markdown" });
};

const parseDue = (text) => {
  // Handle skip option
  if (text.toLowerCase() === "skip") {
    return null;
  }

  // Handle today
  if (text.toLowerCase() === "today") {
    return dayjs().format("YYYY-MM-DD");
  }

  // Handle tomorrow
  if (text.toLowerCase() === "tomorrow") {
    return dayjs().add(1, "day").format("YYYY-MM-DD");
  }

  // Handle "in X days"
  if (/in\s+(\d+)\s+day/i.test(text)) {
    const n = parseInt(RegExp.$1, 10);
    return dayjs().add(n, "day").format("YYYY-MM-DD");
  }

  // Accept several formats and normalise to YYYY-MM-DD (Basecamp uses due_on)
  const formats = [
    "YYYY-MM-DD",
    "DD-MM-YYYY",
    "D-M-YYYY",
    "DD/MM/YYYY",
    "D/M/YYYY",
  ];

  for (const f of formats) {
    const d = dayjs(text, f, true);
    if (d.isValid()) return d.format("YYYY-MM-DD");
  }

  // last resort: natural parse (not strict)
  const d2 = dayjs(text);
  return d2.isValid() ? d2.format("YYYY-MM-DD") : null;
};

const createTodoList = async (
  ctx,
  projectId,
  todosetId,
  name = "To-Do List"
) => {
  const { access, accountId } = await store.get(String(ctx.from.id));

  try {
    const payload = {
      name: name,
      description: "Default to-do list created automatically",
    };
    const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todosets/${todosetId}/todolists.json`;

    console.log(`Creating todolist with payload:`, payload);
    console.log(`POST URL: ${url}`);

    const { data } = await bc(access).post(url, payload);
    console.log(`Successfully created todolist:`, data);
    return data;
  } catch (error) {
    console.error(`Error creating todolist:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      projectId,
      todosetId,
      name,
    });
    throw error;
  }
};

// Fetch all todo lists for a project
const fetchTodoLists = async (ctx, projectId) => {
  const { access, accountId } = await store.get(String(ctx.from.id));

  try {
    console.log(
      `Fetching todo lists for project ${projectId}, account ${accountId}`
    );

    // Get the project data which includes the dock with todoset ID
    const { data: project } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/projects/${projectId}.json`
    );
    console.log(`Project verified:`, {
      id: project.id,
      name: project.name,
      status: project.status,
    });

    // Find the todoset from the dock
    const todosetDock = project.dock.find((item) => item.name === "todoset");
    if (!todosetDock) {
      throw new Error(
        `No todoset found in project dock. To-dos might not be enabled in this project.`
      );
    }

    console.log(`Found todoset in dock:`, todosetDock);
    const todosetId = todosetDock.id;

    // Get the todoset details
    const { data: todoset } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todosets/${todosetId}.json`
    );
    console.log(`Todoset details:`, todoset);

    if (!todoset || !todoset.id) {
      throw new Error(`No valid todoset found in project ${projectId}`);
    }

    // Fetch lists inside that todoset
    const listsUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todosets/${todoset.id}/todolists.json`;
    console.log(`Fetching lists from: ${listsUrl}`);

    const { data: lists } = await bc(access).get(listsUrl);
    console.log(`Found ${lists?.length || 0} existing lists:`, lists);

    // If no lists exist, create a default one
    if (!lists || lists.length === 0) {
      console.log(
        `No todo lists found in project ${projectId}, creating default list...`
      );
      const newList = await createTodoList(ctx, projectId, todoset.id, "Tasks");
      console.log(`Created new list:`, newList);
      return { todosetId: todoset.id, lists: [newList] };
    }

    return { todosetId: todoset.id, lists };
  } catch (error) {
    console.error(`Error in fetchTodoLists:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      projectId,
      accountId,
    });
    throw error;
  }
};

// Legacy function - kept for backward compatibility
const chooseDefaultTodoList = async (ctx, projectId) => {
  const { lists } = await fetchTodoLists(ctx, projectId);

  // Pick the first active list; fallback to any
  const open = lists.find((l) => l.status === "active") || lists[0];
  console.log(`Selected default list:`, open);
  return open;
};

const createTodo = async (
  ctx,
  { projectId, todoListId, title, description, assigneeId, dueOn }
) => {
  const { access, accountId } = await store.get(String(ctx.from.id));

  console.log(`\n🔵 createTodo called with:`, {
    title,
    projectId,
    todoListId,
    assigneeId,
    assigneeId_type: typeof assigneeId,
    dueOn,
  });

  const payload = {
    todo: {
      content: title,
      description: description || undefined,
      // Use assignee_ids as array of IDs (from Basecamp 3 API docs)
      assignee_ids: assigneeId ? [assigneeId] : [],
      due_on: dueOn || undefined, // YYYY-MM-DD
    },
  };

  console.log(`📤 Sending to Basecamp API:`, {
    content: payload.todo.content,
    assignee_ids: payload.todo.assignee_ids,
    assignee_ids_length: payload.todo.assignee_ids.length,
    due_on: payload.todo.due_on,
  });

  const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todolists/${todoListId}/todos.json`;
  console.log(`POST URL: ${url}`);

  const response = await bc(access).post(url, payload);
  const { data } = response;

  console.log(`✅ API Response Status:`, response.status);
  console.log(`📥 Basecamp returned:`, {
    id: data.id,
    content: data.content,
    assignee: data.assignee,
    assignees: data.assignees,
    assignees_length: data.assignees?.length || 0,
    due_on: data.due_on,
    status: data.status,
    app_url: data.app_url,
  });

  // Verify assignment
  if (assigneeId && (!data.assignees || data.assignees.length === 0)) {
    console.error(`\n❌ ASSIGNMENT FAILED!`);
    console.error(`   Sent assignee_ids: [${assigneeId}]`);
    console.error(`   Received assignees:`, data.assignees);
    console.error(`   This could indicate:`);
    console.error(`   - Invalid assignee ID`);
    console.error(`   - User not part of the project`);
    console.error(`   - Permission issue`);
  } else if (assigneeId && data.assignees && data.assignees.length > 0) {
    console.log(
      `✅ Task successfully assigned to:`,
      data.assignees.map((a) => `${a.name} (ID: ${a.id})`)
    );
  }

  // Log the full response to see what fields are available
  console.log(`Full response data keys:`, Object.keys(data));

  return data; // includes id, app_url, etc.
};

// Helper function to send DMs to assignees after task creation
const notifyAssignees = async (
  todo,
  projectName,
  creatorName,
  assigneeSlackId = null
) => {
  try {
    console.log("📧 notifyAssignees called with:", {
      taskTitle: todo.content || todo.title,
      projectName,
      creatorName,
      assigneeSlackId,
      hasAssignees: !!(todo.assignees && todo.assignees.length > 0),
    });

    // Get assignees from the todo response
    const assignees = todo.assignees || [];

    if (assignees.length === 0 && !assigneeSlackId) {
      console.log(
        "⚠️ No assignees to notify (no assignees in todo and no slackUserId provided)"
      );
      return;
    }

    // Fetch Airtable people to get Slack IDs
    console.log("Fetching people from Airtable for Slack ID matching...");
    const airtablePeople = await fetchPeople();
    console.log(`Found ${airtablePeople.length} people in Airtable`);

    // If assigneeSlackId is provided, use it directly
    if (assigneeSlackId) {
      console.log(`📧 Sending DM using provided Slack ID: ${assigneeSlackId}`);
      const taskData = {
        title: todo.content || todo.title,
        description: todo.description || "",
        project_name: projectName,
        due_date: todo.due_on,
        creator_name: creatorName,
        url: todo.app_url,
      };

      await sendAssigneeDM(assigneeSlackId, taskData, false);
      console.log(`✅ DM sent successfully to ${assigneeSlackId}`);
      return;
    }

    // Otherwise, get Slack IDs from assignees
    for (const assignee of assignees) {
      // Try to find the person in Airtable by Basecamp ID first, then by email
      let airtablePerson = airtablePeople.find(
        (ap) => ap.basecamp_id && ap.basecamp_id == assignee.id
      );

      if (!airtablePerson && assignee.email_address) {
        airtablePerson = airtablePeople.find(
          (ap) =>
            ap.email &&
            ap.email.toLowerCase() === assignee.email_address.toLowerCase()
        );
      }

      if (airtablePerson && airtablePerson.slack_id) {
        console.log(
          `📧 Sending DM to ${assignee.name} (Slack ID: ${airtablePerson.slack_id})`
        );

        const taskData = {
          title: todo.content || todo.title,
          description: todo.description || "",
          project_name: projectName,
          due_date: todo.due_on,
          creator_name: creatorName,
          url: todo.app_url,
        };

        await sendAssigneeDM(airtablePerson.slack_id, taskData, false);
        console.log(`✅ DM sent successfully to ${assignee.name}`);
      } else {
        console.log(
          `⚠️ No Slack ID found for assignee ${assignee.name} (${assignee.email_address})`
        );
        console.log(`   Airtable person found: ${!!airtablePerson}`);
        if (airtablePerson) {
          console.log(`   But slack_id is missing in Airtable record`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error notifying assignees:", error.message);
    console.error("Stack trace:", error.stack);
    // Don't throw - this is not critical
  }
};

/** ------------ Invoice Creation Helpers ------------ **/

const askCustomer = async (ctx, offset = 0) => {
  try {
    const limit = 10;
    const response = await getCustomers({ limit, offset });

    const customers = response.data || [];
    const total = response.meta?.total || customers.length;
    const hasMore = offset + customers.length < total;
    const hasPrevious = offset > 0;

    // Build customer options
    const buttons = [];

    // Add "Add New Customer" button as first option
    buttons.push([
      Markup.button.callback("➕ Add New Customer", "invoice_customer_new"),
    ]);

    // Add customer buttons
    customers.forEach((customer) => {
      const displayText = `${customer.name}${
        customer.email ? ` (${customer.email})` : ""
      }`;
      buttons.push([
        Markup.button.callback(displayText, `invoice_customer_${customer.id}`),
      ]);
    });

    // Add pagination buttons if needed
    const paginationRow = [];
    if (hasPrevious) {
      paginationRow.push(
        Markup.button.callback("⬅️ Previous", `invoice_page_${offset - limit}`)
      );
    }
    if (hasMore) {
      paginationRow.push(
        Markup.button.callback("➡️ Next", `invoice_page_${offset + limit}`)
      );
    }
    if (paginationRow.length > 0) {
      buttons.push(paginationRow);
    }

    await ctx.reply(
      `📋 *Select a customer or add a new one:*\n\n` +
        `Showing ${offset + 1}-${
          offset + customers.length
        } of ${total} customers`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(buttons),
      }
    );
  } catch (error) {
    console.error("Error fetching customers:", error);
    await ctx.reply(
      "❌ Failed to fetch customers. Please try again or contact support."
    );
  }
};

const askCustomerDetails = async (ctx, field) => {
  const prompts = {
    name: "👤 Please enter the customer's *name*:",
    email: "📧 Please enter the customer's *email*:",
    organizationName: "🏢 Please enter the *organization name*:",
  };

  await ctx.reply(prompts[field], { parse_mode: "Markdown" });
};

const askCurrency = async (ctx) => {
  const buttons = [
    [Markup.button.callback("ETH", "invoice_currency_eth")],
    [Markup.button.callback("USDC", "invoice_currency_usdc")],
    [Markup.button.callback("USDT", "invoice_currency_usdt")],
  ];

  await ctx.reply("💰 *Select currency:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
};

const askInvoiceDueDate = async (ctx) => {
  const buttons = [
    [Markup.button.callback("Today", "invoice_due_0")],
    [Markup.button.callback("Tomorrow", "invoice_due_1")],
    [Markup.button.callback("7 days", "invoice_due_7")],
    [Markup.button.callback("14 days", "invoice_due_14")],
    [Markup.button.callback("30 days", "invoice_due_30")],
    [Markup.button.callback("45 days", "invoice_due_45")],
    [Markup.button.callback("60 days", "invoice_due_60")],
    [Markup.button.callback("90 days", "invoice_due_90")],
  ];

  await ctx.reply("📅 *Select due date:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
};

const askLineItem = async (ctx) => {
  await ctx.reply(
    "📝 *Add a line item*\n\n" +
      "Please enter the item details in this format:\n" +
      "`Item Name | Price`\n\n" +
      "Example: `Web Development | 5000`",
    { parse_mode: "Markdown" }
  );
};

const confirmLineItems = async (ctx) => {
  const items = ctx.session.invoiceFlow.data.lineItems;

  let itemsList = "*Current line items:*\n\n";
  items.forEach((item, index) => {
    itemsList += `${index + 1}. ${item.name} - $${item.price}\n`;
  });

  const total = items.reduce((sum, item) => sum + parseFloat(item.price), 0);
  itemsList += `\n*Total:* $${total.toFixed(2)}`;

  const buttons = [
    [Markup.button.callback("➕ Add Another Item", "invoice_item_add")],
    [Markup.button.callback("✅ Create Invoice", "invoice_create")],
    [Markup.button.callback("❌ Cancel", "invoice_cancel")],
  ];

  await ctx.reply(itemsList, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
};

/** ------------ Telegram bot handlers ------------ **/
bot.start(requireAuth, async (ctx) => {
  console.log("🚀 Start command received from:", ctx.from);
  ctx.session ??= {};
  await resetFlow(ctx);

  await ctx.reply(
    "👋 *Welcome to Basecamp Task Bot!*\n\n" +
      "I help you create tasks in Basecamp using AI-powered processing.\n\n" +
      "🚀 *How to use:*\n" +
      "• Simply send or forward me any message describing a task\n" +
      "• I'll automatically process it and create the task(s) for you\n" +
      "• You can create single or multiple tasks at once\n\n" +
      "📝 *Examples:*\n" +
      "• `Fix login bug - assign to John, due tomorrow`\n" +
      "• `Update documentation\\nReview PR #123\\nTest new feature`\n\n" +
      "💡 *Commands:*\n" +
      "• /stop - Cancel current task creation\n" +
      "• /help - Show help message\n\n" +
      "_Just send me a message to get started!_",
    { parse_mode: "Markdown" }
  );
});

bot.command("stop", requireAuth, async (ctx) => {
  console.log("🛑 Stop command received from:", ctx.from);
  ctx.session ??= {};

  // Clean up any ongoing flow messages
  await resetFlow(ctx);

  // Reset invoice flow if active
  resetInvoiceFlow(ctx);

  await ctx.reply(
    "🛑 *Conversation stopped.*\n\n" +
      "Your current task creation or invoice creation has been cancelled and all data cleared.\n\n" +
      "Just send me a new message to create another task or use /create_invoice for invoices!",
    { parse_mode: "Markdown" }
  );
});

bot.command("update_status", requireAuth, async (ctx) => {
  console.log("🔄 Update status command received from:", ctx.from);

  try {
    const telegramId = String(ctx.from.id);

    // Fetch current status from Airtable
    const people = await fetchPeople(true); // Force refresh
    const person = people.find((p) => p.telegram_id === telegramId);

    if (!person) {
      return ctx.reply(
        "❌ Sorry, I couldn't find your profile in the system. Please contact an admin."
      );
    }

    const currentStatus = person.tg_status || "offline";
    const newStatus = currentStatus === "online" ? "offline" : "online";
    const buttonText =
      currentStatus === "online" ? "📴 Set to Offline" : "📳 Set to Online";
    const statusEmoji = currentStatus === "online" ? "🟢" : "⚫";

    await ctx.reply(
      `${statusEmoji} Your current status: *${currentStatus.toUpperCase()}*\n\nWould you like to change it?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: buttonText,
                callback_data: `status_toggle_${newStatus}`,
              },
            ],
          ],
        },
      }
    );
  } catch (error) {
    console.error("Error in update_status command:", error);
    await ctx.reply(
      "❌ Sorry, there was an error checking your status. Please try again."
    );
  }
});

bot.command("help", requireAuth, async (ctx) => {
  console.log("❓ Help command received from:", ctx.from);

  try {
    await ctx.reply(
      "🤖 *Basecamp Task Bot Help*\n\n" +
        "🎯 *Creating Tasks*\n" +
        "Simply send or forward me any message\\! No commands needed\\.\n\n" +
        "📝 *Examples*\n" +
        "• Create single task:\n" +
        "`Fix the login bug \\- assign to Sarah, due Friday`\n\n" +
        "• Create multiple tasks:\n" +
        "`Update docs\nReview code\nDeploy to staging`\n\n" +
        "🤖 *AI Features*\n" +
        "• Automatically detects project names\n" +
        "• Identifies assignees by name\n" +
        "• Parses due dates \\(tomorrow, next Monday, 2025\\-10\\-15\\)\n" +
        "• Handles single or multiple tasks\n\n" +
        "⚙️ *Commands*\n" +
        "• /start \\- Show welcome message\n" +
        "• /stop \\- Cancel current task\n" +
        "• /create\\_invoice \\- Create invoice\n" +
        "• /update\\_status \\- Update your availability status\n" +
        "• /help \\- Show this help\n\n" +
        "_This bot uses AI to make task creation effortless\\!_",
      {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }
    );
    console.log("✅ Help message sent successfully");
  } catch (error) {
    console.error("❌ Error sending help message:", {
      error: error.message,
      description: error.response?.description,
      payload: error.on?.payload,
    });

    // Fallback to simpler message without formatting
    try {
      await ctx.reply(
        "🤖 Basecamp Task Bot Help\n\n" +
          "To create tasks, simply send me a message describing what needs to be done!\n\n" +
          "Commands:\n" +
          "/start - Show welcome message\n" +
          "/stop - Cancel current task\n" +
          "/create_invoice - Create invoice\n" +
          "/help - Show this help\n\n" +
          "This bot uses AI to make task creation effortless!",
        { parse_mode: undefined }
      );
      console.log("✅ Fallback help message sent");
    } catch (fallbackError) {
      console.error("❌ Even fallback message failed:", fallbackError.message);
    }
  }
});

// Helper function to convert amount to USDC with 8 decimal places
const toUSDC = (amount) => {
  // Convert amount to number with 8 decimal places
  return Math.round(parseFloat(amount) * 100000000);
};

// Helper function to format USDC amount for display
const formatUSDC = (amount) => {
  // Convert from 8 decimal places to regular number
  return (amount / 100000000).toFixed(2);
};

bot.command("test_api", requireAuth, async (ctx) => {
  console.log("🧪 Test API command received from:", ctx.from);

  try {
    await ctx.reply("🧪 Testing CopperX API endpoints...");

    const apiTestResults = await testCopperXAPI();

    let responseMessage = "*CopperX API Test Results:*\n\n";

    const formatStatus = (status, error) => {
      if (status === "success") return "✅ Working";
      if (status === "failed")
        return `❌ Failed${error ? `\n   Error: ${error}` : ""}`;
      return "⚠️ Unknown";
    };

    responseMessage += `GET /customers: ${formatStatus(
      apiTestResults.customersGet.status,
      apiTestResults.customersGet.error
    )}\n\n`;
    responseMessage += `POST /customers: ${formatStatus(
      apiTestResults.customersPost.status,
      apiTestResults.customersPost.error
    )}\n\n`;
    responseMessage += `POST /invoices: ${formatStatus(
      apiTestResults.invoicesPost.status,
      apiTestResults.invoicesPost.error
    )}\n\n`;
    responseMessage += `GET /api/v1/auth/me: ${formatStatus(
      apiTestResults.authMe.status,
      apiTestResults.authMe.error
    )}\n\n`;

    if (apiTestResults.error) {
      responseMessage += `\n*General Error:* ${apiTestResults.error}`;
    }

    await ctx.reply(responseMessage, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error testing API:", error);
    await ctx.reply("❌ Failed to test API. Check bot logs for details.");
  }
});

bot.command("create_invoice", requireAuth, async (ctx) => {
  console.log("💰 Create invoice command received from:", ctx.from);

  // Initialize invoice flow
  ctx.session ??= {};
  ctx.session.invoiceFlow = {
    step: 1, // 1: Choose customer action, 2-4: New customer flow, 5: Currency selection, 6+: Line items
    lineItems: [],
    currentItem: null,
    customer: null,
    currency: null, // Global currency for all items
  };

  const buttons = [
    [
      { text: "🔍 Select Existing Customer", callback_data: "customer_select" },
      { text: "➕ Create New Customer", callback_data: "customer_create" },
    ],
  ];

  const welcomeMessage =
    "🧾 *Create New Invoice*\n\n" +
    "First, let's select a customer for this invoice\\. Would you like to select an existing customer or create a new one?";

  await ctx.reply(welcomeMessage, {
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: buttons },
  });
});

// Handle callback queries for invoice flow
bot.on("callback_query", requireAuth, async (ctx, next) => {
  const data = ctx.callbackQuery.data;

  // Handle customer-related callbacks
  if (
    data.startsWith("customer_") ||
    data.startsWith("invoice_") ||
    data.startsWith("currency_") ||
    data.startsWith("finalize_")
  ) {
    await ctx.answerCbQuery(); // Acknowledge the button press

    ctx.session ??= {};
    ctx.session.invoiceFlow ??= {};

    // Pagination
    if (data.startsWith("invoice_page_")) {
      const offset = parseInt(data.replace("invoice_page_", ""));
      await askCustomer(ctx, offset);
      return;
    }

    // Customer selection
    if (data.startsWith("invoice_customer_")) {
      if (data === "invoice_customer_new") {
        // Start new customer creation flow
        ctx.session.invoiceFlow.step = 2; // New customer flow - collect name
        ctx.session.invoiceFlow.newCustomer = {};
        await askCustomerDetails(ctx, "name");
      } else {
        // Existing customer selected
        const customerId = data.replace("invoice_customer_", "");

        // Extract customer name from the button text
        const buttonText =
          ctx.callbackQuery.message.reply_markup.inline_keyboard
            .flat()
            .find((btn) => btn.callback_data === data)?.text || "Customer";

        ctx.session.invoiceFlow.data.customerId = customerId;
        ctx.session.invoiceFlow.data.customerName = buttonText;
        ctx.session.invoiceFlow.step = 5; // Move to currency selection
        await ctx.reply(`✅ Customer selected: ${buttonText}`);
        await askCurrency(ctx);
      }
      return;
    }

    // Currency selection
    if (data.startsWith("invoice_currency_")) {
      const currency = data.replace("invoice_currency_", "");
      ctx.session.invoiceFlow.data.currency = currency;
      ctx.session.invoiceFlow.step = 6; // Move to due date selection
      await ctx.reply(`✅ Currency: ${currency.toUpperCase()}`);
      await askInvoiceDueDate(ctx);
      return;
    }

    // Due date selection
    if (data.startsWith("invoice_due_")) {
      const days = parseInt(data.replace("invoice_due_", ""));
      const dueDate = dayjs().add(days, "day").format("YYYY-MM-DD");
      ctx.session.invoiceFlow.data.dueDate = dueDate;
      ctx.session.invoiceFlow.step = 7; // Move to line items
      await ctx.reply(`✅ Due date: ${dueDate}`);
      await askLineItem(ctx);
      return;
    }

    // Line item actions
    if (data === "invoice_item_add") {
      await askLineItem(ctx);
      return;
    }

    if (data === "invoice_create") {
      // Create the invoice
      await ctx.reply("⏳ Creating invoice...");

      try {
        const invoiceData = {
          lineItems: {
            data: ctx.session.invoiceFlow.lineItems.map((item) => ({
              priceData: {
                currency: ctx.session.invoiceFlow.currency,
                productData: {
                  name: item.name,
                },
                unitAmount: item.amount, // Already in correct format with 8 decimals
              },
              quantity: item.quantity,
            })),
          },
          paymentSetting: {
            allowSwap: false,
          },
          customerId: ctx.session.invoiceFlow.customer.id,
        };

        console.log("Creating invoice with data:", invoiceData);
        console.log("Customer being used:", ctx.session.invoiceFlow.customer);
        console.log(
          "Customer ID being used:",
          ctx.session.invoiceFlow.customer?.id
        );
        console.log(
          "Full session invoiceFlow:",
          JSON.stringify(ctx.session.invoiceFlow, null, 2)
        );
        const { data: invoice } = await invoiceController_create(invoiceData);
        console.log("Invoice created:", invoice);

        // Calculate total
        const total = ctx.session.invoiceFlow.lineItems.reduce(
          (sum, item) => sum + (item.amount * item.quantity) / 100000000,
          0
        );

        // Calculate totals from the invoice response
        const totalAmount = (parseInt(invoice.total) / 100000000).toFixed(2);
        const currency = invoice.currency.toUpperCase();

        await ctx.reply(
          `✅ *Invoice created successfully\\!*\n\n` +
            `Invoice ID: \`${invoice.id}\`\n` +
            `Total: ${totalAmount.replace(/\./g, "\\.")} ${currency}\n\n` +
            `${
              invoice.hostedUrl
                ? `🔗 [View Invoice](${invoice.hostedUrl.replace(
                    /[_*[\]()~`>#+=|{}.!-]/g,
                    "\\$&"
                  )})`
                : ""
            }`,
          {
            parse_mode: "MarkdownV2",
            disable_web_page_preview: true,
          }
        );

        // Ask if user wants to finalize the invoice
        const finalizeButtons = [
          [
            {
              text: "✅ Yes, Finalize Invoice",
              callback_data: `finalize_${invoice.id}`,
            },
            { text: "❌ No, Keep as Draft", callback_data: "finalize_no" },
          ],
        ];

        await ctx.reply(
          "📋 *Invoice Finalization*\n\n" +
            "Would you like to finalize this invoice? Finalizing will make it ready for payment\\.\n\n" +
            "• *Yes*: Finalize the invoice now\n" +
            "• *No*: Keep it as a draft",
          {
            parse_mode: "MarkdownV2",
            reply_markup: { inline_keyboard: finalizeButtons },
          }
        );

        // Store invoice ID for finalization
        ctx.session.invoiceFlow.finalizeInvoiceId = invoice.id;
      } catch (error) {
        console.error("Error creating invoice:", error);
        await ctx.reply(
          "❌ Failed to create invoice. Please try again or contact support.\n\n" +
            `Error: ${error.response?.data?.message || error.message}`
        );
      }
      return;
    }

    // Handle customer selection/creation
    if (data === "customer_select") {
      ctx.session.invoiceFlow.step = 2;
      await ctx.answerCbQuery();
      await ctx.reply(
        "Please enter the customer's name to search\\. I'll look for matching customers\\.",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    if (data === "customer_create") {
      ctx.session.invoiceFlow.step = 2;
      ctx.session.invoiceFlow.newCustomer = {};
      await ctx.answerCbQuery();
      await ctx.reply(
        "Let's create a new customer\\.\n\n" +
          "I'll ask for the customer's details step by step:\n\n" +
          "*Please enter the customer's name:*",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    if (data.startsWith("customer_confirm_")) {
      const customerId = data.replace("customer_confirm_", "");
      const customers = await getCustomers({ limit: 100 });
      const customer = customers.find((c) => c.id === customerId);

      if (!customer) {
        await ctx.answerCbQuery("❌ Customer not found");
        return;
      }

      ctx.session.invoiceFlow.customer = customer;
      ctx.session.invoiceFlow.step = 5; // Move to currency selection
      console.log("Customer selected and stored:", customer);
      console.log("Customer ID stored:", customer.id);
      console.log(
        "Session after customer selection:",
        JSON.stringify(ctx.session.invoiceFlow, null, 2)
      );
      await ctx.answerCbQuery("✅ Customer selected");

      // Show currency selection
      const currencyButtons = [
        [
          { text: "USDC", callback_data: "currency_usdc" },
          { text: "USDT", callback_data: "currency_usdt" },
        ],
        [
          { text: "ETH", callback_data: "currency_eth" },
          { text: "SOL", callback_data: "currency_sol" },
        ],
      ];

      const message =
        "✅ *Customer selected:*\n" +
        `Name: ${customer.name.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&")}\n` +
        `Email: ${customer.email.replace(
          /[_*[\]()~`>#+=|{}.!-]/g,
          "\\$&"
        )}\n\n` +
        "Now, please select the currency for this invoice:";

      await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: { inline_keyboard: currencyButtons },
      });
      return;
    }

    if (data === "customer_confirm_no") {
      ctx.session.invoiceFlow.step = 2;
      ctx.session.invoiceFlow.newCustomer = {};
      await ctx.reply(
        "Let's create a new customer instead\\.\n\n" +
          "*Please enter the customer's name:*",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // Handle customer creation confirmation
    if (data === "customer_create_confirm") {
      await ctx.reply("⏳ Creating customer...");

      try {
        // Use the CopperX SDK directly as requested
        const response = await copperx.customerController_create({
          name: ctx.session.invoiceFlow.newCustomer.name,
          organizationName:
            ctx.session.invoiceFlow.newCustomer.organizationName,
          email: ctx.session.invoiceFlow.newCustomer.email,
        });

        // Store the customer with the ID from the response
        ctx.session.invoiceFlow.customer = {
          id: response.data.id,
          name: response.data.name,
          email: response.data.email,
          organizationName: response.data.organizationName,
        };
        console.log(
          "New customer created and stored:",
          ctx.session.invoiceFlow.customer
        );
        console.log(
          "New customer ID stored:",
          ctx.session.invoiceFlow.customer.id
        );
        console.log(
          "Session after customer creation:",
          JSON.stringify(ctx.session.invoiceFlow, null, 2)
        );

        ctx.session.invoiceFlow.step = 5; // Move to currency selection
        delete ctx.session.invoiceFlow.newCustomer;

        // Show currency selection
        const currencyButtons = [
          [
            { text: "USDC", callback_data: "currency_usdc" },
            { text: "USDT", callback_data: "currency_usdt" },
          ],
          [
            { text: "ETH", callback_data: "currency_eth" },
            { text: "SOL", callback_data: "currency_sol" },
          ],
        ];

        const message =
          "✅ *Customer created successfully\\!*\n\n" +
          "Now, please select the currency for this invoice:";

        await ctx.reply(message, {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: currencyButtons },
        });
      } catch (error) {
        console.error("Error creating customer:", error);
        await ctx.reply(
          "❌ Failed to create customer\\. Please try again\\.\n\n" +
            `Error: ${error.message.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&")}`,
          { parse_mode: "MarkdownV2" }
        );
      }
      return;
    }

    if (data.startsWith("currency_")) {
      const currency = data.replace("currency_", "");
      ctx.session.invoiceFlow.currency = currency;
      ctx.session.invoiceFlow.step = 6; // Move to line items

      const currencyDisplay = currency.toUpperCase();
      await ctx.answerCbQuery(`Selected ${currencyDisplay}`);

      const message =
        `✅ *Currency selected:* ${currencyDisplay}\n\n` +
        "Now, let's add items to your invoice\\. For each item, I'll ask for:\n" +
        "• Item name\n" +
        "• Amount\n" +
        "• Quantity\n\n" +
        "*What's the name of the first item?*";

      await ctx.reply(message, { parse_mode: "MarkdownV2" });
      return;
    }

    if (data === "invoice_add_item") {
      ctx.session.invoiceFlow.step = 6;
      ctx.session.invoiceFlow.currentItem = null;

      await ctx.reply("*What's the name of the next item?*", {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    if (data === "invoice_cancel") {
      resetInvoiceFlow(ctx);
      await ctx.reply("❌ Invoice creation cancelled.");
      return;
    }

    // Handle invoice finalization
    if (data.startsWith("finalize_")) {
      if (data === "finalize_no") {
        await ctx.reply(
          "✅ Invoice kept as draft. You can finalize it later from the CopperX dashboard."
        );
        resetInvoiceFlow(ctx);
        return;
      }

      // Extract invoice ID from callback data
      const invoiceId = data.replace("finalize_", "");

      try {
        await ctx.reply("⏳ Finalizing invoice...");

        // Call the finalize API
        const response = await copperx.invoiceController_finalizeInvoice({
          id: invoiceId,
        });

        await ctx.reply(
          `✅ *Invoice finalized successfully\\!*\n\n` +
            `Invoice ID: \`${invoiceId}\`\n` +
            `Status: Finalized\n\n` +
            `The invoice is now ready for payment\\.`,
          {
            parse_mode: "MarkdownV2",
          }
        );

        console.log("Invoice finalized:", response.data);
      } catch (error) {
        console.error("Error finalizing invoice:", error);
        await ctx.reply(
          "❌ Failed to finalize invoice. Please try again or contact support.\n\n" +
            `Error: ${error.response?.data?.message || error.message}`
        );
      }

      // Reset flow after finalization
      resetInvoiceFlow(ctx);
      return;
    }

    // This is an invoice callback, we've handled it
    return;
  }

  // Not an invoice callback, pass to next handler
  return next();
});

// Handle all messages (not just text)
bot.on(["text", "mention", "text_mention"], async (ctx) => {
  // Handle group/channel messages (check for mentions of offline users)
  if (
    ctx.chat.type === "group" ||
    ctx.chat.type === "supergroup" ||
    ctx.chat.type === "channel"
  ) {
    console.log("\n👥 Group/Channel message received:", {
      chat_id: ctx.chat.id,
      chat_title: ctx.chat.title,
      from: ctx.from?.username,
      text: ctx.message.text,
      entities: ctx.message.entities?.map((e) => ({
        type: e.type,
        offset: e.offset,
        length: e.length,
        user: e.user,
      })),
      raw_message: ctx.message, // Log full message for debugging
    });

    // Check for mentions in the message
    if (ctx.message.entities) {
      // Log all entities for debugging
      console.log("Message entities:", ctx.message.entities);

      const mentions = [];
      for (const entity of ctx.message.entities) {
        if (entity.type === "text_mention" && entity.user) {
          // Direct mention with user object
          console.log("Found text_mention:", {
            user_id: entity.user.id,
            first_name: entity.user.first_name,
            username: entity.user.username,
          });
          mentions.push(String(entity.user.id));
        } else if (entity.type === "mention") {
          // @username mention - need to extract
          const username = ctx.message.text.substring(
            entity.offset + 1, // Skip @
            entity.offset + entity.length
          );
          console.log("Found @mention:", username);
          mentions.push(username);
        }
      }

      if (mentions.length > 0) {
        console.log("📌 Found mentions:", mentions);

        try {
          const people = await fetchPeople(true); // Force refresh to get latest status
          console.log(
            "Fetched people from Airtable:",
            people.map((p) => ({
              name: p.name,
              telegram_id: p.telegram_id,
              tg_status: p.tg_status,
            }))
          );

          for (const mention of mentions) {
            console.log("Checking mention:", mention);

            // Find person by telegram_id or username
            const person = people.find((p) => {
              if (p.telegram_id === mention) {
                console.log(
                  `Found person by telegram_id: ${p.name} (${p.tg_status})`
                );
                return true;
              }
              return false;
            });

            if (person && person.tg_status === "offline") {
              console.log(
                `⚠️ User ${person.name} is offline, sending auto-reply`
              );

              // Generate AI response for the auto-reply
              const aiResponse = await generateOfflineResponse(
                person.name,
                ctx.message.text,
                ctx.from?.first_name || ctx.from?.username || "Someone"
              );

              // Send reply in the channel/group
              await ctx.reply(aiResponse, {
                reply_to_message_id: ctx.message.message_id,
              });

              // Send DM to the offline person
              if (person.telegram_id) {
                try {
                  await bot.telegram.sendMessage(
                    person.telegram_id,
                    `📬 *New message in ${ctx.chat.title || "a group"}*\n\n` +
                      `From: ${
                        ctx.from?.first_name || ctx.from?.username || "Someone"
                      }\n\n` +
                      `Message:\n"${ctx.message.text}"\n\n` +
                      `_You were mentioned while your status was offline._`,
                    { parse_mode: "Markdown" }
                  );
                  console.log(`✅ DM sent to ${person.name}`);
                } catch (dmError) {
                  console.error(
                    `❌ Failed to send DM to ${person.name}:`,
                    dmError.message
                  );
                }
              }
            }
          }
        } catch (error) {
          console.error("Error processing mentions:", error);
        }
      }
    }

    // Don't process group messages further for task creation
    return;
  }

  // Private chat handling - require auth
  const uid = String(ctx.from.id);

  // Refresh whitelist from Airtable periodically
  try {
    whitelist = await getTelegramWhitelist();
  } catch (error) {
    console.error("Error refreshing whitelist:", error.message);
  }

  if (!whitelist.has(uid)) {
    return ctx.reply("Sorry, you are not authorised to use this bot.");
  }

  const saved = await store.get(uid);
  if (!saved) {
    const link = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${BASECAMP_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&state=${uid}`;
    return ctx.reply(`Connect your Basecamp:\n${link}`);
  }

  // Skip processing if this is a command (starts with /)
  if (ctx.message.text?.startsWith("/")) {
    return;
  }

  console.log("📨 Text message received:", {
    from: ctx.from,
    text: ctx.message.text,
    session: ctx.session,
  });

  ctx.session ??= {};

  const text = ctx.message.text?.trim();

  // Handle invoice flow text inputs
  if (ctx.session.invoiceFlow?.step > 0) {
    const flow = ctx.session.invoiceFlow;

    // Customer name search
    if (flow.step === 2 && flow.newCustomer === undefined) {
      // Search for existing customer
      const customers = await getCustomers({ limit: 100 });
      const searchTerm = text.toLowerCase();
      const matches = customers.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm) ||
          c.email.toLowerCase().includes(searchTerm)
      );

      if (matches.length === 0) {
        await ctx.reply(
          "❌ No customers found matching your search\\.\n\n" +
            "Would you like to try another search or create a new customer?",
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🔍 Search Again", callback_data: "customer_select" },
                  { text: "➕ Create New", callback_data: "customer_create" },
                ],
              ],
            },
          }
        );
        return;
      }

      if (matches.length === 1) {
        const customer = matches[0];
        await ctx.reply(
          "*Found one matching customer:*\n\n" +
            `Name: ${customer.name.replace(
              /[_*[\]()~`>#+=|{}.!-]/g,
              "\\$&"
            )}\n` +
            `Email: ${customer.email.replace(
              /[_*[\]()~`>#+=|{}.!-]/g,
              "\\$&"
            )}\n\n` +
            "Is this the correct customer?",
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Yes",
                    callback_data: `customer_confirm_${customer.id}`,
                  },
                  { text: "❌ No", callback_data: "customer_confirm_no" },
                ],
              ],
            },
          }
        );
        return;
      }

      // Multiple matches - show as buttons
      const buttons = matches.map((c) => [
        {
          text: `${c.name} (${c.email})`,
          callback_data: `customer_confirm_${c.id}`,
        },
      ]);

      await ctx.reply(
        `Found ${matches.length} matching customers\\. Please select one:`,
        {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: buttons },
        }
      );
      return;
    }

    // New customer flow - name input (step 2)
    if (flow.step === 2 && flow.newCustomer !== undefined) {
      flow.newCustomer.name = text;
      flow.step = 3;
      await ctx.reply("*Please enter the organization name:*", {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    // New customer flow - organization input (step 3)
    if (flow.step === 3) {
      flow.newCustomer.organizationName = text;
      flow.step = 4;
      await ctx.reply("*Please enter the customer's email address:*", {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    // New customer flow - email input (step 4)
    if (flow.step === 4) {
      if (!text.includes("@")) {
        await ctx.reply("❌ Please enter a valid email address\\.");
        return;
      }

      flow.newCustomer.email = text;
      flow.step = 5;

      // Show confirmation
      const message =
        "*Please confirm the customer details:*\n\n" +
        `Name: ${flow.newCustomer.name.replace(
          /[_*[\]()~`>#+=|{}.!-]/g,
          "\\$&"
        )}\n` +
        `Organization: ${flow.newCustomer.organizationName.replace(
          /[_*[\]()~`>#+=|{}.!-]/g,
          "\\$&"
        )}\n` +
        `Email: ${flow.newCustomer.email.replace(
          /[_*[\]()~`>#+=|{}.!-]/g,
          "\\$&"
        )}`;

      await ctx.reply(message, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Confirm",
                callback_data: "customer_create_confirm",
              },
              { text: "🔄 Redo", callback_data: "customer_create" },
            ],
          ],
        },
      });
      return;
    }

    // Item name input (step 6)
    if (flow.step === 6) {
      flow.currentItem = {
        name: text,
        amount: 0,
        quantity: 1,
      };
      flow.step = 7;

      // Escape all special characters for MarkdownV2
      const escapedName = text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
      const currencyDisplay = flow.currency.toUpperCase();

      const message =
        `*Item Name:* ${escapedName}\n\n` +
        `Now, *what's the amount in ${currencyDisplay}?*\n` +
        `Example: 100\\.50 for 100\\.50 ${currencyDisplay}`;

      await ctx.reply(message, { parse_mode: "MarkdownV2" });
      return;
    }

    // Currency selection (step 2) is handled by callback
    // Amount input
    if (flow.step === 7) {
      const inputAmount = parseFloat(text);
      if (isNaN(inputAmount) || inputAmount <= 0) {
        await ctx.reply("❌ Please enter a valid amount (e.g., 100.50)");
        return;
      }

      flow.currentItem.amount = toUSDC(inputAmount);
      flow.step = 8;

      // Escape all special characters for MarkdownV2
      const escapedName = flow.currentItem.name.replace(
        /[_*[\]()~`>#+=|{}.!-]/g,
        "\\$&"
      );
      const amountFormatted = formatUSDC(flow.currentItem.amount).replace(
        /\./g,
        "\\."
      );
      const currencyDisplay = flow.currency.toUpperCase();
      const message =
        `*Item Name:* ${escapedName}\n` +
        `*Amount:* ${amountFormatted} ${currencyDisplay}\n\n` +
        "*What's the quantity?* \\(default: 1\\)";

      await ctx.reply(message, { parse_mode: "MarkdownV2" });
      return;
    }

    // Quantity input
    if (flow.step === 8) {
      const quantity = parseInt(text);
      if (isNaN(quantity) || quantity <= 0) {
        await ctx.reply("❌ Please enter a valid quantity (e.g., 1)");
        return;
      }

      flow.currentItem.quantity = quantity;
      flow.lineItems.push(flow.currentItem);

      // Show summary and ask if they want to add more
      const buttons = [
        [{ text: "➕ Add Another Item", callback_data: "invoice_add_item" }],
        [{ text: "✅ Create Invoice", callback_data: "invoice_create" }],
        [{ text: "❌ Cancel", callback_data: "invoice_cancel" }],
      ];

      let summary = "*Invoice Summary:*\n\n";
      let total = 0;

      flow.lineItems.forEach((item, index) => {
        const itemTotal = (item.amount * item.quantity) / 100000000;
        total += itemTotal;
        const escapedName = item.name.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
        const amountFormatted = formatUSDC(item.amount).replace(/\./g, "\\.");
        const itemTotalFormatted = itemTotal.toFixed(2).replace(/\./g, "\\.");

        summary +=
          `${index + 1}\\. ${escapedName}\n` +
          `   ${amountFormatted} ${flow.currency.toUpperCase()} × ${
            item.quantity
          } \\= ${itemTotalFormatted} ${flow.currency.toUpperCase()}\n\n`;
      });

      const totalFormatted = total.toFixed(2).replace(/\./g, "\\.");
      // Add total (single currency now)
      summary += `\n*Total: ${totalFormatted} ${flow.currency.toUpperCase()}*`;

      await ctx.reply(summary, {
        parse_mode: "MarkdownV2",
        reply_markup: { inline_keyboard: buttons },
      });

      flow.step = 9;
      return;
    }

    return;
  }

  // Handle legacy invoice flow steps
  if (ctx.session.invoiceFlow?.step > 0) {
    const flow = ctx.session.invoiceFlow;
    const textInputSteps = [2, 3, 4, 7];

    if (textInputSteps.includes(flow.step)) {
      // New customer creation flow
      if (flow.step === 2) {
        // Collecting name
        flow.newCustomer.name = text;
        flow.step = 3;
        await askCustomerDetails(ctx, "email");
        return;
      }

      if (flow.step === 3) {
        // Collecting email
        if (!text.includes("@")) {
          await ctx.reply("❌ Please enter a valid email address.");
          return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
          await ctx.reply(
            "❌ Invalid email format. Please enter a valid email address."
          );
          return;
        }
        flow.newCustomer.email = text;
        flow.step = 4;
        await askCustomerDetails(ctx, "organizationName");
        return;
      }

      if (flow.step === 4) {
        // Collecting organization name and creating customer
        flow.newCustomer.organizationName = text;

        await ctx.reply("⏳ Creating customer...");

        try {
          const customer = await createCustomer(flow.newCustomer);
          flow.data.customerId = customer.id;
          flow.data.customerName = customer.name;
          flow.step = 5;

          await ctx.reply(`✅ Customer created: ${customer.name}`);
          await askCurrency(ctx);
        } catch (error) {
          console.error("Error creating customer:", error);
          await ctx.reply(
            "❌ Failed to create customer. Please check the details and try again.\n\n" +
              `Error: ${error.response?.data?.message || error.message}`
          );
          flow.step = 2;
          await askCustomerDetails(ctx, "name");
        }
        return;
      }

      // Legacy line item collection - no longer used
      if (flow.step === 7) {
        await ctx.reply(
          "❌ This invoice format is no longer supported. Please use /create_invoice to start a new invoice.",
          { parse_mode: "Markdown" }
        );
        delete ctx.session.invoiceFlow;
        return;
      }
    }
  }

  ctx.session.flow ??= { step: 0, selections: {} };
  let f = ctx.session.flow;

  // If no active flow or at step 0, treat any message as task creation request
  if (!f.step || f.step === 0) {
    console.log("No active flow - treating message as new task request");
    await resetFlow(ctx);
    ctx.session.flow.step = 1;
    f = ctx.session.flow;
    // Don't return - continue to process the message below
  }

  if (f.step === 1) {
    // Process the task description with AI
    f.selections.originalMessage = text;
    f.step = 2; // Move to confirmation step

    const processingMessage = await ctx.reply(
      "🤖 Processing your task with AI..."
    );

    try {
      // Fetch projects and people to provide context to AI
      const { access, accountId } = await store.get(String(ctx.from.id));
      let context = { projects: [], people: [] };

      try {
        // Fetch projects
        const { data: projects } = await bc(access).get(
          `https://3.basecampapi.com/${accountId}/projects.json`
        );
        context.projects = projects.map((p) => ({ id: p.id, name: p.name }));

        // Fetch people from Airtable
        try {
          const airtablePeople = await fetchPeople();
          context.people = airtablePeople.map((p) => ({
            name: p.name,
            email: p.email,
            slack_id: p.slack_id,
            basecamp_id: p.basecamp_id, // Include Basecamp ID if provided
          }));
          const withBasecampIds = context.people.filter(
            (p) => p.basecamp_id
          ).length;
          console.log(
            `Fetched people from Airtable (${context.people.length} people, ${withBasecampIds} with basecamp_id)`
          );
        } catch (airtableError) {
          console.error(
            "Error fetching people from Airtable:",
            airtableError.message
          );
          console.warn(
            "⚠️ Airtable fetch failed, AI will not have people context"
          );
          context.people = [];
        }

        console.log("Context for AI:", {
          projects_count: context.projects.length,
          people_count: context.people.length,
          source: "Airtable",
        });
      } catch (contextError) {
        console.error("Error fetching context for AI:", contextError.message);
        // Continue without context if fetching fails
      }

      const aiResult = await processTaskWithAI(text, context);

      // Check if it's multiple tasks
      if (aiResult.is_multiple && aiResult.tasks) {
        console.log(`AI detected ${aiResult.tasks.length} tasks`);

        // Log each task's extracted data for debugging
        aiResult.tasks.forEach((task, index) => {
          console.log(`Task ${index + 1} extracted:`, {
            title: task.title,
            project_name: task.project_name,
            assignee_names: task.assignee_names,
            due_date: task.due_date,
          });
        });

        // Fetch Basecamp people once for all tasks to avoid multiple API calls
        let basecampPeople = null;
        try {
          const { data } = await bc(access).get(
            `https://3.basecampapi.com/${accountId}/people.json`
          );
          basecampPeople = data;
          console.log(
            `Fetched ${basecampPeople.length} Basecamp people for batch processing`
          );
        } catch (error) {
          console.error(
            "Error fetching Basecamp people for batch:",
            error.message
          );
        }

        // Process all tasks to check what's missing
        const processedTasks = [];
        for (const taskData of aiResult.tasks) {
          console.log(`\n=== Processing task: ${taskData.title} ===`);
          console.log(`Task data:`, {
            assignee_names: taskData.assignee_names,
            project_name: taskData.project_name,
          });
          console.log(`Context people count: ${context.people.length}`);
          console.log(
            `Context people names:`,
            context.people.map((p) => p.name)
          );

          const processedTask = await processTaskData(
            taskData,
            context,
            access,
            accountId,
            basecampPeople
          );

          console.log(`Processed task result:`, {
            title: processedTask.title,
            projectId: processedTask.projectId,
            assigneeId: processedTask.assigneeId,
            assigneeEmail: processedTask.assigneeEmail,
            dueOn: processedTask.dueOn,
          });

          processedTasks.push(processedTask);
        }

        // Check if any tasks are missing project, todo list, or due date
        const tasksNeedingInfo = [];

        for (let index = 0; index < processedTasks.length; index++) {
          const task = processedTasks[index];
          const needsProject = !task.projectId;
          let needsTodoList = false;
          const needsDueDate = !task.dueOn;

          // If project is known, check if we need to ask for todo list
          if (task.projectId && !task.todoListId) {
            try {
              const { lists } = await fetchTodoLists(ctx, task.projectId);
              if (lists.length > 1) {
                needsTodoList = true;
                console.log(
                  `Task "${task.title}" needs todo list selection (${lists.length} lists available)`
                );
              } else if (lists.length === 1) {
                // Auto-select the only list
                task.todoListId = lists[0].id;
                console.log(
                  `Task "${task.title}" auto-selected todo list: ${lists[0].name}`
                );
              }
            } catch (error) {
              console.error(
                `Error checking todo lists for task "${task.title}":`,
                error.message
              );
            }
          }

          // Add to needingInfo if any info is missing
          if (needsProject || needsTodoList || needsDueDate) {
            tasksNeedingInfo.push({
              index,
              task,
              needsProject,
              needsTodoList,
              needsDueDate,
            });
          }
        }

        if (tasksNeedingInfo.length > 0) {
          // Delete the processing message
          try {
            await ctx.deleteMessage(processingMessage.message_id);
          } catch (deleteError) {
            console.log(
              "Could not delete processing message:",
              deleteError.message
            );
          }

          console.log(`${tasksNeedingInfo.length} tasks need additional info`);

          // Store processed tasks and enter interactive mode
          f.selections.batchTasks = processedTasks;
          f.selections.batchTasksNeedingInfo = tasksNeedingInfo;
          f.selections.currentBatchTaskIndex = 0;
          f.selections.basecampPeople = basecampPeople;

          // Ask for first missing info
          return askBatchTaskInfo(ctx);
        }

        // All info present, create tasks directly
        const results = await createBatchTasks(
          ctx,
          processedTasks,
          basecampPeople
        );

        // Delete the processing message
        try {
          await ctx.deleteMessage(processingMessage.message_id);
        } catch (deleteError) {
          console.log(
            "Could not delete processing message:",
            deleteError.message
          );
        }

        // Send summary
        await sendBatchTaskSummary(ctx, results);
        await resetFlow(ctx);
        return;
      }

      // Single task - use existing flow
      const processedTask = await processTaskData(
        aiResult,
        context,
        access,
        accountId,
        null // No pre-fetched people for single task
      );
      f.selections.title = processedTask.title;
      f.selections.description = processedTask.description;
      f.selections.projectId = processedTask.projectId;
      f.selections.assigneeId = processedTask.assigneeId;
      f.selections.assigneeEmail = processedTask.assigneeEmail;
      f.selections.slackUserId = processedTask.slackUserId;
      f.selections.dueOn = processedTask.dueOn;

      // Store AI-extracted information
      f.selections.ai_extracted = {
        project_name: aiResult.project_name,
        assignee_names: aiResult.assignee_names,
        due_date: aiResult.due_date,
      };

      // Delete the processing message after successful AI processing
      try {
        await ctx.deleteMessage(processingMessage.message_id);
      } catch (deleteError) {
        console.log(
          "Could not delete processing message:",
          deleteError.message
        );
      }

      return await showTaskConfirmation(
        ctx,
        aiResult.title,
        aiResult.description
      );
    } catch (error) {
      console.error("Error in AI processing:", error);

      // Delete the processing message even on error
      try {
        await ctx.deleteMessage(processingMessage.message_id);
      } catch (deleteError) {
        console.log(
          "Could not delete processing message:",
          deleteError.message
        );
      }

      // Fallback to simple processing
      f.selections.title =
        text.length > 80 ? text.substring(0, 77) + "..." : text;
      f.selections.description = text;

      return await showTaskConfirmation(
        ctx,
        f.selections.title,
        f.selections.description
      );
    }
  }

  if (f.step === 3) {
    // This is now the project selection step
    return askProject(ctx);
  }

  if (f.step === 6) {
    // This is now the due date step (after AI processing, confirmation, project, todo list, assignee)
    const due = parseDue(text);

    // Handle skip - null is valid when user types "skip"
    if (due === null && text.toLowerCase() !== "skip") {
      return ctx.reply(
        'Could not parse that date. Try YYYY-MM-DD, "today", "tomorrow", "in 3 days", or type "skip" to skip.'
      );
    }

    f.selections.dueOn = due;

    try {
      const {
        projectId,
        todoListId,
        title,
        description,
        assigneeId,
        slackUserId,
      } = f.selections;
      const todo = await createTodo(ctx, {
        projectId,
        todoListId,
        title,
        description,
        assigneeId,
        dueOn: due,
      });

      // Get project name for notification
      const projectName =
        f.projects?.find((p) => p.id === projectId)?.name || "Unknown Project";
      const creatorName =
        ctx.from?.first_name || ctx.from?.username || "Unknown";

      // Send DM to assignee if assigned
      if (slackUserId) {
        await notifyAssignees(todo, projectName, creatorName, slackUserId);
      } else if (assigneeId) {
        await notifyAssignees(todo, projectName, creatorName);
      }

      await resetFlow(ctx);
      return ctx.reply(
        `✅ Task created: ${todo.content}\nLink: ${todo.app_url}`
      );
    } catch (e) {
      console.error(e?.response?.data || e.message);
      await resetFlow(ctx);
      return ctx.reply("Sorry, failed to create the task.");
    }
  }

  if (f.step === 9) {
    // Batch task due date input
    const needingInfo =
      f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
    const taskIndex = needingInfo.index;

    // Parse the due date (handles skip, today, tomorrow, etc.)
    const due = parseDue(text);

    // Handle skip - null is valid when user types "skip"
    if (due === null && text.toLowerCase() !== "skip") {
      return ctx.reply(
        'Could not parse that date. Try YYYY-MM-DD, "today", "tomorrow", "in 3 days", or type "skip" to skip.'
      );
    }

    if (text.toLowerCase() === "skip") {
      console.log(`Skipped due date for task ${taskIndex + 1}`);
    } else {
      // Update the task in batchTasks
      f.selections.batchTasks[taskIndex].dueOn = due;
      console.log(`Set due date for task ${taskIndex + 1}: ${due}`);
    }

    // Mark this question as answered
    needingInfo.needsDueDate = false;

    // Check if current task still needs info
    if (
      !needingInfo.needsProject &&
      !needingInfo.needsTodoList &&
      !needingInfo.needsDueDate
    ) {
      // Move to next task needing info
      f.selections.currentBatchTaskIndex++;
    }

    // Check if there are more tasks needing info
    if (
      f.selections.currentBatchTaskIndex <
      f.selections.batchTasksNeedingInfo.length
    ) {
      return askBatchTaskInfo(ctx);
    }

    // All info collected, create tasks
    console.log("All batch task info collected, creating tasks...");
    const results = await createBatchTasks(
      ctx,
      f.selections.batchTasks,
      f.selections.basecampPeople
    );
    await sendBatchTaskSummary(ctx, results);
    await resetFlow(ctx);
    return;
  }
});

// Project chosen
bot.action(/^proj_(\d+)$/, requireAuth, async (ctx) => {
  await ctx.answerCbQuery();
  const projectId = Number(ctx.match[1]);
  const f = ctx.session.flow;

  // Clean up all project selection messages
  if (f.projectMessages) {
    await cleanupMessages(ctx, f.projectMessages);
    f.projectMessages = [];
  }

  // Check if we're in batch task mode (step 7)
  if (f.step === 7) {
    // Batch task project selection
    const needingInfo =
      f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
    const taskIndex = needingInfo.index;

    // Update the task's project
    f.selections.batchTasks[taskIndex].projectId = projectId;
    console.log(`Set project for task ${taskIndex + 1}: ${projectId}`);

    // Mark project as provided
    needingInfo.needsProject = false;

    // Now check if we need to ask for todo list
    try {
      const { lists } = await fetchTodoLists(ctx, projectId);

      if (lists.length > 1) {
        // Multiple lists - need to ask user
        needingInfo.needsTodoList = true;
        return askBatchTaskInfo(ctx);
      } else if (lists.length === 1) {
        // Auto-select the only list
        f.selections.batchTasks[taskIndex].todoListId = lists[0].id;
        console.log(
          `Auto-selected todo list for task ${taskIndex + 1}: ${lists[0].name}`
        );
      }
    } catch (error) {
      console.error("Error fetching todo lists for batch task:", error.message);
      // Continue anyway - will use default list
    }

    // Check if current task still needs info (due date)
    if (needingInfo.needsDueDate) {
      return askBatchTaskInfo(ctx);
    }

    // Move to next task needing info
    f.selections.currentBatchTaskIndex++;

    // Check if there are more tasks needing info
    if (
      f.selections.currentBatchTaskIndex <
      f.selections.batchTasksNeedingInfo.length
    ) {
      return askBatchTaskInfo(ctx);
    }

    // All info collected, create tasks
    console.log("All batch task info collected, creating tasks...");
    const results = await createBatchTasks(
      ctx,
      f.selections.batchTasks,
      f.selections.basecampPeople
    );
    await sendBatchTaskSummary(ctx, results);
    await resetFlow(ctx);
    return;
  }

  // Normal single task flow
  f.selections.projectId = projectId;

  // Fetch todo lists and ask user to select if multiple exist
  try {
    f.step = 4; // Move to todo list selection
    return askTodoList(ctx);
  } catch (e) {
    console.error(e?.response?.data || e.message);
    return ctx.reply(
      "Could not find or create a to-do list in that project. Please check project permissions."
    );
  }
});

// Todo list chosen
bot.action(/^list_(.+)$/, requireAuth, async (ctx) => {
  await ctx.answerCbQuery();
  const listIdOrPage = ctx.match[1];

  if (listIdOrPage.startsWith("page_")) {
    // Handle pagination
    const page = Number(listIdOrPage.replace("page_", ""));
    console.log(`Showing todo list page ${page}`);
    return askTodoList(ctx, page);
  }

  const f = ctx.session.flow;
  const listId = Number(listIdOrPage);

  // Clean up all todo list selection messages
  if (f.todoListMessages) {
    await cleanupMessages(ctx, f.todoListMessages);
    f.todoListMessages = [];
  }

  // Check if we're in batch task mode (step 8)
  if (f.step === 8) {
    // Batch task todo list selection
    const needingInfo =
      f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
    const taskIndex = needingInfo.index;

    // Update the task's todo list
    f.selections.batchTasks[taskIndex].todoListId = listId;
    console.log(`Set todo list for task ${taskIndex + 1}: ${listId}`);

    // Mark todo list as provided
    needingInfo.needsTodoList = false;

    // Check if current task still needs info (due date)
    if (needingInfo.needsDueDate) {
      return askBatchTaskInfo(ctx);
    }

    // Move to next task needing info
    f.selections.currentBatchTaskIndex++;

    // Check if there are more tasks needing info
    if (
      f.selections.currentBatchTaskIndex <
      f.selections.batchTasksNeedingInfo.length
    ) {
      return askBatchTaskInfo(ctx);
    }

    // All info collected, create tasks
    console.log("All batch task info collected, creating tasks...");
    const results = await createBatchTasks(
      ctx,
      f.selections.batchTasks,
      f.selections.basecampPeople
    );
    await sendBatchTaskSummary(ctx, results);
    await resetFlow(ctx);
    return;
  }

  // Normal single task flow
  f.selections.todoListId = listId;
  console.log(`Todo list selected: ${listId}`);

  f.step = 5; // Move to assignee selection
  return askAssignee(ctx);
});

// Assignee chosen
bot.action(/^person_(.+)$/, requireAuth, async (ctx) => {
  await ctx.answerCbQuery();
  const personIdOrNone = ctx.match[1];

  if (personIdOrNone === "none") {
    // Clean up all assignee selection messages
    if (ctx.session.flow.assigneeMessages) {
      await cleanupMessages(ctx, ctx.session.flow.assigneeMessages);
      ctx.session.flow.assigneeMessages = [];
    }

    // No assignee selected
    ctx.session.flow.selections.assigneeId = null;
    console.log(`No assignee selected for task`);
    ctx.session.flow.step = 6; // Updated step number
    return askDueDate(ctx);
  } else if (personIdOrNone.startsWith("page_")) {
    // Handle assignee pagination
    const page = Number(personIdOrNone.replace("page_", ""));
    console.log(`Showing assignee page ${page}`);
    return askAssignee(ctx, page);
  } else {
    // Clean up all assignee selection messages
    if (ctx.session.flow.assigneeMessages) {
      await cleanupMessages(ctx, ctx.session.flow.assigneeMessages);
      ctx.session.flow.assigneeMessages = [];
    }

    const personId = Number(personIdOrNone);
    ctx.session.flow.selections.assigneeId = personId;
    console.log(`Assignee selected: ${personId}`);
    ctx.session.flow.step = 6; // Updated step number
    return askDueDate(ctx);
  }
});

// Task confirmation actions
bot.action("confirm_task", requireAuth, async (ctx) => {
  try {
    console.log("\n🔄 Processing confirm_task action");
    console.log("Callback query data:", ctx.callbackQuery.data);
    console.log("Session state:", {
      step: ctx.session.flow?.step,
      title: ctx.session.flow?.selections?.title,
      projectId: ctx.session.flow?.selections?.projectId,
      todoListId: ctx.session.flow?.selections?.todoListId,
    });

    // Acknowledge the callback query immediately
    await ctx.answerCbQuery("✅ Task confirmed");

    // Validate session
    if (!ctx.session.flow?.selections?.title) {
      console.error("❌ Invalid session state:", ctx.session.flow);
      await ctx.reply(
        "Sorry, there was an error. Please send your task description again."
      );
      return;
    }

    // Delete the confirmation message
    try {
      await ctx.deleteMessage();
      console.log("✅ Deleted confirmation message");
    } catch (error) {
      console.error("Failed to delete confirmation message:", error);
    }

    // Clear any tracked confirmation messages
    if (ctx.session.flow.confirmationMessages?.length) {
      try {
        await cleanupMessages(ctx, ctx.session.flow.confirmationMessages);
      } catch (error) {
        console.error("Failed to cleanup confirmation messages:", error);
      }
      ctx.session.flow.confirmationMessages = [];
    }

    // Check if we need project selection
    if (!ctx.session.flow.selections.projectId) {
      console.log("No project selected, showing project selection");
      ctx.session.flow.step = 3;
      await ctx.reply("Please select a project for this task:");
      await askProject(ctx);
      return;
    }

    // Check if we need todo list selection
    if (!ctx.session.flow.selections.todoListId) {
      console.log("No todo list selected, showing todo list selection");
      ctx.session.flow.step = 4;
      await ctx.reply("Please select a todo list for this task:");
      await askTodoList(ctx);
      return;
    }

    // Check if AI already extracted assignee - if so, skip to due date check
    if (ctx.session.flow.selections.assigneeId) {
      console.log("Using AI-extracted assignee, skipping assignee selection");

      // Check if due date is missing - if so, ask for it
      if (!ctx.session.flow.selections.dueOn) {
        console.log("No due date found, asking user");
        ctx.session.flow.step = 6;
        await ctx.reply("When is this task due?");
        return askDueDate(ctx);
      }

      // All info present, create task immediately
      console.log("Using AI-extracted due date, creating task immediately");
      const {
        projectId,
        todoListId,
        title,
        description,
        assigneeId,
        dueOn,
        slackUserId,
      } = ctx.session.flow.selections;

      // Show creating message
      const processingMsg = await ctx.reply("⏳ Creating task...");

      try {
        const todo = await createTodo(ctx, {
          projectId,
          todoListId,
          title,
          description,
          assigneeId,
          dueOn,
        });

        // Get project name for notification
        const projectName =
          ctx.session.flow.projects?.find((p) => p.id === projectId)?.name ||
          "Unknown Project";
        const creatorName =
          ctx.from?.first_name || ctx.from?.username || "Unknown";

        // Send DM to assignee if assigned
        if (slackUserId) {
          await notifyAssignees(todo, projectName, creatorName, slackUserId);
        } else if (assigneeId) {
          await notifyAssignees(todo, projectName, creatorName);
        }

        // Clean up processing message
        try {
          await ctx.deleteMessage(processingMsg.message_id);
        } catch (deleteError) {
          console.log(
            "Could not delete processing message:",
            deleteError.message
          );
        }

        await resetFlow(ctx);
        return ctx.reply(
          `✅ Task created successfully!\n\nTitle: ${todo.content}\nLink: ${todo.app_url}\n\nSend me another message to create a new task.`
        );
      } catch (e) {
        console.error(e?.response?.data || e.message);

        // Clean up processing message
        try {
          await ctx.deleteMessage(processingMsg.message_id);
        } catch (deleteError) {
          console.log(
            "Could not delete processing message:",
            deleteError.message
          );
        }

        await resetFlow(ctx);
        return ctx.reply(
          "❌ Sorry, failed to create the task. Please try again or contact support if the issue persists."
        );
      }
    } else {
      // Ask for assignee
      ctx.session.flow.step = 5;
      await ctx.reply("Who should be assigned to this task?");
      return askAssignee(ctx);
    }
  } catch (e) {
    console.error(e?.response?.data || e.message);
    return ctx.reply(
      "Could not find or create a to-do list in that project. Please check project permissions."
    );
  }
});

// Status toggle handler
bot.action(/^status_toggle_(.+)$/, requireAuth, async (ctx) => {
  const newStatus = ctx.match[1];
  const telegramId = String(ctx.from.id);

  try {
    await ctx.answerCbQuery("Updating status...");

    const result = await updatePersonStatus(telegramId, newStatus);

    if (!result) {
      return ctx.editMessageText(
        "❌ Sorry, I couldn't update your status. Please contact an admin."
      );
    }

    const statusEmoji = newStatus === "online" ? "🟢" : "⚫";
    await ctx.editMessageText(
      `${statusEmoji} Status updated successfully!\n\nYour status is now: *${newStatus.toUpperCase()}*`,
      { parse_mode: "Markdown" }
    );

    console.log(`✅ Status updated for ${result.name}: ${newStatus}`);
  } catch (error) {
    console.error("Error updating status:", error);
    await ctx.answerCbQuery("❌ Error updating status");
    await ctx.editMessageText(
      "❌ Sorry, there was an error updating your status. Please try again."
    );
  }
});

bot.action("rewrite_task", requireAuth, async (ctx) => {
  await ctx.answerCbQuery();

  // Clean up confirmation messages
  if (ctx.session.flow.confirmationMessages) {
    await cleanupMessages(ctx, ctx.session.flow.confirmationMessages);
    ctx.session.flow.confirmationMessages = [];
  }

  // Re-process the original message with AI
  const reprocessingMessage = await ctx.reply(
    "🤖 Re-processing your task with AI..."
  );

  try {
    const originalMessage = ctx.session.flow.selections.originalMessage;
    const aiResult = await processTaskWithAI(originalMessage);
    ctx.session.flow.selections.title = aiResult.title;
    ctx.session.flow.selections.description = aiResult.description;

    // Delete the reprocessing message after successful AI processing
    try {
      await ctx.deleteMessage(reprocessingMessage.message_id);
    } catch (deleteError) {
      console.log(
        "Could not delete reprocessing message:",
        deleteError.message
      );
    }

    return await showTaskConfirmation(
      ctx,
      aiResult.title,
      aiResult.description
    );
  } catch (error) {
    console.error("Error in AI reprocessing:", error);

    // Delete the reprocessing message even on error
    try {
      await ctx.deleteMessage(reprocessingMessage.message_id);
    } catch (deleteError) {
      console.log(
        "Could not delete reprocessing message:",
        deleteError.message
      );
    }

    return ctx.reply(
      "❌ Error re-processing the task. Please try starting over with /start"
    );
  }
});

// Project pagination
bot.action(/^proj_page_(\d+)$/, requireAuth, async (ctx) => {
  await ctx.answerCbQuery();
  const page = Number(ctx.match[1]);
  console.log(`Showing project page ${page}`);
  return askProject(ctx, page);
});

/** ------------ OAuth callback server ------------ **/
// Helper function to handle Basecamp OAuth
const handleBasecampOAuth = async (code, redirectUri) => {
  const body = qs.stringify({
    client_id: BASECAMP_CLIENT_ID,
    client_secret: BASECAMP_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const tokenUrl =
    "https://launchpad.37signals.com/authorization/token?type=web_server";
  const { data: token } = await axios.post(tokenUrl, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // Discover account id via authorization.json
  const { data: auth } = await axios.get(
    "https://launchpad.37signals.com/authorization.json",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    }
  );
  const accountId =
    Array.isArray(auth.accounts) && auth.accounts.length
      ? auth.accounts[0].id
      : auth.accounts.id;

  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    accountId,
  };
};

// Telegram OAuth callback
app.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state } = req.query; // state carries telegram user id
    const auth = await handleBasecampOAuth(code, REDIRECT_URI);

    await store.set(String(state), {
      access: auth.access_token,
      refresh: auth.refresh_token,
      accountId: auth.accountId,
      platform: "telegram",
    });

    res.send("Connected. You can return to Telegram.");
  } catch (e) {
    console.error(e?.response?.data || e.message);
    res.status(500).send("OAuth failed.");
  }
});

// Basecamp webhook endpoint
app.post("/basecamp/webhook", async (req, res) => {
  try {
    const event = req.body;

    // Validate webhook payload
    if (!event || typeof event !== "object") {
      console.error("Invalid webhook payload received:", event);
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    console.log(
      "Received Basecamp webhook payload:",
      JSON.stringify(event, null, 2)
    );

    // Validate required fields
    if (!event.kind || !event.recording || !event.recording.bucket) {
      console.error("Missing required fields in webhook payload:", {
        has_kind: !!event.kind,
        has_recording: !!event.recording,
        has_bucket: event.recording?.bucket,
      });
      return res
        .status(400)
        .json({ error: "Missing required fields in webhook payload" });
    }

    console.log("Processing Basecamp webhook:", {
      kind: event.kind,
      recording: JSON.stringify(event.recording, null, 2),
      creator: event.creator,
    });

    // Get the project ID from the event
    const projectId = event.recording.bucket.id;

    // Get channel for this project (with fallback to default channel)
    let channelId = null;

    // Try to get project-specific channel from Airtable mapping
    try {
      const mappings = await fetchProjectMappings();
      channelId = mappings[projectId];
      if (channelId) {
        console.log(
          `Using project-specific channel ${channelId} for project ${projectId} (from Airtable)`
        );
      }
    } catch (error) {
      console.error(
        "Error fetching project mappings from Airtable:",
        error.message
      );
    }

    // Fallback to default channel if no project-specific mapping found
    if (!channelId) {
      channelId = process.env.SLACK_DEFAULT_CHANNEL;
      console.log(
        `Using default channel ${channelId} for project ${projectId}`
      );
    }

    if (!channelId) {
      console.log(
        "No Slack channel configured (neither project-specific nor default), skipping notification"
      );
      return res.sendStatus(200);
    }

    // Fetch full details for all event types to ensure we have complete information
    let todoDetails = null;
    let parentTodo = null; // For comments, this will be the parent todo

    try {
      const users = await store.getAllUsers();
      if (users.length > 0) {
        const auth = await store.get(users[0]);
        if (auth) {
          // For todo events, fetch the todo itself
          if (
            event.kind === "todo_created" ||
            event.kind === "todo_completed" ||
            event.kind === "todo_assignees_changed" ||
            event.kind === "todo_changed"
          ) {
            if (event.recording.url) {
              const { data: fetchedTodo } = await bc(auth.access).get(
                event.recording.url
              );
              todoDetails = fetchedTodo;
              console.log(`Fetched full todo details for ${event.kind}:`, {
                id: todoDetails.id,
                title: todoDetails.title,
                assignees: todoDetails.assignees,
              });
            }
          }

          // For comment events, we need to fetch the parent todo
          if (event.kind === "comment_created") {
            console.log("Comment event detected, looking for parent todo...");

            // The comment itself
            if (event.recording.url) {
              const { data: comment } = await bc(auth.access).get(
                event.recording.url
              );
              console.log("Comment data:", {
                id: comment.id,
                parent: comment.parent,
              });

              // Fetch the parent todo if available
              if (comment.parent && comment.parent.url) {
                const { data: fetchedTodo } = await bc(auth.access).get(
                  comment.parent.url
                );
                parentTodo = fetchedTodo;
                console.log("Fetched parent todo for comment:", {
                  id: parentTodo.id,
                  title: parentTodo.title,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching event details:", error.message);
    }

    // Enrich assignees with slack_id from Airtable
    let enrichedAssignees = todoDetails?.assignees || [];
    if (enrichedAssignees.length > 0) {
      try {
        const airtablePeople = await fetchPeople();
        enrichedAssignees = enrichedAssignees.map((assignee) => {
          console.log(`Looking up assignee in Airtable:`, {
            basecamp_id: assignee.id,
            email: assignee.email_address,
            name: assignee.name,
          });

          // First try to match by Basecamp ID (most reliable)
          let airtablePerson = airtablePeople.find(
            (ap) => ap.basecamp_id && ap.basecamp_id == assignee.id
          );

          // Fall back to email matching if basecamp_id match failed
          if (!airtablePerson && assignee.email_address) {
            airtablePerson = airtablePeople.find(
              (ap) =>
                ap.email &&
                ap.email.toLowerCase() === assignee.email_address.toLowerCase()
            );
            if (airtablePerson) {
              console.log(
                `✅ Matched assignee ${assignee.name} by email: ${assignee.email_address}`
              );
            }
          } else if (airtablePerson) {
            console.log(
              `✅ Matched assignee ${assignee.name} by Basecamp ID: ${assignee.id}`
            );
          }

          if (!airtablePerson) {
            console.log(
              `⚠️ No Airtable match found for assignee ${assignee.name} (basecamp_id: ${assignee.id}, email: ${assignee.email_address})`
            );
          }

          return {
            ...assignee,
            slack_id: airtablePerson?.slack_id || null,
          };
        });
        console.log(
          "Enriched assignees with Slack IDs from Airtable:",
          enrichedAssignees.map((a) => ({
            name: a.name,
            slack_id: a.slack_id,
          }))
        );
      } catch (error) {
        console.error(
          "Error enriching assignees with Slack IDs from Airtable:",
          error.message
        );
      }
    }

    // Enrich creator with slack_id from Airtable
    let creatorSlackId = null;
    if (event.creator) {
      try {
        const airtablePeople = await fetchPeople();

        // First try to match by Basecamp ID
        let airtablePerson = airtablePeople.find(
          (ap) => ap.basecamp_id && ap.basecamp_id == event.creator.id
        );

        // Fall back to email or name matching if basecamp_id match failed
        if (!airtablePerson && event.creator.email_address) {
          airtablePerson = airtablePeople.find(
            (ap) =>
              ap.email &&
              ap.email.toLowerCase() ===
                event.creator.email_address.toLowerCase()
          );
        }

        if (!airtablePerson) {
          // Last resort: try name matching
          airtablePerson = airtablePeople.find(
            (ap) => ap.name.toLowerCase() === event.creator.name.toLowerCase()
          );
        }

        if (airtablePerson) {
          creatorSlackId = airtablePerson.slack_id;
          console.log(
            `✅ Matched creator ${event.creator.name} with Slack ID: ${creatorSlackId}`
          );
        } else {
          console.log(
            `⚠️ No Airtable match found for creator ${event.creator.name}`
          );
        }
      } catch (error) {
        console.error(
          "Error enriching creator with Slack ID from Airtable:",
          error.message
        );
      }
    }

    // Format the event data
    const data = {
      title:
        event.kind === "comment_created"
          ? parentTodo?.title || event.recording.title // Use parent todo title for comments
          : todoDetails?.title || event.recording.title,
      description:
        todoDetails?.description ||
        todoDetails?.content ||
        event.recording.content,
      project_name: event.recording.bucket.name,
      creator_name: event.creator.name,
      creator_slack_id: creatorSlackId,
      url:
        event.kind === "comment_created"
          ? parentTodo?.app_url || event.recording.app_url // Use parent todo URL for comments
          : todoDetails?.app_url || event.recording.app_url,
      due_date: todoDetails?.due_on || event.recording.due_on || null,
      completer_name: event.recording.completer?.name,
      assignees: enrichedAssignees.map((a) => ({
        id: a.id,
        name: a.name,
        email_address: a.email_address,
        slack_id: a.slack_id,
      })),
      content: event.recording.content, // For comments, this is the actual comment text
    };

    console.log("Formatted data for notifications:", {
      title: data.title,
      project_name: data.project_name,
      assignees: data.assignees.map((a) => ({
        name: a.name,
        slack_id: a.slack_id,
      })),
      url: data.url,
      due_date: data.due_date,
    });

    console.log("Formatted data for Slack:", {
      title: data.title,
      description: data.description,
      assignees_count: data.assignees.length,
      assignees: data.assignees,
      due_date: data.due_date,
      due_date_type: typeof data.due_date,
    });

    // Send to Slack based on event type
    switch (event.kind) {
      case "todo_created":
        // Send new task notification and store the message mapping
        console.log(
          "📢 Sending todo_created notification to channel",
          channelId
        );
        const createResponse = await sendToSlack(channelId, event.kind, data);
        console.log("✅ Channel notification sent, response:", {
          ts: createResponse?.ts,
          channel: createResponse?.channel,
        });

        // Store the message mapping for future thread replies
        if (createResponse && todoDetails) {
          console.log("💾 Storing task message mapping");
          await storeTaskMessage(
            todoDetails.id, // Basecamp task ID
            createResponse.ts, // Slack message timestamp (thread_ts)
            createResponse.channel, // Slack channel ID
            todoDetails.bucket?.id || event.recording.bucket?.id, // Project ID
            todoDetails.title || event.recording.title // Task title
          );
          console.log("✅ Task message mapping stored");
        }

        // Send DMs to assignees
        if (data.assignees && data.assignees.length > 0) {
          console.log("📧 Sending DMs to assignees for new task");
          for (const assignee of data.assignees) {
            if (assignee.slack_id) {
              try {
                const dmResponse = await sendAssigneeDM(
                  assignee.slack_id,
                  data,
                  false
                );
                console.log(
                  `✅ DM sent to ${assignee.name} (${assignee.slack_id})`
                );
              } catch (error) {
                console.error(
                  `❌ Failed to send DM to ${assignee.name}:`,
                  error.message
                );
              }
            } else {
              console.log(
                `⚠️ No Slack ID for assignee ${assignee.name}, skipping DM`
              );
            }
          }
        }
        break;

      case "todo_assignees_changed":
      case "todo_changed":
        // Handle assignment changes
        console.log("🔔 Processing assignment change event");
        console.log("Todo details:", {
          hasTodoDetails: !!todoDetails,
          todoId: todoDetails?.id,
          assigneesCount: enrichedAssignees.length,
          assignees: enrichedAssignees.map((a) => ({
            name: a.name,
            slack_id: a.slack_id,
          })),
        });

        // Fetch the full todo details to see current assignees
        if (todoDetails && enrichedAssignees.length > 0) {
          console.log(
            "✅ Task has assignees after change:",
            enrichedAssignees.map((a) => a.name)
          );

          // Send DM to newly assigned people
          for (const assignee of enrichedAssignees) {
            if (assignee.slack_id) {
              console.log(
                `\n📧 Sending assignment DM to ${assignee.name} (${assignee.slack_id})`
              );

              try {
                // Prepare task data for DM
                const taskData = {
                  title: data.title,
                  description: data.description,
                  project_name: data.project_name,
                  due_date: data.due_date,
                  creator_name: data.creator_name,
                  url: data.url,
                };

                console.log("Task data for DM:", taskData);

                const dmResponse = await sendAssigneeDM(
                  assignee.slack_id,
                  taskData,
                  true
                ); // true = existing task
                if (dmResponse) {
                  console.log(
                    `✅ Assignment DM sent to ${assignee.name} (message ts: ${dmResponse.ts})`
                  );
                } else {
                  console.log(
                    `⚠️ DM to ${assignee.name} returned null response`
                  );
                }
              } catch (error) {
                console.error(
                  `❌ Failed to send DM to ${assignee.name}:`,
                  error.message,
                  error.stack
                );
              }
            } else {
              console.log(
                `⚠️ No Slack ID for assignee ${assignee.name}, skipping DM. Check Airtable record.`
              );
            }
          }

          // Also send notification to thread/channel for each assignee
          const taskId = todoDetails.id;
          const threadInfo = await getTaskMessage(taskId);
          console.log("Thread info for task:", { taskId, threadInfo });

          for (const assignee of enrichedAssignees) {
            if (threadInfo && threadInfo.thread_ts) {
              // Reply to the original thread
              console.log(
                `💬 Sending assignment notification to thread for ${assignee.name}`
              );
              try {
                await sendAssignmentToThread(
                  threadInfo.channel_id,
                  threadInfo.thread_ts,
                  assignee.slack_id,
                  data
                );
                console.log(`✅ Thread notification sent for ${assignee.name}`);
              } catch (error) {
                console.error(
                  `❌ Failed to send thread notification for ${assignee.name}:`,
                  error.message
                );
              }
            } else {
              // No thread found, send to channel
              console.log(
                `📢 No thread found, sending assignment notification to channel for ${assignee.name}`
              );
              try {
                await sendAssignmentToThread(
                  channelId,
                  null,
                  assignee.slack_id,
                  data
                );
                console.log(
                  `✅ Channel notification sent for ${assignee.name}`
                );
              } catch (error) {
                console.error(
                  `❌ Failed to send channel notification for ${assignee.name}:`,
                  error.message
                );
              }
            }
          }
        } else if (!todoDetails) {
          console.log(
            "⚠️ No todo details available, skipping assignment notifications"
          );
        } else if (enrichedAssignees.length === 0) {
          console.log(
            "⚠️ No enriched assignees found (task might have been unassigned or Slack IDs missing)"
          );
        }
        break;

      case "todo_completed":
      case "comment_created":
        // Try to find the original message to reply to thread
        // For comments, use the parent todo ID; for completed, use the todo ID
        let taskId = null;
        if (event.kind === "comment_created") {
          taskId = parentTodo?.id;
          console.log(`Comment event - using parent todo ID: ${taskId}`);
        } else {
          taskId = todoDetails?.id || event.recording.id;
          console.log(`Completed event - using todo ID: ${taskId}`);
        }

        let threadInfo = null;

        if (taskId) {
          threadInfo = await getTaskMessage(taskId);
          console.log(`Lookup result for task ${taskId}:`, threadInfo);
        } else {
          console.log(`⚠️ No task ID found for ${event.kind} event`);
        }

        if (threadInfo && threadInfo.thread_ts) {
          // Reply to the original thread
          console.log(
            `✅ Found original message, replying to thread for ${event.kind}`
          );
          await sendToSlack(
            threadInfo.channel_id,
            event.kind,
            data,
            threadInfo.thread_ts // This makes it a thread reply
          );
        } else {
          // No thread found, send as new message
          console.log(
            `⚠️ No thread found for task ${taskId}, sending as new message`
          );
          await sendToSlack(channelId, event.kind, data);
        }
        break;

      default:
        console.log(`Unhandled Basecamp event type: ${event.kind}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing Basecamp webhook:", error);
    res.sendStatus(500);
  }
});

// Slack OAuth callback
app.get("/oauth/callback/slack", async (req, res) => {
  try {
    const { code, state } = req.query;

    // Validate required parameters
    if (!code) {
      console.error("OAuth callback missing code parameter");
      return res.status(400).send("OAuth failed: Missing authorization code");
    }

    if (!state) {
      console.error("OAuth callback missing state parameter");
      return res.status(400).send("OAuth failed: Missing state parameter");
    }

    console.log("Received Basecamp OAuth callback for Slack:", {
      code: "REDACTED",
      state: state,
      redirect_uri: `${process.env.APP_URL}/oauth/callback/slack`,
    });

    const slackRedirectUri = `${process.env.APP_URL}/oauth/callback/slack`;

    try {
      const auth = await handleBasecampOAuth(code, slackRedirectUri);
      console.log("Successfully obtained Basecamp tokens for Slack user:", {
        state: state,
        accountId: auth.accountId,
      });

      await store.set(String(state), {
        access: auth.access_token,
        refresh: auth.refresh_token,
        accountId: auth.accountId,
        platform: "slack",
      });

      console.log("Successfully stored auth data for Slack user:", state);
      res.send(
        "Connected! You can return to Slack and continue creating tasks."
      );
    } catch (authError) {
      console.error("Error during Basecamp OAuth:", {
        error: authError.message,
        response: authError.response?.data,
        status: authError.response?.status,
      });
      res
        .status(500)
        .send(
          "OAuth failed: Could not authenticate with Basecamp. Please try again or contact support if the issue persists."
        );
    }
  } catch (e) {
    console.error("Unexpected error in Slack OAuth callback:", {
      error: e.message,
      stack: e.stack,
    });
    res
      .status(500)
      .send(
        "OAuth failed: An unexpected error occurred. Please try again or contact support if the issue persists."
      );
  }
});

// Graceful shutdown handling
const gracefulShutdown = () => {
  console.log("🛑 Received shutdown signal, closing database connection...");

  try {
    store.close();
    console.log("✅ Database connection closed");
  } catch (error) {
    console.error("❌ Error closing database:", error.message);
  }

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("SIGUSR2", gracefulShutdown); // nodemon restart

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
});

// Health check endpoint for Railway
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    railway: !!process.env.RAILWAY_ENVIRONMENT,
    webhook_url:
      process.env.WEBHOOK_URL ||
      `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`,
    auth_store: "airtable",
  });
});

// Debug endpoint to test webhook endpoint
app.get("/debug/webhook", async (req, res) => {
  try {
    const webhookInfo = await bot.telegram.getWebhookInfo();
    res.json({
      webhook_info: webhookInfo,
      current_webhook_url:
        process.env.WEBHOOK_URL ||
        `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`,
      environment_variables: {
        NODE_ENV: process.env.NODE_ENV,
        RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
        RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN,
        RAILWAY_DOMAIN: process.env.RAILWAY_DOMAIN,
        WEBHOOK_URL: process.env.WEBHOOK_URL,
      },
      server_status: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      webhook_url:
        process.env.WEBHOOK_URL ||
        `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`,
    });
  }
});

// Test endpoint to verify Railway deployment
app.get("/test", (req, res) => {
  res.json({
    message: "Bot server is running!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    webhook_configured: !!(
      process.env.WEBHOOK_URL || process.env.RAILWAY_PUBLIC_DOMAIN
    ),
    auth_store_connected: !!store,
  });
});

// Debug endpoint to list all projects
app.get("/debug/projects", async (req, res) => {
  try {
    const users = await store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({ error: "No authenticated users found" });
    }

    const auth = await store.get(users[0]);
    if (!auth) {
      return res.status(400).json({ error: "No valid authentication found" });
    }

    // Fetch all projects
    const { data: projects } = await bc(auth.access).get(
      `https://3.basecampapi.com/${auth.accountId}/projects.json`
    );

    // Format the data nicely
    const projectDetails = projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      created_at: project.created_at,
      people_url: `${req.protocol}://${req.get("host")}/debug/project-people/${
        project.id
      }`,
    }));

    res.json({
      status: "ok",
      account_id: auth.accountId,
      total_projects: projects.length,
      projects: projectDetails,
      note: "Click on people_url to see who has access to each project",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(error.response?.status || 500).json({
      error: "Failed to fetch projects",
      message: error.message,
    });
  }
});

// Debug endpoint to get people in a specific project
app.get("/debug/project-people/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({ error: "Project ID is required" });
    }

    const users = store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({ error: "No authenticated users found" });
    }

    const auth = await store.get(users[0]);
    if (!auth) {
      return res.status(400).json({ error: "No valid authentication found" });
    }

    // Fetch project details first
    const { data: project } = await bc(auth.access).get(
      `https://3.basecampapi.com/${auth.accountId}/projects/${projectId}.json`
    );

    // Fetch people in the project
    const { data: projectPeople } = await bc(auth.access).get(
      `https://3.basecampapi.com/${auth.accountId}/projects/${projectId}/people.json`
    );

    // Format the data nicely
    const peopleDetails = projectPeople.map((person) => ({
      id: person.id,
      name: person.name,
      email_address: person.email_address,
      title: person.title,
      admin: person.admin,
      owner: person.owner,
      company: person.company?.name || null,
    }));

    res.json({
      status: "ok",
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
      },
      account_id: auth.accountId,
      total_people: projectPeople.length,
      people_with_emails: projectPeople.filter((p) => p.email_address).length,
      people: peopleDetails,
      note: "These are the people who have access to this specific project",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching project people:", error);
    res.status(error.response?.status || 500).json({
      error: "Failed to fetch project people",
      message: error.message,
      status: error.response?.status,
      details: error.response?.data,
    });
  }
});

// Debug endpoint to see raw Basecamp user data
app.get("/debug/basecamp-users", async (req, res) => {
  try {
    const users = await store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({ error: "No authenticated users found" });
    }

    const auth = await store.get(users[0]);
    if (!auth) {
      return res.status(400).json({ error: "No valid authentication found" });
    }

    // Fetch Basecamp people
    const { data: basecampPeople } = await bc(auth.access).get(
      `https://3.basecampapi.com/${auth.accountId}/people.json`
    );

    // Show all users with their details
    const userDetails = basecampPeople.map((person) => ({
      id: person.id,
      name: person.name,
      email_address: person.email_address,
      title: person.title,
      admin: person.admin,
      owner: person.owner,
    }));

    res.json({
      status: "ok",
      account_id: auth.accountId,
      total_users: basecampPeople.length,
      users_with_emails: basecampPeople.filter((p) => p.email_address).length,
      users: userDetails,
      note: "These emails come directly from Basecamp user profiles",
      action:
        "Update incorrect emails in Basecamp Settings > People & permissions",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching Basecamp users:", error);
    res.status(500).json({
      error: "Failed to fetch Basecamp users",
      message: error.message,
    });
  }
});

// Debug endpoint to compare Airtable people with Basecamp
app.get("/debug/people-matching", async (req, res) => {
  try {
    const users = await store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({ error: "No authenticated users found" });
    }

    const auth = await store.get(users[0]);
    if (!auth) {
      return res.status(400).json({ error: "No valid authentication found" });
    }

    // Fetch Basecamp people
    const { data: basecampPeople } = await bc(auth.access).get(
      `https://3.basecampapi.com/${auth.accountId}/people.json`
    );

    let airtablePeople = [];
    let airtableError = null;

    try {
      airtablePeople = await fetchPeople(true); // Force refresh
    } catch (error) {
      airtableError = error.message;
    }

    // Compare and find matches/mismatches
    const comparison = airtablePeople.map((airPerson) => {
      const basecampMatch = basecampPeople.find(
        (bp) =>
          bp.email_address &&
          bp.email_address.toLowerCase() === airPerson.email.toLowerCase()
      );

      return {
        airtable_name: airPerson.name,
        airtable_email: airPerson.email,
        airtable_basecamp_id: airPerson.basecamp_id,
        slack_id: airPerson.slack_id,
        basecamp_id: basecampMatch?.id || null,
        basecamp_name: basecampMatch?.name || null,
        basecamp_email: basecampMatch?.email_address || null,
        ids_match:
          airPerson.basecamp_id && basecampMatch
            ? airPerson.basecamp_id == basecampMatch.id
            : null,
        status: basecampMatch ? "✅ MATCHED" : "❌ NO MATCH",
      };
    });

    res.json({
      status: "ok",
      airtable_people_count: airtablePeople.length,
      basecamp_people_count: basecampPeople.length,
      airtable_error: airtableError,
      comparison: comparison,
      unmatched_airtable: comparison
        .filter((c) => !c.basecamp_id)
        .map((c) => c.airtable_email),
      id_mismatches: comparison
        .filter((c) => c.ids_match === false)
        .map(
          (c) =>
            `${c.airtable_name}: Airtable ID ${c.airtable_basecamp_id} != Basecamp ID ${c.basecamp_id}`
        ),
      all_basecamp_emails: basecampPeople
        .filter((bp) => bp.email_address)
        .map((bp) => bp.email_address),
      timestamp: new Date().toISOString(),
      help: {
        message:
          "This shows how your Airtable people data matches with actual Basecamp users",
        note: "Email matching is case-insensitive",
        action: "Update Airtable records if there are mismatches",
      },
    });
  } catch (error) {
    console.error("Error in people matching debug:", error);
    res.status(500).json({
      error: "Failed to compare people lists",
      message: error.message,
    });
  }
});

// Check authentication status
app.get("/debug/auth-status", async (req, res) => {
  try {
    // Get all users and their auth data
    const users = await store.getAllUsers();
    console.log("Found users:", users);

    const auths = await Promise.all(
      users.map(async (userId) => {
        console.log("Checking auth for user:", userId);
        const auth = await store.get(userId);
        console.log("Auth data:", auth);

        if (!auth) {
          return {
            userId: userId,
            error: "No auth data found",
            hasValidTokens: false,
          };
        }

        return {
          userId: userId,
          platform: auth.platform || "unknown",
          accountId: auth.accountId,
          hasValidTokens: !!(auth.access && auth.refresh),
        };
      })
    );

    const validAuths = auths.filter((auth) => auth); // Remove any null entries

    res.json({
      status: "ok",
      authenticated_users: users.length,
      valid_auths: auths.filter((a) => a.hasValidTokens).length,
      auth_details: auths,
      auth_store_connected: !!store,
      timestamp: new Date().toISOString(),
      help:
        auths.length === 0
          ? {
              message: "No authenticated users found",
              steps: [
                "1. Start a chat with your Telegram bot",
                "2. Send any message",
                "3. Click the Basecamp authentication link",
                "4. Authorize the app",
                "5. Return to Telegram and confirm connection",
                "6. Try checking auth status again",
              ],
            }
          : undefined,
    });
  } catch (error) {
    console.error("Auth status error:", error);
    res.status(500).json({
      error: "Failed to get auth status",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Manual webhook reset endpoint
app.post("/debug/reset-webhook", async (req, res) => {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    res.json({
      message: "Webhook deleted successfully",
      pending_updates_dropped: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual webhook setup endpoint
app.post("/debug/setup-webhook", async (req, res) => {
  try {
    const webhookUrl =
      req.body.url ||
      process.env.WEBHOOK_URL ||
      `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`;

    await bot.telegram.setWebhook(webhookUrl, {
      max_connections: 40,
      drop_pending_updates: true,
    });

    const webhookInfo = await bot.telegram.getWebhookInfo();
    res.json({
      message: "Webhook set successfully",
      url: webhookUrl,
      webhook_info: webhookInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Setup Basecamp webhooks for all projects
app.post("/debug/setup-basecamp-webhooks", async (req, res) => {
  try {
    // Get auth token from any authenticated user (preferably an admin)
    const users = store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({
        error: "No authenticated users found",
        help: "Please authenticate with Basecamp first by:",
        steps: [
          "1. Start a chat with your Telegram bot",
          "2. Send any message",
          "3. Click the Basecamp authentication link",
          "4. Authorize the app",
          "5. Return to Telegram and confirm connection",
          "6. Try this webhook setup again",
        ],
      });
    }

    const auth = await store.get(users[0]);
    if (!auth) {
      return res.status(400).json({ error: "No valid authentication found" });
    }

    const results = await setupWebhooksForAllProjects(
      auth.accountId,
      auth.access
    );
    res.json({
      message: "Basecamp webhooks setup completed",
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to set up Basecamp webhooks:", error);
    res.status(500).json({ error: error.message });
  }
});

// List Basecamp webhooks for a project
app.get("/debug/list-basecamp-webhooks/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const users = await store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({ error: "No authenticated users found" });
    }

    const auth = await store.get(users[0]);
    if (!auth) {
      return res.status(400).json({ error: "No valid authentication found" });
    }

    const webhooks = await listProjectWebhooks(
      auth.accountId,
      projectId,
      auth.access
    );
    res.json({
      message: "Basecamp webhooks retrieved",
      webhooks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to list Basecamp webhooks:", error);
    res.status(500).json({ error: error.message });
  }
});

// Manual bot commands setup endpoint
app.post("/debug/setup-commands", async (req, res) => {
  try {
    await setupBotCommands();

    // Get current commands to verify
    const commands = await bot.telegram.getMyCommands();

    res.json({
      message: "Bot commands set successfully",
      commands: commands,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set up webhook endpoint for ALL environments (before server starts)
app.get("/webhook", (req, res) => {
  res.json({
    message: "Webhook endpoint is active",
    method: "GET",
    timestamp: new Date().toISOString(),
    note: "Telegram should POST to this endpoint",
  });
});

app.post("/webhook", async (req, res, next) => {
  console.log("📨 Webhook POST received:", {
    method: req.method,
    url: req.url,
    headers: {
      "content-type": req.headers["content-type"],
      "content-length": req.headers["content-length"],
      "user-agent": req.headers["user-agent"],
    },
    body: req.body,
  });

  try {
    return bot.webhookCallback("/webhook")(req, res, next);
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res
      .status(500)
      .json({ error: "Webhook processing failed", message: error.message });
  }
});

// Configure Slack notifications for Basecamp projects
const setupSlackNotifications = async () => {
  const defaultChannel = process.env.SLACK_DEFAULT_CHANNEL;

  try {
    const mappings = await fetchProjectMappings();
    const projectCount = Object.keys(mappings).length;

    if (!defaultChannel && projectCount === 0) {
      console.log("⚠️ No Slack channels configured");
      console.log("Set SLACK_DEFAULT_CHANNEL for a default channel");
      console.log(
        "Add project mappings in Airtable for project-specific channels"
      );
      return;
    }

    if (defaultChannel) {
      console.log(`✅ Default Slack channel: ${defaultChannel}`);
    }

    if (projectCount > 0) {
      console.log(
        `✅ Project-specific mappings loaded from Airtable (${projectCount} project(s)):`
      );
      Object.entries(mappings).forEach(([projectId, channelId]) => {
        console.log(`   Project ${projectId} → Channel ${channelId}`);
      });
    }
  } catch (error) {
    console.log(
      `⚠️ Error loading project mappings from Airtable: ${error.message}`
    );
    if (defaultChannel) {
      console.log(
        `Will use default channel ${defaultChannel} for all projects`
      );
    }
  }
};

app.listen(PORT, async () => {
  console.log(`🚀 Server started on port :${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `🚂 Railway: ${!!process.env.RAILWAY_ENVIRONMENT ? "YES" : "NO"}`
  );

  // Set up Slack notifications
  await setupSlackNotifications();
});

// Set up bot commands menu (works for both polling and webhook modes)
const setupBotCommands = async () => {
  try {
    const commands = [
      { command: "start", description: "Begin creating a new task" },
      { command: "stop", description: "Cancel current conversation and reset" },
      { command: "help", description: "Show available commands" },
    ];

    await bot.telegram.setMyCommands(commands);
    console.log("✅ Bot commands menu set up successfully");
  } catch (error) {
    console.error("❌ Failed to set up bot commands menu:", error.message);
  }
};

// For Railway deployment - use webhooks instead of polling
if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT) {
  console.log("🚂 Railway environment detected, configuring webhooks...");

  // Construct webhook URL with better fallbacks
  let webhookUrl = process.env.WEBHOOK_URL;

  if (!webhookUrl) {
    const domain =
      process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_DOMAIN;
    if (domain) {
      webhookUrl = `https://${domain}/webhook`;
    } else {
      console.log(
        "⚠️  No webhook URL configured - webhook setup will be skipped"
      );
      console.log(
        "To enable webhooks, set one of these environment variables:"
      );
      console.log("  - WEBHOOK_URL (full URL)");
      console.log("  - RAILWAY_PUBLIC_DOMAIN (domain only)");
      console.log("  - RAILWAY_DOMAIN (domain only)");
    }
  }

  if (webhookUrl) {
    console.log(`🔗 Webhook URL: ${webhookUrl}`);

    // Validate webhook URL format
    try {
      const url = new URL(webhookUrl);
      if (!url.protocol.startsWith("https")) {
        console.error("❌ Webhook URL must use HTTPS in production");
        webhookUrl = null; // Disable webhook setup
      }
    } catch (error) {
      console.error("❌ Invalid webhook URL format:", webhookUrl);
      webhookUrl = null; // Disable webhook setup
    }

    // Retry webhook setup with exponential backoff
    const setupWebhook = async (retryCount = 0) => {
      const maxRetries = 3;
      const baseDelay = 5000; // 5 seconds

      try {
        console.log(
          `🔄 Setting webhook (attempt ${retryCount + 1}/${maxRetries + 1})...`
        );

        await bot.telegram.setWebhook(webhookUrl, {
          max_connections: 40,
          drop_pending_updates: true,
        });

        console.log(`✅ Webhook successfully set to: ${webhookUrl}`);
        console.log("🤖 Telegram bot configured for webhook mode");

        // Get webhook info to verify
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log("📊 Webhook info:", {
          url: webhookInfo.url,
          has_custom_certificate: webhookInfo.has_custom_certificate,
          pending_update_count: webhookInfo.pending_update_count,
          max_connections: webhookInfo.max_connections,
        });
      } catch (error) {
        console.error(
          `❌ Failed to set webhook (attempt ${retryCount + 1}):`,
          error.message
        );

        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
          console.log(`⏳ Retrying in ${delay}ms...`);
          setTimeout(() => setupWebhook(retryCount + 1), delay);
        } else {
          console.error("❌ Max retries reached. Webhook setup failed.");
          console.error(
            "💡 Bot will continue running but may not receive updates"
          );
          console.error(
            "Check your environment variables and redeploy if needed"
          );
        }
      }
    };

    // Start webhook setup after server is fully ready
    setTimeout(() => {
      setupWebhook();
      // Set up commands menu after webhook is configured
      setTimeout(setupBotCommands, 2000);
    }, 10000); // 10 second delay
  } else {
    console.log(
      "🤖 Running in webhook mode without Telegram webhook configured"
    );
    // Still set up commands menu even without webhook
    setTimeout(setupBotCommands, 5000);
  }
} else {
  // Use polling for local development
  console.log("🔄 Starting bot in polling mode for development");

  // Delete webhook before starting polling to avoid conflicts
  bot.telegram
    .deleteWebhook()
    .then(() => {
      console.log("✅ Webhook deleted, starting polling...");
      return bot.launch();
    })
    .then(() => {
      console.log("✅ Telegram bot launched in polling mode");
      // Set up commands menu after bot is launched
      setTimeout(setupBotCommands, 2000);
    })
    .catch((err) => {
      console.error("❌ Failed to launch bot:", err);
    });
}
