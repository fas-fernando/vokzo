const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const viewAdminIdx = content.indexOf('id="view-admin"');
console.log(content.substring(viewAdminIdx, viewAdminIdx + 2000));
