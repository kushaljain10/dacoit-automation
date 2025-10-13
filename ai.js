import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL ||
  "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Shared AI processing function with context extraction
const processTaskWithAI = async (message, context = null, retryCount = 0) => {
  let prompt = `You are a task management assistant. Analyze the user message to determine if it contains:
- Single task: One task to be created
- Multiple tasks: Multiple tasks, possibly with different assignees and projects

For SINGLE TASK, extract:
1. A clear, actionable task title (max 80 characters)
2. A detailed description
3. Project name if mentioned (match against available projects)
4. Assignee names if mentioned (match against available people)
5. Due date if mentioned (can be "today", "tomorrow", specific date, or "in X days")

For MULTIPLE TASKS, the format will typically be:
"Assignee Name - Task 1 for Project A. Task 2 for Project B.
Another Assignee - Task 3 for Project C. Task 4 for Project D."

IMPORTANT: Each line starting with a name followed by a dash (-) indicates the assignee for ALL tasks in that line until the next assignee line.

Extract each task separately with its corresponding assignee and project.

IMPORTANT: Return ONLY a valid JSON object without any markdown formatting, code blocks, or backticks.`;

  // Add context if available
  if (context) {
    if (context.projects && context.projects.length > 0) {
      prompt += `\n\nAvailable projects to match against:\n${context.projects
        .map((p) => `- ${p.name} (ID: ${p.id})`)
        .join("\n")}`;
    }

    if (context.people && context.people.length > 0) {
      prompt += `\n\nAvailable people to match against:\n${context.people
        .map((p) => `- ${p.name} (${p.email})`)
        .join("\n")}`;
    }
  }

  prompt += `\n\nReturn format for SINGLE task:
{
  "is_multiple": false,
  "title": "Task title",
  "description": "Task description",
  "project_name": "Project name or null",
  "assignee_names": ["Person name"] or [],
  "due_date": "Date (can be 'today', 'tomorrow', 'YYYY-MM-DD', or 'in X days') or null"
}

Return format for MULTIPLE tasks:
{
  "is_multiple": true,
  "tasks": [
    {
      "title": "Task 1 title",
      "description": "Task 1 description",
      "project_name": "Project name or null",
      "assignee_names": ["Person name"],
      "due_date": "Date (can be 'today', 'tomorrow', 'YYYY-MM-DD', or 'in X days') or null"
    },
    {
      "title": "Task 2 title",
      "description": "Task 2 description",
      "project_name": "Project name or null",
      "assignee_names": ["Person name"],
      "due_date": "Date (can be 'today', 'tomorrow', 'YYYY-MM-DD', or 'in X days') or null"
    }
  ]
}

Example input:
"John Doe - Create homepage for Acme. Design logo for Beta.
Jane Smith - Review code for Gamma. Test features for Delta."

Example output:
{
  "is_multiple": true,
  "tasks": [
    {
      "title": "Create homepage",
      "description": "Create homepage for Acme project",
      "project_name": "Acme",
      "assignee_names": ["John Doe"],
      "due_date": null
    },
    {
      "title": "Design logo",
      "description": "Design logo for Beta project",
      "project_name": "Beta",
      "assignee_names": ["John Doe"],
      "due_date": null
    },
    {
      "title": "Review code",
      "description": "Review code for Gamma project",
      "project_name": "Gamma",
      "assignee_names": ["Jane Smith"],
      "due_date": null
    },
    {
      "title": "Test features",
      "description": "Test features for Delta project",
      "project_name": "Delta",
      "assignee_names": ["Jane Smith"],
      "due_date": null
    }
  ]
}

User message: "${message.replace(/"/g, '\\"')}"`;

  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  // Log what we're sending to AI
  console.log("=== AI Request ===");
  console.log("User message:", message);
  console.log("Context provided:", {
    projects_count: context?.projects?.length || 0,
    people_count: context?.people?.length || 0,
  });
  console.log("Full prompt:", prompt);
  console.log("==================");

  try {
    const response = await axios.post(
      OPENROUTER_API_URL,
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

    // Check if it's multiple tasks
    if (parsedResponse.is_multiple && parsedResponse.tasks) {
      // Validate each task has required fields
      const validTasks = parsedResponse.tasks.filter(
        (task) => task.title && task.description
      );
      if (validTasks.length === 0) {
        throw new Error("AI response has no valid tasks");
      }

      return {
        is_multiple: true,
        tasks: validTasks.map((task) => ({
          title: task.title,
          description: task.description,
          project_name: task.project_name || null,
          assignee_names: task.assignee_names || [],
          due_date: task.due_date || null,
        })),
      };
    }

    // Single task - validate required fields
    if (!parsedResponse.title || !parsedResponse.description) {
      throw new Error("AI response missing required fields");
    }

    return {
      is_multiple: false,
      title: parsedResponse.title,
      description: parsedResponse.description,
      project_name: parsedResponse.project_name || null,
      assignee_names: parsedResponse.assignee_names || [],
      due_date: parsedResponse.due_date || null,
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
      return processTaskWithAI(message, context, retryCount + 1);
    }

    // If it's not a rate limit error or we've exceeded retries, fall back
    console.log("Falling back to simple text processing");
    console.error(
      `AI Error: ${error.response?.status} ${
        error.response?.statusText || error.message
      }`
    );
    if (error.response?.status === 401) {
      console.error("⚠️ OpenRouter API authentication failed!");
      console.error("   Check your OPENROUTER_API_KEY in .env file");
      console.error("   Make sure it starts with 'sk-or-v1-' and is valid");
    }

    // Try basic parsing of "Name - task description" format
    let assigneeNames = [];
    const nameMatch = message.match(
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*-\s*/i
    );
    if (nameMatch) {
      assigneeNames = [nameMatch[1].trim()];
      console.log(
        `Fallback: Detected potential assignee name: "${assigneeNames[0]}"`
      );
    }

    return {
      is_multiple: false,
      title: message.length > 80 ? message.substring(0, 77) + "..." : message,
      description: message,
      project_name: null,
      assignee_names: assigneeNames,
      due_date: null,
    };
  }
};

export { processTaskWithAI };
