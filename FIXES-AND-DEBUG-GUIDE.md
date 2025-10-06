# Fixes and Debugging Guide

## Issues Fixed

### 1. Confirm Button Not Responding
**Problem**: When clicking "✅ Confirm" after AI processes a task, nothing happens.

**Root Cause**: The `askTodoList()` function was being called without `await`, which could cause issues in the promise chain. Additionally, there was no logging to help debug what was happening.

**Fixes Applied**:
- ✅ Added `await` to `askTodoList()` call in confirm_task handler
- ✅ Added comprehensive logging to show what's happening at each step:
  - Logs when confirm button is clicked with current state
  - Logs when fetching todo lists for a project
  - Logs errors if todo list fetching fails

**How to Debug**:
1. When you click confirm, check the server logs for:
   ```
   ✅ Confirm button clicked { projectId: ..., todoListId: ..., assigneeId: ..., slackUserId: ... }
   ```
2. If projectId is null/undefined, you'll see:
   ```
   No project found, asking user to select
   ```
3. If projectId exists but todoListId is null:
   ```
   No todo list selected, fetching lists for project <ID>
   ```
4. Check for any error messages from `fetchTodoLists`

### 2. DMs Not Being Sent to Assignees
**Problem**: When a task is assigned to someone (during creation or later), they don't receive a DM on Slack.

**Root Cause**: Could be multiple issues:
- Slack IDs not in Airtable
- Slack IDs incorrectly formatted
- `notifyAssignees` function failing silently

**Fixes Applied**:
- ✅ Added comprehensive logging to `notifyAssignees` function:
  - Logs when function is called with full context
  - Logs how many people found in Airtable
  - Logs when sending DM with Slack ID
  - Logs success/failure for each DM sent
  - Logs if Slack ID is missing in Airtable

**How to Debug**:
1. When a task is created/assigned, check logs for:
   ```
   📧 notifyAssignees called with: { taskTitle: ..., projectName: ..., creatorName: ..., assigneeSlackId: ..., hasAssignees: true/false }
   ```
2. Check if Airtable people are fetched:
   ```
   Fetching people from Airtable for Slack ID matching...
   Found X people in Airtable
   ```
3. Check if Slack ID is found:
   ```
   📧 Sending DM to <Name> (Slack ID: <ID>)
   ✅ DM sent successfully to <Name>
   ```
4. If no Slack ID found:
   ```
   ⚠️ No Slack ID found for assignee <Name> (<email>)
   Airtable person found: true/false
   But slack_id is missing in Airtable record
   ```

**Common Issues**:
- **Slack ID missing in Airtable**: Add the user's Slack ID to the Airtable `people` table
- **Email mismatch**: Ensure email in Airtable matches Basecamp user email exactly
- **Basecamp ID mismatch**: Update `basecamp_id` in Airtable to match actual Basecamp user ID

### 3. Assignment Change Notifications Not Working
**Problem**: When someone is assigned to an existing task in Basecamp, no notification is sent to Slack (no DM, no thread/channel message).

**Root Cause**: The webhook handler for `todo_assignees_changed` and `todo_changed` events might be:
- Not receiving the webhook
- Not finding Slack IDs for assignees
- Failing to send notifications due to errors

**Fixes Applied**:
- ✅ Added extensive logging to assignment change webhook handler:
  - Logs when assignment change event is received
  - Logs todo details and assignees
  - Logs DM sending attempts and results
  - Logs thread/channel notification attempts
  - Logs specific errors if sending fails
  - Logs warnings if no todo details or assignees found

**How to Debug**:
1. When you assign someone in Basecamp, check logs for:
   ```
   🔔 Processing assignment change event
   Todo details: { hasTodoDetails: true, todoId: ..., assigneesCount: ..., assignees: [...] }
   ```
2. Check if assignees have Slack IDs:
   ```
   ✅ Task has assignees after change: [Name1, Name2]
   ```
3. Check DM sending:
   ```
   📧 Sending assignment DM to <Name> (<Slack ID>)
   ✅ Assignment DM sent to <Name>
   ```
4. Check thread/channel notification:
   ```
   Thread info for task: { taskId: ..., threadInfo: { thread_ts: ..., channel_id: ... } }
   💬 Sending assignment notification to thread for <Name>
   ✅ Thread notification sent for <Name>
   ```

**Common Issues**:
- **No webhook received**: Check Basecamp webhook configuration at `/debug/setup-basecamp-webhooks`
- **No Slack IDs**: Assignees don't have Slack IDs in Airtable
- **Thread not found**: Task was created outside the bot, so no thread mapping exists - notification will go to channel instead:
  ```
  📢 No thread found, sending assignment notification to channel for <Name>
  ```

## How to Test Each Feature

