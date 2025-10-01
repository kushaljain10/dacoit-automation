const axios = require("axios");

const OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL ||
  "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Shared AI processing function
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

module.exports = { processTaskWithAI };
