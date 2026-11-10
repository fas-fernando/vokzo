const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // Corrige ponto e vírgula em renderProducts
  c = c.replace(
    "}).join(''); + buildPaginationControlsHtml('products'",
    "}).join('') + buildPaginationControlsHtml('products'"
  );

  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] Ponto e vírgula corrigido em:', p);
}
