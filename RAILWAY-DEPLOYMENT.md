# 🚂 Railway Deployment Guide

This guide helps you deploy your Basecamp automation bot to Railway with proper webhook configuration.

## ✅ Pre-deployment Checklist

- [ ] Bot is working locally with `npm run dev`
- [ ] All environment variables are configured
- [ ] Bot webhook has been reset: `node reset-bot.js`
- [ ] Railway CLI is installed: `npm i -g @railway/cli`

## 🔧 Railway Environment Variables

Set these in your Railway dashboard:

```bash
NODE_ENV=production
RAILWAY_ENVIRONMENT=true

# Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Basecamp OAuth
BASECAMP_CLIENT_ID=your_basecamp_client_id
BASECAMP_CLIENT_SECRET=your_basecamp_client_secret
REDIRECT_URI=https://your-app.railway.app/oauth/callback

# Webhook Configuration
WEBHOOK_URL=https://your-app.railway.app/webhook
RAILWAY_PUBLIC_DOMAIN=your-app.railway.app

# AI Configuration
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_API_URL=https://openrouter.ai/api/v1/chat/completions

# Access Control
WHITELIST=your_telegram_user_id

# User Agent (required by Basecamp)
USER_AGENT=YourAppName (your_email@domain.com)

# Port (Railway sets this automatically)
PORT=3000
```

## 🚀 Deployment Steps

### 1. Deploy to Railway

```bash
# Login to Railway
railway login

# Link to your project
railway link

# Deploy
railway up
```

### 2. Verify Deployment

After deployment, check these endpoints:

```bash
# Basic test (should return "Bot server is running!")
curl https://your-app.railway.app/test

# Health check
curl https://your-app.railway.app/health

# Webhook info
curl https://your-app.railway.app/debug/webhook

# Manual webhook reset (if needed)
curl -X POST https://your-app.railway.app/debug/reset-webhook
```

### 3. Monitor Logs

```bash
# View Railway logs
railway logs

# Follow logs in real-time
railway logs --follow
```

## 🔍 Troubleshooting

### Webhook Setup Issues

**Problem**: `Failed to set webhook: ETIMEDOUT`

**Solutions**:

1. **Check Domain**: Ensure `RAILWAY_PUBLIC_DOMAIN` is set correctly
2. **Wait for Deployment**: Railway might take a few minutes to fully deploy
3. **Check Logs**: Look for webhook setup attempts in Railway logs
4. **Manual Setup**: Use the debug endpoints to manually set webhook

### Common Issues

| Issue          | Solution                                             |
| -------------- | ---------------------------------------------------- |
| `ETIMEDOUT`    | Wait for full deployment, check domain configuration |
| `409 Conflict` | Reset webhook: `node reset-bot.js` then redeploy     |
| `Invalid URL`  | Check `RAILWAY_PUBLIC_DOMAIN` environment variable   |
| `OAuth Failed` | Verify `REDIRECT_URI` matches your Railway domain    |

### Debug Commands

```bash
# Reset webhook locally
node reset-bot.js

# Set webhook manually
node reset-bot.js setup https://your-app.railway.app/webhook

# Check Railway environment
railway run env

# View Railway variables
railway variables
```

## 🔒 Security Notes

- Never commit `.env` files to version control
- Use Railway's environment variable management
- The SQLite database (`auth.db`) persists across deployments
- Webhook URLs must use `https://` in production

## 📞 Support

If you encounter issues:

1. Check Railway logs: `railway logs --follow`
2. Verify environment variables are set correctly
3. Use debug endpoints to inspect webhook status
4. Reset bot webhook: `node reset-bot.js`
5. Redeploy if needed: `railway up --detach`

The bot will automatically retry webhook setup with exponential backoff during deployment.
