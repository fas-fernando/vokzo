const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const lines = content.split('\n');

for (let i = 1515; i < 1612; i++) {
  const line = lines[i];
  if (line.includes('<div') || line.includes('</div')) {
    console.log((i+1) + ': ' + line.trim());
  }
}
