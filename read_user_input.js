const fs = require('fs');
const transcript = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = transcript.trim().split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  const step = JSON.parse(lines[i]);
  if (step.type === 'USER_INPUT') {
    console.log('User input found at step', i);
    console.log('Content:', step.content);
    console.log('Media:', step.media);
    break;
  }
}
