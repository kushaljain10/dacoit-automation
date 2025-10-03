const express = require("express");
const axios = require("axios");
const qs = require("qs");
const { Telegraf, Markup, session } = require("telegraf");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const fs = require("fs");
const path = require("path");
const { processTaskWithAI } = require("./ai");
const { SQLiteAuthStore } = require("./store");
const { bc } = require("./basecamp");
const { sendToSlack } = require("./slack-notifications");
const {
  setupWebhooksForAllProjects,
  listProjectWebhooks,
} = require("./basecamp-webhooks");
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
  PORT = process.env.PORT || 3000,
} = process.env;

const whitelist = new Set(
  String(WHITELIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const app = express();
app.use(express.json()); // Add JSON body parser middleware
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

// Catch-all handler for debugging
bot.use(async (ctx, next) => {
  console.log("🔍 Update received:", {
    update_type: Object.keys(ctx.update)[0],
    from: ctx.from,
    chat: ctx.chat,
  });
  await next();
});

// Initialize SQLite store
const store = new SQLiteAuthStore();
console.log(`Loaded ${store.size()} authentication(s) from persistent storage`);

/** ------------ Helpers ------------ **/
// Use shared Basecamp client

// Use shared AI processing

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
      result.slackUserId = matchedPerson.slack_user_id;

      console.log(
        `✅ AI matched assignee: ${matchedPerson.name} (${matchedPerson.email})`
      );

      // Now find the Basecamp user ID by email
      try {
        // Fetch Basecamp people only if not already provided
        if (!basecampPeople) {
          const { data } = await bc(access).get(
            `https://3.basecampapi.com/${accountId}/people.json`
          );
          basecampPeople = data;
          console.log(
            `Fetched ${basecampPeople.length} Basecamp people for matching`
          );
        }

        console.log(
          `Looking for Basecamp user with email: ${matchedPerson.email}`
        );
        console.log(
          `Available Basecamp emails:`,
          basecampPeople.map((bp) => bp.email_address)
        );

        const basecampPerson = basecampPeople.find(
          (bp) =>
            bp.email_address.toLowerCase() === matchedPerson.email.toLowerCase()
        );
        if (basecampPerson) {
          result.assigneeId = basecampPerson.id;
          console.log(
            `✅ Matched to Basecamp user ID: ${basecampPerson.id} (${basecampPerson.name})`
          );
        } else {
          console.log(
            `❌ No Basecamp user found with email: ${matchedPerson.email}`
          );
        }
      } catch (error) {
        console.error(
          "Error fetching Basecamp people for email match:",
          error.message
        );
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

  return result;
};

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

// Helper functions for batch task processing
const askBatchTaskInfo = async (ctx) => {
  const f = ctx.session.flow;
  const needingInfo =
    f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
  const task = needingInfo.task;

  // Store what we're asking for
  f.selections.currentBatchTaskQuestion = needingInfo.needsProject
    ? "project"
    : "dueDate";

  if (needingInfo.needsProject) {
    await ctx.reply(
      `📋 **Task ${needingInfo.index + 1}:** ${
        task.title
      }\n\nProject not found. Please select a project:`,
      { parse_mode: "Markdown" }
    );
    f.step = 6; // Batch project selection
    return askProject(ctx);
  } else if (needingInfo.needsDueDate) {
    await ctx.reply(
      `📋 **Task ${needingInfo.index + 1}:** ${
        task.title
      }\n\nDue date? (e.g. 2025-10-12 or "in 3 days", or type "skip" to skip)`,
      { parse_mode: "Markdown" }
    );
    f.step = 7; // Batch due date input
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
      const list = await chooseDefaultTodoList(ctx, processedTask.projectId);

      // Verify assignee is part of the project if assigneeId is provided
      if (processedTask.assigneeId) {
        try {
          const { access, accountId } = store.get(String(ctx.from.id));
          const { data: projectPeople } = await bc(access).get(
            `https://3.basecampapi.com/${accountId}/projects/${processedTask.projectId}/people.json`
          );
          
          console.log(`\n🔍 Verifying assignee ${processedTask.assigneeId} is in project ${processedTask.projectId}`);
          console.log(`Project people IDs:`, projectPeople.map(p => p.id));
          
          const isInProject = projectPeople.some(p => p.id === processedTask.assigneeId);
          
          if (!isInProject) {
            console.error(`\n⚠️ WARNING: Assignee ID ${processedTask.assigneeId} is NOT part of project ${processedTask.projectId}!`);
            console.error(`This task will be created WITHOUT an assignee.`);
            console.error(`Available people in project:`, projectPeople.map(p => `${p.name} (ID: ${p.id})`));
            // Set assigneeId to null so task gets created without assignee
            processedTask.assigneeId = null;
          } else {
            const assigneePerson = projectPeople.find(p => p.id === processedTask.assigneeId);
            console.log(`✅ Assignee verified: ${assigneePerson.name} (ID: ${assigneePerson.id}) is in the project`);
          }
        } catch (verifyError) {
          console.error(`Error verifying assignee in project:`, verifyError.message);
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
    console.log(`✅ Task successfully assigned to:`, data.assignees.map(a => `${a.name} (ID: ${a.id})`));
  }

  // Log the full response to see what fields are available
  console.log(`Full response data keys:`, Object.keys(data));

  return data; // includes id, app_url, etc.
};

/** ------------ Telegram bot handlers ------------ **/
bot.start(requireAuth, async (ctx) => {
  console.log("🚀 Start command received from:", ctx.from);
  ctx.session ??= {};
  await resetFlow(ctx);
  ctx.session.flow.step = 1;
  await askTaskDescription(ctx);
});

bot.command("stop", requireAuth, async (ctx) => {
  console.log("🛑 Stop command received from:", ctx.from);
  ctx.session ??= {};

  // Clean up any ongoing flow messages
  await resetFlow(ctx);

  await ctx.reply(
    "🛑 *Conversation stopped.*\n\n" +
      "Your current task creation has been cancelled and all data cleared.\n\n" +
      "Use /start to begin a new task creation process.",
    { parse_mode: "Markdown" }
  );
});

bot.command("help", requireAuth, async (ctx) => {
  console.log("❓ Help command received from:", ctx.from);

  await ctx.reply(
    "🤖 *Basecamp Task Bot Commands*\n\n" +
      "*/start* - Begin creating a new task\n" +
      "*/stop* - Cancel current conversation and reset\n" +
      "*/help* - Show this help message\n\n" +
      "_This bot helps you create tasks in Basecamp using AI-powered processing._",
    { parse_mode: "Markdown" }
  );
});

bot.on("text", requireAuth, async (ctx) => {
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
  ctx.session.flow ??= { step: 0, selections: {} };
  let f = ctx.session.flow;

  // Show welcome message if user hasn't started the flow
  if (!f.step) {
    await ctx.reply(
      "👋 *Welcome to Basecamp Task Bot!*\n\n" +
        "I help you create tasks in Basecamp using AI-powered processing.\n\n" +
        "🚀 *How to get started:*\n" +
        "• Use /start to begin creating a new task\n" +
        "• Use /stop to cancel and reset anytime\n" +
        "• Use /help to see all available commands\n\n" +
        "_Just send me a task description and I'll help you organize it!_",
      { parse_mode: "Markdown" }
    );

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
      // Fetch projects and people to provide context to AI
      const { access, accountId } = store.get(String(ctx.from.id));
      let context = { projects: [], people: [] };

      try {
        // Fetch projects
        const { data: projects } = await bc(access).get(
          `https://3.basecampapi.com/${accountId}/projects.json`
        );
        context.projects = projects.map((p) => ({ id: p.id, name: p.name }));

        // Use custom people list from environment variable only
        if (process.env.CUSTOM_PEOPLE_LIST) {
          try {
            const customPeople = JSON.parse(process.env.CUSTOM_PEOPLE_LIST);
            context.people = customPeople.map((p) => ({
              name: p.name,
              email: p.email,
              slack_user_id: p.slack_user_id,
            }));
            console.log(
              `Using custom people list from environment (${context.people.length} people)`
            );
          } catch (parseError) {
            console.error(
              "Error parsing CUSTOM_PEOPLE_LIST:",
              parseError.message
            );
            console.warn(
              "⚠️ CUSTOM_PEOPLE_LIST is invalid, AI will not have people context"
            );
            context.people = [];
          }
        } else {
          console.warn(
            "⚠️ CUSTOM_PEOPLE_LIST not set, AI will not have people context"
          );
          context.people = [];
        }

        console.log("Context for AI:", {
          projects_count: context.projects.length,
          people_count: context.people.length,
          using_custom_people: !!process.env.CUSTOM_PEOPLE_LIST,
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

        // Check if any tasks are missing project or due date
        const tasksNeedingInfo = processedTasks
          .map((task, index) => ({
            index,
            task,
            needsProject: !task.projectId,
            needsDueDate: !task.dueOn,
          }))
          .filter((t) => t.needsProject || t.needsDueDate);

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

  if (f.step === 7) {
    // Batch task due date input
    const needingInfo =
      f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
    const taskIndex = needingInfo.index;

    // Allow skipping due date
    if (text.toLowerCase() === "skip") {
      console.log(`Skipped due date for task ${taskIndex + 1}`);
    } else {
      const due = parseDue(text);
      if (!due) {
        return ctx.reply(
          "Could not parse that date. Try YYYY-MM-DD or DD-MM-YYYY, or type 'skip' to skip."
        );
      }
      // Update the task in batchTasks
      f.selections.batchTasks[taskIndex].dueOn = due;
      console.log(`Set due date for task ${taskIndex + 1}: ${due}`);
    }

    // Mark this question as answered
    needingInfo.needsDueDate = false;

    // Check if current task still needs info
    if (!needingInfo.needsProject && !needingInfo.needsDueDate) {
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

  // Check if we're in batch task mode (step 6)
  if (f.step === 6) {
    // Batch task project selection
    const needingInfo =
      f.selections.batchTasksNeedingInfo[f.selections.currentBatchTaskIndex];
    const taskIndex = needingInfo.index;

    // Update the task's project
    f.selections.batchTasks[taskIndex].projectId = projectId;
    console.log(`Set project for task ${taskIndex + 1}: ${projectId}`);

    // Mark project as provided
    needingInfo.needsProject = false;

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

  // pick a default list inside the project (first active list, create if none exists)
  try {
    const list = await chooseDefaultTodoList(ctx, projectId);
    f.selections.todoListId = list.id;

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

  f.step = 4;
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

  // Check if project is missing - if so, ask for it
  if (!ctx.session.flow.selections.projectId) {
    console.log("No project found, asking user to select");
    ctx.session.flow.step = 3;
    return askProject(ctx);
  }

  console.log("Using AI-extracted project, proceeding with task creation");

  // Get todo list for the project
  try {
    const list = await chooseDefaultTodoList(
      ctx,
      ctx.session.flow.selections.projectId
    );
    ctx.session.flow.selections.todoListId = list.id;

    // Check if AI already extracted assignee - if so, skip to due date check
    if (ctx.session.flow.selections.assigneeId) {
      console.log("Using AI-extracted assignee, skipping assignee selection");

      // Check if due date is missing - if so, ask for it
      if (!ctx.session.flow.selections.dueOn) {
        console.log("No due date found, asking user");
        ctx.session.flow.step = 5;
        return askDueDate(ctx);
      }

      // All info present, create task immediately
      console.log("Using AI-extracted due date, creating task immediately");
      const { projectId, todoListId, title, description, assigneeId, dueOn } =
        ctx.session.flow.selections;
      try {
        const todo = await createTodo(ctx, {
          projectId,
          todoListId,
          title,
          description,
          assigneeId,
          dueOn,
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
    } else {
      // Ask for assignee
      ctx.session.flow.step = 4;
      return askAssignee(ctx);
    }
  } catch (e) {
    console.error(e?.response?.data || e.message);
    return ctx.reply(
      "Could not find or create a to-do list in that project. Please check project permissions."
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

    store.set(String(state), {
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

    // Try to get project-specific channel from mapping
    if (process.env.BASECAMP_SLACK_MAPPINGS) {
      try {
        const mappings = JSON.parse(process.env.BASECAMP_SLACK_MAPPINGS);
        channelId = mappings[projectId];
        if (channelId) {
          console.log(
            `Using project-specific channel ${channelId} for project ${projectId}`
          );
        }
      } catch (error) {
        console.error("Error parsing BASECAMP_SLACK_MAPPINGS:", error.message);
      }
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

    // For todo_created events, fetch the full todo details to get all information
    let todoDetails = null;
    if (event.kind === "todo_created" && event.recording.url) {
      try {
        const users = store.getAllUsers();
        if (users.length > 0) {
          const auth = store.get(users[0]);
          if (auth) {
            const { data: fetchedTodo } = await bc(auth.access).get(
              event.recording.url
            );
            todoDetails = fetchedTodo;
            console.log("Fetched full todo details:", {
              title: todoDetails.title,
              content: todoDetails.content,
              description: todoDetails.description,
              assignees: todoDetails.assignees,
              due_on: todoDetails.due_on,
              all_keys: Object.keys(todoDetails),
            });
          }
        }
      } catch (error) {
        console.error("Error fetching full todo details:", error.message);
      }
    }

    // Enrich assignees with slack_user_id if custom people list is configured
    let enrichedAssignees = todoDetails?.assignees || [];
    if (process.env.CUSTOM_PEOPLE_LIST && enrichedAssignees.length > 0) {
      try {
        const customPeople = JSON.parse(process.env.CUSTOM_PEOPLE_LIST);
        enrichedAssignees = enrichedAssignees.map((assignee) => {
          const customPerson = customPeople.find(
            (cp) =>
              cp.email.toLowerCase() === assignee.email_address?.toLowerCase()
          );
          return {
            ...assignee,
            slack_user_id: customPerson?.slack_user_id || null,
          };
        });
        console.log(
          "Enriched assignees with Slack user IDs:",
          enrichedAssignees
        );
      } catch (error) {
        console.error(
          "Error enriching assignees with Slack IDs:",
          error.message
        );
      }
    }

    // Format the event data
    const data = {
      title: todoDetails?.title || event.recording.title,
      description:
        todoDetails?.description ||
        todoDetails?.content ||
        event.recording.content,
      project_name: event.recording.bucket.name,
      creator_name: event.creator.name,
      url: event.recording.app_url,
      due_date: todoDetails?.due_on || event.recording.due_on || null,
      completer_name: event.recording.completer?.name,
      assignees: enrichedAssignees,
      content: event.recording.content, // For comments
    };

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
      case "todo_completed":
      case "comment_created":
        await sendToSlack(channelId, event.kind, data);
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

      store.set(String(state), {
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
    sqlite_db: fs.existsSync(path.join(__dirname, "auth.db")),
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
    database_connected: store && store.db !== null,
  });
});

// Check authentication status
app.get("/debug/auth-status", (req, res) => {
  try {
    // Get all users and their auth data
    const users = store.getAllUsers();
    console.log("Found users:", users);

    const auths = users
      .map((userId) => {
        console.log("Checking auth for user:", userId);
        const auth = store.get(userId);
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
      .filter((auth) => auth); // Remove any null entries

    res.json({
      status: "ok",
      authenticated_users: users.length,
      valid_auths: auths.filter((a) => a.hasValidTokens).length,
      auth_details: auths,
      database_connected: store && store.db !== null,
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

    const auth = store.get(users[0]);
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
    const users = store.getAllUsers();
    if (!users.length) {
      return res.status(400).json({ error: "No authenticated users found" });
    }

    const auth = store.get(users[0]);
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
const setupSlackNotifications = () => {
  const defaultChannel = process.env.SLACK_DEFAULT_CHANNEL;
  const mappingsEnv = process.env.BASECAMP_SLACK_MAPPINGS;

  if (!defaultChannel && !mappingsEnv) {
    console.log("⚠️ No Slack channels configured");
    console.log("Set SLACK_DEFAULT_CHANNEL for a default channel");
    console.log("Set BASECAMP_SLACK_MAPPINGS for project-specific channels");
    return;
  }

  if (defaultChannel) {
    console.log(`✅ Default Slack channel: ${defaultChannel}`);
  }

  if (mappingsEnv) {
    try {
      const mappings = JSON.parse(mappingsEnv);
      const projectCount = Object.keys(mappings).length;
      console.log(
        `✅ Project-specific mappings configured for ${projectCount} project(s):`
      );
      Object.entries(mappings).forEach(([projectId, channelId]) => {
        console.log(`   Project ${projectId} → Channel ${channelId}`);
      });
    } catch (error) {
      console.log(
        `⚠️ Invalid BASECAMP_SLACK_MAPPINGS format: ${error.message}`
      );
      console.log(
        'Expected format: {"projectId1":"channelId1","projectId2":"channelId2"}'
      );
    }
  }
};

app.listen(PORT, () => {
  console.log(`🚀 Server started on port :${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `🚂 Railway: ${!!process.env.RAILWAY_ENVIRONMENT ? "YES" : "NO"}`
  );

  // Set up Slack notifications
  setupSlackNotifications();
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
  bot
    .launch()
    .then(() => {
      console.log("✅ Telegram bot launched in polling mode");
      // Set up commands menu after bot is launched
      setTimeout(setupBotCommands, 2000);
    })
    .catch((err) => {
      console.error("❌ Failed to launch bot:", err);
    });
}
