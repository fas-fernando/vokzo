const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  if (!fs.existsSync(p)) continue;
  let c = fs.readFileSync(p, 'utf8');

  // Ajusta linha do botão do parceiro
  c = c.replace(
    /<span class="hidden sm:inline">Portal do Parceiro PDV<\/span>\s*<span class="sm:hidden">Parceiro<\/span>/g,
    '<span class="hidden sm:inline">Portal do Parceiro PDV</span><span class="sm:hidden">Parceiro</span>'
  );

  fs.writeFileSync(p, c, 'utf8');
  console.log('Ajustado:', p);
}
