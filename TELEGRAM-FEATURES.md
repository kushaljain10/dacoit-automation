# Telegram Bot New Features

This document describes the three new features implemented for the Telegram bot.

## 1. Airtable-Based Whitelist

**What changed:**

- The whitelist is now fetched from the `telegram_id` field in the Airtable `people` table instead of using the `WHITELIST` environment variable.
- Empty/null `telegram_id` values are automatically filtered out.
- The whitelist is refreshed dynamically from Airtable on each authentication check.
- Fallback to env variable `WHITELIST` if Airtable fetch fails.

**Airtable Setup:**
Add a new column to your `people` table:

- **Column Name:** `telegram_id`
- **Type:** Single line text
- **Description:** User's Telegram ID (numeric)
- **Example:** `5387749233`

**How to get Telegram ID:**

- Users can message `@userinfobot` on Telegram to get their ID
- Or use `/start` in your bot and check the logs for the user ID

**Files Modified:**

- `airtable.js` - Added `getTelegramWhitelist()` function
- `index.js` - Updated whitelist initialization and `requireAuth` middleware

---

## 2. Group Message Auto-Reply for Offline Users

**What it does:**
When someone mentions a team member in a Telegram group/channel and that person's status is "offline", the bot will:

1. **Send an auto-reply in the group** (replying to the original message)

   - The reply is AI-generated and contextually relevant to the message
   - Informs the sender that the person is unavailable
   - Assures them the person will get back soon

2. **Send a DM to the offline person** with:
   - Channel/group name where they were mentioned
   - Name of the person who mentioned them
   - The exact message text
   - Note that they were mentioned while offline

**Airtable Setup:**
Add a new column to your `people` table:

- **Column Name:** `tg_status`
- **Type:** Single select (or Single line text)
- **Options:** `online`, `offline`
- **Default:** `offline`

**How it works:**

1. Bot detects mentions in group messages (using `@mention` or direct user tags)
2. Checks if the mentioned user exists in Airtable with a `telegram_id`
3. Checks if their `tg_status` is `offline`
4. Generates AI response using Claude Sonnet 3.5
5. Sends reply in group + DM to offline user

**Example Flow:**

```
Group Message: "Hey @john, can you review the design?"

Bot (if John is offline):
"John is currently unavailable and will review your message as soon as possible. Your request has been forwarded to him."

John's DM:
"📬 New message in Design Team

From: Sarah

Message:
"Hey @john, can you review the design?"

You were mentioned while your status was offline."
```

**Files Modified:**

- `airtable.js` - Added `tg_status` field to people fetching
- `index.js` - Added group message handler with mention detection
- `index.js` - Added `generateOfflineResponse()` AI function

---

## 3. /update_status Command

**What it does:**
Allows users to toggle their Telegram availability status between "online" and "offline" directly from Telegram.

**Usage:**

1. User sends `/update_status` command
2. Bot shows current status with a toggle button
3. User clicks button to change status
4. Status is updated in Airtable
5. Cache is cleared to ensure fresh data

**Example:**

```
User: /update_status

Bot: "🟢 Your current status: ONLINE
Would you like to change it?"
[📴 Set to Offline]

User clicks button...

Bot: "⚫ Status updated successfully!
Your status is now: OFFLINE"
```

**Files Modified:**

- `airtable.js` - Added `updatePersonStatus()` function
- `index.js` - Added `/update_status` command handler
- `index.js` - Added `status_toggle_*` callback query handler

---

## Testing Checklist

### 1. Whitelist

- [ ] Add your `telegram_id` to Airtable `people` table
- [ ] Send `/start` to the bot - should authenticate successfully
- [ ] Remove your `telegram_id` from Airtable
- [ ] Send `/start` again - should say "not authorised"
- [ ] Add it back - should work again

### 2. Auto-Reply

- [ ] Set your `tg_status` to `offline` in Airtable
- [ ] Add the bot to a test group/channel
- [ ] Have someone mention you in the group
- [ ] Verify bot sends auto-reply in the group
- [ ] Verify you receive a DM with the message details
- [ ] Set `tg_status` to `online`
- [ ] Have someone mention you - should NOT auto-reply

### 3. Status Command

- [ ] Send `/update_status`
- [ ] Verify it shows your current status correctly
- [ ] Click the toggle button
- [ ] Verify status updates in Telegram
- [ ] Check Airtable - `tg_status` should be updated
- [ ] Send `/update_status` again - should show new status

---

## Environment Variables

No new environment variables required! Everything uses existing Airtable configuration:

- `AIRTABLE_PERSONAL_ACCESS_TOKEN`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_PEOPLE_TABLE` (default: "people")
- `OPENROUTER_API_KEY` (for AI responses)
- `OPENROUTER_API_URL`

---

## Troubleshooting

### Whitelist not working

- Check logs for "Telegram whitelist loaded: X users"
- Verify `telegram_id` values in Airtable are correct (numeric strings)
- Try manually refreshing: restart the bot

### Auto-reply not working

- Check that bot is added to the group/channel
- Verify user has `telegram_id` in Airtable
- Verify `tg_status` is set to "offline"
- Check logs for "Found mentions:" message
- Ensure OpenRouter API key is valid

### Status update not working

- Check that user's `telegram_id` matches their Telegram ID
- Verify Airtable permissions allow updates
- Check logs for "Updating Telegram status for..."

### DMs not being sent

- Verify the bot has permission to send DMs to the user
- User must have started a conversation with the bot first
- Check error logs for "Failed to send DM"

---

## Notes

- **Group Privacy:** The bot needs to be able to see messages in groups. Make sure privacy mode is disabled for the bot (BotFather setting).
- **Mention Detection:** Currently only detects direct user mentions (clicking on username). `@username` mentions require the username to be stored in Airtable (not implemented yet).
- **AI Responses:** Uses Claude Sonnet 3.5 for generating contextual replies. Falls back to generic message if AI fails.
- **Cache:** People data is cached for 5 minutes. Cache is automatically cleared when status is updated.
