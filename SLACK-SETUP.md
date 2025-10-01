# Setting Up the Slack Bot

This guide will help you set up the Slack bot for the Basecamp Task Bot.

## 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app (e.g., "Basecamp Task Bot") and select your workspace

## 2. Configure App Settings

### Basic Information

1. Under "Basic Information", note down:
   - Client ID
   - Client Secret
   - Signing Secret

### OAuth & Permissions

1. Go to "OAuth & Permissions"
2. Add the following Bot Token Scopes:
   ```
   commands             - Add slash commands
   chat:write          - Send messages
   im:write            - Send direct messages
   im:history          - View DM history
   users:read          - View basic user info
   ```
3. Set up Redirect URLs:
   - Add: `https://your-app-domain.com/oauth/callback/slack`
   - Click "Save URLs"

### Slash Commands

1. Go to "Slash Commands"
2. Create the following commands:
   - `/task` - Create a new Basecamp task
   - `/task-help` - Show help and usage information

### App Home

1. Go to "App Home"
2. Enable "Messages Tab"
3. Check "Allow users to send Slash commands and messages from the messages tab"

### Interactivity & Shortcuts

1. Go to "Interactivity & Shortcuts"
2. Enable "Interactivity"
3. Set Request URL: `https://your-app-domain.com/slack/events`

## 3. Install App to Workspace

1. Go to "Install App"
2. Click "Install to Workspace"
3. Review permissions and click "Allow"

## 4. Environment Variables

Add these to your `.env` file:

```env
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# For OAuth
APP_URL=https://your-app-domain.com
```

## 5. Deploy Your App

1. Deploy your app to your hosting platform (e.g., Railway)
2. Update the OAuth Redirect URLs in Slack with your actual domain
3. Update the Interactivity Request URL with your actual domain

## 6. Testing the Bot

1. In Slack, type `/task` to start creating a task
2. The bot will guide you through:
   - Task description (processed by AI)
   - Project selection
   - Assignee selection
   - Due date

## 7. Troubleshooting

### Common Issues

1. **"Slack app isn't responding"**

   - Check if your server is running
   - Verify environment variables
   - Check server logs for errors

2. **OAuth Issues**

   - Verify redirect URLs match exactly
   - Check environment variables
   - Ensure proper scopes are configured

3. **Interactivity Not Working**
   - Verify request URL is correct and accessible
   - Check server logs for payload verification errors

### Debug Endpoints

The following endpoints are available for debugging:

- `GET /health` - Check server status
- `GET /debug/slack` - View Slack app configuration
- `POST /debug/reset-slack` - Reset Slack app state

## 8. Security Notes

1. Keep your tokens secure
2. Don't commit `.env` file
3. Use HTTPS for all URLs
4. Regularly rotate tokens
5. Monitor app usage

## 9. Maintenance

1. Regularly check Slack's API changelog for updates
2. Monitor your app's logs
3. Keep dependencies updated
4. Back up your SQLite database regularly

## 10. Support

For issues or questions:

1. Check server logs
2. Review Slack's API documentation
3. Contact support team
