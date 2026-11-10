const fs = require('fs');
const path = require('path');

const dbPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/database.json';
const bakPath = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/database.json.bak_before_user_reset';

// 1. Fazer backup
const currentDbRaw = fs.readFileSync(dbPath, 'utf8');
fs.writeFileSync(bakPath, currentDbRaw, 'utf8');
console.log('Backup criado em:', bakPath);

const currentDb = JSON.parse(currentDbRaw);

// 2. Extrair credenciais do admin e configurações
const adminCredentials = currentDb.adminCredentials || {
  phone: '11996466498',
  email: 'fas.alves.souza@gmail.com',
  pin: '4546',
  name: 'Administrador Master'
};

const globalSettings = currentDb.globalSettings || {};
const config = currentDb.config || { partnerTokenPrice: 29.9 };

const defaultB2bPlans = {
  plano_starter: {
    id: 'plano_starter',
    nome_plano: 'Starter',
    limite_lojas: 50,
    valor_mensal: 390.00,
    descricao: 'Franquia Starter - Até 50 farmácias/tenants com API ilimitada'
  },
  plano_pro: {
    id: 'plano_pro',
    nome_plano: 'Pro',
    limite_lojas: 150,
    valor_mensal: 890.00,
    descricao: 'Franquia Pro - Até 150 farmácias/tenants com API ilimitada'
  },
  plano_enterprise: {
    id: 'plano_enterprise',
    nome_plano: 'Enterprise',
    limite_lojas: 500,
    valor_mensal: 1990.00,
    descricao: 'Franquia Enterprise - Até 500 farmácias/tenants com SLA prioritário'
  }
};

const freshDb = {
  merchants: {},
  repositores: {},
  products: [],
  partners: {},
  partnerStores: [],
  partnerInvoices: [],
  b2bPlans: defaultB2bPlans,
  globalSettings: globalSettings,
  adminCredentials: adminCredentials,
  config: config,
  payments: {}
};

fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2), 'utf8');
console.log('database.json resetado com sucesso!');
console.log('Resumo do novo database.json:');
console.log('- Lojistas (merchants):', Object.keys(freshDb.merchants).length);
console.log('- Produtos:', freshDb.products.length);
console.log('- Parceiros (partners):', Object.keys(freshDb.partners).length);
console.log('- Lojas de Parceiros (partnerStores):', freshDb.partnerStores.length);
console.log('- Faturas de Parceiros (partnerInvoices):', freshDb.partnerInvoices.length);
console.log('- Pagamentos (payments):', Object.keys(freshDb.payments).length);
console.log('- Usuário Admin Master mantido:', freshDb.adminCredentials.name, freshDb.adminCredentials.phone, freshDb.adminCredentials.email);
