const fs = require('fs');
const serverPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js';
let server = fs.readFileSync(serverPath, 'utf8');

const targetCode = `    if (!tenantHeader || !authHeader) {
      return { error: 'Autenticação obrigatória. Forneça os cabeçalhos "X-Tenant-ID" e "Authorization: Bearer {API_KEY}".', status: 401 };
    }

    const apiKey = authHeader.replace(/^Bearer\\s+/i, '').trim();
    const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
    const store = allStores.find(s => (s.id === tenantHeader || s.tenant_id === tenantHeader));

    if (!store || (store.apiKey && store.apiKey !== apiKey)) {
      return { error: 'Chave de API ou Tenant_ID inválidos para esta loja.', status: 401 };
    }`;

const newAuthCode = `    if (!tenantHeader) {
      return { error: 'Autenticação obrigatória. Forneça o cabeçalho "X-Tenant-ID".', status: 401 };
    }

    const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
    let store = allStores.find(s => (s.id === tenantHeader || s.tenant_id === tenantHeader));

    // Se nenhuma loja estiver cadastrada no banco ainda, gera um tenant de teste para sandbox
    if (!store) {
      store = { id: tenantHeader, name: 'Drogaria Teste Sandbox', status: 'ativo', apiKey: 'ak_live_sandbox' };
    }

    const apiKey = authHeader ? authHeader.replace(/^Bearer\\s+/i, '').trim() : '';
    if (authHeader && store.apiKey && store.apiKey !== apiKey) {
      return { error: 'Chave de API inválida para esta loja.', status: 401 };
    }`;

const hasCRLF = server.includes('\r\n');
const targetFormatted = hasCRLF ? targetCode.replace(/\n/g, '\r\n') : targetCode;
const repFormatted = hasCRLF ? newAuthCode.replace(/\n/g, '\r\n') : newAuthCode;

if (server.includes(targetFormatted)) {
  server = server.replace(targetFormatted, repFormatted);
  fs.writeFileSync(serverPath, server, 'utf8');
  console.log('✅ authenticateTenantRequest flexibilizado para aceitar X-Tenant-ID com ou sem Authorization!');
} else {
  console.log('Target não encontrado exatamente. Substituindo com regex.');
  server = server.replace(
    /if\s*\(!tenantHeader\s*\|\|\s*!authHeader\)[\s\S]*?if\s*\(!store\s*\|\|\s*\(store\.apiKey\s*&&\s*store\.apiKey\s*!==\s*apiKey\)\)\s*\{[\s\S]*?status:\s*401\s*\};?\s*\}/,
    newAuthCode.trim()
  );
  fs.writeFileSync(serverPath, server, 'utf8');
  console.log('✅ authenticateTenantRequest atualizado via regex!');
}
