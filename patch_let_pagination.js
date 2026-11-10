const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  c = c.replace(/var merchantProductsPage = 1;/g, 'let merchantProductsPage = 1;');
  c = c.replace(/var merchantProductsPageSize = 10;/g, 'let merchantProductsPageSize = 10;');
  c = c.replace(/var adminStoresPage = 1;/g, 'let adminStoresPage = 1;');
  c = c.replace(/var adminStoresPageSize = 10;/g, 'let adminStoresPageSize = 10;');
  c = c.replace(/var adminPartnersPage = 1;/g, 'let adminPartnersPage = 1;');
  c = c.replace(/var adminPartnersPageSize = 10;/g, 'let adminPartnersPageSize = 10;');
  c = c.replace(/var partnerStoresPage = 1;/g, 'let partnerStoresPage = 1;');
  c = c.replace(/var partnerStoresPageSize = 10;/g, 'let partnerStoresPageSize = 10;');

  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] Alterado para let em:', p);
}
