import axios from "axios";

// Create Basecamp API client with auth token
const bc = (token) => {
  return axios.create({
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        process.env.USER_AGENT || "Basecamp Task Bot (Notifications)",
    },
  });
};

export { bc };
