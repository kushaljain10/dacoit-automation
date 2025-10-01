const axios = require("axios");

// Create Basecamp API client with auth token
const bc = (token) => {
  return axios.create({
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Basecamp Task Bot (your@email.com)",
    },
  });
};

module.exports = { bc };
