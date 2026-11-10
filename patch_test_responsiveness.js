const fs = require('fs');
const path = require('path');

// 1. Atualizar parceiro.html
let parceiroHtml = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/parceiro.html', 'utf8');
if (parceiroHtml.includes('border-b border-slate-800 flex items-center gap-2 overflow-x-auto')) {
  parceiroHtml = parceiroHtml.replace(
    'border-b border-slate-800 flex items-center gap-2 overflow-x-auto',
    'border-b border-slate-800 flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-slate-800/80 rounded-2xl overflow-x-auto'
  );
  fs.writeFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/parceiro.html', parceiroHtml, 'utf8');
  console.log('parceiro.html abas atualizadas.');
}

// 2. Atualizar test_responsiveness_suite.js
const testPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/test_responsiveness_suite.js';
let testContent = fs.readFileSync(testPath, 'utf8');

const target1 = "const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');";
const replace1 = "const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');\nconst partnerHtml = fs.existsSync(path.join(__dirname, 'parceiro.html')) ? fs.readFileSync(path.join(__dirname, 'parceiro.html'), 'utf8') : '';\nconst allHtml = html + ' ' + partnerHtml;";

if (testContent.includes(target1) && !testContent.includes('const partnerHtml =')) {
  testContent = testContent.replace(target1, replace1);
}

const target2 = "assert(html.includes('flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-slate-800/80 rounded-2xl'), 'Abas do Parceiro com wrap fluido em telas de celular');";
const replace2 = "assert(allHtml.includes('flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-slate-800/80 rounded-2xl'), 'Abas do Parceiro com wrap fluido em telas de celular');";

if (testContent.includes(target2)) {
  testContent = testContent.replace(target2, replace2);
}

fs.writeFileSync(testPath, testContent, 'utf8');
console.log('test_responsiveness_suite.js atualizado.');
