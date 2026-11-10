const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

const cssRule = `
    .merchant-kebab-dropdown {
      min-width: 13.5rem;
      z-index: 50 !important;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    }
`;

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');
  if (!c.includes('min-width: 13.5rem;')) {
    c = c.replace('.hidden { display: none !important; }', '.hidden { display: none !important; }' + cssRule);
    fs.writeFileSync(p, c, 'utf8');
    console.log('[OK] CSS de kebab menu injetado em:', p);
  }
}
