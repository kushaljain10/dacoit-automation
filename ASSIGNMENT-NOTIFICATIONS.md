# Assignment Notifications Feature

## Overview

This feature adds Slack notifications when tasks are assigned in Basecamp, both during creation and when assigning someone to an existing task.

## Features Implemented

### 1. Direct Message (DM) to Assignees

When a task is assigned to someone (either during creation or later), they receive a DM on Slack with:

- **Task Title** - Clear title of the task
- **Task Description** - Full description of what needs to be done
- **Project Name** - Which project the task belongs to
- **Due Date** - When the task is due (formatted nicely)
- **Creator Name** - Who created/assigned the task
- **Direct Link** - Button to view the task in Basecamp

The DM is sent in two scenarios:

- **New Task Assignment**: When a task is created with an assignee
- **Existing Task Assignment**: When someone is assigned to an existing task

### 2. Thread/Channel Notifications

When a person is assigned to an existing task, the system also:

- **Sends a message to the thread** of the original task notification (if it exists)
- **Broadcasts to the channel** so it's visible to everyone
- **Tags the assigned person** using Slack mentions
- **Falls back to channel** if no thread is found in Airtable

## How It Works

### Task Creation Flow

1. User creates a task via Telegram bot
2. Task is created in Basecamp with assignee
3. System sends DM to assignee with full task details
4. Task creation notification is sent to project's Slack channel

### Assignment Change Flow (via Webhook)

1. Someone assigns a task to a person in Basecamp
2. Basecamp sends webhook event (`todo_assignees_changed` or `todo_changed`)
3. System fetches full task details including current assignees
4. For each assignee with a Slack ID in Airtable:
   - Sends DM with task details
   - Looks up original task message in Airtable
   - Sends notification to thread (or channel if thread not found)
   - Tags the assignee in the notification

## Technical Implementation

### New Functions in `slack-notifications.js`

#### `sendAssigneeDM(assigneeSlackId, taskData, isExistingTask)`

Sends a direct message to an assignee about their task assignment.

- **assigneeSlackId**: Slack user ID to send DM to
- **taskData**: Object containing task information (title, description, project, due date, creator, url)
- **isExistingTask**: Boolean indicating if this is an existing task being assigned (changes header text)

#### `sendAssignmentToThread(channelId, threadTs, assigneeSlackId, taskData)`

Sends an assignment notification to a Slack thread or channel.

- **channelId**: Slack channel ID
- **threadTs**: Thread timestamp (if replying to thread, null for channel)
- **assigneeSlackId**: Slack user ID to mention
- **taskData**: Task information

### Modified Functions in `index.js`

#### `notifyAssignees(todo, projectName, creatorName, assigneeSlackId)`

Helper function that fetches Airtable people data and sends DMs to assignees.

- Handles both direct Slack ID and fetching from Basecamp assignees
- Matches assignees with Airtable records to get Slack IDs

#### Updated Task Creation

Modified the following areas to send DMs after task creation:

- Single task creation (step 5 in text handler)
- Task confirmation flow (confirm_task action)
- Batch task creation (`createBatchTasks` function)

#### Updated Webhook Handler

Added handling for assignment change events:

- `todo_assignees_changed`
- `todo_changed`

Fetches full task details, enriches with Slack IDs, and sends both DMs and thread notifications.

## Configuration

### Airtable Requirements

The system requires the following Airtable setup:

1. **People Table** (existing)

   - `name` - Person's name
   - `email` - Email address
   - `slack_id` - Slack user ID (format: `U1234567890`)
   - `basecamp_id` - Basecamp user ID (for matching)

2. **Task Messages Table** (existing)
   - Stores mapping between Basecamp task IDs and Slack message timestamps
   - Used to find threads for assignment notifications

### Environment Variables

No new environment variables required. Uses existing:

- `SLACK_BOT_TOKEN` - For sending Slack messages
- `AIRTABLE_PERSONAL_ACCESS_TOKEN` - For fetching people data
- `AIRTABLE_BASE_ID` - Airtable base
- `AIRTABLE_PEOPLE_TABLE` - Table name for people data

## Message Format Examples

### DM to Assignee (New Task)

```
🆕 You've been assigned to a new task

Fix login bug on homepage

The login button is not working on the homepage. Users are getting a 500 error when they click it.

Project: Acme Website
Due Date: Oct 12, 2025
Created by: John Doe

[View Task in Basecamp] (button)
```

### DM to Assignee (Existing Task)

```
📌 You've been assigned to a task

Update documentation

Update the API documentation to reflect the new endpoints.

Project: Internal Tools
Due Date: Oct 15, 2025
Created by: Jane Smith

[View Task in Basecamp] (button)
```

### Thread/Channel Notification

```
👤 @alice has been assigned to this task
```

## Benefits

1. **Immediate Notification** - Assignees know right away they have a new task
2. **Complete Context** - All task details in one place
3. **Easy Access** - Direct link to view/edit in Basecamp
4. **Team Visibility** - Thread/channel notifications keep everyone informed
5. **Works Everywhere** - Handles both new tasks and assignment changes
6. **Graceful Degradation** - Falls back to channel if thread not found

## Error Handling

- DMs are non-blocking - if they fail, task creation still succeeds
- Missing Slack IDs are handled gracefully with console warnings
- Thread lookup failures fall back to channel notifications
- Airtable fetch errors use stale cache or skip notifications

## Testing

To test the implementation:

1. **Test DM on New Task**:

   - Create a task via Telegram bot and assign it to someone with a Slack ID in Airtable
   - Verify they receive a DM with all task details

2. **Test DM on Assignment Change**:

   - Create a task without an assignee
   - Assign it to someone in Basecamp
   - Verify they receive a DM

3. **Test Thread Notification**:

   - Create a task (notification should be sent to Slack channel)
   - Assign someone to that task in Basecamp
   - Verify notification appears in the thread and tags the person

4. **Test Fallback**:
   - Create a task outside the bot (directly in Basecamp)
   - Assign someone to it
   - Verify notification goes to channel (not thread)

## Future Enhancements

Possible improvements:

- Track previous assignees to only notify newly added people
- Batch notifications for multiple assignees
- Customizable notification templates
- Support for unassignment notifications
- Notification preferences per user
