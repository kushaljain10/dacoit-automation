# Airtable Setup Guide

This bot now uses Airtable instead of environment variables to manage:

- People data (names, emails, Slack IDs, Basecamp IDs)
- Project-to-Slack channel mappings

## 🚀 Setup Steps

### 1. Create Airtable Base

1. Go to [Airtable](https://airtable.com) and create a new base
2. Name it something like "Basecamp Bot Data"

### 2. Create People Table

Create a table named `People` with these columns:

| Column Name       | Type             | Description         | Example               |
| ----------------- | ---------------- | ------------------- | --------------------- |
| **Name**          | Single line text | Person's full name  | `Karan Ruparel`       |
| **Email**         | Email            | Their email address | `karan@dacoit.design` |
| **Slack User ID** | Single line text | Slack member ID     | `U12345ABCDE`         |
| **Basecamp ID**   | Number           | Basecamp user ID    | `12345678`            |

#### How to Get These IDs:

**Slack User ID:**

- In Slack, click on a person's profile
- Click "More" → "Copy member ID"

**Basecamp ID:**

- Visit: `http://localhost:3000/debug/basecamp-users`
- Find the user and copy their `id`

### 3. Create Projects Table

Create a table named `Projects` with these columns:

| Column Name             | Type                        | Description         | Example              |
| ----------------------- | --------------------------- | ------------------- | -------------------- |
| **Basecamp Project ID** | Number                      | Basecamp project ID | `44141016`           |
| **Slack Channel ID**    | Single line text            | Slack channel ID    | `C12345ABCDE`        |
| **Project Name**        | Single line text (optional) | For reference only  | `Automation Testing` |

#### How to Get These IDs:

**Basecamp Project ID:**

- Visit: `http://localhost:3000/debug/projects`
- Find your project and copy the `id`

**Slack Channel ID:**

- In Slack, right-click on a channel → View channel details
- Scroll down and copy the Channel ID

### 4. Get Airtable Credentials

**Personal Access Token:**

1. Go to [Airtable Developer Hub](https://airtable.com/create/tokens)
2. Click "Create new token"
3. Give it a name (e.g., "Basecamp Bot")
4. Add these scopes:
   - `data.records:read` (to read your data)
5. Add access to your base (select the base you created)
6. Click "Create token"
7. Copy the token (starts with `pat...`) - **you won't see it again!**

**Base ID:**

1. Go to [Airtable API docs](https://airtable.com/api)
2. Click on your base
3. You'll see the Base ID in the introduction (starts with `app...`)

### 5. Update Environment Variables

Add these to your `.env` file:

```bash
# Airtable Configuration
AIRTABLE_PERSONAL_ACCESS_TOKEN=patXXXXXXXXXXXXXX.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX

# Optional: Customize table/view names (defaults shown)
AIRTABLE_PEOPLE_TABLE=People
AIRTABLE_PEOPLE_VIEW=Grid view
AIRTABLE_PROJECTS_TABLE=Projects
AIRTABLE_PROJECTS_VIEW=Grid view
```

### 6. Remove Old Environment Variables

You can now remove these from your `.env` (they're no longer used):

- ~~`CUSTOM_PEOPLE_LIST`~~
- ~~`BASECAMP_SLACK_MAPPINGS`~~

### 7. Restart Your Server

```bash
npm start
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

✅ **No more JSON in environment variables!**  
✅ **Easy to update** - just edit Airtable, no deployment needed  
✅ **Cached for 5 minutes** - fast and efficient  
✅ **Automatic cache refresh** - always up to date  
✅ **Fallback to cache** - works even if Airtable is temporarily down

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

## 🎉 You're Done!

Your bot now uses Airtable for all configuration. No more editing environment variables! 🚀
