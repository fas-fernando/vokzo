const { generateInvoicePdfBuffer } = require('./invoice-pdf');
const cronEngine = require('./cron-engine');
const {
  registerLog,
  getSystemLogs,
  getSystemLogsPaginated,
  initAuditDatabase,
  insertRepositorSqlite,
  getRepositoresSqlite,
  findRepositorByPhoneSqlite,
  deleteRepositorSqlite
} = require('./audit-logger');
const {
  getFifoDb,
  createRequirePartnerAuth,
  handleProductSync,
  handleProductCheckout
} = require('./b2b-fifo-controller');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DB_FILE = path.join(PUBLIC_DIR, 'database.json');

// Sessões ativas de suporte (Impersonation em nova aba)
const supportSessions = {};

// Inicializa database.json se não existir
if (!fs.existsSync(DB_FILE)) {
  const initialDb = {
    merchants: {},
    repositores: {},
    products: [],
    partners: {},
    partnerStores: [],
    partnerInvoices: [],
    globalSettings: {
      systemName: "Alerta Vencimento",
      systemLogo: "",
      supportPhone: "11996466498",
      supportEmail: "fas.alves.souza@gmail.com",
      retentionDays: 90,
      pixKey: "38032274880",
      pixKeyType: "cpf",
      pixName: "Fernando Alves",
      pixCity: "Caieiras",
      pixTxId: "***",
      pixInstructions: "Após o pagamento, seu acesso será liberado em instantes pelo administrador.",
      pixAmount: "49.90",
      pixAmountAnnual: "199.00",
      pixAmountXml: "19.90",
      xmlModulePrice: "19.90",
      toleranceDays: 3,
      freeLimit: 30,
      systemStatus: "online",
      trialDays: 14,
      alertRedDays: 7,
      alertYellowDays: 30,
      tplBilling: "Olá, {nome_loja}! Seu período de teste no Alerta Vencimento expirou. Para continuar utilizando sem limites, renove por apenas R$ {valor} via Chave PIX: {chave_pix}. Enviamos o comprovante por aqui!",
      tplExpiry: "🚨 *ALERTA DE VENCIMENTO*\nO item *{nome_produto}* está a *{dias_vencer} dias* do vencimento. Acelere a saída para evitar prejuízos!"
    },
    adminCredentials: {
      phone: "11996466498",
      email: "fas.alves.souza@gmail.com",
      pin: "4546",
      name: "Administrador Master"
    },
    config: {
      partnerTokenPrice: 29.90
    }
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
}

const DEFAULT_B2B_PLANS = {
  'plano_starter': {
    id: 'plano_starter',
    nome_plano: 'Starter',
    limite_lojas: 50,
    valor_mensal: 390.00,
    descricao: 'Franquia Starter - Até 50 lojas/PDVs com API ilimitada'
  },
  'plano_pro': {
    id: 'plano_pro',
    nome_plano: 'Pro',
    limite_lojas: 150,
    valor_mensal: 890.00,
    descricao: 'Franquia Pro - Até 150 lojas/PDVs com API ilimitada'
  },
  'plano_enterprise': {
    id: 'plano_enterprise',
    nome_plano: 'Enterprise',
    limite_lojas: 500,
    valor_mensal: 1990.00,
    descricao: 'Franquia Enterprise - Até 500 lojas/PDVs com SLA prioritário'
  }
};

function getB2bPlan(planId, db) {
  if (!planId) return (db && db.b2bPlans && db.b2bPlans['plano_starter']) || DEFAULT_B2B_PLANS['plano_starter'];
  const rawId = String(planId).toLowerCase().trim();

  // 1. Busca exata (ex: 'plano_starter', 'plano_pro', 'plano_enterprise')
  if (db && db.b2bPlans && db.b2bPlans[rawId]) return db.b2bPlans[rawId];
  if (DEFAULT_B2B_PLANS[rawId]) return DEFAULT_B2B_PLANS[rawId];

  // 2. Busca adicionando ou removendo prefixo 'plano_' (ex: 'pro' <-> 'plano_pro')
  const withPrefix = rawId.startsWith('plano_') ? rawId : ('plano_' + rawId);
  const withoutPrefix = rawId.startsWith('plano_') ? rawId.replace('plano_', '') : rawId;
  if (db && db.b2bPlans && db.b2bPlans[withPrefix]) return db.b2bPlans[withPrefix];
  if (DEFAULT_B2B_PLANS[withPrefix]) return DEFAULT_B2B_PLANS[withPrefix];
  if (db && db.b2bPlans && db.b2bPlans[withoutPrefix]) return db.b2bPlans[withoutPrefix];
  if (DEFAULT_B2B_PLANS[withoutPrefix]) return DEFAULT_B2B_PLANS[withoutPrefix];

  // 3. Busca por nome do plano (ex: 'Starter', 'Pro', 'Enterprise')
  const allPlans = Object.assign({}, DEFAULT_B2B_PLANS, (db && db.b2bPlans) || {});
  for (const key of Object.keys(allPlans)) {
    const pl = allPlans[key];
    if (pl && pl.nome_plano && pl.nome_plano.toLowerCase().trim() === rawId) {
      return pl;
    }
  }

  return (db && db.b2bPlans && db.b2bPlans['plano_starter']) || DEFAULT_B2B_PLANS['plano_starter'];
}

function readDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (!data.b2bPlans || Object.keys(data.b2bPlans).length === 0) {
        data.b2bPlans = { ...DEFAULT_B2B_PLANS };
      }
      return data;
    }
  } catch (e) {
    console.error('❌ Erro ao ler database.json:', e.message);
  }
  return { merchants: {}, repositores: {}, products: [], b2bPlans: { ...DEFAULT_B2B_PLANS }, globalSettings: {}, adminCredentials: { phone: "11996466498", pin: "4546" } };
}


function applyDataRetention(db) {
  const retentionDays = parseInt((db.globalSettings && db.globalSettings.retentionDays) || 90, 10);
  if (!Array.isArray(db.products) || retentionDays <= 0) return 0;
  
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const initialCount = db.products.length;

  db.products = db.products.filter(p => {
    if (p.status !== 'baixado' && p.status !== 'resolvido' && p.status !== 'descartado') {
      return true;
    }
    const recordTime = p.resolvedAt ? new Date(p.resolvedAt).getTime() : 
                      (p.expiry ? new Date(p.expiry).getTime() : (typeof p.id === 'number' && p.id > 1000000000 ? p.id : 0));
    if (!recordTime) return false;
    return (now - recordTime) < maxAgeMs;
  });

  const removed = initialCount - db.products.length;
  if (removed > 0) {
    console.log(`🧹 [DATA RETENTION] ${removed} produto(s) antigo(s) resolvido(s) (> ${retentionDays} dias) purgado(s) do banco.`);
    writeDatabase(db);
  }
  return removed;
}

function writeDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('❌ Erro ao escrever em database.json:', e.message);
    return false;
  }
}


// =========================================================================
// MOTOR MERCADO PAGO: INTEGRAÇÃO PIX OFICIAL, WEBHOOKS & APROVAÇÃO AUTOMÁTICA
// =========================================================================
const https = require('https');


// Chamada genérica HTTPS para APIs externas (Asaas, Efí, Mercado Pago)

// =========================================================================
// MOTOR MERCADO PAGO: GESTÃO MULTI-AMBIENTE & CREDENCIAIS SEGURAS
// =========================================================================
function getActiveMpCredentials(settings) {
  const gs = settings || {};
  const env = (gs.mp_environment === 'sandbox' || gs.mpEnvironment === 'sandbox') ? 'sandbox' : 'production';
  const isSandbox = (env === 'sandbox');

  let accessToken = isSandbox
    ? (gs.mp_access_token_test || gs.mpAccessTokenTest || '')
    : (gs.mp_access_token_prod || gs.mpAccessTokenProd || '');

  let publicKey = isSandbox
    ? (gs.mp_public_key_test || gs.mpPublicKeyTest || '')
    : (gs.mp_public_key_prod || gs.mpPublicKeyProd || '');

  // Fallback inteligente para chaves legadas se a chave específica do ambiente não estiver preenchida
  if (!accessToken && gs.mpAccessToken) {
    accessToken = gs.mpAccessToken;
  }
  if (!publicKey && gs.mpPublicKey) {
    publicKey = gs.mpPublicKey;
  }

  return {
    environment: env,
    isSandbox,
    accessToken: (accessToken || '').trim(),
    publicKey: (publicKey || '').trim()
  };
}

function callExternalGatewayApi(hostname, endpoint, method, headers, data) {
  return new Promise((resolve, reject) => {
    const postData = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : '';
    const options = {
      hostname: hostname,
      port: 443,
      path: endpoint,
      method: method,
      headers: Object.assign({
        'Content-Type': 'application/json'
      }, headers || {})
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body || '{}'), raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Timeout de comunicação com o gateway bancário'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

function callMercadoPagoApi(endpoint, method, token, data) {
  return new Promise((resolve) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: 'api.mercadopago.com',
      port: 443,
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `mp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body, data: { message: body } });
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ [MERCADO PAGO HTTPS ERROR]:', err.message);
      resolve({ status: 502, error: err.message, data: { message: err.message } });
    });

    req.setTimeout(12000, () => {
      console.warn('⚠️ [MERCADO PAGO TIMEOUT]: Timeout de 12s ao comunicar com api.mercadopago.com');
      req.destroy();
      resolve({ status: 504, error: 'Timeout ao conectar na API do Mercado Pago', data: { message: 'Timeout na API do Mercado Pago' } });
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// =========================================================================
// GERADOR NATIVO DE PIX ESTÁTICO (PADRÃO BANCO CENTRAL EMVCo / BR CODE)
// =========================================================================
function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, value) {
  const strVal = String(value);
  const len = String(strVal.length).padStart(2, '0');
  return `${id}${len}${strVal}`;
}

function generatePixEmvCo({ key = '38032274880', name = 'Fernando Alves', city = 'Caieiras', amount, txid = '***', description }) {
  const cleanName = (name || 'Fernando Alves').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().substring(0, 25);
  const cleanCity = (city || 'Caieiras').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().substring(0, 15);
  const cleanKey = String(key || '38032274880').trim();
  const cleanTxid = (txid || '***').substring(0, 25);

  let merchantAccountInfo = emvField('00', 'br.gov.bcb.pix') + emvField('01', cleanKey);
  if (description) {
    const cleanDesc = String(description).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().substring(0, 25);
    merchantAccountInfo += emvField('02', cleanDesc);
  }

  let payload = '';
  payload += emvField('00', '01'); // Payload Format Indicator
  payload += emvField('26', merchantAccountInfo); // Merchant Account Information
  payload += emvField('52', '0000'); // Merchant Category Code
  payload += emvField('53', '986'); // Transaction Currency (986 = BRL)
  if (amount && parseFloat(amount) > 0) {
    payload += emvField('54', parseFloat(amount).toFixed(2)); // Transaction Amount
  }
  payload += emvField('58', 'BR'); // Country Code
  payload += emvField('59', cleanName); // Merchant Name
  payload += emvField('60', cleanCity); // Merchant City
  payload += emvField('62', emvField('05', cleanTxid)); // Additional Data Field (TxId)
  payload += '6304'; // CRC16 Tag

  payload += crc16(payload);
  return payload;
}

// Processa a ativação imediata do pagamento aprovado no banco de dados
function processPaymentActivation(payment, db) {
  if (!payment) return false;
  payment.status = 'approved';
  payment.approvedAt = new Date().toISOString();

  const type = payment.type || '';
  console.log(`⚡ [MERCADO PAGO ATIVAÇÃO]: Processando pagamento ${payment.id} de tipo: ${type}`);

  // 1. Lojista PRO Mensal
  if (type === 'merchant_pro_monthly') {
    const phone = cleanDigits(payment.phone || payment.merchantPhone || '');
    if (phone && db.merchants && db.merchants[phone]) {
      const m = db.merchants[phone];
      m.plano = 'premium';
      m.status = 'ativo';
      m.proExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      m.lastPayment = {
        amount: payment.amount,
        date: new Date().toISOString(),
        paymentId: payment.id,
        gateway: 'mercadopago_pix'
      };
      console.log(`🎉 [LOJISTA PRO MENSAL ATIVADO]: ${m.name} (${phone}) virou PRO automaticamente via Mercado Pago!`);
    }
  }

  // 2. Lojista PRO Anual
  else if (type === 'merchant_pro_annual') {
    const phone = cleanDigits(payment.phone || payment.merchantPhone || '');
    if (phone && db.merchants && db.merchants[phone]) {
      const m = db.merchants[phone];
      m.plano = 'premium';
      m.status = 'ativo';
      m.proExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      m.lastPayment = {
        amount: payment.amount,
        date: new Date().toISOString(),
        paymentId: payment.id,
        gateway: 'mercadopago_pix'
      };
      console.log(`🎉 [LOJISTA PRO ANUAL ATIVADO]: ${m.name} (${phone}) virou PRO Anual automaticamente via Mercado Pago!`);
    }
  }

  // 3. Módulo de Importação XML (NF-e)
  else if (type === 'merchant_xml') {
    const phone = cleanDigits(payment.phone || payment.merchantPhone || '');
    if (phone && db.merchants && db.merchants[phone]) {
      const m = db.merchants[phone];
      m.hasXmlImport = true;
      if (m.plano !== 'premium') m.plano = 'automacao';
      m.status = 'ativo';
      m.lastXmlPayment = {
        amount: payment.amount,
        date: new Date().toISOString(),
        paymentId: payment.id,
        gateway: 'mercadopago_pix'
      };
      console.log(`📄 [MÓDULO XML LIBERADO]: ${m.name} (${phone}) teve importação de XML ativada via Mercado Pago!`);
    }
  }

  // 4. Upgrade de Franquia B2B do Parceiro
  else if (type === 'partner_plan_upgrade' || type === 'partner_plan') {
    const pid = payment.partnerId || payment.parceiro_id || '';
    const planId = payment.planId || payment.plano_id || '';
    if (pid && db.partners && db.partners[pid]) {
      const p = db.partners[pid];
      const newPlan = getB2bPlan(planId, db);
      p.plano_id = newPlan.id;
      p.nome_plano = newPlan.nome_plano;
      p.limite_lojas = newPlan.limite_lojas;
      p.valor_mensal = newPlan.valor_mensal;
      p.faturaEstimada = newPlan.valor_mensal;
      p.status = 'ativo';

      // Gera fatura de recibo já com status 'Paga'
      if (!Array.isArray(db.partnerInvoices)) db.partnerInvoices = [];
      const invoiceCode = `FAT-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      db.partnerInvoices.unshift({
        id: invoiceCode,
        partnerId: pid,
        parceiro_id: pid,
        nomePlano: newPlan.nome_plano,
        limiteLojas: newPlan.limite_lojas,
        mesReferencia: `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`,
        lojasCobradas: p.activeStoresCount || p.storesCount || 0,
        valorTotal: payment.amount || newPlan.valor_mensal,
        status: 'Paga',
        dataVencimento: new Date().toISOString().split('T')[0],
        dataPagamento: new Date().toISOString(),
        paymentId: payment.id,
        gateway: 'mercadopago_pix'
      });

      console.log(`🤝 [PARCEIRO UPGRADE ATIVADO]: ${p.name} migrado para ${newPlan.nome_plano} (${newPlan.limite_lojas} Tokens) via Mercado Pago!`);
    }
  }

  // 5. Pagamento de Fatura Mensal do Parceiro
  else if (type === 'partner_invoice') {
    const invId = payment.invoiceId || '';
    if (invId && Array.isArray(db.partnerInvoices)) {
      const inv = db.partnerInvoices.find(i => i.id === invId);
      if (inv) {
        inv.status = 'Paga';
        inv.dataPagamento = new Date().toISOString();
        inv.paymentId = payment.id;
        inv.gateway = 'mercadopago_pix';
        console.log(`💳 [FATURA PARCEIRO PAGA]: Fatura ${invId} marcada como PAGA via Mercado Pago!`);
      }
    }
  }

  writeDatabase(db);
  return true;
}

function cleanDigits(str) {
  return ('' + (str || '')).replace(/\D/g, '');
}

function daysDiff(expiryDate) {
  if (!expiryDate) return 999;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const exp = new Date(expiryDate);
  const diffTime = exp.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};


// =========================================================================
// ARMAZENAMENTO TEMPORÁRIO DE XML (NF-e) COM RETENÇÃO AUTOMÁTICA DE 7 DIAS
// =========================================================================
const XML_UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads', 'xml_nfe');
if (!fs.existsSync(XML_UPLOADS_DIR)) {
  fs.mkdirSync(XML_UPLOADS_DIR, { recursive: true });
}

function cleanupExpiredXmlFiles() {
  try {
    if (!fs.existsSync(XML_UPLOADS_DIR)) return;
    const files = fs.readdirSync(XML_UPLOADS_DIR);
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias em ms
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(XML_UPLOADS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        const ageMs = now - stats.mtimeMs;
        if (ageMs > SEVEN_DAYS_MS) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`🗑️ [ROTINA XML 7 DIAS]: Arquivo apagado: ${file} (Idade: ${(ageMs / (24 * 60 * 60 * 1000)).toFixed(1)} dias)`);
        }
      } catch (fErr) {}
    }

    if (deletedCount > 0) {
      console.log(`✅ [ROTINA XML 7 DIAS]: Limpeza concluída: ${deletedCount} arquivo(s) XML com mais de 7 dias foram apagados do disco.`);
    }
  } catch (err) {
    console.warn('Erro na rotina de limpeza de XML:', err);
  }
}

