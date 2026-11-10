const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const lines = content.split('\n');

const stack = [];
for (let i = 740; i <= 1515; i++) {
  const line = lines[i];
  
  const openMatches = line.matchAll(/<div([^>]*)>/gi);
  for (const m of openMatches) {
    const idMatch = m[1].match(/id="([^"]+)"/i);
    const id = idMatch ? idMatch[1] : (m[1].includes('class=') ? m[1].substring(0, 30) : 'div');
    stack.push({ line: i + 1, id });
  }

  const closeCount = (line.match(/<\/div>/gi) || []).length;
  for (let c = 0; c < closeCount; c++) {
    if (stack.length > 0) {
      const closed = stack.pop();
      // console.log(`Linha ${i+1}: fechou div aberta na linha ${closed.line} (${closed.id})`);
    } else {
      console.log(`</div> EXTRA NA LINHA ${i + 1}!`);
    }
  }
}
console.log('Stack restante em settings:', stack);
