const { StringSession } = require('telegram/sessions');
const { TelegramClient } = require('telegram');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const input = require('input');
const { NewMessage } = require('telegram/events');

const apiId = 11931788; // Replace with your API ID (number, no quotes)
const apiHash = '3a67be53aa57f46d0a3674a9eb4df43a'; // Replace with your API Hash (string, in quotes)
const sessionDir = path.join(__dirname, 'session');
const sessionFile = path.join(sessionDir, 'session.txt');
const stringSession = new StringSession(''); // Fill this later with the value from session

async function numberLogin(client) {
  await client.start({
    phoneNumber: async () => await input.text('Please enter your phone number: '),
    password: async () => await input.text('Please enter your 2FA password (if enabled): '),
    phoneCode: async () => await input.text('Please enter the code you received: '),
    onError: (err) => console.log(err),
  });
}

async function main() {
  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir);
  }

  let client;
  if (!fs.existsSync(sessionFile)) {
    client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });
    await numberLogin(client);
    console.log('You are now connected.');
    console.log('Your session string:', client.session.save());
    fs.writeFileSync(sessionFile, client.session.save());
  } else {
    const sessionStr = fs.readFileSync(sessionFile, 'utf8');
    client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
      connectionRetries: 5,
    });
    await client.connect();
    console.log('Session loaded.');
  }

  // Helper to add and schedule a new daily message
  function addAndScheduleDaily(chatId, message, time, skipSave) {
    // Add to schedule.json only if not skipSave
    if (!skipSave) {
      let schedules = [];
      try {
        schedules = JSON.parse(fs.readFileSync('schedule.json', 'utf8'));
      } catch (e) {}
      // Prevent duplicate schedule
      const exists = schedules.some(s => s.chatId === chatId && s.message === message && s.time === time);
      if (!exists) {
        schedules.push({ chatId, message, time });
        fs.writeFileSync('schedule.json', JSON.stringify(schedules, null, 2));
      }
    }
    // Schedule it daily
    const [hour, minute] = time.split(':').map(Number);
    if (
      isNaN(hour) || isNaN(minute) ||
      hour < 0 || hour > 23 ||
      minute < 0 || minute > 59
    ) {
      console.error(`Invalid time format for daily schedule: ${time}`);
      return;
    }
    const rule = new schedule.RecurrenceRule();
    rule.hour = hour;
    rule.minute = minute;
    rule.tz = 'Asia/Kolkata'; // Set to IST
    const sendMsg = async () => {
      try {
        // Resolve the entity before sending the message
        const entity = await client.getEntity(chatId);
        await client.sendMessage(entity, { message });
        console.log(`Daily message sent to ${chatId} at ${new Date().toLocaleString()}`);
      } catch (err) {
        if (err.message && err.message.includes('Could not find the input entity')) {
          console.error(`Cannot send message to ${chatId}: The user or chat must interact with the bot at least once before scheduling messages. Please ask them to send a message to the bot first.`);
        } else {
          console.error(`Failed to send daily message to ${chatId}:`, err);
        }
      }
    };
    schedule.scheduleJob(rule, sendMsg);
    console.log(`Scheduled daily message to ${chatId} at ${time}`);
  }

  // Listen for /schedule commands in any chat (daily, HH:mm only)
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg || !msg.text) return;
    if (msg.text.startsWith('/schedule ')) {
      // Support multiple schedules in one message (split by newlines or semicolons)
      const chatId = msg.chatId || msg.peerId || msg.peerId?.channelId || msg.peerId?.userId || msg.peerId?.chatId;
      if (!chatId) {
        await client.sendMessage(msg.chatId, { message: 'Could not determine chat ID.' });
        return;
      }
      // Split message into multiple schedule commands
      const scheduleLines = msg.text.split(/\n|;/).map(line => line.trim()).filter(line => line.startsWith('/schedule '));
      let scheduledCount = 0;
      let failedCount = 0;
      for (const line of scheduleLines) {
        const parts = line.split(' ');
        if (parts.length < 3) {
          failedCount++;
          continue;
        }
        const time = parts[1];
        const message = line.substring(line.indexOf(time) + time.length + 1);
        // Validate time format HH:mm
        if (!/^\d{2}:\d{2}$/.test(time)) {
          failedCount++;
          continue;
        }
        addAndScheduleDaily(chatId, message, time, false);
        scheduledCount++;
      }
      let reply = '';
      if (scheduledCount > 0) reply += `Scheduled ${scheduledCount} daily message(s).\n`;
      if (failedCount > 0) reply += `${failedCount} schedule(s) failed (check format: /schedule HH:mm message).`;
      if (!reply) reply = 'No valid schedules found.';
      await client.sendMessage(chatId, { message: reply });
      return;
    }
  }, new NewMessage({}));

  // On startup, schedule all daily messages from schedule.json (do not save again)
  let schedules = [];
  try {
    schedules = JSON.parse(fs.readFileSync('schedule.json', 'utf8'));
  } catch (e) {}
  for (const sched of schedules) {
    addAndScheduleDaily(sched.chatId, sched.message, sched.time, true); // skipSave=true
  }
}

main(); 