const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'index.html');
const destScratch = path.join(__dirname, 'alerta_vencimento_app.html');
const destBrain = 'C:\\Users\\fasal\\.gemini\\antigravity\\brain\\8dcdc677-9fde-4f84-9df5-78f4a1cdf27b\\alerta_vencimento_app.html';

const content = fs.readFileSync(src, 'utf8');
fs.writeFileSync(destScratch, content, 'utf8');
fs.writeFileSync(destBrain, content, 'utf8');

console.log('✅ Arquivos sincronizados:');
console.log('   - index.html (' + content.length + ' bytes)');
console.log('   - alerta_vencimento_app.html [scratch] (' + fs.statSync(destScratch).size + ' bytes)');
console.log('   - alerta_vencimento_app.html [brain] (' + fs.statSync(destBrain).size + ' bytes)');
