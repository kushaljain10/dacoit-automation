# ToDo List Selection Feature

## Overview
This feature allows users to select which ToDo list to add their task to when a Basecamp project has multiple ToDo lists. Previously, the bot would automatically select the first active list or create a new one if none existed. Now, users have full control over which list their tasks go into.

## How It Works

### Single Task Flow

1. **Task Description** - User provides task details
2. **AI Processing & Confirmation** - AI processes and user confirms
3. **Project Selection** - User selects or AI detects the project
4. **📋 ToDo List Selection** (NEW)
   - System fetches all ToDo lists in the selected project
   - If only **one list exists**: Auto-selects it and moves to next step
   - If **multiple lists exist**: Shows paginated list of options for user to choose
5. **Assignee Selection** - User selects who to assign the task to
6. **Due Date** - User provides or skips due date
7. **Task Created** - Task is created in Basecamp

### Batch Task Flow

When creating multiple tasks at once, the bot will:

1. Process all tasks with AI
2. For each task missing information:
   - Ask for project if not detected
   - **Fetch ToDo lists for that project**
   - If multiple lists exist, ask user to select one
   - Ask for due date if not provided
3. Create all tasks with the selected information

## Features

### Smart Auto-Selection
- **Single List**: Automatically selected, no user interaction needed
- **Multiple Lists**: User prompted to choose
- **Archived Lists**: Shown with "(archived)" label for clarity

### Pagination Support
- Shows 8 lists per page
- Navigation buttons (⬅️ Previous, ➡️ Show More)
- Page counter shows current position (e.g., "1-8 of 15")

### Batch Task Support
- Each task in a batch can be assigned to different ToDo lists
- System remembers selections per task
- Auto-selects when only one list available

### Message Cleanup
- Selection messages are cleaned up after choice is made
- Keeps chat history clean and organized

## User Experience

### Example Flow (Single List)
```
User: "Fix login bug"
Bot: 🤖 Processing your task with AI...
Bot: 🤖 AI Processed Task:
     Title: Fix login bug
     Description: ...
     
     [✅ Confirm] [🔄 Rewrite]

User: [clicks ✅ Confirm]
Bot: Choose a project:
     [Acme Website]
     [Internal Tools]

User: [clicks Acme Website]
Bot: Who should this be assigned to?
     [➡️ No assignee]
     [Alice]
     [Bob]
     
(Note: No todo list selection because project only has one list)
```

### Example Flow (Multiple Lists)
```
User: "Update documentation"
Bot: 🤖 Processing...
Bot: [Confirmation UI]

User: [confirms]
Bot: Choose a project:
     [Internal Tools]

User: [clicks Internal Tools]
Bot: Which to-do list should this task be added to?
     [Features]
     [Bugs]
     [Documentation]
     [Technical Debt]

User: [clicks Documentation]
Bot: Who should this be assigned to?
     [➡️ No assignee]
     [Alice]
     ...
```

### Example Flow (Batch Tasks with Multiple Lists)
```
Bot: 📋 Task 1: Fix login bug
     
     Please select a to-do list:
     [Features]
     [Bugs]
     [Documentation]

User: [clicks Bugs]
Bot: 📋 Task 2: Update API docs
     
     Please select a to-do list:
     [Features]
     [Bugs]
     [Documentation]

User: [clicks Documentation]
Bot: ✅ Batch Task Creation Complete
     📊 Created 2 task(s), 0 failed
     ...
```

## Technical Implementation

### New Functions

#### `fetchTodoLists(ctx, projectId)`
Fetches all ToDo lists from a project.
- Returns: `{ todosetId, lists }` - The todoset ID and array of lists
- Handles projects with no lists by creating a default "Tasks" list
- Includes error handling for permissions issues

#### `askTodoList(ctx, page = 0)`
Shows paginated list selection UI to user.
- Auto-selects if only one list exists
- Supports pagination for projects with many lists
- Tracks messages for cleanup
- Shows archived status for archived lists

#### `chooseDefaultTodoList(ctx, projectId)` (Updated)
Legacy function maintained for backward compatibility.
- Now uses `fetchTodoLists()` internally
- Picks first active list or falls back to first list
- Used for batch tasks when todoListId not pre-selected

### Action Handlers

