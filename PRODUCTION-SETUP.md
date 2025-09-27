# Production Deployment Guide

This guide explains how to deploy your Basecamp Telegram bot to production environments like Railway, handling authentication storage properly.

## 🚀 Quick Production Setup (Single User)

### Step 1: Set Environment Variables

In your Railway dashboard, add these environment variables:

```bash
# Required - Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
BASECAMP_CLIENT_ID=your_basecamp_client_id
BASECAMP_CLIENT_SECRET=your_basecamp_client_secret
REDIRECT_URI=https://your-railway-domain.railway.app/oauth/callback
USER_AGENT=YourBotName (your_email@domain.com)
WHITELIST=your_telegram_user_id

# Required - AI Processing
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_API_URL=https://openrouter.ai/api/v1/chat/completions

# Required - Production Mode
NODE_ENV=production
RAILWAY_ENVIRONMENT=true

# Required - Webhook Configuration
WEBHOOK_URL=https://your-railway-domain.railway.app/webhook
# OR use this if Railway provides PUBLIC_DOMAIN
# WEBHOOK_URL will auto-generate from RAILWAY_PUBLIC_DOMAIN

# Optional - Persistent Authentication (Single User)
BASECAMP_SAVED_AUTH={"userId":"your_telegram_id","access":"token","refresh":"token","accountId":"id"}
```

### Step 2: Update Basecamp OAuth App

1. Go to https://launchpad.37signals.com
2. Find your OAuth application
3. Update the **Redirect URI** to: `https://your-railway-domain.railway.app/oauth/callback`

### Step 3: First-Time Authentication

1. Deploy to Railway
2. Send `/start` to your bot on Telegram
3. Complete the Basecamp authentication flow
4. Check your Railway logs for a message like:

```
🔐 IMPORTANT: Save this authentication data as BASECAMP_SAVED_AUTH environment variable:
BASECAMP_SAVED_AUTH={"userId":"123456","access":"...","refresh":"...","accountId":"..."}
```

5. Copy this entire JSON string and set it as the `BASECAMP_SAVED_AUTH` environment variable in Railway
6. Redeploy your app

## 🗄️ Multi-User Production Setup (Database)

For supporting multiple users, you'll need a database:

### Option 1: Railway PostgreSQL

1. Add PostgreSQL to your Railway project
2. Run the SQL commands from `database-setup.sql`
3. Add database connection environment variables:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
# Railway provides this automatically
```

### Option 2: External Database

Set up your preferred database and add connection details.

## 🔧 Environment Variables Reference

| Variable                 | Required | Description                    | Example                                  |
| ------------------------ | -------- | ------------------------------ | ---------------------------------------- |
| `TELEGRAM_BOT_TOKEN`     | ✅       | Your Telegram bot token        | `123456:ABC-DEF...`                      |
| `BASECAMP_CLIENT_ID`     | ✅       | Basecamp OAuth client ID       | `abc123...`                              |
| `BASECAMP_CLIENT_SECRET` | ✅       | Basecamp OAuth client secret   | `def456...`                              |
| `REDIRECT_URI`           | ✅       | OAuth callback URL             | `https://app.railway.app/oauth/callback` |
| `USER_AGENT`             | ✅       | Bot identification             | `MyBot (me@example.com)`                 |
| `WHITELIST`              | ✅       | Authorized Telegram user IDs   | `123456789,987654321`                    |
| `OPENROUTER_API_KEY`     | ✅       | OpenRouter API key             | `sk-or-...`                              |
| `NODE_ENV`               | ✅       | Environment mode               | `production`                             |
| `WEBHOOK_URL`            | ✅       | Telegram webhook URL           | `https://app.railway.app/webhook`        |
| `BASECAMP_SAVED_AUTH`    | 🔵       | Single-user auth persistence   | `{"userId":"..."}`                       |
| `DATABASE_URL`           | 🔵       | Multi-user database connection | `postgresql://...`                       |

Legend: ✅ Required, 🔵 Optional

## 🔍 Troubleshooting

### Bot Not Responding

1. Check Railway logs for errors
2. Verify webhook is set correctly
3. Ensure `TELEGRAM_BOT_TOKEN` is correct

### Authentication Issues

1. Verify `REDIRECT_URI` matches Basecamp app settings
2. Check `BASECAMP_CLIENT_ID` and `BASECAMP_CLIENT_SECRET`
3. Ensure user is in `WHITELIST`

### 409 Conflict Errors

1. Only one bot instance should be running
2. Clear webhooks with the reset script: `node reset-bot.js`
3. Redeploy to Railway

### Authentication Not Persisting

1. Check if `BASECAMP_SAVED_AUTH` is set correctly
2. Verify the JSON format is valid
3. Ensure Railway environment variables are saved

## 🏗️ Development vs Production

| Feature         | Development              | Production                        |
| --------------- | ------------------------ | --------------------------------- |
| **Storage**     | `auth_store.json` file   | Environment variables or database |
| **Bot Mode**    | Polling                  | Webhooks                          |
| **Restarts**    | Auto-reload with nodemon | Manual redeploy                   |
| **Environment** | `NODE_ENV=development`   | `NODE_ENV=production`             |

## 📊 Monitoring

Monitor these in your Railway logs:

- Authentication loading/saving messages
- Webhook setup confirmations
- API call success/failures
- User interaction flows

## 🔐 Security Notes

1. **Never commit** `.env` files or `auth_store.json`
2. **Rotate tokens** periodically
3. **Limit whitelist** to trusted users only
4. **Use HTTPS** for all OAuth callbacks
5. **Monitor logs** for suspicious activity

## 📈 Scaling Considerations

### Single User (Current Setup)

- ✅ Simple environment variable storage
- ✅ No database required
- ❌ Limited to one user

### Multi-User (Database Setup)

- ✅ Supports unlimited users
- ✅ Proper data persistence
- ✅ Scalable architecture
- ❌ Requires database setup

Choose based on your needs!
