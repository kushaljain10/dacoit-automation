const express = require("express");
const axios = require("axios");
const qs = require("qs");
const { Telegraf, Markup, session } = require("telegraf");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
require("dotenv").config();
dayjs.extend(customParseFormat);

const {
  TELEGRAM_BOT_TOKEN,
  BASECAMP_CLIENT_ID,
  BASECAMP_CLIENT_SECRET,
  REDIRECT_URI,
  USER_AGENT,
  WHITELIST,
  OPENROUTER_API_KEY,
  OPENROUTER_API_URL,
  PORT = 3000,
} = process.env;

const whitelist = new Set(
  String(WHITELIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const app = express();
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.flow) ctx.session.flow = { step: 0, selections: {} };
  return next();
});

bot.catch((err, ctx) => {
  console.error("Bot error for update", ctx.update, err);
});

// SQLite-based authentication store for production safety
class SQLiteAuthStore {
  constructor() {
    this.dbFile = path.join(__dirname, "auth.db");
    this.db = null;
    this.initialize();
  }

  initialize() {
    try {
      this.db = new Database(this.dbFile);

      // Create table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_auth (
          user_id TEXT PRIMARY KEY,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          account_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index for faster lookups
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_user_auth_user_id
        ON user_auth(user_id)
      `);

      console.log("SQLite auth store initialized");
    } catch (error) {
      console.error("Error initializing SQLite store:", error.message);
      throw error;
    }
  }

  get(userId) {
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare("SELECT * FROM user_auth WHERE user_id = ?");
      const result = stmt.get(userId);

      if (result) {
        return {
          access: result.access_token,
          refresh: result.refresh_token,
          accountId: result.account_id,
        };
      }
      return null;
    } catch (error) {
      console.error("Error getting auth data:", error.message);
      return null;
    }
  }

  set(userId, authData) {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO user_auth (user_id, access_token, refresh_token, account_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(userId, authData.access, authData.refresh, authData.accountId);

      console.log(`Authentication data saved for user: ${userId}`);
    } catch (error) {
      console.error("Error saving auth data:", error.message);
    }
  }

  delete(userId) {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare("DELETE FROM user_auth WHERE user_id = ?");
      stmt.run(userId);
      console.log(`Authentication data deleted for user: ${userId}`);
    } catch (error) {
      console.error("Error deleting auth data:", error.message);
    }
  }

  getAllUsers() {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare("SELECT user_id FROM user_auth");
      return stmt.all().map((row) => row.user_id);
    } catch (error) {
      console.error("Error getting all users:", error.message);
      return [];
    }
  }

  size() {
    if (!this.db) return 0;

    try {
      const stmt = this.db.prepare("SELECT COUNT(*) as count FROM user_auth");
      const result = stmt.get();
      return result.count;
    } catch (error) {
      console.error("Error getting size:", error.message);
      return 0;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Initialize SQLite store
const store = new SQLiteAuthStore();
console.log(`Loaded ${store.size()} authentication(s) from persistent storage`);

/** ------------ Helpers ------------ **/
const bc = (access) => ({
  get: (url) =>
    axios.get(url, {
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    }),
  post: (url, data) =>
    axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
    }),
});

const processTaskWithAI = async (message, retryCount = 0) => {
  const prompt = `You are a task management assistant. Given a user message (which could be from a client or describing work to be done), extract and create:

1. A clear, actionable task title (max 80 characters)
2. A detailed description that includes all relevant information

The message could be:
- A client request 
- Work description
- Bug report
- Feature request
- General task description

IMPORTANT: Return ONLY a valid JSON object without any markdown formatting, code blocks, or backticks. No \`\`\`json or \`\`\` - just the raw JSON.

Example format:
{"title": "Clear task title here", "description": "Detailed description with all relevant context and requirements"}

User message: "${message.replace(/"/g, '\\"')}"`;

  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  try {
    const response = await axios.post(
      OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "deepseek/deepseek-chat-v3-0324",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Basecamp Task Processor",
        },
      }
    );

    let aiResponse = response.data.choices[0].message.content.trim();
    console.log("AI Raw Response:", aiResponse);

    // Clean up the response - remove markdown code blocks if present
    aiResponse = aiResponse
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    console.log("AI Cleaned Response:", aiResponse);

    // Parse the JSON response
    const parsedResponse = JSON.parse(aiResponse);

    // Validate the response has required fields
    if (!parsedResponse.title || !parsedResponse.description) {
      throw new Error("AI response missing required fields");
    }

    return {
      title: parsedResponse.title,
      description: parsedResponse.description,
    };
  } catch (error) {
    console.error(
      `Error processing task with AI (attempt ${retryCount + 1}):`,
      error.message
    );

    // Check if it's a rate limit error (429) and we haven't exceeded max retries
    if (error.response?.status === 429 && retryCount < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
      console.log(
        `Rate limited. Retrying in ${delay}ms... (attempt ${
          retryCount + 1
        }/${maxRetries})`
      );

      // Wait for the calculated delay
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Retry with incremented count
      return processTaskWithAI(message, retryCount + 1);
    }

    // If it's not a rate limit error or we've exceeded retries, fall back
    console.log("Falling back to simple text processing");
    return {
      title: message.length > 80 ? message.substring(0, 77) + "..." : message,
      description: message,
    };
  }
};

