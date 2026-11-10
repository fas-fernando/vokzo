const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // 1. Atualizar STORAGE_KEY para v18 e limpar versões legadas
  const oldKey = "const STORAGE_KEY = 'alerta_vencimento_state_v17';";
  const newKey = `const STORAGE_KEY = 'alerta_vencimento_state_v18';
    try {
      ['alerta_vencimento_state_v17', 'alerta_vencimento_state_v16', 'alerta_vencimento_state_v15', 'alerta_vencimento_state_v14'].forEach(k => {
        if (window.localStorage) window.localStorage.removeItem(k);
      });
      if (window.sessionStorage) window.sessionStorage.removeItem('admin_impersonating_backup');
    } catch (e) {}`;

  if (c.includes(oldKey)) {
    c = c.replace(oldKey, newKey);
  }

  // 2. Definir currentUser admin no buildInitialData
  const oldInitUser = "products: [],\r\n        currentUser: null,";
  const oldInitUserLF = "products: [],\n        currentUser: null,";
  const newInitUser = `products: [],
        currentUser: {
          role: 'admin',
          phone: ADMIN_PHONE,
          name: 'Administrador Master',
          email: 'fas.alves.souza@gmail.com'
        },`;

  if (c.includes(oldInitUser)) {
    c = c.replace(oldInitUser, newInitUser.replace(/\n/g, '\r\n'));
  } else if (c.includes(oldInitUserLF)) {
    c = c.replace(oldInitUserLF, newInitUser);
  }

  // 3. Substituição direta no syncFromServer (para refletir banco vazio do servidor)
  const oldAssignMerchants = "if (data.merchants && typeof data.merchants === 'object') {\r\n              if (!appState.merchants) appState.merchants = {};\r\n              Object.assign(appState.merchants, data.merchants);\r\n            }";
  const oldAssignMerchantsLF = "if (data.merchants && typeof data.merchants === 'object') {\n              if (!appState.merchants) appState.merchants = {};\n              Object.assign(appState.merchants, data.merchants);\n            }";
  const newAssignMerchants = `if (data.merchants && typeof data.merchants === 'object') {
              appState.merchants = data.merchants;
            }`;

  if (c.includes(oldAssignMerchants)) {
    c = c.replace(oldAssignMerchants, newAssignMerchants.replace(/\n/g, '\r\n'));
  } else if (c.includes(oldAssignMerchantsLF)) {
    c = c.replace(oldAssignMerchantsLF, newAssignMerchants);
  }

  const oldAssignRepositores = "if (data.repositores && typeof data.repositores === 'object') {\r\n              if (!appState.repositores) appState.repositores = {};\r\n              Object.assign(appState.repositores, data.repositores);\r\n            }";
  const oldAssignRepositoresLF = "if (data.repositores && typeof data.repositores === 'object') {\n              if (!appState.repositores) appState.repositores = {};\n              Object.assign(appState.repositores, data.repositores);\n            }";
  const newAssignRepositores = `if (data.repositores && typeof data.repositores === 'object') {
              appState.repositores = data.repositores;
            }`;

  if (c.includes(oldAssignRepositores)) {
    c = c.replace(oldAssignRepositores, newAssignRepositores.replace(/\n/g, '\r\n'));
  } else if (c.includes(oldAssignRepositoresLF)) {
    c = c.replace(oldAssignRepositoresLF, newAssignRepositores);
  }

  const oldAssignPartners = "if (data.partners && typeof data.partners === 'object') {\r\n              if (!appState.partners) appState.partners = {};\r\n              Object.assign(appState.partners, data.partners);\r\n            }";
  const oldAssignPartnersLF = "if (data.partners && typeof data.partners === 'object') {\n              if (!appState.partners) appState.partners = {};\n              Object.assign(appState.partners, data.partners);\n            }";
  const newAssignPartners = `if (data.partners && typeof data.partners === 'object') {
              appState.partners = data.partners;
            }`;

  if (c.includes(oldAssignPartners)) {
    c = c.replace(oldAssignPartners, newAssignPartners.replace(/\n/g, '\r\n'));
  } else if (c.includes(oldAssignPartnersLF)) {
    c = c.replace(oldAssignPartnersLF, newAssignPartners);
  }

  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] Arquivo atualizado:', p);
}

// Atualizar server.js
const serverPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js';
let serverCode = fs.readFileSync(serverPath, 'utf8');

const oldServerMerge = `        // Merge de lojistas
        if (parsed.merchants && typeof parsed.merchants === 'object') {
          if (!db.merchants) db.merchants = {};
          Object.assign(db.merchants, parsed.merchants);
        }

        // Merge de produtos (com garantia dos campos de rastreio de ociosidade data_cadastro / data_ultima_movimentacao)
        if (Array.isArray(parsed.products)) {
          if (!Array.isArray(db.products)) db.products = [];
          const prodMap = new Map();
          db.products.forEach(p => prodMap.set(p.id, p));
          parsed.products.forEach(p => {
            if (!p.data_cadastro && p.createdAt) p.data_cadastro = p.createdAt;
            if (!p.data_cadastro) p.data_cadastro = new Date().toISOString();
            if (!p.data_ultima_movimentacao) p.data_ultima_movimentacao = p.data_cadastro;
            prodMap.set(p.id, p);
          });
          db.products = Array.from(prodMap.values());
        }

        // Merge de repositores
        if (parsed.repositores && typeof parsed.repositores === 'object') {
          if (!db.repositores) db.repositores = {};
          Object.assign(db.repositores, parsed.repositores);
        }

        // Merge de parceiros B2B
        if (parsed.partners && typeof parsed.partners === 'object') {
          if (!db.partners) db.partners = {};
          Object.assign(db.partners, parsed.partners);
        }`;

const newServerMerge = `        // Sincronização limpa de lojistas
        if (parsed.merchants && typeof parsed.merchants === 'object') {
          db.merchants = parsed.merchants;
        }

        // Produtos
        if (Array.isArray(parsed.products)) {
          db.products = parsed.products;
        }

        // Repositores
        if (parsed.repositores && typeof parsed.repositores === 'object') {
          db.repositores = parsed.repositores;
        }

        // Parceiros B2B
        if (parsed.partners && typeof parsed.partners === 'object') {
          db.partners = parsed.partners;
        }`;

if (serverCode.includes(oldServerMerge)) {
  serverCode = serverCode.replace(oldServerMerge, newServerMerge);
  fs.writeFileSync(serverPath, serverCode, 'utf8');
  console.log('[OK] server.js atualizado com sincronização limpa!');
} else {
  // Test LF
  const oldLF = oldServerMerge.replace(/\r\n/g, '\n');
  if (serverCode.includes(oldLF)) {
    serverCode = serverCode.replace(oldLF, newServerMerge.replace(/\r\n/g, '\n'));
    fs.writeFileSync(serverPath, serverCode, 'utf8');
    console.log('[OK] server.js (LF) atualizado com sincronização limpa!');
  } else {
    console.log('[WARN] Trecho de merge no server.js pode ter formato ligeiramente diferente, verificando...');
  }
}
