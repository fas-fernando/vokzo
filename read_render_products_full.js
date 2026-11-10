const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');

const start = content.indexOf('function renderProducts() {');
const end = content.indexOf('function updateProductCounts() {', start);
console.log('renderProducts length:', end - start);
console.log(content.substring(start, start + 1000));
console.log('...\n' + content.substring(end - 800, end));
