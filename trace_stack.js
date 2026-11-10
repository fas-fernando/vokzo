const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const lines = content.split('\n');

const stack = [];
for (let i = 543; i <= 1612; i++) {
  const line = lines[i];
  
  // Abertura de div
  const openMatches = line.matchAll(/<div([^>]*)>/gi);
  for (const m of openMatches) {
    const idMatch = m[1].match(/id="([^"]+)"/i);
    const id = idMatch ? idMatch[1] : (m[1].includes('class=') ? m[1].substring(0, 30) : 'div');
    stack.push({ line: i + 1, id });
  }

  // Fechamento de div
  const closeCount = (line.match(/<\/div>/gi) || []).length;
  for (let c = 0; c < closeCount; c++) {
    if (stack.length > 0) {
      const closed = stack.pop();
      if (stack.length === 0) {
        console.log(`DIV RAIZ (view-admin) FOI FECHADA NA LINHA ${i + 1} por </${closed.id}>!`);
      }
    } else {
      console.log(`</div> EXTRA na linha ${i + 1}!`);
    }
  }
}
console.log('Stack restante:', stack);
