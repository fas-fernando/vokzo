const fs = require('fs');
const server = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js', 'utf8');

const regex = /if\s*\((?:pathname|req\.url)[^)]*(?:PUT|PATCH|DELETE)[^)]*\)/g;
let m;
while ((m = regex.exec(server)) !== null) {
  console.log('Match at', m.index, ':', m[0]);
}