### Test DMs on Task Creation
1. Create a task via Telegram bot
2. Assign it to someone who has a Slack ID in Airtable
3. Check server logs for `notifyAssignees` call
4. Verify DM is received in Slack
5. Check for any error logs

### Test DMs on Assignment Change
1. Create a task in Basecamp (or via bot)
2. Assign someone to it in Basecamp
3. Check server logs for webhook receipt:
   ```
   Received Basecamp webhook payload: { kind: "todo_assignees_changed", ... }
   ```
4. Check for `Processing assignment change event` log
5. Verify DM is received in Slack
6. Verify thread/channel notification is posted

### Test Confirm Button
1. Send a message to create a task
2. Wait for AI to process
3. Click "✅ Confirm"
4. Check logs for:
   ```
   ✅ Confirm button clicked
   ```
5. Should see project selection OR todo list selection
6. If nothing happens, check logs for errors

## Verification Checklist

### Airtable Setup
- [ ] People table has `name`, `email`, `slack_id`, and `basecamp_id` columns
- [ ] Slack IDs are in format `U1234567890` (starts with U)
- [ ] Emails match exactly with Basecamp user emails
- [ ] Basecamp IDs match actual user IDs (check at `/debug/people-matching`)

### Slack Bot Setup
- [ ] Bot has permission to send DMs (`chat:write`)
- [ ] Bot is invited to project channels
- [ ] `SLACK_BOT_TOKEN` environment variable is set

### Basecamp Webhooks
- [ ] Webhooks are set up for all projects (`POST /debug/setup-basecamp-webhooks`)
- [ ] Webhooks are pointing to correct URL
- [ ] Webhook events include `todo_created`, `todo_assignees_changed`, `todo_changed`

### Environment Variables
- [ ] `SLACK_BOT_TOKEN` is set
- [ ] `AIRTABLE_PERSONAL_ACCESS_TOKEN` is set
- [ ] `AIRTABLE_BASE_ID` is set
- [ ] `AIRTABLE_PEOPLE_TABLE` is set (or defaults to "people")

## Log Patterns to Look For

### Successful Task Creation with DM
```
✅ Confirm button clicked { projectId: 12345, ... }
No todo list selected, fetching lists for project 12345
Found 1 todo lists in project 12345
Only one todo list found, auto-selecting: Tasks
📧 notifyAssignees called with: { taskTitle: "...", creatorName: "John", assigneeSlackId: "U12345" }
📧 Sending DM using provided Slack ID: U12345
✅ DM sent successfully to U12345
✅ Task created: ...
```

### Successful Assignment Change
```
Received Basecamp webhook payload: { kind: "todo_assignees_changed", ... }
🔔 Processing assignment change event
Todo details: { hasTodoDetails: true, assigneesCount: 1, assignees: [{ name: "Alice", slack_id: "U12345" }] }
✅ Task has assignees after change: [Alice]
📧 Sending assignment DM to Alice (U12345)
✅ Assignment DM sent to Alice
Thread info for task: { taskId: 67890, threadInfo: { thread_ts: "1234567890.123456", channel_id: "C12345" } }
💬 Sending assignment notification to thread for Alice
✅ Thread notification sent for Alice
```

### Error: No Slack ID in Airtable
```
📧 notifyAssignees called with: { ... }
Fetching people from Airtable for Slack ID matching...
Found 5 people in Airtable
⚠️ No Slack ID found for assignee Alice (alice@example.com)
   Airtable person found: true
   But slack_id is missing in Airtable record
```

### Error: No Todo List Found
```
✅ Confirm button clicked { projectId: 12345, ... }
No todo list selected, fetching lists for project 12345
Error fetching todo lists: { status: 404, error: ... }
Error fetching to-do lists. Please check your Basecamp permissions.
```

## Quick Fixes

### If DMs aren't being sent:
1. Check logs for `notifyAssignees called` - if not present, function isn't being called
2. Check logs for `Found X people in Airtable` - if 0, Airtable connection issue
3. Check logs for `No Slack ID found` - add Slack IDs to Airtable
4. Test sending a DM manually via Slack API to verify bot permissions

### If confirm button doesn't work:
1. Check logs for `Confirm button clicked` - if not present, button handler not registered
2. Check logs for errors in `askTodoList` or `askProject`
3. Verify `projectId` is being set by AI or user selection
4. Check for any uncaught exceptions in the console

### If assignment webhooks don't work:
1. Test webhook receipt: `curl -X POST https://your-domain.com/basecamp/webhook -H "Content-Type: application/json" -d '{"kind":"todo_assignees_changed","recording":{"id":123}}'`
2. Check if webhook is registered in Basecamp: `GET /debug/list-basecamp-webhooks/<projectId>`
3. Verify enrichedAssignees has Slack IDs
4. Check Airtable people table for matching records

