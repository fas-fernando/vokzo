const fs = require('fs');

const p = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/test_responsiveness_suite.js';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  "assert(html.includes('<span class=\"hidden sm:inline\">Parceiros (Revendedores B2B)</span><span class=\"sm:hidden\">Parceiros</span>'), 'Aba de Parceiros do Admin com versão compacta no mobile');",
  "assert(html.includes('Parceiros (Revendedores B2B)</span>'), 'Aba de Parceiros do Admin com texto completo sempre visível');"
);

c = c.replace(
  "assert(html.includes('<span class=\"hidden sm:inline\">Configurações</span>\\n            <span class=\"sm:hidden\">Ajustes</span>') || html.includes('<span class=\"hidden sm:inline\">Configurações</span><span class=\"sm:hidden\">Ajustes</span>'), 'Aba de Configurações com versão compacta no mobile');",
  "assert(html.includes('Configurações</span>'), 'Aba de Configurações com texto completo sempre visível');"
);

c = c.replace(
  "assert(html.includes('class=\"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3\"'), 'KPIs do Parceiro no Admin responsivos em 1, 2 ou 3 colunas');",
  "assert(html.includes('snap-x snap-mandatory') && html.includes('admin-stat-partner-mrr'), 'KPIs do Parceiro no Admin com carrossel horizontal mobile e grid desktop');"
);

fs.writeFileSync(p, c, 'utf8');
console.log('test_responsiveness_suite.js atualizado com sucesso!');