// Executa limpeza na inicialização e a cada 1 hora
cleanupExpiredXmlFiles();
setInterval(cleanupExpiredXmlFiles, 60 * 60 * 1000);

function handleApiRequest(req, res, pathname) {
      // 1c. POST /api/cleanup-retention - Purga dados antigos de acordo com a política de retenção
  if (pathname === '/api/cleanup-retention' && req.method === 'POST') {
    const db = readDatabase();
    const removed = applyDataRetention(db);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, removed }));
    return true;
  }

  // 1b. GET /api/backup - Download do snapshot completo do banco de dados
  if ((pathname === '/api/backup' || pathname === '/api/backup.json') && req.method === 'GET') {
    const db = readDatabase();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `alerta_vencimento_backup_${dateStr}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(JSON.stringify(db, null, 2));
    return true;
  }

  // 1. GET /api/state - Retorna todo o banco atualizado (sem cache)
  if (pathname === '/api/state' && req.method === 'GET') {
    const db = readDatabase();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(JSON.stringify(db));
    return true;
  }

  const GENERIC_AUTH_ERROR = 'Credenciais inválidas. Verifique os dados e tente novamente.';

  // =========================================================================
  // 2a. POST /auth/parceiro - Autenticação Dedicada de Parceiros B2B (Isolamento Estrito)
  // =========================================================================
  if ((pathname === '/auth/parceiro' || pathname === '/api/auth/parceiro' || pathname === '/api/login/parceiro' || pathname === '/api/parceiro/login') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { phone, cnpj, email, id, tenantId, identifier, pin } = JSON.parse(body || '{}');
        const rawInput = (identifier || phone || cnpj || email || id || tenantId || '').trim();
        const clean = cleanDigits(rawInput);
        const cleanPin = (pin || '').trim();
        const upperInput = rawInput.toUpperCase();

        const db = readDatabase();
        const partners = db.partners || {};
        let foundPartner = null;

        // BUSCA EXCLUSIVA NA TABELA DE PARCEIROS
        for (const pid of Object.keys(partners)) {
          const p = partners[pid];
          if (!p) continue;
          const pPhone = cleanDigits(p.phone || p.telefone || '');
          const pCnpj = cleanDigits(p.cnpj || '');
          const pId = String(p.id || pid || '').toUpperCase();
          const pEmail = (p.email || '').trim().toLowerCase();

          if (
            (clean && (clean === pPhone || clean === pCnpj)) ||
            upperInput === pId ||
            (clean && clean === cleanDigits(pId)) ||
            (rawInput.toLowerCase() === pEmail && pEmail.length > 3)
          ) {
            foundPartner = p;
            break;
          }
        }

        if (!foundPartner) {
          console.log(`❌ [LOGIN PARCEIRO 401]: Falha de autenticação para identificador "${rawInput}".`);
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: GENERIC_AUTH_ERROR }));
          return;
        }

        // Validação estrita de PIN ANTES da checagem de status (evita User Enumeration)
        if ((foundPartner.pin || '4546').trim() !== cleanPin) {
          console.log(`⚠️ [LOGIN PARCEIRO 401]: Falha de autenticação para ${foundPartner.name}.`);
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: GENERIC_AUTH_ERROR
          }));
          return;
        }

        // Validação estrita do status na tabela de Parceiros
        const partnerStatus = String(foundPartner.status || 'ATIVO').trim().toUpperCase();
        if (partnerStatus !== 'ATIVO') {
          console.log(`🚫 [LOGIN PARCEIRO 403]: Parceiro ${foundPartner.name} (${foundPartner.id}) está ${partnerStatus}.`);
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: 'Acesso do parceiro inativo ou bloqueado pelo administrador. Contate o suporte para reativação.',
            code: 'PARTNER_INACTIVE'
          }));
          return;
        }

        const parceiroId = foundPartner.id || 'PARC-001';
        const partnerPlan = getB2bPlan(foundPartner.plano_id || foundPartner.plano || 'plano_starter', db);
        const nomePlano = foundPartner.nome_plano || partnerPlan.nome_plano || 'Starter';
        const limiteLojas = parseInt(foundPartner.limite_lojas || foundPartner.limite_tokens || partnerPlan.limite_lojas || 50, 10);
        const valorMensal = parseFloat(foundPartner.valor_mensal !== undefined ? foundPartner.valor_mensal : partnerPlan.valor_mensal);

        console.log(`🤝 [LOGIN PARCEIRO OK]: ${foundPartner.name} (${parceiroId}) | Plano: ${nomePlano} (${limiteLojas} tokens)`);
        registerLog(parceiroId, 'PARCEIRO', 'LOGIN_PARCEIRO', { nome: foundPartner.name, plano: nomePlano });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          role: 'PARCEIRO',
          redirect: '/dashboard-parceiro',
          token: `token_parc_${parceiroId}_${Date.now().toString(36)}`,
          user: {
            id: parceiroId,
            parceiro_id: parceiroId,
            partnerId: parceiroId,
            name: foundPartner.name || foundPartner.nome || 'Parceiro PDV',
            nome: foundPartner.name || foundPartner.nome || 'Parceiro PDV',
            cnpj: foundPartner.cnpj || '',
            phone: foundPartner.phone || foundPartner.telefone || clean,
            telefone: foundPartner.phone || foundPartner.telefone || clean,
            email: foundPartner.email || '',
            plano_id: foundPartner.plano_id || partnerPlan.id,
            plano: foundPartner.plano_id || partnerPlan.id,
            nome_plano: nomePlano,
            limite_lojas: limiteLojas,
            limite_tokens: limiteLojas,
            valor_mensal: valorMensal,
            role: 'PARCEIRO',
            status: 'ATIVO'
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro interno ao processar login do parceiro: ' + err.message }));
      }
    });
    return true;
  }

  // =========================================================================
  // 2b. POST /auth/admin - Login Secreto / Restrito do Super Admin
  // =========================================================================
  if ((pathname === '/auth/admin' || pathname === '/api/auth/admin' || pathname === '/api/admin/login') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin, phone } = JSON.parse(body || '{}');
        const db = readDatabase();
        const adminPhone = cleanDigits((db.adminCredentials && db.adminCredentials.phone) || '11996466498');
        const adminPin = ((db.adminCredentials && db.adminCredentials.pin) || '4546').trim();
        const cleanPin = (pin || '').trim();

        if (cleanPin === adminPin) {
          console.log('🛡️ [LOGIN ADMIN RESTRITO]: Autenticado com sucesso!');
          registerLog(adminPhone || 'MASTER_ADMIN', 'SUPER_ADMIN', 'LOGIN_SUPER_ADMIN', { status: 'SUCESSO' });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            role: 'ADMIN',
            redirect: '/admin',
            user: {
              phone: adminPhone,
              name: (db.adminCredentials && db.adminCredentials.name) || 'Administrador Master',
              role: 'ADMIN',
              plano: 'master'
            }
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: GENERIC_AUTH_ERROR }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return true;
  }

  // =========================================================================
  // 2c. POST /auth/lojista - Autenticação de Lojistas e Equipe/Repositores (RBAC Estrito)
  // =========================================================================
  if ((pathname === '/auth/lojista' || pathname === '/api/auth/lojista' || pathname === '/api/login') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { phone, pin, identifier } = JSON.parse(body || '{}');
        const rawInput = (identifier || phone || '').trim();
        const clean = cleanDigits(rawInput);
        const cleanPin = (pin || '').trim();

        const db = readDatabase();
        if (!db.merchants) db.merchants = {};
        if (!db.repositores) db.repositores = {};
        if (!db.partners) db.partners = {};

        // 1. ISOLAMENTO ESTREITO: Se for Parceiro, nega com erro 401
        const isPartner = Object.values(db.partners).some(p => {
          if (!p) return false;
          const pPhone = cleanDigits(p.phone || p.telefone || '');
          const pCnpj = cleanDigits(p.cnpj || '');
          const pId = String(p.id || '').toUpperCase();
          return (clean && (clean === pPhone || clean === pCnpj)) || (rawInput.toUpperCase() === pId);
        });

        if (isPartner) {
          console.log(`🚫 [RBAC 401]: Tentativa de acesso cross-role na rota Lojista (${clean || rawInput}).`);
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: GENERIC_AUTH_ERROR
          }));
          return;
        }

        // 2. BUSCA NA TABELA DE LOJISTAS
        let foundMerchant = db.merchants[clean];
        if (!foundMerchant && clean) {
          foundMerchant = Object.values(db.merchants).find(m => {
            return cleanDigits(m.phone || m.telefone || '') === clean || (m.cnpj && cleanDigits(m.cnpj) === clean);
          });
        }

        if (foundMerchant) {
          if ((foundMerchant.pin || '').trim() !== cleanPin) {
            console.log(`⚠️ [LOGIN LOJISTA 401]: Falha de autenticação para ${foundMerchant.name} (${clean})`);
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: GENERIC_AUTH_ERROR }));
            return;
          }

          if (String(foundMerchant.status || 'ativo').toLowerCase() === 'bloqueado') {
            console.log(`🚫 [LOGIN LOJISTA 403]: Lojista ${foundMerchant.name} bloqueado.`);
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: false,
              error: 'Conta do lojista bloqueada pelo administrador. Entre em contato com o suporte.',
              code: 'MERCHANT_BLOCKED'
            }));
            return;
          }

          console.log(`🔑 [LOGIN LOJISTA OK]: ${foundMerchant.name} (${clean}) autenticado! Redirecionando para /dashboard-lojista`);
          registerLog(clean, 'LOJISTA', 'LOGIN_LOJISTA', { nome: foundMerchant.name, plano: foundMerchant.plano || 'free' });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            role: 'LOJISTA',
            redirect: '/dashboard-lojista',
            user: {
              phone: clean,
              name: foundMerchant.name,
              email: foundMerchant.email || '',
              documento: foundMerchant.documento || foundMerchant.cnpj || foundMerchant.cpf || '',
              role: 'LOJISTA',
              plano: foundMerchant.plano || 'free',
              hasXmlImport: !!foundMerchant.hasXmlImport,
              status: foundMerchant.status || 'ativo'
            }
          }));
          return;
        }

        // 3. BUSCA NA TABELA DE REPOSITORES / EQUIPE (SQLite + database.json)
        let foundRepositor = (clean ? findRepositorByPhoneSqlite(clean) : null) || db.repositores[clean];
        if (!foundRepositor && clean) {
          foundRepositor = Object.values(db.repositores).find(r => cleanDigits(r.phone || r.telefone || '') === clean);
        }

        if (foundRepositor) {
          if ((foundRepositor.pin || '').trim() !== cleanPin) {
            console.log(`⚠️ [LOGIN REPOSITOR 401]: Falha de autenticação para ${foundRepositor.name} (${clean})`);
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: GENERIC_AUTH_ERROR }));
            return;
          }

          if (String(foundRepositor.status || 'ativo').toLowerCase() === 'bloqueado') {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: 'Acesso do funcionário bloqueado pelo lojista.' }));
            return;
          }

          console.log(`📦 [LOGIN REPOSITOR OK]: ${foundRepositor.name} (${clean}) autenticado! Redirecionando para /leitor`);
          registerLog(clean, 'REPOSITOR', 'LOGIN_REPOSITOR', { nome: foundRepositor.name, storeOwnerPhone: foundRepositor.storeOwnerPhone || foundRepositor.tenantId });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            role: 'REPOSITOR',
            redirect: '/leitor',
            user: {
              phone: clean,
              name: foundRepositor.name,
              role: 'REPOSITOR',
              storeOwnerPhone: foundRepositor.storeOwnerPhone || foundRepositor.tenantId,
              storeName: foundRepositor.storeName || 'Estoque',
              status: foundRepositor.status || 'ativo'
            }
          }));
          return;
        }

        // 4. NÃO ENCONTRADO EM LOJISTAS NEM REPOSITORES
        console.log(`❌ [LOGIN 401]: Falha de autenticação para ${rawInput || clean}`);
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: GENERIC_AUTH_ERROR
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro interno ao autenticar: ' + err.message }));
      }
    });
    return true;
  }

  // 2b. GET /api/repositores - Lista os repositores de uma loja direto do SQLite (com sync legado)
  if ((pathname === '/api/repositores' || pathname === '/api/v1/repositores') && req.method === 'GET') {
    const db = readDatabase();
    if (!db.repositores) db.repositores = {};
    const urlObj = new URL(req.url, 'http://localhost');
    const tenantId = cleanDigits(urlObj.searchParams.get('tenantId') || urlObj.searchParams.get('storeId') || '');

    // Migra eventuais registros legados do JSON para o SQLite se ainda não estiverem lá
    const existingSqlite = getRepositoresSqlite('') || [];
    const existingPhones = new Set(existingSqlite.map(r => cleanDigits(r.phone)));
    Object.values(db.repositores).forEach(r => {
      if (r && r.phone && !existingPhones.has(cleanDigits(r.phone))) {
        insertRepositorSqlite({
          phone: cleanDigits(r.phone),
          pin: r.pin || '1234',
          name: r.name || 'Repositor',
          tenantId: cleanDigits(r.tenantId || ''),
          storeName: r.storeName || 'Seu Mercado',
          status: r.status || 'ativo',
          createdAt: r.createdAt
        });
      }
    });

    const sqliteList = getRepositoresSqlite(tenantId);
    const list = Array.isArray(sqliteList)
      ? sqliteList
      : Object.values(db.repositores).filter(r => !tenantId || cleanDigits(r.tenantId) === tenantId);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, repositores: list }));
    return true;
  }

  // 2c. POST /api/repositores - Cadastra repositor no SQLite e retorna status 200
  if ((pathname === '/api/repositores' || pathname === '/api/v1/repositores') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { tenantId, storeId, phone, pin, name } = JSON.parse(body || '{}');
        const cleanPhone = cleanDigits(phone);
        const cleanPin = (pin || '').trim();
        const cleanTenant = cleanDigits(tenantId || storeId);

        if (!cleanPhone || cleanPhone.length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Informe um WhatsApp válido para o Repositor com DDD.' }));
          return;
        }

        if (!cleanPin || cleanPin.length !== 4) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'O PIN do Repositor deve ter exatamente 4 dígitos numéricos.' }));
          return;
        }

        if (!cleanTenant) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Identificador da loja (tenantId) não informado.' }));
          return;
        }

        const db = readDatabase();
        if (!db.repositores) db.repositores = {};

        const merchant = (db.merchants && db.merchants[cleanTenant]) || {};
        const storeName = merchant.name || 'Seu Mercado';
        const createdAt = db.repositores[cleanPhone] ? db.repositores[cleanPhone].createdAt : new Date().toISOString();

        const repRecord = {
          phone: cleanPhone,
          pin: cleanPin,
          name: (name || 'Repositor').trim(),
          tenantId: cleanTenant,
          storeName: storeName,
          status: 'ativo',
          createdAt: createdAt
        };

        // 1. Executa INSERT OR REPLACE na tabela Repositores do SQLite
        const sqliteResult = insertRepositorSqlite(repRecord);
        if (!sqliteResult || sqliteResult.changes === 0) {
          console.warn('⚠️ [SQLITE REPOSITORES]: Fallback ou aviso no INSERT:', sqliteResult);
        }

        // 2. Mantém espelho no database.json
        db.repositores[cleanPhone] = repRecord;
        writeDatabase(db);

        // 3. Registra na trilha de auditoria (System_Logs)
        registerLog(cleanTenant, 'LOJISTA', 'CREATE_REPOSITOR', {
          repositor_phone: cleanPhone,
          nome: repRecord.name,
          loja: storeName
        });

        // Mensagem de Boas-Vindas Oficial
        const hostHeader = req.headers.host || ('localhost:' + PORT);
        const systemUrl = `http://${hostHeader}`;
        const welcomeMessage = `Fala! O *${storeName}* liberou seu acesso ao Scanner de Validade. Seu PIN é: *${cleanPin}*. Acesse o sistema por aqui: ${systemUrl}`;

        console.log(`📲 [REPOSITOR SALVO NO SQLITE]: ${cleanPhone} da loja "${storeName}"`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          changes: sqliteResult ? sqliteResult.changes : 1,
          repositor: repRecord,
          welcomeMessage: welcomeMessage,
          whatsappUrl: `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(welcomeMessage)}`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro interno ao salvar repositor: ' + err.message }));
      }
    });
    return true;
  }

  // 2d. DELETE /api/repositores - Revoga/remove acesso de repositor do SQLite e database.json
  if ((pathname === '/api/repositores' || pathname === '/api/v1/repositores') && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { phone, tenantId, storeId } = JSON.parse(body || '{}');
        const cleanPhone = cleanDigits(phone);
        const cleanTenant = cleanDigits(tenantId || storeId);

        const sqliteDel = deleteRepositorSqlite(cleanPhone, cleanTenant);
        const db = readDatabase();
        let jsonDeleted = false;
        if (db.repositores && db.repositores[cleanPhone]) {
          if (!cleanTenant || cleanDigits(db.repositores[cleanPhone].tenantId) === cleanTenant) {
            delete db.repositores[cleanPhone];
            writeDatabase(db);
            jsonDeleted = true;
          }
        }

        if ((sqliteDel && sqliteDel.changes > 0) || jsonDeleted) {
          registerLog(cleanTenant || 'LOJISTA', 'LOJISTA', 'DELETE_REPOSITOR', { repositor_phone: cleanPhone });
          console.log(`🗑️ [REPOSITOR REMOVIDO DO SQLITE]: ${cleanPhone} (Loja: ${cleanTenant})`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, changes: (sqliteDel && sqliteDel.changes) || 1 }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Repositor não encontrado para esta loja.' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro ao remover repositor.' }));
      }
    });
    return true;
  }

  // 2e. GET /api/capital-parado - Monitor de Capital Parado (Query de Estoque Ocioso > X dias)
  if (pathname === '/api/capital-parado' && req.method === 'GET') {
    const db = readDatabase();
    const urlObj = new URL(req.url, 'http://localhost');
    const tenantId = cleanDigits(urlObj.searchParams.get('tenantId') || '');
    const merchant = (db.merchants && db.merchants[tenantId]) || {};
    const configuredDays = parseInt(urlObj.searchParams.get('days') || merchant.capitalParadoDays || 90, 10);

    const now = Date.now();
    const allProducts = Array.isArray(db.products) ? db.products : [];

    const slowMovingProducts = allProducts.filter(p => {
      const owner = cleanDigits(p.ownerPhone || '11987654321');
      if (tenantId && owner !== tenantId) return false;
      const isActive = (p.status !== 'baixado' && p.status !== 'resolvido' && p.status !== 'descartado');
      if (!isActive) return false;

      const regDateStr = p.data_cadastro || p.createdAt || p.data_ultima_movimentacao || (p.id ? new Date(p.id).toISOString() : null);
      let regTime = regDateStr ? new Date(regDateStr).getTime() : now;
      if (isNaN(regTime)) regTime = now;

      const idleDays = Math.max(0, Math.floor((now - regTime) / (1000 * 60 * 60 * 24)));
      p._idleDays = idleDays;
      return idleDays >= configuredDays;
    }).map(p => ({
      id: p.id,
      name: p.name,
      batch: p.batch || 'S/L',
      expiry: p.expiry,
      data_cadastro: p.data_cadastro || p.createdAt || new Date(p.id || now).toISOString(),
      data_ultima_movimentacao: p.data_ultima_movimentacao || p.data_cadastro || p.createdAt || new Date().toISOString(),
      idleDays: p._idleDays,
      ownerPhone: p.ownerPhone
    }));

    slowMovingProducts.sort((a, b) => b.idleDays - a.idleDays);

    console.log(`⏱️ [CAPITAL PARADO]: Query executada para Tenant "${tenantId || 'Todos'}". Encontrados ${slowMovingProducts.length} itens parados há mais de ${configuredDays} dias.`);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      tenantId: tenantId,
      thresholdDays: configuredDays,
      count: slowMovingProducts.length,
      products: slowMovingProducts
    }));
    return true;
  }

  // 2f. POST /api/cron/daily-alerts - Disparo manual/teste do cron de alertas diários
  if (pathname === '/api/cron/daily-alerts' && req.method === 'POST') {
    cronEngine.runDailyRedAlerts().then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return true;
  }

  // 2g. POST /api/cron/monthly-roi - Disparo manual/teste do recibo de ROI mensal
  if (pathname === '/api/cron/monthly-roi' && req.method === 'POST') {
    cronEngine.runMonthlyRoiRecap().then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return true;
  }



  // =========================================================================
  // ENDPOINTS REST DA API v1 B2B PARA PDVs (BLINDAGEM x-api-key + FIFO SQLite)
  // =========================================================================
  const requirePartnerAuth = createRequirePartnerAuth(readDatabase);

  // 1. GET /api/v1/products/alerts - Consumo de Alertas (SQLite Lotes + Flag de HARD BLOCK)
  if ((pathname === '/api/v1/products/alerts' || pathname === '/api/v1/alerts') && req.method === 'GET') {
    let authorized = false;
    requirePartnerAuth(req, res, () => { authorized = true; });
    if (!authorized) return true;

    const store = req.store;
    const db = readDatabase();
    const stDb = (db.partnerStores || []).find(s => s.id === req.store_id || s.tenant_id === req.store_id);
    if (stDb) {
      stDb.requisicoesMes = (parseInt(stDb.requisicoesMes) || 0) + 1;
      writeDatabase(db);
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const alerts = [];

    // Busca lotes ativos direto do SQLite (Produtos_Lotes) para este tenant_id
    try {
      const fdb = getFifoDb();
      const sqliteLotes = fdb.prepare(`
        SELECT id, codigo_barras, nome, lote, data_validade, quantidade, preco_unitario
        FROM Produtos_Lotes
        WHERE tenant_id = ? AND quantidade > 0
        ORDER BY data_validade ASC
      `).all(req.store_id);

      for (const l of sqliteLotes) {
        const diff = daysDiff(l.data_validade);
        if (diff <= 30) {
          const isHardBlock = diff <= 0;
          alerts.push({
            id: l.id,
            ean: l.codigo_barras,
            codigo_barras: l.codigo_barras,
            name: l.nome,
            batch: l.lote || 'LT-PDV',
            quantity: l.quantidade,
            unit_price: parseFloat(l.preco_unitario || 0),
            expiry_date: l.data_validade,
            days_remaining: diff,
            alert_level: isHardBlock ? 'vencido' : (diff <= 7 ? 'vermelho' : 'amarelo'),
            hard_block: isHardBlock,
            action: isHardBlock ? 'BLOQUEAR_VENDA' : 'ALERTA_APROXIMACAO',
            sanitary_status: isHardBlock ? 'PROIBIDO_VENDA_ANVISA' : 'PERMITIDO_COM_ALERTA',
            instruction: isHardBlock
              ? 'BLOQUEIO FÍSICO OBRIGATÓRIO: Produto com validade expirada. Impedir leitura no checkout.'
              : `Alerta Comercial: Validade expira em ${diff} dias. Aplicar desconto ou priorizar na gôndola.`
          });
        }
      }
    } catch (e) {}

    alerts.sort((a, b) => a.days_remaining - b.days_remaining);
    const hardBlocksCount = alerts.filter(a => a.hard_block).length;
    console.log(`🛡️ [API v1 ALERTS]: ${store.name} (${req.store_id}) consultou alertas. Total: ${alerts.length} | Hard Blocks: ${hardBlocksCount}`);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      tenant_id: req.store_id,
      store_name: store.name,
      timestamp: new Date().toISOString(),
      today: todayStr,
      total_alerts: alerts.length,
      hard_blocks_count: hardBlocksCount,
      requires_immediate_action: hardBlocksCount > 0,
      products: alerts
    }));
    return true;
  }

  // 2. POST /api/v1/products/sync - Entrada / Upsert de Lotes no SQLite com requirePartnerAuth
  if ((pathname === '/api/v1/products/sync' || pathname === '/api/v1/sync') && req.method === 'POST') {
    let authorized = false;
    requirePartnerAuth(req, res, () => { authorized = true; });
    if (!authorized) return true;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        handleProductSync(req, res, payload, { readDatabase, writeDatabase });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Payload JSON inválido: ' + err.message }));
      }
    });
    return true;
  }

  // 3. POST /api/v1/products/checkout - Saída Inteligente por FIFO (data_validade ASC) com Transação SQLite
  if ((pathname === '/api/v1/products/checkout' || pathname === '/api/v1/checkout') && req.method === 'POST') {
    let authorized = false;
    requirePartnerAuth(req, res, () => { authorized = true; });
    if (!authorized) return true;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        handleProductCheckout(req, res, payload, { readDatabase, writeDatabase });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Payload JSON inválido: ' + err.message }));
      }
    });
    return true;
  }

    // =========================================================================
  // MÓDULO PARCEIRO B2B: ROTAS REST DE GESTÃO, SANDBOX E INVOICES (FRANQUIA FIXA)
  // =========================================================================

  // A. GET /api/partner/dashboard - Métricas consolidadas do parceiro (Franquia Fixa B2B)
  if (pathname === '/api/partner/dashboard' && req.method === 'GET') {
    const db = readDatabase();
    const urlObj = new URL(req.url, 'http://localhost');
    const partnerId = (urlObj.searchParams.get('partnerId') || urlObj.searchParams.get('parceiro_id') || '').trim();
    const partnersMap = db.partners || {};
    const pIdUpper = partnerId.toUpperCase();
    const pIdDigits = cleanDigits(partnerId);

    const foundPartner = partnersMap[partnerId] || Object.values(partnersMap).find(x =>
      x && (
        String(x.id || '').toUpperCase() === pIdUpper ||
        (pIdDigits && cleanDigits(x.phone || '') === pIdDigits) ||
        (pIdDigits && cleanDigits(x.cnpj || '') === pIdDigits)
      )
    );

    const partner = foundPartner || {
      id: partnerId || 'PARC-001',
      name: 'Parceiro Integrador PDV',
      cnpj: '',
      plano_id: 'plano_starter'
    };

    const partnerPlan = getB2bPlan(partner.plano_id || partner.plano || 'plano_starter', db);
    const planName = partner.nome_plano || partnerPlan.nome_plano || 'Starter';
    const planLimit = parseInt(partner.limite_tokens || partner.limite_lojas || partnerPlan.limite_lojas || 50, 10);
    const planPrice = parseFloat(partner.valor_mensal !== undefined ? partner.valor_mensal : partnerPlan.valor_mensal);

    const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
    const pIdNorm = String(partnerId || '').toUpperCase().trim();
    const stores = partnerId ? allStores.filter(s => {
      const sp = String(s.partnerId || s.parceiro_id || '').toUpperCase().trim();
      return sp === pIdNorm || sp === String(partner.id || '').toUpperCase().trim();
    }) : [];
    const activeStores = stores.filter(s => s.status === 'ativo' || !s.status);

    const totalReqs = stores.reduce((sum, s) => sum + (parseInt(s.requisicoesMes) || 0), 0);
    const faturaEstimada = planPrice; // Franquia fixa mensal, sem multiplicação unitária

    const allInvoices = Array.isArray(db.partnerInvoices) ? db.partnerInvoices : [];
    const invoices = partnerId ? allInvoices.filter(inv => inv.partnerId === partnerId || inv.parceiro_id === partnerId) : [];

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      partner: {
        ...partner,
        plano_id: partnerPlan.id,
        nome_plano: planName,
        limite_lojas: planLimit,
        valor_mensal: planPrice
      },
      plano: {
        id: partnerPlan.id,
        nome_plano: planName,
        limite_lojas: planLimit,
        valor_mensal: planPrice
      },
      plano_texto: `Plano: ${planName} | Uso: ${activeStores.length} / ${planLimit} Tokens`,
      totalLojasAtivas: activeStores.length,
      totalLojasGeral: stores.length,
      limiteLojas: planLimit,
      requisicoesMes: totalReqs,
      valorUnitario: planPrice,
      faturaAtualEstimada: faturaEstimada,
      stores: stores,
      lojas: stores,
      invoices: invoices,
      faturas: invoices,
      metrics: {
        totalStores: activeStores.length,
        totalRequestsMonth: totalReqs,
        estimatedInvoiceAmount: faturaEstimada
      }
    }));
    return true;
  }

  // B1. GET /api/partner/lojas - Lista lojas/tenants vinculadas a um parceiro
  if (pathname === '/api/partner/lojas' && req.method === 'GET') {
    const db = readDatabase();
    const urlObj = new URL(req.url, 'http://localhost');
    const pId = urlObj.searchParams.get('partnerId') || urlObj.searchParams.get('parceiro_id') || '';
    const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
    const stores = pId ? allStores.filter(s => s.partnerId === pId || s.parceiro_id === pId) : allStores;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, lojas: stores, stores: stores }));
    return true;
  }

  // B2. POST /api/partner/lojas - Cadastra nova loja com validação de Quota do Plano (Trava 403)
  if (pathname === '/api/partner/lojas' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { partnerId, parceiro_id, partner_id, name, nome_loja, cnpj } = payload;
        const cleanName = (name || nome_loja || '').trim();
        const cleanCnpj = (cnpj || '').trim();

        const headerPartner = req.headers['x-parceiro-id'] || req.headers['x-partner-id'] || '';
        const resolvedPartnerId = (partnerId || parceiro_id || partner_id || headerPartner || '').trim();

        if (!cleanName || !cleanCnpj) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Nome da loja e CNPJ são obrigatórios.' }));
          return;
        }

        const db = readDatabase();

        let targetPartnerId = resolvedPartnerId;
        if (!targetPartnerId && db.partners) {
          const keys = Object.keys(db.partners);
          if (keys.length === 1) targetPartnerId = keys[0];
          else targetPartnerId = 'PARC-001';
        }

        const partner = db.partners && db.partners[targetPartnerId];

        // 1. Trava 403 se parceiro bloqueado (Soft Lock)
        if (partner && (partner.status === 'bloqueado' || partner.status === 'inativo')) {
          console.log(`🚫 [API BLOQUEADA 403 FORBIDDEN]: Parceiro ${targetPartnerId} está bloqueado.`);
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: 'Parceiro bloqueado pelo administrador. Cadastro de lojas e geração de tokens suspensos.',
            code: 'PARTNER_BLOCKED'
          }));
          return;
        }

        // 2. Trava 403 se o limite de lojas do plano foi atingido (Quota Gate)
        const partnerPlan = getB2bPlan(partner ? partner.plano_id : 'plano_starter', db);
        const planLimit = parseInt((partner && partner.limite_lojas) || (partnerPlan && partnerPlan.limite_lojas) || 50, 10);
        const currentActiveStores = (Array.isArray(db.partnerStores) ? db.partnerStores : []).filter(s =>
          (s.partnerId === targetPartnerId || s.parceiro_id === targetPartnerId) &&
          (s.status === 'ativo' || !s.status)
        );

        if (currentActiveStores.length >= planLimit) {
          console.log(`🚫 [LIMITE DO PLANO ATINGIDO 403]: Parceiro ${targetPartnerId} atingiu limite de ${currentActiveStores.length}/${planLimit} lojas.`);
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: 'Limite do plano atingido. Faça upgrade.',
            message: `Limite do plano atingido (${currentActiveStores.length}/${planLimit} lojas). Faça upgrade para cadastrar novas lojas.`,
            code: 'PLAN_LIMIT_REACHED',
            current: currentActiveStores.length,
            limit: planLimit,
            plano: partnerPlan.nome_plano
          }));
          return;
        }

        if (!Array.isArray(db.partnerStores)) db.partnerStores = [];

        // Geração segura de Tenant_ID único e API_Key criptográfica
        const crypto = require('crypto');
        const randId = crypto.randomBytes(3).toString('hex').toUpperCase();
        const secretKey = crypto.randomBytes(16).toString('hex');
        const tenantId = `TNT-${randId}`;
        const apiKey = `ak_live_${secretKey}`;

        const newStore = {
          id: tenantId,
          tenant_id: tenantId,
          parceiro_id: targetPartnerId,     // Foreign Key explícita no SQLite
          partnerId: targetPartnerId,       // Compatibilidade
          name: cleanName,
          nome_loja: cleanName,
          cnpj: cleanCnpj,
          apiKey: apiKey,
          api_key: apiKey,
          status: 'ativo',
          requisicoesMes: 0,
          requisicoes_mes: 0,
          createdAt: new Date().toISOString(),
          data_cadastro: new Date().toISOString()
        };

        db.partnerStores.unshift(newStore);

        // Atualiza contadores no objeto parceiro de forma calculada e precisa
        if (db.partners && db.partners[targetPartnerId]) {
          const p = db.partners[targetPartnerId];
          const activeForPartner = db.partnerStores.filter(s => (s.partnerId === targetPartnerId || s.parceiro_id === targetPartnerId) && (s.status === 'ativo' || !s.status));
          p.storesCount = activeForPartner.length;
          p.activeStoresCount = activeForPartner.length;
        }

        writeDatabase(db);

        console.log(`🏪 [NOVO TENANT CRIADO]: ${newStore.name} (Tenant: ${tenantId}, Parceiro: ${targetPartnerId}, Uso: ${currentActiveStores.length + 1}/${planLimit})`);

        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          loja: newStore,
          store: newStore,
          tenant: newStore,
          uso_franquia: `${currentActiveStores.length + 1} / ${planLimit} Tokens`
        }));
      } catch (err) {
        console.error('Erro ao criar loja do parceiro:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha interna ao cadastrar loja.' }));
      }
    });
    return true;
  }

  // Rota para Bloquear / Desbloquear Loja do Parceiro (Atualiza status e recalcula tokens)
  if ((pathname === '/api/partner/stores/toggle-block' || pathname === '/api/partner/lojas/status') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { storeId, partnerId, blocked } = JSON.parse(body || '{}');
        const db = readDatabase();
        const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
        const store = allStores.find(s => s.id === storeId || String(s.id) === String(storeId));

        if (!store) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Loja não encontrada.' }));
          return;
        }

        const newStatus = blocked ? 'bloqueado' : 'ativo';
        store.status = newStatus;
        store.bloqueado_em = blocked ? new Date().toISOString() : null;

        const targetPartnerId = partnerId || store.partnerId || store.parceiro_id;
        const activeForPartner = allStores.filter(s => (s.partnerId === targetPartnerId || s.parceiro_id === targetPartnerId) && (s.status === 'ativo' || !s.status));

        if (db.partners && db.partners[targetPartnerId]) {
          db.partners[targetPartnerId].storesCount = activeForPartner.length;
          db.partners[targetPartnerId].activeStoresCount = activeForPartner.length;
        }

        writeDatabase(db);
        console.log(`🔒 [LOJA ${blocked ? 'BLOQUEADA' : 'DESBLOQUEADA'}]: ${store.name} (${store.id}). Tokens ativos restantes: ${activeForPartner.length}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          storeId: store.id,
          status: newStatus,
          activeStoresCount: activeForPartner.length,
          tokensEmUso: activeForPartner.length,
          message: blocked ? 'Loja bloqueada com sucesso. Token liberado.' : 'Loja reativada com sucesso.'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // Rota de Health Check / Status da API v1
  if ((pathname === '/api/v1/status' || pathname === '/api/v1/health') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'online',
      version: 'v1.4',
      api_name: 'VOKZO B2B Engine',
      server_time: new Date().toISOString(),
      latency_ms: 12
    }));
    return true;
  }

    // C. POST /api/partner/simulator - Simulador de Webhook / API Sandbox
  if (pathname === '/api/partner/simulator' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { tenantId, ean, partnerId } = JSON.parse(body || '{}');
        const db = readDatabase();
        const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
        const store = allStores.find(s => s.id === tenantId) || { id: tenantId, name: 'Drogaria Teste Sandbox' };

        const mockProducts = [
          { name: 'Dipirona Monoidratada 500mg 20 Comprimidos', validade: '2026-11-20', diasVencer: 13, lote: 'LT-884102', cor: 'amarelo' },
          { name: 'Amoxicilina + Clavulanato 875mg 14 Comprimidos', validade: '2026-11-10', diasVencer: 3, lote: 'LT-110294', cor: 'vermelho' },
          { name: 'Paracetamol 750mg 20 Comprimidos', validade: '2027-04-15', diasVencer: 159, lote: 'LT-492011', cor: 'verde' }
        ];

        const chosenProd = mockProducts[Math.floor(Math.random() * mockProducts.length)];
        const simulatedPayload = {
          webhook_event: 'inventory.product_scanned',
          timestamp: new Date().toISOString(),
          tenant_id: store.id,
          store_name: store.name,
          ean: ean || '7896004701234',
          product: chosenProd.name,
          lote: chosenProd.lote,
          validade: chosenProd.validade,
          dias_ate_vencimento: chosenProd.diasVencer,
          classificacao_risco: chosenProd.cor.toUpperCase(),
          acao_recomendada: chosenProd.cor === 'vermelho' ? 'PRIORIDADE_IMEDIATA_PROMOVER_DESCONTO' : (chosenProd.cor === 'amarelo' ? 'MONITORAR_ESTOQUE' : 'NENHUMA_ACAO_NECESSARIA'),
          api_response_status: 200,
          api_response_message: 'Notificação recebida com sucesso. Sincronização em tempo real realizada.'
        };

        if (store.id) {
          const idx = allStores.findIndex(s => s.id === store.id);
          if (idx !== -1) {
            allStores[idx].requisicoesMes = (parseInt(allStores[idx].requisicoesMes) || 0) + 1;
            writeDatabase(db);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          status: 'ok',
          data: simulatedPayload,
          message: 'Webhook simulado com sucesso! Conexão de API operacional.'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha ao processar simulador.' }));
      }
    });
    return true;
  }

  // D. GET /api/partner/invoices - Lista faturas
  if (pathname === '/api/partner/invoices' && req.method === 'GET') {
    const db = readDatabase();
    const urlObj = new URL(req.url, 'http://localhost');
    const partnerId = urlObj.searchParams.get('partnerId') || '';

    const allInvoices = Array.isArray(db.partnerInvoices) ? db.partnerInvoices : [];
    const list = allInvoices.filter(inv => !partnerId || inv.partnerId === partnerId || inv.parceiro_id === partnerId);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, invoices: list }));
    return true;
  }

  // E. GET /api/partner/invoices/pdf - Download de Fatura em PDF Oficial (Franquia Fixa B2B)
  if ((pathname === '/api/partner/invoices/pdf' || pathname.startsWith('/api/partner/invoices/download')) && req.method === 'GET') {
    const db = readDatabase();
    const urlObj = new URL(req.url, 'http://localhost');
    const invoiceId = urlObj.searchParams.get('id') || 'FAT-2026-11-001';
    const partnerId = urlObj.searchParams.get('partnerId') || 'PARC-001';

    const partner = (db.partners && db.partners[partnerId]) || {
      id: partnerId || 'PARC-001',
      name: 'Parceiro PDV',
      cnpj: '',
      email: '',
      plano_id: 'plano_starter'
    };

    const partnerPlan = getB2bPlan(partner.plano_id || 'plano_starter', db);
    const planName = partner.nome_plano || partnerPlan.nome_plano || 'Starter';
    const planLimit = parseInt(partner.limite_lojas || partnerPlan.limite_lojas || 50, 10);
    const planMonthlyPrice = parseFloat(partner.valor_mensal !== undefined ? partner.valor_mensal : partnerPlan.valor_mensal);

    const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
    const stores = allStores.filter(s => !partnerId || s.partnerId === partnerId || s.parceiro_id === partnerId);
    const activeStores = stores.filter(s => s.status === 'ativo');

    const allInvoices = Array.isArray(db.partnerInvoices) ? db.partnerInvoices : [];
    const invoice = allInvoices.find(i => i.id === invoiceId) || allInvoices[0] || {
      id: invoiceId,
      mesReferencia: 'Novembro / 2026',
      nome_plano: planName,
      limite_lojas: planLimit,
      lojasCobradas: activeStores.length,
      valor_mensal: planMonthlyPrice,
      valorTotal: planMonthlyPrice,
      status: 'Pendente/Aberta',
      dataVencimento: '15/11/2026'
    };

    invoice.nome_plano = invoice.nome_plano || planName;
    invoice.limite_lojas = invoice.limite_lojas || planLimit;
    invoice.valor_mensal = invoice.valor_mensal !== undefined ? invoice.valor_mensal : planMonthlyPrice;
    invoice.valorTotal = invoice.valor_mensal;
    partner.nome_plano = planName;
    partner.limite_lojas = planLimit;
    partner.valor_mensal = planMonthlyPrice;

    try {
      const pdfBuffer = generateInvoicePdfBuffer(invoice, partner, stores);

      console.log(`📄 [FATURA PDF GERADA]: Fatura ${invoice.id} gerada para ${partner.name}. Franquia: ${planName} (R$ ${planMonthlyPrice.toFixed(2)}). Tamanho: ${pdfBuffer.length} bytes`);

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Fatura-${invoice.id}.pdf"`,
        'Content-Length': pdfBuffer.length,
        'Cache-Control': 'no-cache'
      });
      res.end(pdfBuffer);
      return true;
    } catch (pdfErr) {
      console.error('Erro ao gerar PDF da fatura:', pdfErr);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Erro ao gerar fatura em PDF.' }));
      return true;
    }
  }

  
  // =========================================================================
  // ROTAS MERCADO PAGO (PIX INTEGRADO, STATUS & WEBHOOK)
  // =========================================================================

  // 1. POST /api/payments/create-pix - Cria cobrança PIX no Mercado Pago
  
  // 1.1 POST /api/payments/create-card - Processamento de Cartão de Crédito Multi-Gateway
    // =========================================================================
  // CONFIGURAÇÕES DE GATEWAY DE PAGAMENTO: MULTI-AMBIENTE (PRODUÇÃO & SANDBOX)
  // Rota dedicada: PUT & POST /api/v1/settings/gateway
  // =========================================================================
  // =========================================================================
  // CONFIGURAÇÕES DE PIX ESTÁTICO (CHAVE PIX, RECEBEDOR, WHATSAPP, VALORES)
  // Rota dedicada: PUT & POST /api/v1/settings/pix-static (e aliases)
  // =========================================================================
  if ((pathname === '/api/v1/settings/pix-static' || pathname === '/api/settings/pix-static' || pathname === '/api/v1/settings/gateway' || pathname === '/api/settings/gateway') && (req.method === 'PUT' || req.method === 'POST')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const db = readDatabase();
        if (!db.globalSettings) db.globalSettings = {};
        const gs = db.globalSettings;

        if (data.pixKey !== undefined) gs.pixKey = String(data.pixKey).trim();
        if (data.pix_key !== undefined) gs.pixKey = String(data.pix_key).trim();
        if (data.pixKeyType !== undefined) gs.pixKeyType = String(data.pixKeyType).trim();
        if (data.pix_key_type !== undefined) gs.pixKeyType = String(data.pix_key_type).trim();
        if (data.pixName !== undefined) gs.pixName = String(data.pixName).trim();
        if (data.pix_name !== undefined) gs.pixName = String(data.pix_name).trim();
        if (data.pixCity !== undefined) gs.pixCity = String(data.pixCity).trim();
        if (data.pix_city !== undefined) gs.pixCity = String(data.pix_city).trim();
        if (data.pixTxId !== undefined) gs.pixTxId = String(data.pixTxId).trim();
        if (data.pix_txid !== undefined) gs.pixTxId = String(data.pix_txid).trim();
        if (data.supportPhone !== undefined) gs.supportPhone = cleanDigits(data.supportPhone);
        if (data.pixWhatsapp !== undefined) gs.supportPhone = cleanDigits(data.pixWhatsapp);
        if (data.pixInstructions !== undefined) gs.pixInstructions = String(data.pixInstructions).trim();

        if (data.pixAmount !== undefined) gs.pixAmount = parseFloat(data.pixAmount).toFixed(2);
        if (data.pixAmountAnnual !== undefined) gs.pixAmountAnnual = parseFloat(data.pixAmountAnnual).toFixed(2);
        if (data.pixAmountXml !== undefined) {
          gs.pixAmountXml = parseFloat(data.pixAmountXml).toFixed(2);
          gs.xmlModulePrice = gs.pixAmountXml;
        }

        // Garante operação 100% via PIX Estático nativo
        gs.activeGateway = 'pix_static';
        gs.enablePix = true;
        gs.enableCreditCard = false;

        writeDatabase(db);

        console.log(`⚡ [CONFIGURAÇÃO PIX ESTÁTICO SALVA]: Chave=${gs.pixKey} | Titular=${gs.pixName} | Cidade=${gs.pixCity} | WhatsApp=${gs.supportPhone}`);
        registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'UPDATE_CONFIG_PIX', { chave: gs.pixKey, titular: gs.pixName, cidade: gs.pixCity });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          message: 'Configurações de PIX Estático salvas com sucesso no servidor!',
          settings: {
            pixKey: gs.pixKey,
            pixKeyType: gs.pixKeyType || 'cpf',
            pixName: gs.pixName,
            pixCity: gs.pixCity,
            pixTxId: gs.pixTxId || '***',
            supportPhone: gs.supportPhone,
            pixInstructions: gs.pixInstructions,
            pixAmount: gs.pixAmount,
            pixAmountAnnual: gs.pixAmountAnnual,
            pixAmountXml: gs.pixAmountXml
          }
        }));
      } catch (err) {
        console.error('Erro ao atualizar configurações de PIX:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // GET /api/v1/settings/pix-static - Consulta das Configurações de PIX
  if ((pathname === '/api/v1/settings/pix-static' || pathname === '/api/settings/pix-static' || pathname === '/api/v1/settings/gateway' || pathname === '/api/settings/gateway') && req.method === 'GET') {
    const db = readDatabase();
    const gs = db.globalSettings || {};

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      settings: {
        pixKey: gs.pixKey || '38032274880',
        pixKeyType: gs.pixKeyType || 'cpf',
        pixName: gs.pixName || 'Fernando Alves',
        pixCity: gs.pixCity || 'Caieiras',
        pixTxId: gs.pixTxId || '***',
        supportPhone: gs.supportPhone || '11996466498',
        pixInstructions: gs.pixInstructions || 'Após o pagamento, seu acesso será liberado em instantes pelo administrador.',
        pixAmount: gs.pixAmount || '49.90',
        pixAmountAnnual: gs.pixAmountAnnual || '199.00',
        pixAmountXml: gs.pixAmountXml || gs.xmlModulePrice || '19.90'
      }
    }));
    return true;
  }

  // POST /api/payments/create-card - Descontinuado (Pagamentos exclusivos via PIX)
  if ((pathname === '/api/payments/create-card' || pathname === '/api/v1/payments/card') && req.method === 'POST') {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: 'Pagamento via Cartão de Crédito descontinuado. Os pagamentos são realizados exclusivamente via PIX.'
    }));
    return true;
  }

  // Webhooks legados respondem de forma neutra
  if ((pathname === '/api/webhooks/asaas' || pathname === '/api/asaas/webhook' || pathname === '/api/webhooks/efi' || pathname === '/api/efi/webhook') && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Webhooks externos descontinuados. Sistema operando em modo PIX Estático Concierge.' }));
    return true;
  }

  // =========================================================================
  // 1. ROTA DE PIX ESTÁTICO NATIVO (PADRÃO BANCO CENTRAL EMVCo / BR CODE)
  // Substitui integrações externas, webhooks e timeouts por onboarding nativo
  // =========================================================================
  if ((pathname === '/api/v1/payments/pix-static' || pathname === '/api/v1/payments/pix' || pathname === '/api/payments/create-pix' || pathname === '/api/v1/payments') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const db = readDatabase();
        const globalSettings = db.globalSettings || {};

        const rawPlanName = String(payload.nome_plano || payload.description || payload.planName || 'Alerta Vencimento PRO').trim();
        const serviceType = String(payload.type || '').trim();

        // 1. Resolução dinâmica de valor com base no serviço ou no payload
        let numAmount = parseFloat(payload.valor !== undefined ? payload.valor : (payload.amount !== undefined ? payload.amount : 0));
        if (!numAmount || numAmount <= 0) {
          if (serviceType === 'merchant_pro_annual') {
            numAmount = parseFloat(globalSettings.pixAmountAnnual || 199.00);
          } else if (serviceType === 'merchant_xml') {
            numAmount = parseFloat(globalSettings.pixAmountXml || globalSettings.xmlModulePrice || 19.90);
          } else {
            numAmount = parseFloat(globalSettings.pixAmount || 49.90);
          }
        }

        if (numAmount <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Valor da cobrança PIX deve ser maior que zero.' }));
          return;
        }

        // 2. Descrição dinâmica com o serviço adquirido (limite 25 chars padrão EMVCo BACEN)
        let serviceDesc = rawPlanName;
        if (!serviceDesc.toLowerCase().startsWith('plano:')) {
          serviceDesc = 'Plano: ' + serviceDesc;
        }
        const planDescription = serviceDesc
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9 :_-]/g, '')
          .trim()
          .substring(0, 25);

        // 3. Dados do recebedor obtidos DINAMICAMENTE da configuração salva pelo Admin
        const staticKey = String(globalSettings.pixKey || '38032274880').trim();
        const staticReceiverName = String(globalSettings.pixName || 'Fernando Alves').trim();
        const staticCity = String(globalSettings.pixCity || 'Caieiras').trim();
        const staticTxId = String(globalSettings.pixTxId || '***').trim();

        // 4. Geração do Payload EMVCo BR Code Oficial do Banco Central
        const payloadPix = generatePixEmvCo({
          key: staticKey,
          name: staticReceiverName,
          city: staticCity,
          amount: numAmount,
          txid: staticTxId,
          description: planDescription
        });

        const paymentId = `pix_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        // Registra histórico local no database para conciliação
        try {
          if (!db.payments) db.payments = {};
          db.payments[paymentId] = {
            id: paymentId,
            internalId: paymentId,
            gateway: 'pix_static',
            environment: 'concierge',
            method: 'pix',
            amount: numAmount,
            nome_plano: rawPlanName,
            description: planDescription,
            type: serviceType || 'merchant_pro_monthly',
            phone: cleanDigits(payload.phone || ''),
            partnerId: payload.partnerId || '',
            planId: payload.planId || '',
            invoiceId: payload.invoiceId || '',
            status: 'pending',
            statusDetail: 'pending_concierge_proof',
            payload_pix: payloadPix,
            qr_code: payloadPix,
            chave_pix: staticKey,
            beneficiario: staticReceiverName,
            cidade: staticCity,
            createdAt: new Date().toISOString()
          };
          writeDatabase(db);
        } catch (dbErr) {
          console.warn('⚠️ [PIX ESTÁTICO]: Aviso ao salvar histórico no banco:', dbErr.message);
        }

        console.log(`⚡ [PIX ESTÁTICO EMVCo]: Payload gerado com sucesso! Valor: R$ ${numAmount.toFixed(2)} | Serviço: "${planDescription}" | Chave: ${staticKey} | Titular: ${staticReceiverName}`);
        registerLog(cleanDigits(payload.phone || '') || payload.partnerId || 'CLIENTE', payload.partnerId ? 'PARCEIRO' : 'LOJISTA', 'GERAR_PIX_ESTATICO', {
          paymentId,
          type: serviceType || 'merchant_pro_monthly',
          valor: numAmount,
          servico: rawPlanName
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          payload_pix: payloadPix,
          qr_code: payloadPix,
          paymentId: paymentId,
          amount: numAmount,
          nome_plano: rawPlanName,
          description: planDescription,
          beneficiario: staticReceiverName,
          chave_pix: staticKey,
          cidade: staticCity
        }));
      } catch (err) {
        console.error('❌ Erro no Controller de PIX Estático:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: `Erro ao gerar PIX estático: ${err.message}`
        }));
      }
    });
    return true;
  }

  // 2. GET /api/payments/status - Consulta status do pagamento (Polling do Frontend)
  if (pathname === '/api/payments/status' && req.method === 'GET') {
    (async () => {
    const urlObj = new URL(req.url, 'http://localhost:3000');
    const paymentId = urlObj.searchParams.get('id') || urlObj.searchParams.get('paymentId') || '';

    const db = readDatabase();
    if (!db.payments) db.payments = {};

    let payment = db.payments[paymentId];
    if (!payment) {
      payment = Object.values(db.payments).find(p => p.id === paymentId || p.internalId === paymentId);
    }

    if (!payment) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Pagamento não localizado.' }));
      return true;
    }

    // Se estiver pendente e tiver token do MP, consulta a API do Mercado Pago
    const mpToken = (db.globalSettings && db.globalSettings.mpAccessToken || '').trim();
    if (payment.status === 'pending' && mpToken && !payment.id.startsWith('mp_sim_') && !isNaN(payment.id)) {
      try {
        const mpCheck = await callMercadoPagoApi(`/v1/payments/${payment.id}`, 'GET', mpToken);
        if (mpCheck.status === 200 && mpCheck.data && mpCheck.data.status === 'approved') {
          processPaymentActivation(payment, db);
        }
      } catch (err) {
        // Silencioso no polling
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      paymentId: payment.id,
      status: payment.status,
      type: payment.type,
      amount: payment.amount,
      approvedAt: payment.approvedAt || null
    }));
    })();
    return true;
  }

  // 3. POST /api/webhooks/mercadopago - Webhook oficial do Mercado Pago
  if ((pathname === '/api/webhooks/mercadopago' || pathname === '/api/mercadopago/webhook') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const hookData = JSON.parse(body || '{}');
        const urlObj = new URL(req.url, 'http://localhost:3000');
        const topic = hookData.type || hookData.topic || urlObj.searchParams.get('topic') || urlObj.searchParams.get('type') || '';
        const resourceId = (hookData.data && hookData.data.id) || hookData.id || urlObj.searchParams.get('id') || urlObj.searchParams.get('data.id');

        console.log(`📩 [MERCADO PAGO WEBHOOK]: Evento recebido: ${topic} | ID Recurso: ${resourceId}`);

        const db = readDatabase();
        if (!db.payments) db.payments = {};
        const mpToken = (db.globalSettings && db.globalSettings.mpAccessToken || '').trim();

        if (resourceId) {
          let payment = db.payments[String(resourceId)];
          if (!payment) {
            payment = Object.values(db.payments).find(p => p.id === String(resourceId) || p.internalId === String(resourceId));
          }

          if (mpToken && !String(resourceId).startsWith('mp_sim_')) {
            try {
              const mpCheck = await callMercadoPagoApi(`/v1/payments/${resourceId}`, 'GET', mpToken);
              if (mpCheck.status === 200 && mpCheck.data) {
                const mpPayment = mpCheck.data;
                if (mpPayment.status === 'approved') {
                  if (!payment) {
                    const meta = mpPayment.metadata || {};
                    payment = {
                      id: String(resourceId),
                      amount: mpPayment.transaction_amount,
                      type: meta.type || 'merchant_pro_monthly',
                      phone: meta.phone || '',
                      partnerId: meta.partner_id || meta.partnerId || '',
                      planId: meta.plan_id || meta.planId || '',
                      invoiceId: meta.invoice_id || meta.invoiceId || '',
                      status: 'approved'
                    };
                    db.payments[String(resourceId)] = payment;
                  }
                  processPaymentActivation(payment, db);
                }
              }
            } catch (err) {
              console.error('Erro ao verificar pagamento no Mercado Pago via Webhook:', err);
            }
          } else if (payment) {
            processPaymentActivation(payment, db);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'Webhook processado com sucesso.' }));
      } catch (err) {
        console.error('Erro no processamento do webhook Mercado Pago:', err);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // 4. POST /api/payments/simulate-approve - Simula aprovação imediata para testes e demonstrações
  if (pathname === '/api/payments/simulate-approve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { paymentId, id } = JSON.parse(body || '{}');
        const targetId = paymentId || id || '';

        const db = readDatabase();
        if (!db.payments) db.payments = {};

        let payment = db.payments[targetId];
        if (!payment) {
          payment = Object.values(db.payments).find(p => p.id === targetId || p.internalId === targetId);
        }

        if (!payment) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Pagamento não encontrado para simulação.' }));
          return;
        }

        processPaymentActivation(payment, db);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          message: 'Pagamento aprovado com sucesso via simulação Mercado Pago!',
          payment: payment
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // CRUD COMPLETO DE PLANOS B2B (PACOTES DE FRANQUIA FIXA)
  // =========================================================================

  // GET /api/v1/planos/b2b e GET /api/admin/b2b-plans - Lista planos B2B para Admin e Modal do Parceiro
  if ((pathname === '/api/v1/planos/b2b' || pathname === '/api/planos/b2b' || pathname === '/api/admin/b2b-plans' || pathname === '/api/b2b-plans') && req.method === 'GET') {
    const db = readDatabase();
    if (!db.b2bPlans || Object.keys(db.b2bPlans).length === 0) {
      db.b2bPlans = { ...DEFAULT_B2B_PLANS };
    }
    const plansList = Object.values(db.b2bPlans).sort((a, b) => (parseFloat(a.valor_mensal) || 0) - (parseFloat(b.valor_mensal) || 0));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, plans: plansList, planos: plansList }));
    return true;
  }

  // POST /api/admin/b2b-plans - Cadastra novo plano B2B
  if (pathname === '/api/admin/b2b-plans' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const nome_plano = (payload.nome_plano || payload.nome || '').trim();
        const limite_lojas = parseInt(payload.limite_lojas || payload.limite || 0, 10);
        const valor_mensal = parseFloat(payload.valor_mensal || payload.valor || 0);

        if (!nome_plano || limite_lojas <= 0 || isNaN(valor_mensal) || valor_mensal < 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Nome do plano, limite de lojas (>0) e valor mensal válido são obrigatórios.' }));
          return;
        }

        const db = readDatabase();
        if (!db.b2bPlans) db.b2bPlans = { ...DEFAULT_B2B_PLANS };

        const planKey = (payload.id || `plano_${nome_plano.toLowerCase().replace(/[^a-z0-9]/g, '_')}`).trim();
        const newPlan = {
          id: planKey,
          nome_plano,
          limite_lojas,
          valor_mensal,
          descricao: payload.descricao || `Franquia ${nome_plano} - Até ${limite_lojas} lojas com API de Validade`,
          created_at: new Date().toISOString()
        };

        db.b2bPlans[planKey] = newPlan;
        writeDatabase(db);

        console.log(`📦 [PLANO B2B CADASTRADO]: ${nome_plano} (${limite_lojas} lojas - R$ ${valor_mensal.toFixed(2)})`);
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, plan: newPlan, message: 'Plano B2B salvo com sucesso!' }));
      } catch (err) {
        console.error('Erro ao salvar plano B2B:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha interna ao salvar plano B2B.' }));
      }
    });
    return true;
  }

  // PUT /api/admin/b2b-plans - Atualiza plano B2B existente
  if (pathname === '/api/admin/b2b-plans' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const planId = (payload.id || '').trim();
        if (!planId) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'ID do plano é obrigatório.' }));
          return;
        }

        const db = readDatabase();
        if (!db.b2bPlans || !db.b2bPlans[planId]) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Plano B2B não encontrado.' }));
          return;
        }

        const plan = db.b2bPlans[planId];
        if (payload.nome_plano) plan.nome_plano = payload.nome_plano.trim();
        if (payload.limite_lojas !== undefined) plan.limite_lojas = parseInt(payload.limite_lojas, 10);
        if (payload.valor_mensal !== undefined) plan.valor_mensal = parseFloat(payload.valor_mensal);
        if (payload.descricao) plan.descricao = payload.descricao.trim();

        // Atualiza em cascata os parceiros vinculados
        if (db.partners) {
          Object.keys(db.partners).forEach(pid => {
            const p = db.partners[pid];
            if (p.plano_id === planId) {
              p.nome_plano = plan.nome_plano;
              p.limite_lojas = plan.limite_lojas;
              p.valor_mensal = plan.valor_mensal;
              p.faturaEstimada = plan.valor_mensal;
            }
          });
        }

        writeDatabase(db);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, plan, message: 'Plano B2B atualizado com sucesso!' }));
      } catch (err) {
        console.error('Erro ao atualizar plano B2B:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha interna ao atualizar plano B2B.' }));
      }
    });
    return true;
  }

  // DELETE /api/admin/b2b-plans - Exclui plano se não estiver em uso
  if (pathname === '/api/admin/b2b-plans' && req.method === 'DELETE') {
    const urlObj = new URL(req.url, 'http://localhost');
    const planId = urlObj.searchParams.get('id') || '';
    const db = readDatabase();

    // Permite ao Administrador gerenciar e excluir qualquer plano desde que não tenha parceiros vinculados
    const totalPlansCount = Object.keys(db.b2bPlans || {}).length;
    if (totalPlansCount <= 1) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'O sistema deve manter pelo menos 1 plano B2B ativo.' }));
      return true;
    }

    if (db.partners) {
      const inUse = Object.values(db.partners).some(p => p.plano_id === planId);
      if (inUse) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Não é possível excluir um plano que possui parceiros vinculados.' }));
        return true;
      }
    }

    if (db.b2bPlans && db.b2bPlans[planId]) {
      delete db.b2bPlans[planId];
      writeDatabase(db);
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Plano excluído com sucesso.' }));
    return true;
  }

  // GET /api/admin/partners ou /api/v1/partners - Lista todos os parceiros, métricas e planos vinculados
  if ((pathname === '/api/admin/partners' || pathname === '/api/v1/partners' || pathname === '/api/partners') && req.method === 'GET') {
    try {
      const db = readDatabase();
      if (!db.partners) db.partners = {};
      if (!db.b2bPlans) db.b2bPlans = { ...DEFAULT_B2B_PLANS };
      const rawStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];
      const uniqueStoresMap = new Map();
      rawStores.forEach(st => {
        if (!st) return;
        const key = String(st.id || st.tenant_id || st.apiKey || st.cnpj || st.name || '').trim().toLowerCase();
        if (key && !uniqueStoresMap.has(key)) {
          uniqueStoresMap.set(key, st);
        }
      });
      const allStores = Array.from(uniqueStoresMap.values());

      // LEFT JOIN SEMANTICS: Se o parceiro estiver sem plano, ele NUNCA desaparece da lista
      const partnerList = Object.keys(db.partners).map(pid => {
        const p = db.partners[pid];
        if (!p) return null;
        const pIdStr = String(p.id || pid || '').toUpperCase().trim();
        const pPhoneStr = cleanDigits(p.phone || p.telefone || '');
        const pCnpjStr = cleanDigits(p.cnpj || '');

        // Comparação robusta de vínculo de lojas do parceiro
        const stores = allStores.filter(st => {
          const sPid = String(st.partnerId || st.parceiro_id || '').toUpperCase().trim();
          return sPid === pIdStr || sPid === String(pid).toUpperCase().trim() ||
                 (pPhoneStr && cleanDigits(st.partnerId || st.parceiro_id || '') === pPhoneStr) ||
                 (pCnpjStr && cleanDigits(st.cnpj || '') === pCnpjStr);
        });
        const activeStores = stores.filter(st => st.status === 'ativo' || !st.status);
        
        // LEFT JOIN seguro com fallback
        const plan = getB2bPlan(p.plano_id || p.planId || 'plano_starter', db);
        const rawValor = (p.valor_mensal !== undefined && p.valor_mensal !== null)
          ? p.valor_mensal
          : (plan && plan.valor_mensal !== undefined ? plan.valor_mensal : 0);
        const faturaEstimada = isNaN(parseFloat(rawValor)) ? 0 : parseFloat(rawValor);
        const totalReqs = stores.reduce((sum, st) => sum + (parseInt(st.requisicoesMes || st.requisicoes_mes) || 0), 0);

        // Garante persistência da contagem no próprio objeto em db.partners
        p.storesCount = stores.length;
        p.activeStoresCount = activeStores.length;
        p.faturaEstimada = faturaEstimada;

        return {
          ...p,
          id: p.id || pid,
          name: p.name || p.nome || 'Parceiro Sem Nome',
          cnpj: p.cnpj || '',
          phone: p.phone || p.telefone || '',
          pin: p.pin || '4546',
          email: p.email || '',
          plano_id: plan ? plan.id : 'plano_starter',
          nome_plano: plan ? plan.nome_plano : 'Starter',
          limite_lojas: plan ? parseInt(plan.limite_lojas, 10) : 50,
          valor_mensal: faturaEstimada,
          valorPorLoja: faturaEstimada,
          status: p.status || 'ativo',
          createdAt: p.createdAt || p.data_cadastro || new Date().toISOString(),
          storesCount: stores.length,
          activeStoresCount: activeStores.length,
          faturaEstimada: faturaEstimada,
          totalReqs: totalReqs
        };
      }).filter(Boolean);

      // Total de lojas ativas no sistema
      const totalStores = allStores.filter(st => st.status === 'ativo' || !st.status).length;
      
      // Faturamento Mensal B2B: SUM(COALESCE(pb.valor_mensal, 0)) dos Parceiros ATIVOS
      const activePartners = partnerList.filter(p => {
        const st = String(p.status || 'ativo').toLowerCase().trim();
        return st === 'ativo' || st === 'active';
      });

      const totalMrr = activePartners.reduce((sum, p) => {
        const plan = getB2bPlan(p.plano_id || p.planId || 'plano_starter', db);
        const rawVal = (p.valor_mensal !== undefined && p.valor_mensal !== null)
          ? p.valor_mensal
          : (plan && plan.valor_mensal !== undefined ? plan.valor_mensal : 0);
        const val = isNaN(parseFloat(rawVal)) ? 0 : parseFloat(rawVal);
        return sum + val;
      }, 0);

      const safeTotalMrr = isNaN(totalMrr) ? 0 : totalMrr;

      // Resposta no formato exato com suporte a camelCase e snake_case (Enterprise)
      const payload = {
        success: true,
        partners: partnerList,
        plans: Object.values(db.b2bPlans || {}),
        metrics: {
          totalPartners: partnerList.length,
          totalStores: totalStores,
          totalMrr: safeTotalMrr,
          total_partners: partnerList.length,
          total_tenants: totalStores,
          monthly_revenue: safeTotalMrr,
          totalPlans: Object.keys(db.b2bPlans || {}).length,
          defaultTokenPrice: (db.globalSettings && db.globalSettings.partnerTokenPrice) || 29.90
        }
      };

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error('❌ [GET /api/admin/partners] Erro ao buscar parceiros:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: "Erro ao buscar parceiros",
        details: err.message
      }));
      return true;
    }
  }

  // POST /api/v1/partners - Cadastra novo parceiro vinculado a um Plano B2B (Franquia Fixa)
  // ISOLAMENTO ESTRITO: Persiste exclusivamente na tabela/coleção de Parceiros (NUNCA lojistas/merchants)
  if ((pathname === '/api/v1/partners' || pathname === '/api/admin/partners' || pathname === '/api/partners') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name, cnpj, phone, pin, email, plano_id, plano_tipo, planId } = JSON.parse(body || '{}');
        if (!name || !name.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'O Nome do Parceiro (Empresa PDV) é obrigatório.' }));
          return;
        }

        const cleanPhone = cleanDigits(phone || '');
        if (!cleanPhone || cleanPhone.length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'O Telefone/WhatsApp com DDD é obrigatório.' }));
          return;
        }

        const cleanPin = (pin || '').trim() || '4546';

        const db = readDatabase();
        if (!db.partners) db.partners = {};
        if (!db.b2bPlans) db.b2bPlans = Object.assign({}, DEFAULT_B2B_PLANS);

        // Auto-gera Tenant ID sequencial (PARC-001, PARC-002, etc.)
        let maxNum = 0;
        Object.keys(db.partners).forEach(pid => {
          const match = pid.match(/PARC-(\d+)/i);
          if (match) {
            const n = parseInt(match[1], 10);
            if (n > maxNum) maxNum = n;
          }
        });
        const partnerId = 'PARC-' + String(maxNum + 1).padStart(3, '0');

        // Resolução do Plano B2B selecionado (sem forçar Trial ou Starter quando Pro/Enterprise for enviado)
        const requestedPlanId = (plano_id || plano_tipo || planId || '').trim();
        const plan = getB2bPlan(requestedPlanId, db);

        // Persistência com isolamento estrito na tabela/coleção de PARCEIROS
        const crypto = require('crypto');
        const newPartner = {
          id: partnerId,
          apiKey: 'ak_partner_' + crypto.randomBytes(16).toString('hex'),
          name: name.trim(),
          cnpj: (cnpj || '').trim(),
          phone: cleanPhone,
          email: (email || '').trim(),
          pin: cleanPin,
          plano_id: plan.id,
          nome_plano: plan.nome_plano,
          limite_lojas: plan.limite_lojas,
          valor_mensal: plan.valor_mensal,
          valorPorLoja: plan.valor_mensal,
          status: 'ATIVO', // Status padrão ATIVO garantido
          createdAt: new Date().toISOString(),
          storesCount: 0,
          activeStoresCount: 0,
          faturaEstimada: plan.valor_mensal,
          totalReqs: 0
        };

        // Salva ESTRITAMENTE na tabela de Parceiros (NUNCA em db.merchants ou lojistas)
        db.partners[partnerId] = newPartner;
        writeDatabase(db);

        registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'CREATE_PARCEIRO', {
          parceiro_id: partnerId,
          nome: newPartner.name,
          plano: plan.nome_plano,
          limite_tokens: plan.limite_lojas
        });

        console.log('🤝 [NOVO PARCEIRO CADASTRADO]: ' + newPartner.name + ' (ID: ' + partnerId + ', Plano: ' + plan.nome_plano + ', Limite: ' + plan.limite_lojas + ' lojas, R$ ' + plan.valor_mensal + '/mês, Status: ATIVO)');

        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          partner: newPartner,
          message: 'Parceiro ' + newPartner.name + ' cadastrado com sucesso no plano ' + plan.nome_plano + '! ID: ' + partnerId
        }));
      } catch (err) {
        console.error('Erro ao cadastrar parceiro:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha interna ao cadastrar parceiro.' }));
      }
    });
    return true;
  }

  // PUT /api/v1/admin/parceiros/:id/plano e PUT/POST /api/admin/partners/assign-plan
  // Validação estrita de ID, contagem de linhas afetadas (changes) e registro na trilha de auditoria (System_Logs)
  const adminPartnerPlanMatch = pathname.match(/^\/api\/v1\/admin\/parceiros\/([^/]+)\/plano$/);
  const isAssignPlanRoute = (pathname === '/api/admin/partners/assign-plan' || pathname === '/api/admin/partners/plan' || !!adminPartnerPlanMatch);
  const isUpdatePartnerRoute = (pathname === '/api/admin/partners' || pathname === '/api/v1/partners' || pathname === '/api/partners');

  if ((isAssignPlanRoute && (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST')) ||
      (isUpdatePartnerRoute && (req.method === 'PUT' || req.method === 'PATCH'))) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const urlId = adminPartnerPlanMatch ? decodeURIComponent(adminPartnerPlanMatch[1]) : '';
        const rawTargetId = (urlId || parsed.id || parsed.partnerId || parsed.parceiro_id || '').trim();
        const numericCastId = (/^\d+$/.test(rawTargetId)) ? Number(rawTargetId) : null;
        const actorId = (parsed.actor_id || req.headers['x-actor-id'] || 'MASTER_ADMIN').toString().trim();

        const { name, cnpj, phone, pin, email, valorPorLoja, status, plano_id, planId, plano, limite_tokens, limite_lojas, valor_mensal } = parsed;

        const db = readDatabase();
        if (!db.partners) db.partners = {};
        if (!db.b2bPlans || Object.keys(db.b2bPlans).length === 0) db.b2bPlans = { ...DEFAULT_B2B_PLANS };

        let partnerKey = null;
        if (rawTargetId && db.partners[rawTargetId]) {
          partnerKey = rawTargetId;
        } else if (numericCastId !== null && db.partners[String(numericCastId)]) {
          partnerKey = String(numericCastId);
        } else if (rawTargetId) {
          const found = Object.values(db.partners).find(x => {
            if (!x) return false;
            const xId = String(x.id || '');
            if (xId.toUpperCase() === rawTargetId.toUpperCase()) return true;
            if (numericCastId !== null && (x.id === numericCastId || xId === String(numericCastId))) return true;
            if (cleanDigits(rawTargetId).length >= 10 && cleanDigits(x.phone || '') === cleanDigits(rawTargetId)) return true;
            return false;
          });
          if (found) partnerKey = found.id;
        }

        let changes = 0;
        if (!partnerKey || !db.partners[partnerKey]) {
          // Validação estrita: se changes === 0, ABORTA e retorna 404
          console.warn(`⚠️ [UPDATE PLANO 404]: Parceiro "${rawTargetId}" não encontrado no banco (changes=0).`);
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            error: 'Parceiro não encontrado',
            changes: 0
          }));
          return;
        }

        const p = db.partners[partnerKey];
        const oldPlanName = p.nome_plano || p.plano_id || 'Starter';

        if (name) p.name = name.trim();
        if (cnpj !== undefined) p.cnpj = cnpj.trim();
        if (phone !== undefined) p.phone = cleanDigits(phone);
        if (pin !== undefined) p.pin = pin.trim();
        if (email !== undefined) p.email = email.trim();
        if (valorPorLoja !== undefined) p.valorPorLoja = parseFloat(valorPorLoja);
        if (status) p.status = status;

        const requestedPlan = plano_id || planId || plano;
        if (requestedPlan) {
          const plan = getB2bPlan(requestedPlan, db);
          const finalLimit = parseInt(limite_tokens || limite_lojas || plan.limite_lojas || 50, 10);
          const finalPrice = parseFloat(valor_mensal !== undefined ? valor_mensal : plan.valor_mensal);

          p.plano_id = plan.id;
          p.plano = plan.id;
          p.nome_plano = plan.nome_plano;
          p.limite_lojas = finalLimit;
          p.limite_tokens = finalLimit;
          p.valor_mensal = finalPrice;
          p.valorPorLoja = finalPrice;
          p.faturaEstimada = finalPrice;
        }

        p.updatedAt = new Date().toISOString();
        writeDatabase(db);
        changes = 1;

        if (changes === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Parceiro não encontrado', changes: 0 }));
          return;
        }

        // Registra na trilha de auditoria SQLite (System_Logs)
        registerLog(actorId, 'SUPER_ADMIN', 'UPDATE_PLANO_PARCEIRO', {
          parceiro_id: partnerKey,
          parceiro_nome: p.name,
          plano_anterior: oldPlanName,
          novo_plano: p.nome_plano,
          plano_id: p.plano_id,
          limite_tokens: p.limite_lojas,
          valor_mensal: p.valor_mensal
        });

        console.log(`✏️ [PARCEIRO ATUALIZADO NO BANCO (changes=${changes})]: ${p.name} (ID: ${partnerKey}, Plano: ${p.nome_plano || 'Starter'}, Limite: ${p.limite_lojas} tokens, R$ ${p.valor_mensal}/mês)`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, changes: changes, partner: p }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // GET /api/v1/admin/logs - Retorna logs paginados (page, limit) da tabela System_Logs
  if ((pathname === '/api/v1/admin/logs' || pathname === '/api/admin/logs') && req.method === 'GET') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const page = Math.max(parseInt(urlObj.searchParams.get('page') || '1', 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit') || '15', 10) || 15, 1), 100);
      const result = getSystemLogsPaginated(page, limit);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        data: result.data,
        pagination: result.pagination
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Erro ao consultar logs de auditoria: ' + err.message }));
    }
    return true;
  }

  
  // PATCH /api/partner/upgrade - Upgrade de plano do Parceiro
  if ((pathname === '/api/partner/upgrade' || pathname === '/api/partner/plan') && (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { partnerId, parceiro_id, plano_id, planId } = JSON.parse(body || '{}');
        const headerPartner = req.headers['x-parceiro-id'] || req.headers['x-partner-id'] || '';
        const pid = (partnerId || parceiro_id || headerPartner || '').trim();
        const targetPlanId = (plano_id || planId || '').trim();

        const db = readDatabase();
        if (!db.partners) db.partners = {};
        if (!db.b2bPlans) db.b2bPlans = { ...DEFAULT_B2B_PLANS };

        // Localiza parceiro por id, telefone ou cnpj
        let targetKey = pid;
        if (!db.partners[targetKey]) {
          const found = Object.values(db.partners).find(p => 
            (p.id && p.id.toUpperCase() === pid.toUpperCase()) ||
            (p.phone && cleanDigits(p.phone) === cleanDigits(pid)) ||
            (p.cnpj && cleanDigits(p.cnpj) === cleanDigits(pid))
          );
          if (found) targetKey = found.id;
        }

        if (!db.partners[targetKey]) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Parceiro não localizado no sistema.' }));
          return;
        }

        const p = db.partners[targetKey];
        const newPlan = getB2bPlan(targetPlanId, db);
        p.plano_id = newPlan.id;
        p.nome_plano = newPlan.nome_plano;
        p.limite_lojas = newPlan.limite_lojas;
        p.valor_mensal = newPlan.valor_mensal;
        p.valorPorLoja = newPlan.valor_mensal;
        p.faturaEstimada = newPlan.valor_mensal;

        writeDatabase(db);
        registerLog(targetKey, 'PARCEIRO', 'UPGRADE_PLANO_PARCEIRO', {
          parceiro_nome: p.name,
          novo_plano: newPlan.nome_plano,
          limite_tokens: newPlan.limite_lojas,
          valor_mensal: newPlan.valor_mensal
        });
        console.log(`🚀 [UPGRADE DE PLANO B2B]: Parceiro ${p.name} (${p.id}) migrado para ${newPlan.nome_plano} (${newPlan.limite_lojas} Tokens - R$ ${newPlan.valor_mensal}/mês)`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          message: `Plano atualizado com sucesso para ${newPlan.nome_plano}!`,
          partner: p,
          plan: newPlan
        }));
      } catch (err) {
        console.error('Erro ao atualizar plano do parceiro:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha ao processar upgrade de plano.' }));
      }
    });
    return true;
  }

  // PATCH /api/admin/merchants/toggle-status - Bloqueio / Desbloqueio de Lojista (Soft Lock)
  if ((pathname === '/api/admin/merchants/toggle-status' || pathname === '/api/admin/merchants/status') && (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { phone, status } = JSON.parse(body || '{}');
        const clean = cleanDigits(phone || '');
        if (!clean) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Telefone do lojista é obrigatório.' }));
          return;
        }

        const db = readDatabase();
        if (!db.merchants || !db.merchants[clean]) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Lojista não encontrado no sistema.' }));
          return;
        }

        const m = db.merchants[clean];
        const currentStatus = (m.status || 'ativo').toLowerCase();
        const newStatus = status ? status : (currentStatus === 'ativo' ? 'bloqueado' : 'ativo');
        m.status = newStatus;
        writeDatabase(db);

        console.log(`🔒 [SOFT LOCK LOJISTA]: ${m.name} (${clean}) alterado para: ${newStatus.toUpperCase()}`);
        registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'TOGGLE_STATUS_LOJISTA', { lojista_phone: clean, nome: m.name, novo_status: newStatus });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          phone: clean,
          status: newStatus,
          merchant: m,
          message: `Lojista ${m.name} ${newStatus === 'bloqueado' ? 'bloqueado' : 'desbloqueado'} com sucesso!`
        }));
      } catch (err) {
        console.error('Erro ao alterar status do lojista:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Falha interna ao alterar status do lojista.' }));
      }
    });
    return true;
  }


  // PATCH /api/admin/partners/toggle-status - Bloqueio / Desbloqueio de Parceiro (Soft Lock)
  if ((pathname === '/api/admin/partners/toggle-status' || pathname === '/api/v1/partners/toggle-status' || pathname === '/api/admin/partners/status') && (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id, status } = JSON.parse(body || '{}');
        const db = readDatabase();
        if (!db.partners || !db.partners[id]) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Parceiro não encontrado.' }));
          return;
        }

        const currentStatus = (db.partners[id].status || 'ativo').toLowerCase();
        const newStatus = status ? status : (currentStatus === 'ativo' ? 'bloqueado' : 'ativo');
        db.partners[id].status = newStatus;
        writeDatabase(db);

        console.log(`🔒 [SOFT LOCK PARCEIRO]: ${db.partners[id].name} (${id}) alterado para: ${newStatus.toUpperCase()}`);
        registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'TOGGLE_STATUS_PARCEIRO', { parceiro_id: id, nome: db.partners[id].name, novo_status: newStatus });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          id: id,
          status: newStatus,
          partner: db.partners[id],
          message: `Parceiro ${db.partners[id].name} ${newStatus === 'bloqueado' ? 'bloqueado' : 'desbloqueado'} com sucesso.`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }


  // =========================================================================
  // SUPORTE AO VIVO (IMPERSONATION EM NOVA ABA)
  // =========================================================================

  // POST /api/admin/support-session - Cria sessão temporária de suporte para parceiro
  if (pathname === '/api/admin/support-session' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { partnerId } = JSON.parse(body || '{}');
        const db = readDatabase();
        const partners = db.partners || {};
        const partner = partners[partnerId] || Object.values(partners).find(p => p.id === partnerId);

        if (!partner) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Parceiro não encontrado.' }));
          return;
        }

        const supportToken = 'supp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
        supportSessions[supportToken] = {
          token: supportToken,
          partnerId: partner.id,
          partnerName: partner.name,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60 * 60 * 1000 // 1 hora
        };

        console.log(`🛡️ [SESSÃO DE SUPORTE CRIADA]: Parceiro ${partner.name} (${partner.id}) -> Token: ${supportToken}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          token: supportToken,
          partnerId: partner.id,
          partnerName: partner.name,
          url: `/parceiro.html?support_token=${supportToken}&partner_id=${partner.id}`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // GET /api/partner/support-session - Valida sessão de suporte
  if (pathname === '/api/partner/support-session' && req.method === 'GET') {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const token = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('support_token');

    if (!token || !supportSessions[token]) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Sessão de suporte expirada ou inválida.' }));
      return;
    }

    const session = supportSessions[token];
    if (Date.now() > session.expiresAt) {
      delete supportSessions[token];
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Sessão de suporte expirada.' }));
      return;
    }

    const db = readDatabase();
    const partner = (db.partners && db.partners[session.partnerId]) || { id: session.partnerId, name: session.partnerName };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      session,
      partner,
      impersonatedByAdmin: true
    }));
    return true;
  }

  // DELETE /api/admin/support-session - Encerra a sessão de suporte
  if ((pathname === '/api/admin/support-session' || pathname === '/api/partner/support-session') && (req.method === 'DELETE' || req.method === 'POST')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const tokenFromQuery = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('support_token');
        const { token } = JSON.parse(body || '{}');
        const targetToken = token || tokenFromQuery;

        if (targetToken && supportSessions[targetToken]) {
          console.log(`🔒 [SESSÃO DE SUPORTE ENCERRADA]: Token ${targetToken}`);
          delete supportSessions[targetToken];
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'Sessão de suporte encerrada com sucesso.' }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      }
    });
    return true;
  }

  // POST /api/admin/token-price - Atualiza o valor base do token nas configurações globais
  if (pathname === '/api/admin/token-price' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { price } = JSON.parse(body || '{}');
        const db = readDatabase();
        if (!db.config) db.config = {};
        db.config.partnerTokenPrice = parseFloat(price) || 29.90;
        writeDatabase(db);

        console.log(`🪙 [PREÇO TOKEN PARCEIRO ATUALIZADO]: R$ ${db.config.partnerTokenPrice}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, price: db.config.partnerTokenPrice }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }


  // 3. POST /api/register-merchant - Cadastro direto de lojista no banco do servidor
  if (pathname === '/api/register-merchant' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name, phone, pin, plano } = JSON.parse(body || '{}');
        const clean = cleanDigits(phone);
        const cleanPin = (pin || '').trim();

        if (!name || clean.length < 10 || cleanPin.length !== 4) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Parâmetros incompletos' }));
          return;
        }

        const db = readDatabase();
        if (!db.merchants) db.merchants = {};

        const isUpdate = !!db.merchants[clean];
        db.merchants[clean] = {
          phone: clean,
          name: name.trim(),
          pin: cleanPin,
          plano: plano || 'free',
          status: db.merchants[clean] ? (db.merchants[clean].status || 'ativo') : 'ativo',
          createdAt: db.merchants[clean] ? db.merchants[clean].createdAt : new Date().toISOString()
        };

        writeDatabase(db);
        registerLog(clean, 'LOJISTA', isUpdate ? 'UPDATE_LOJISTA' : 'CREATE_LOJISTA', { nome: name, plano: plano || 'free' });
        console.log(`🟢 [BANCO DE DADOS] ${isUpdate ? 'Atualizado' : 'Novo'} Lojista cadastrado: ${name} (${clean}) | PIN: ${cleanPin} | Plano: ${plano || 'free'}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, merchant: db.merchants[clean] }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro ao processar cadastro' }));
      }
    });
    return true;
  }

  // =========================================================================
  // POST /api/v1/merchants/profile - Atualização Direta de Perfil e Faturamento do Lojista
  // =========================================================================
  if ((pathname === '/api/v1/merchants/profile' || pathname === '/api/merchant/settings' || pathname === '/api/merchants/profile') && (req.method === 'POST' || req.method === 'PUT')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { phone, originalPhone, name, email, documento, cpf, cnpj, nicheMode, redDays, yellowDays, redMonths, yellowMonths, capitalParadoDays, frequencia_alerta } = payload;
        
        const cleanPhone = cleanDigits(phone || originalPhone || '');
        if (!cleanPhone || cleanPhone.length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Telefone inválido' }));
          return;
        }

        const db = readDatabase();
        if (!db.merchants) db.merchants = {};

        const origClean = cleanDigits(originalPhone || '');
        if (origClean && origClean !== cleanPhone && db.merchants[origClean]) {
          db.merchants[cleanPhone] = db.merchants[origClean];
          delete db.merchants[origClean];
        }

        if (!db.merchants[cleanPhone]) {
          db.merchants[cleanPhone] = { phone: cleanPhone, name: name || 'Lojista', plano: 'free', createdAt: new Date().toISOString() };
        }

        const m = db.merchants[cleanPhone];
        if (name) m.name = name.trim();
        if (email) m.email = email.trim();
        if (documento) m.documento = documento.trim();
        const cleanDoc = cleanDigits(documento || cpf || cnpj || '');
        if (cleanDoc.length === 11) {
          m.cpf = cleanDoc;
        } else if (cleanDoc.length === 14) {
          m.cnpj = cleanDoc;
        }
        if (nicheMode) m.nicheMode = nicheMode;
        if (redDays !== undefined) m.redDays = parseInt(redDays) || 7;
        if (yellowDays !== undefined) m.yellowDays = parseInt(yellowDays) || 30;
        if (redMonths !== undefined) m.redMonths = parseInt(redMonths) || 2;
        if (yellowMonths !== undefined) m.yellowMonths = parseInt(yellowMonths) || 6;
        if (capitalParadoDays !== undefined) m.capitalParadoDays = parseInt(capitalParadoDays) || 90;
        if (frequencia_alerta) m.frequencia_alerta = frequencia_alerta;
        m.updatedAt = new Date().toISOString();

        writeDatabase(db);
        console.log(`✅ [LOJISTA ATUALIZADO]: ${m.name} (${cleanPhone}) | Email: ${m.email} | Doc: ${m.documento} (Salvo no banco de dados)`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, merchant: m }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro ao salvar perfil do lojista', details: err.message }));
      }
    });
    return true;
  }

  // 4. POST /api/state - Sincronização inteligente com merge (nunca perde dados de nenhum dispositivo)
  if (pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const db = readDatabase();

        // Sincronização limpa de lojistas
        if (parsed.merchants && typeof parsed.merchants === 'object') {
          db.merchants = parsed.merchants;
        }

        // Sincronização limpa de produtos
        if (Array.isArray(parsed.products)) {
          db.products = parsed.products;
        }

        // Sincronização segura de repositores (nunca apaga registros existentes no banco)
        if (parsed.repositores && typeof parsed.repositores === 'object' && Object.keys(parsed.repositores).length > 0) {
          if (!db.repositores) db.repositores = {};
          Object.keys(parsed.repositores).forEach(rKey => {
            if (!db.repositores[rKey]) {
              db.repositores[rKey] = parsed.repositores[rKey];
            }
          });
        }

        // Sincronização segura de parceiros B2B (nunca apaga nem regride planos persistidos via API)
        if (parsed.partners && typeof parsed.partners === 'object' && Object.keys(parsed.partners).length > 0) {
          if (!db.partners) db.partners = {};
          Object.keys(parsed.partners).forEach(pid => {
            if (!db.partners[pid]) {
              db.partners[pid] = parsed.partners[pid];
            }
          });
        }

        // Configurações globais
        if (parsed.globalSettings) {
          db.globalSettings = Object.assign(db.globalSettings || {}, parsed.globalSettings);
        }

        writeDatabase(db);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return true;
  }


  // 5. POST /api/products/batch - Sincronização em Lote de Produtos (Fila Offline)
  if (pathname === '/api/products/batch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const batch = JSON.parse(body || '[]');
        if (!Array.isArray(batch)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'O corpo da requisição deve ser um array de produtos.' }));
          return;
        }

        const db = readDatabase();
        if (!Array.isArray(db.products)) db.products = [];

        // Converte datas MM/AA e valida lote obrigatório para Farmácias
        for (const p of batch) {
          const ownerPhone = cleanDigits(p.ownerPhone || '');
          const merchant = db.merchants && db.merchants[ownerPhone];
          const isFarmacia = merchant && merchant.nicheMode === 'farmacia';

          // Trava Anvisa: Lote é obrigatório na farmácia
          if (isFarmacia && (!p.batch || p.batch.trim() === '' || p.batch.toUpperCase() === 'S/L')) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: 'O lote é obrigatório no Modo Farmácia (Anvisa) para o produto: ' + (p.name || '') }));
            return;
          }

          // Conversão de MM/AA para último dia útil se necessário
          if (p.expiry && p.expiry.includes('/') && p.expiry.length <= 5) {
            const digits = p.expiry.replace(/\D/g, '');
            if (digits.length >= 3) {
              const mm = parseInt(digits.slice(0, 2), 10);
              let yy = parseInt(digits.slice(2, 4), 10);
              yy = (yy < 100) ? 2000 + yy : yy;
              const lastDay = new Date(yy, mm, 0).getDate();
              p.expiry = yy + '-' + String(mm).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
            }
          }
        }

        const prodMap = new Map();
        db.products.forEach(p => prodMap.set(p.id, p));
        batch.forEach(p => prodMap.set(p.id, p));
        db.products = Array.from(prodMap.values());
        writeDatabase(db);

        console.log(`📦 [SYNC OFFLINE EM LOTE]: ${batch.length} produtos sincronizados com sucesso.`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, count: batch.length, total: db.products.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  // 6. POST /api/products - Cadastro Individual de Produto
    // Rota de Exclusão Individual de Produto: DELETE /api/products/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/products/')) {
    const rawId = pathname.replace('/api/products/', '');
    const id = isNaN(rawId) ? rawId : Number(rawId);
    try {
      const db = readDatabase();
      if (!Array.isArray(db.products)) db.products = [];
      const prevLen = db.products.length;
      db.products = db.products.filter(p => p.id !== id && String(p.id) !== String(rawId));
      writeDatabase(db);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, removedCount: prevLen - db.products.length, id }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return true;
  }

  // Rota de Baixa Parcial/Total de Produto pelo Lojista: POST /api/products/baixa ou PATCH /api/products/:id/baixa
  if (
    (pathname === '/api/products/baixa' && (req.method === 'POST' || req.method === 'PATCH')) ||
    (req.method === 'PATCH' && /^\/api\/products\/[^/]+\/baixa$/.test(pathname))
  ) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const pathParts = pathname.split('/').filter(Boolean);
        const rawId = (pathParts[2] && pathParts[2] !== 'baixa') ? pathParts[2] : (payload.id || payload.productId || '');
        const codigoBarras = String(payload.codigo_barras || payload.ean || '').trim();
        const quantidade = parseInt(payload.quantidade !== undefined ? payload.quantidade : payload.qty, 10);

        if (isNaN(quantidade) || quantidade <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'A quantidade informada para baixa deve ser maior que zero.' }));
          return;
        }

        const db = readDatabase();
        if (!Array.isArray(db.products)) db.products = [];

        const prod = db.products.find(p =>
          (rawId && String(p.id) === String(rawId)) ||
          (codigoBarras && String(p.codigo_barras || p.ean || '') === codigoBarras)
        );

        if (!prod) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Produto não encontrado no estoque.' }));
          return;
        }

        const currentQty = parseInt(
          prod.qty !== undefined ? prod.qty : (prod.quantity !== undefined ? prod.quantity : (prod.quantidade !== undefined ? prod.quantidade : 1)),
          10
        ) || 1;
        const baixaEfetiva = Math.min(quantidade, currentQty);
        const saldoRestante = Math.max(0, currentQty - baixaEfetiva);
        const nowIso = new Date().toISOString();

        prod.qty = saldoRestante;
        if (prod.quantity !== undefined) prod.quantity = saldoRestante;
        if (prod.quantidade !== undefined) prod.quantidade = saldoRestante;
        prod.updatedAt = nowIso;

        if (saldoRestante <= 0) {
          prod.status = 'baixado';
          prod.resolvedReason = payload.reason || 'promocao_venda';
          prod.tipo_baixa = payload.reason || 'promocao_venda';
          prod.resolvedAt = nowIso;
          prod.data_baixa = nowIso;
        } else {
          prod.status = 'ativo';
        }

        writeDatabase(db);
        registerLog(prod.ownerPhone || 'LOJISTA', 'LOJISTA', 'BAIXA_PRODUTO', {
          productId: prod.id,
          nome: prod.name,
          quantidade_baixada: baixaEfetiva,
          saldo_restante: saldoRestante
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          id: prod.id,
          quantidade_baixada: baixaEfetiva,
          saldo_restante: saldoRestante,
          status: prod.status,
          product: prod
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Erro ao processar baixa de produto: ' + err.message }));
      }
    });
    return true;
  }

  // Rota de Ações em Lote de Produtos (Dar Baixa e Exclusão): POST /api/products/batch-action
  if (pathname === '/api/products/batch-action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { action, productIds, reason } = JSON.parse(body || '{}');
        const ids = Array.isArray(productIds) ? productIds.map(x => String(x)) : [];
        const db = readDatabase();
        if (!Array.isArray(db.products)) db.products = [];

        if (action === 'delete') {
          db.products = db.products.filter(p => !ids.includes(String(p.id)));
        } else if (action === 'dar_baixa') {
          const nowIso = new Date().toISOString();
          db.products.forEach(p => {
            if (ids.includes(String(p.id))) {
              p.status = 'baixado';
              p.resolvedReason = reason || 'baixa_em_lote';
              p.tipo_baixa = reason || 'baixa_em_lote';
              p.resolvedAt = nowIso;
              p.data_baixa = nowIso;
            }
          });
        }
        writeDatabase(db);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, action, affectedCount: ids.length }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  if (pathname === '/api/products' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const prod = JSON.parse(body || '{}');
        const db = readDatabase();
        if (!Array.isArray(db.products)) db.products = [];
        const prodMap = new Map();
        db.products.forEach(p => prodMap.set(p.id, p));
        prodMap.set(prod.id, prod);
        db.products = Array.from(prodMap.values());
        writeDatabase(db);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, product: prod }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }


  // 7. POST /api/upload-xml - Salva o arquivo XML na pasta temporária (retido por 7 dias)
  if (pathname === '/api/upload-xml' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { storePhone, filename, xmlContent } = JSON.parse(body || '{}');
        if (!xmlContent) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Conteúdo XML ausente.' }));
          return;
        }

        const cleanPhone = cleanDigits(storePhone || 'geral');
        const safeName = (filename || 'nota.xml').replace(/[^a-zA-Z0-9._-]/g, '_');
        const savedFileName = `nfe_${cleanPhone}_${Date.now()}_${safeName}`;
        const targetPath = path.join(XML_UPLOADS_DIR, savedFileName);

        fs.writeFileSync(targetPath, xmlContent, 'utf-8');
        console.log(`📄 [XML ARMAZENADO]: ${savedFileName} salvo com retenção de 7 dias.`);

        // Roda a verificação de expiração para manter a pasta limpa
        cleanupExpiredXmlFiles();

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          savedFile: savedFileName,
          retentionDays: 7,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  return false;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, bypass-tunnel-reminder, Bypass-Tunnel-Reminder, ngrok-skip-browser-warning, X-Requested-With, *');
  res.setHeader('Access-Control-Expose-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // Verifica se é uma rota da API REST
  if (handleApiRequest(req, res, pathname)) {
    return;
  }

  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '' || reqPath === '/dashboard-lojista' || reqPath === '/leitor' || reqPath === '/scanner' || reqPath === '/dashboard-parceiro' || reqPath === '/admin' || reqPath === '/admin-login' || reqPath === '/vokz-boss' || reqPath === '/vokz-boss/') {
    reqPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso Negado');
    return;
  }

  // ⚡ PROTECAO CRITICA: Nunca servir index.html para rotas /api/ ou /auth/ nao encontradas.
  // Isso previne o erro "Resposta nao foi em formato JSON (Status 200)" no frontend PIX.
  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: 'Endpoint de API nao encontrado: ' + pathname }));
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (errIndex, dataIndex) => {
        if (errIndex) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Arquivo index.html não encontrado.');
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          res.end(dataIndex);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erro interno no servidor ao ler o arquivo.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': (ext === '.html') ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
      });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log('===============================================================');
  console.log('   🚀 SERVIDOR ALERTA VENCIMENTO INICIADO COM SUCESSO!        ');
  console.log('   💾 BANCO DE DADOS ATIVO: database.json (MULTI-DISPOSITIVO)  ');
  console.log('===============================================================');
  console.log('');
  console.log('   💻 NO SEU COMPUTADOR:');
  console.log(`      http://localhost:${PORT}`);
  console.log('');
  console.log('   📱 NO SEU CELULAR / SMARTPHONE (MESMO WI-FI):');
  console.log(`      http://${localIp}:${PORT}`);
  console.log('');
  cronEngine.startScheduler();
  console.log('   Pressione Ctrl+C para encerrar o servidor.');
  console.log('===============================================================');
});

server.registerLog = registerLog;
server.getSystemLogs = getSystemLogs;
module.exports = server;
