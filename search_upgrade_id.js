const fs = require('fs');
const html = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');

const regex = /modal-partner-upgrade/g;
let match;
while ((match = regex.exec(html)) !== null) {
  console.log('modal-partner-upgrade at', match.index);
  console.log(html.substring(match.index - 40, match.index + 80));
}
