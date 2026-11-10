const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');

const start = content.indexOf('function renderProducts() {');
const nextFn = content.indexOf('function openUrgentActionsDrawer', start);
console.log(content.substring(start, nextFn));
