const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/.system_generated/logs/transcript_full.jsonl';
const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath) });

rl.on('line', line => {
  if (line.includes('"step_index":5320')) {
    const obj = JSON.parse(line);
    const tc = obj.tool_calls.find(t => t.name === 'write_file' && t.args.Path.includes('test_responsiveness_suite.js'));
    fs.writeFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/test_responsiveness_suite.js', tc.args.Content, 'utf8');
    console.log('Restaurado de transcript_full!');
    process.exit(0);
  }
});