const requireAuth = async (ctx, next) => {
  const uid = String(ctx.from.id);
  if (!whitelist.has(uid)) {
    return ctx.reply("Sorry, you are not authorised to use this bot.");
  }
  const saved = store.get(uid);
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
    if (ctx.session.flow.assigneeMessages) {
      await cleanupMessages(ctx, ctx.session.flow.assigneeMessages);
    }
    if (ctx.session.flow.confirmationMessages) {
      await cleanupMessages(ctx, ctx.session.flow.confirmationMessages);
    }
  }

  ctx.session.flow = { step: 0, selections: {} };
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

const showTaskConfirmation = async (ctx, title, description) => {
  const confirmationText = `🤖 **AI Processed Task:**

**Title:** ${title}

**Description:** ${description}

Is this correct?`;

  const buttons = [
    [Markup.button.callback("✅ Confirm", "confirm_task")],
    [Markup.button.callback("🔄 Rewrite", "rewrite_task")],
  ];

  const message = await ctx.reply(confirmationText, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });

  // Track this message for cleanup
  if (!ctx.session.flow.confirmationMessages) {
    ctx.session.flow.confirmationMessages = [];
  }
  ctx.session.flow.confirmationMessages.push(message.message_id);

  return message;
};

const askProject = async (ctx, page = 0) => {
  const { access, accountId } = store.get(String(ctx.from.id));

  try {
    const { data: projects } = await bc(access).get(
      `https://3.basecampapi.com/${accountId}/projects.json`
    );

    console.log(
      `Available projects for account ${accountId}:`,
      projects.map((p) => ({ id: p.id, name: p.name, status: p.status }))
    );

    if (!projects.length) return ctx.reply("No projects found.");

    ctx.session.flow.projects = projects.map((p) => ({
      id: p.id,
      name: p.name,
    }));

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

    const message = await ctx.reply(
      `Choose a project${pageInfo}:`,
      Markup.inlineKeyboard(buttons)
    );

    // Track this message for cleanup later
    if (!ctx.session.flow.projectMessages) {
      ctx.session.flow.projectMessages = [];
    }
    ctx.session.flow.projectMessages.push(message.message_id);

    return message;
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

const askAssignee = async (ctx, page = 0) => {
  const { access, accountId } = store.get(String(ctx.from.id));
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
  ctx.reply('Due date? (e.g. 2025-10-12 or 12-10-2025 or "in 3 days")');

const parseDue = (text) => {
  // Accept several formats and normalise to YYYY-MM-DD (Basecamp uses due_on)
  const formats = [
    "YYYY-MM-DD",
    "DD-MM-YYYY",
    "D-M-YYYY",
    "DD/MM/YYYY",
    "D/M/YYYY",
  ];
  if (/in\s+(\d+)\s+day/i.test(text)) {
    const n = parseInt(RegExp.$1, 10);
    return dayjs().add(n, "day").format("YYYY-MM-DD");
  }
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
  const { access, accountId } = store.get(String(ctx.from.id));

  try {
    const payload = {
      name: name,
      description: "Default to-do list created automatically",
    };
    const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todosets/${todosetId}/todolists.json`;

    console.log(`Creating todolist with payload:`, payload);
    console.log(`POST URL: ${url}`);

    const { data } = await bc(access).post(url, JSON.stringify(payload));
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

const chooseDefaultTodoList = async (ctx, projectId) => {
  const { access, accountId } = store.get(String(ctx.from.id));

  try {
    console.log(
      `Fetching project and todoset for project ${projectId}, account ${accountId}`
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
    console.log(`Project dock:`, project.dock);

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

    console.log(`Using todoset:`, todoset);

    // 2) fetch lists inside that todoset
    const listsUrl = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todosets/${todoset.id}/todolists.json`;
    console.log(`Fetching lists from: ${listsUrl}`);

    const { data: lists } = await bc(access).get(listsUrl);
    console.log(`Found ${lists?.length || 0} existing lists:`, lists);

    // 3) if no lists exist, create a default one
    if (!lists || lists.length === 0) {
      console.log(
        `No todo lists found in project ${projectId}, creating default list...`
      );
      const newList = await createTodoList(ctx, projectId, todoset.id, "Tasks");
      console.log(`Created new list:`, newList);
      return newList;
    }

    // pick the first open list; fallback to any
    const open = lists.find((l) => l.status === "active") || lists[0];
    console.log(`Selected existing list:`, open);
    return open;
  } catch (error) {
    console.error(`Error in chooseDefaultTodoList:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      projectId,
      accountId,
    });
    throw error;
  }
};

const createTodo = async (
  ctx,
  { projectId, todoListId, title, description, assigneeId, dueOn }
) => {
  const { access, accountId } = store.get(String(ctx.from.id));
  const payload = {
    content: title,
    description: description || undefined,
    // Use assignee_ids as array of IDs (from Basecamp 3 API docs)
    assignee_ids: assigneeId ? [assigneeId] : [],
    due_on: dueOn || undefined, // YYYY-MM-DD
  };

  console.log(`Creating todo with payload:`, {
    content: payload.content,
    assignee_ids: payload.assignee_ids,
    due_on: payload.due_on,
  });

  const url = `https://3.basecampapi.com/${accountId}/buckets/${projectId}/todolists/${todoListId}/todos.json`;
  console.log(`POST URL: ${url}`);

  const response = await bc(access).post(url, JSON.stringify(payload));
  const { data } = response;

  console.log(`Full API response status:`, response.status);
  console.log(`Todo creation response:`, {
    id: data.id,
    content: data.content,
    assignee: data.assignee,
    assignees: data.assignees, // Check if it's plural
    due_on: data.due_on,
    status: data.status,
    app_url: data.app_url,
  });

  // Log the full response to see what fields are available
  console.log(`Full response data keys:`, Object.keys(data));

  return data; // includes id, app_url, etc.
};

/** ------------ Telegram bot handlers ------------ **/
bot.start(requireAuth, async (ctx) => {
  ctx.session ??= {};
  await resetFlow(ctx);
  ctx.session.flow.step = 1;
  await askTaskDescription(ctx);
});

bot.on("text", requireAuth, async (ctx) => {
  ctx.session ??= {};
  ctx.session.flow ??= { step: 0, selections: {} };
  let f = ctx.session.flow;

  if (!f.step) {
    await resetFlow(ctx);
    ctx.session.flow.step = 1;
    f = ctx.session.flow; // Update reference after reset
    await askTaskDescription(ctx);
    return;
  }

  const text = ctx.message.text?.trim();

  if (f.step === 1) {
    // Process the task description with AI
    f.selections.originalMessage = text;
    f.step = 2; // Move to confirmation step

    const processingMessage = await ctx.reply(
      "🤖 Processing your task with AI..."
    );

    try {
      const aiResult = await processTaskWithAI(text);
      f.selections.title = aiResult.title;
      f.selections.description = aiResult.description;

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

  if (f.step === 5) {
    // This is now the due date step (after AI processing, confirmation, project, assignee)
    const due = parseDue(text);
    if (!due)
      return ctx.reply(
        "Could not parse that date. Try YYYY-MM-DD or DD-MM-YYYY."
      );
    f.selections.dueOn = due;
    try {
      const { projectId, todoListId, title, description, assigneeId } =
        f.selections;
      const todo = await createTodo(ctx, {
        projectId,
        todoListId,
        title,
        description,
        assigneeId,
        dueOn: due,
      });
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
});

// Project chosen
bot.action(/^proj_(\d+)$/, requireAuth, async (ctx) => {
  await ctx.answerCbQuery();
  const projectId = Number(ctx.match[1]);
  ctx.session.flow.selections.projectId = projectId;

  // Clean up all project selection messages
  if (ctx.session.flow.projectMessages) {
    await cleanupMessages(ctx, ctx.session.flow.projectMessages);
    ctx.session.flow.projectMessages = [];
  }

  // pick a default list inside the project (first active list, create if none exists)
  try {
    const list = await chooseDefaultTodoList(ctx, projectId);
    ctx.session.flow.selections.todoListId = list.id;

    // Inform user if we created a new list
    if (
      list.name === "Tasks" &&
      list.description === "Default to-do list created automatically"
    ) {
      await ctx.reply(
        `✅ Project selected! Created new to-do list "${list.name}" in this project.`
      );
    }
  } catch (e) {
    console.error(e?.response?.data || e.message);
    return ctx.reply(
      "Could not find or create a to-do list in that project. Please check project permissions."
    );
  }

  ctx.session.flow.step = 4;
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
    ctx.session.flow.step = 5;
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
    ctx.session.flow.step = 5;
    return askDueDate(ctx);
  }
});

// Task confirmation actions
bot.action("confirm_task", requireAuth, async (ctx) => {
  await ctx.answerCbQuery();

  // Clean up confirmation messages
  if (ctx.session.flow.confirmationMessages) {
    await cleanupMessages(ctx, ctx.session.flow.confirmationMessages);
    ctx.session.flow.confirmationMessages = [];
  }

  ctx.session.flow.step = 3;
  return askProject(ctx);
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
app.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state } = req.query; // state carries telegram user id
    const body = qs.stringify({
      client_id: BASECAMP_CLIENT_ID,
      client_secret: BASECAMP_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
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

    store.set(String(state), {
      access: token.access_token,
      refresh: token.refresh_token,
      accountId,
    });
    saveStore(store); // Persist the authentication data
    res.send("Connected. You can return to Telegram.");
  } catch (e) {
    console.error(e?.response?.data || e.message);
    res.status(500).send("OAuth failed.");
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

app.listen(PORT, () => console.log(`OAuth server on :${PORT}`));

// For Railway deployment - use webhooks instead of polling
if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT) {
  // Use webhooks for production (Railway)
  const webhookUrl =
    process.env.WEBHOOK_URL ||
    `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`;

  app.use(bot.webhookCallback("/webhook"));

  bot.telegram
    .setWebhook(webhookUrl)
    .then(() => {
      console.log(`Webhook set to: ${webhookUrl}`);
    })
    .catch((err) => {
      console.error("Failed to set webhook:", err);
    });

  console.log("Telegram bot configured for webhook mode");
} else {
  // Use polling for local development
  bot
    .launch()
    .then(() => console.log("Telegram bot launched in polling mode."));
}
