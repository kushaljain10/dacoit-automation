# Bot Setup Guide

## Privacy Mode

The bot needs to have privacy mode DISABLED to read messages in groups. Follow these steps:

1. Open [@BotFather](https://t.me/botfather) in Telegram
2. Send `/mybots`
3. Select your bot
4. Click "Bot Settings"
5. Click "Group Privacy"
6. Click "Turn off"

You should see: "Privacy mode is now disabled. Your bot will receive all messages that people send to groups."

## Group Permissions

The bot needs these permissions in each group:

- Read Messages
- Send Messages
- Reply to Messages

To set these:

1. Add bot to group
2. Make bot admin (recommended)
   - Or ensure these specific permissions are enabled

## Testing Group Messages

1. Add bot to a test group
2. Send a message mentioning someone: "@username test"
3. Check logs for:

   ```
   👥 Group/Channel message received:
   chat_type: "group"
   entities: [{ type: "mention" }]
   ```

4. If not working:
   - Verify privacy mode is disabled
   - Remove and re-add bot to group
   - Make bot admin
   - Check bot permissions

## Common Issues

### Bot not seeing messages

- Privacy mode is enabled
- Bot not admin/missing permissions
- Bot needs to be re-added after privacy change

### Messages seen but no response

- Check entity detection in logs
- Verify person exists in Airtable
- Check tg_status is set correctly

### DMs not working

- Person hasn't started bot
- Wrong telegram_id in Airtable
- Bot blocked by user
