# Airtable Setup Guide

This bot now uses Airtable instead of environment variables to manage:

- People data (names, emails, Slack IDs, Basecamp IDs)
- Project-to-Slack channel mappings

## 🚀 Setup Steps

### 1. Create Airtable Base

1. Go to [Airtable](https://airtable.com) and create a new base
2. Name it something like "Basecamp Bot Data"

### 2. Create Auth Table (for Basecamp credentials)

Create a table named `auth` with these columns:

| Column Name       | Type             | Description                  | Example       |
| ----------------- | ---------------- | ---------------------------- | ------------- |
| **user_id**       | Single line text | Telegram/Slack user ID       | `123456789`   |
| **access_token**  | Long text        | Encrypted Basecamp token     | `U2FsdGVk...` |
| **refresh_token** | Long text        | Encrypted refresh token      | `U2FsdGVk...` |
| **account_id**    | Number           | Basecamp account ID          | `5819631`     |
| **platform**      | Single line text | Platform (telegram or slack) | `telegram`    |
| **updated_at**    | Date             | Last updated timestamp       | `2025-10-04`  |

**Security Note:** Tokens are automatically encrypted before storage using AES-256 encryption.

### 3. Create people Table

Create a table named `people` with these columns:

| Column Name     | Type             | Description         | Example               |
| --------------- | ---------------- | ------------------- | --------------------- |
| **name**        | Single line text | Person's full name  | `Karan Ruparel`       |
| **email**       | Email            | Their email address | `karan@dacoit.design` |
| **slack_id**    | Single line text | Slack member ID     | `U12345ABCDE`         |
| **basecamp_id** | Number           | Basecamp user ID    | `12345678`            |

#### How to Get These IDs:

**Slack User ID:**

- In Slack, click on a person's profile
- Click "More" → "Copy member ID"

**Basecamp ID:**

- Visit: `http://localhost:3000/debug/basecamp-users`
- Find the user and copy their `id`

### 4. Create task_messages Table (for Slack threading)

Create a table named `task_messages` with these columns:

| Column Name          | Type             | Description                 | Example             |
| -------------------- | ---------------- | --------------------------- | ------------------- |
| **basecamp_task_id** | Number           | Basecamp todo ID            | `12345678`          |
| **slack_message_ts** | Single line text | Slack message timestamp     | `1234567890.123456` |
| **slack_channel_id** | Single line text | Slack channel ID            | `C12345ABCDE`       |
| **project_id**       | Number           | Basecamp project ID         | `44141016`          |
| **task_title**       | Single line text | Task title (for reference)  | `Fix bug`           |
| **created_at**       | Date             | When the record was created | `2025-10-04`        |

**Purpose:** This table stores the mapping between Basecamp tasks and their corresponding Slack messages. When a task is completed or commented on, the bot will reply to the original Slack thread instead of creating a new message.

### 5. Create projects Table

Create a table named `projects` with these columns:

| Column Name     | Type                        | Description         | Example              |
| --------------- | --------------------------- | ------------------- | -------------------- |
| **basecamp_id** | Number                      | Basecamp project ID | `44141016`           |
| **slack_id**    | Single line text            | Slack channel ID    | `C12345ABCDE`        |
| **name**        | Single line text (optional) | For reference only  | `Automation Testing` |

#### How to Get These IDs:

**Basecamp Project ID:**

- Visit: `http://localhost:3000/debug/projects`
- Find your project and copy the `id`

**Slack Channel ID:**

- In Slack, right-click on a channel → View channel details
- Scroll down and copy the Channel ID

### 6. Get Airtable Credentials

**Personal Access Token:**

1. Go to [Airtable Developer Hub](https://airtable.com/create/tokens)
2. Click "Create new token"
3. Give it a name (e.g., "Basecamp Bot")
4. Add these scopes:
   - `data.records:read` (to read your data)
   - `data.records:write` (to store auth tokens)
5. Add access to your base (select the base you created)
6. Click "Create token"
7. Copy the token (starts with `pat...`) - **you won't see it again!**

**Base ID:**

1. Go to [Airtable API docs](https://airtable.com/api)
2. Click on your base
3. You'll see the Base ID in the introduction (starts with `app...`)

### 7. Generate Encryption Key

For security, generate a strong encryption key to protect Basecamp tokens:

```bash
# On Mac/Linux, generate a random 32-character key:
openssl rand -base64 32

# Or use Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output - you'll need it for the next step.

### 8. Update Environment Variables

Add these to your `.env` file:

```bash
# Airtable Configuration
AIRTABLE_PERSONAL_ACCESS_TOKEN=patXXXXXXXXXXXXXX.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX

# Encryption key for securing tokens (REQUIRED for security!)
ENCRYPTION_KEY=your_generated_32_char_key_here

# Optional: Customize table names (defaults shown)
AIRTABLE_AUTH_TABLE=auth
AIRTABLE_PEOPLE_TABLE=people
AIRTABLE_PROJECTS_TABLE=projects
AIRTABLE_TASK_MESSAGES_TABLE=task_messages
```

**⚠️ Important:** Keep your `ENCRYPTION_KEY` secret and never commit it to git!

### 9. Remove Old Environment Variables

You can now remove these from your `.env` (they're no longer used):

- ~~`CUSTOM_PEOPLE_LIST`~~
- ~~`BASECAMP_SLACK_MAPPINGS`~~

### 10. First Time Setup

All users will need to authenticate with Basecamp when you first start using Airtable authentication. The bot will guide them through the OAuth flow, and credentials will be securely stored in Airtable with encryption.

### 11. Restart Your Server

```bash
npm start
```

You should see:

```
✅ Using Airtable for authentication storage
Loaded X authentication(s) from Airtable
```

## ✅ Verify Setup

### Check People Data:

```
http://localhost:3000/debug/people-matching
```

This will show:

- ✅ Which Airtable entries match Basecamp users
- ❌ Any mismatches or missing data
- 💡 ID verification (if basecamp_id is correct)

### Check Project Mappings:

Watch the server logs on startup:

```
✅ Project-specific mappings loaded from Airtable (3 project(s)):
   Project 44141016 → Channel C12345ABCDE
   ...
```

## 🎯 Benefits

### Data Management:

✅ **No more JSON in environment variables!**  
✅ **Easy to update** - just edit Airtable, no deployment needed  
✅ **Cached for performance** - fast and efficient (1-5 minute cache)  
✅ **Automatic cache refresh** - always up to date  
✅ **Fallback to cache** - works even if Airtable is temporarily down

### Security:

✅ **Encrypted tokens** - OAuth tokens encrypted with AES-256  
✅ **Centralized auth** - All Basecamp credentials in one secure place  
✅ **Airtable security** - Benefit from Airtable's enterprise-grade security  
✅ **Token scoping** - Personal Access Tokens with granular permissions  
✅ **No local database** - No `auth.db` file to worry about

### Slack Threading:

✅ **Organized conversations** - Task updates appear in threads  
✅ **Context preservation** - All updates for a task stay together  
✅ **Less noise** - Completions and comments don't clutter the channel  
✅ **Reply broadcast** - Thread updates also appear in main channel

## 🔄 Cache Management

The bot caches Airtable data for **5 minutes** to avoid hitting API limits.

To force a refresh:

- Just wait 5 minutes, or
- Visit `/debug/people-matching?force=true` to force reload

## 📝 Example Airtable Setup

### People Table:

```
| Name           | Email                 | Slack User ID | Basecamp ID |
|----------------|----------------------|---------------|-------------|
| Karan Ruparel  | karan@dacoit.design  | U12345678     | 87654321    |
| Shreya Vembar  | shreya@dacoit.design | U87654321     | 12345678    |
```

### Projects Table:

```
| Basecamp Project ID | Slack Channel ID | Project Name         |
|--------------------|------------------|----------------------|
| 44141016           | C12345ABCDE      | Automation Testing   |
| 44141017           | C67890FGHIJ      | Website Redesign     |
```

## 🐛 Troubleshooting

**"Error fetching people from Airtable"**

- Check your `AIRTABLE_PERSONAL_ACCESS_TOKEN` is correct (starts with `pat...`)
- Check your `AIRTABLE_BASE_ID` is correct (starts with `app...`)
- Check the token has the correct scopes (`data.records:read`)
- Check the token has access to your base
- Check table names match (case-sensitive!)

**"Person not getting assigned"**

- Check the email in Airtable matches Basecamp exactly
- Add the `Basecamp ID` to avoid email matching
- Visit `/debug/people-matching` to see mismatches

**"Slack notification not sent"**

- Check you have the project mapped in Airtable
- Check the Slack Channel ID is correct
- Set `SLACK_DEFAULT_CHANNEL` as fallback

**"User authentication not working"**

- Check you have the `auth` table created in Airtable
- Check the Airtable token has `data.records:write` scope
- Check `ENCRYPTION_KEY` is set (32+ characters recommended)
- Ask user to re-authenticate by typing `/start` in the bot

## 🎉 You're Done!

Your bot now uses Airtable for all configuration. No more editing environment variables! 🚀
