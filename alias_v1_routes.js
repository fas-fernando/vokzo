const fs = require('fs');
const serverPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js';
let server = fs.readFileSync(serverPath, 'utf8');

// 1. Em GET /api/v1/products/alerts -> suportar também /api/v1/alerts
server = server.replace(
  "if (pathname === '/api/v1/products/alerts' && req.method === 'GET') {",
  "if ((pathname === '/api/v1/products/alerts' || pathname === '/api/v1/alerts') && req.method === 'GET') {"
);

// 2. Em POST /api/v1/products/sync -> suportar também /api/v1/sync
server = server.replace(
  "if (pathname === '/api/v1/products/sync' && req.method === 'POST') {",
  "if ((pathname === '/api/v1/products/sync' || pathname === '/api/v1/sync') && req.method === 'POST') {"
);

fs.writeFileSync(serverPath, server, 'utf8');
console.log('✅ server.js atualizado com suporte a /api/v1/alerts e /api/v1/sync!');