#### `bot.action(/^list_(.+)$/)`
Handles ToDo list selection.
- Supports pagination (e.g., `list_page_1`)
- Handles both single task flow (step 4) and batch task flow (step 8)
- Cleans up selection messages after choice made
- Updates flow step and proceeds to assignee selection

### Flow Steps (Updated)

**Single Task Flow:**
- Step 1: Task description
- Step 2: Confirmation
- Step 3: Project selection
- Step 4: **ToDo list selection** (NEW)
- Step 5: Assignee selection
- Step 6: Due date

**Batch Task Flow:**
- Step 7: Project selection
- Step 8: **ToDo list selection** (NEW)
- Step 9: Due date

### Session Data Structure

```javascript
ctx.session.flow = {
  step: 4, // Current step
  selections: {
    projectId: 12345,
    todoListId: 67890, // Selected list ID
    assigneeId: 111,
    dueOn: "2025-10-15"
  },
  todoLists: [ // Available lists for current project
    { id: 67890, name: "Features", status: "active" },
    { id: 67891, name: "Bugs", status: "active" },
    { id: 67892, name: "Old Tasks", status: "archived" }
  ],
  todoListMessages: [123, 124], // Message IDs for cleanup
  // ... other flow data
}
```

### Batch Task Data Structure

```javascript
f.selections.batchTasksNeedingInfo = [
  {
    index: 0,
    task: { title: "...", projectId: 12345, todoListId: null },
    needsProject: false,
    needsTodoList: true,  // Will ask for list selection
    needsDueDate: true
  },
  // ... more tasks
]
```

## Edge Cases Handled

1. **Project with No Lists**
   - Automatically creates a default "Tasks" list
   - User doesn't see any selection UI
   - Creates task in the new list

2. **Project with One List**
   - Auto-selects the only available list
   - No user interaction required
   - Logs selection for debugging

3. **Project with Archived Lists**
   - Shows archived lists with "(archived)" suffix
   - User can still select them if needed
   - Useful for historical projects

4. **Batch Tasks with Different Projects**
   - Each task can be in different project's list
   - System fetches lists per project
   - Auto-selects when only one list per project

5. **API Errors**
   - Graceful error messages
   - Falls back to default list selection
   - Doesn't block task creation

6. **Pagination**
   - Shows navigation only when needed
   - Clean UI with page indicators
   - Maintains state across pages

## Benefits

### For Users
✅ **Full Control** - Choose exactly where tasks go  
✅ **No Clutter** - Tasks organized in appropriate lists  
✅ **Time Saving** - Auto-selects when obvious  
✅ **Batch Support** - Works seamlessly with multiple tasks  
✅ **Clear UI** - Easy to see all available lists  

### For Organization
✅ **Better Organization** - Tasks in correct lists from the start  
✅ **Less Cleanup** - No moving tasks after creation  
✅ **Flexible Workflow** - Supports various project structures  
✅ **Archived Support** - Can still use old lists when needed  

## Configuration

No additional configuration required! The feature works automatically based on:
- Number of ToDo lists in each project
- User's Basecamp permissions
- Existing project structure

## Backward Compatibility

The legacy `chooseDefaultTodoList()` function is maintained and used for:
- Batch tasks without pre-selected lists
- Fallback scenarios
- Internal operations

This ensures existing flows continue to work while new features are added.

## Testing

### Test Single List Project
1. Create a task
2. Select a project with only one ToDo list
3. Verify: List is auto-selected, no selection UI shown
4. Verify: Task created successfully

### Test Multiple Lists Project
1. Create a task
2. Select a project with multiple ToDo lists
3. Verify: Selection UI appears with all lists
4. Select a list
5. Verify: Task created in correct list

### Test Batch Tasks
1. Create multiple tasks for same project
2. Verify: If multiple lists, asked to select for each task
3. Select different lists for different tasks
4. Verify: Each task created in its selected list

### Test Pagination
1. Create a task in project with 10+ ToDo lists
2. Verify: Only 8 lists shown initially
3. Click "Show More"
4. Verify: Next page of lists shown
5. Select a list from second page
6. Verify: Task created successfully

## Future Enhancements

Possible improvements:
- **Recently Used Lists** - Show most recently used lists first
- **List Search** - Add search when many lists exist
- **List Creation** - Allow creating new list during task creation
- **Default List Preference** - Remember user's preferred list per project
- **List Metrics** - Show task count per list

