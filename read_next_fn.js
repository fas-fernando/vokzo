const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');

const start = content.indexOf('function renderProducts() {');
const nextFn = content.indexOf('function ', start + 50);
console.log('Next function after renderProducts:');
console.log(content.substring(nextFn, nextFn + 200));
