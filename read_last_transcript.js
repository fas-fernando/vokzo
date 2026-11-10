const fs = require('fs');
const transcript = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = transcript.trim().split('\n');
const lastLine = JSON.parse(lines[lines.length - 1]);
console.log('Last step type:', lastLine.type);
console.log('Last step content:', lastLine.content);
console.log('Last step media:', lastLine.media);
