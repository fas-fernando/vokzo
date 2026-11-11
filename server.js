'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { generateInvoicePdfBuffer, calculateOverageBilling, buildInvoicePdfFilename } = require('./invoice-pdf');
const cronEngine = require('./cron-engine');
const {
  MYSQL_CONFIG,
  pool,
  db,
  initMysqlDatabase,
  normalizeSqlForMysql,
  toMysqlDatetime,
  getSettingJson,
  setSettingJson,
  getSettingValue,
  setSettingValue,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_ADMIN_CREDENTIALS,
  DEFAULT_SYSTEM_CONFIG
} = require('./db-mysql');
const {
  registerLog,
  getSystemLogs,
  getSystemLogsPaginated,
  initAuditDatabase,
  insertRepositorMysql,
  getRepositoresMysql,
  findRepositorByPhoneMysql,
  deleteRepositorMysql
} = require('./audit-logger');
const { createRequirePartnerAuth, handleProductSync, handleProductCheckout } = require('./b2b-fifo-controller');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const supportSessions = {};
const ALLOWED_PARTNER_DUE_DAYS = [5, 10, 15, 20, 25];
const GENERIC_AUTH_ERROR = 'Credenciais inválidas. Verifique os dados e tente novamente.';

const DEFAULT_B2B_PLANS = {
  plano_starter: { id: 'plano_starter', nome_plano: 'Starter', limite_lojas: 50, valor_mensal: 390.00, descricao: 'Franquia Starter - Até 50 lojas/PDVs com API ilimitada' },
  plano_pro: { id: 'plano_pro', nome_plano: 'Pro', limite_lojas: 150, valor_mensal: 890.00, descricao: 'Franquia Pro - Até 150 lojas/PDVs com API ilimitada' },
  plano_enterprise: { id: 'plano_enterprise', nome_plano: 'Enterprise', limite_lojas: 500, valor_mensal: 1990.00, descricao: 'Franquia Enterprise - Até 500 lojas/PDVs com SLA prioritário' }
};

function cleanDigits(str) { return ('' + (str || '')).replace(/\D/g, ''); }

function daysDiff(expiryDate) {
  if (!expiryDate) return 999;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((new Date(expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function normalizePartnerDueDay(val, fallback = 15) {
  const n = parseInt(val, 10);
  if (ALLOWED_PARTNER_DUE_DAYS.includes(n)) return n;
  return ALLOWED_PARTNER_DUE_DAYS.includes(fallback) ? fallback : 15;
}

function isClosedPartnerInvoice(inv) {
  if (!inv || !inv.id) return false;
  if (inv.fechada === false || inv.fechada === 0 || inv.isPreview === true || inv.isOpenCycle === true || inv.mock === true) return false;
  const st = String(inv.status || '').trim().toLowerCase();
  if (!st || ['aberta', 'aberto', 'em aberto', 'open', 'rascunho', 'draft', 'previsao', 'previsão'].includes(st)) return false;
  if (inv.dataFechamentoIso) {
    const closeDate = new Date(inv.dataFechamentoIso);
    if (!isNaN(closeDate.getTime()) && closeDate.getTime() > Date.now()) return false;
  }
  return true;
}

async function getOverageFee(gsOverride = null) {
  const gs = gsOverride || await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
  if (gs && gs.overageFee !== undefined && gs.overageFee !== '') {
    const val = parseFloat(gs.overageFee);
    if (!isNaN(val) && val >= 0) return val;
  }
  const mysqlVal = parseFloat(await getSettingValue('overage_fee', ''));
  if (!isNaN(mysqlVal) && mysqlVal >= 0) return mysqlVal;
  const envVal = parseFloat(process.env.OVERAGE_FEE);
  return (!isNaN(envVal) && envVal >= 0) ? envVal : 19.90;
}

function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) return net.address;
    }
  }
  return 'localhost';
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extraHeaders));
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, fallback = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body || !body.trim()) return resolve(fallback);
      try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function parseJsonSafe(str, fallback = null) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

function getB2bPlanFromMap(planId, plansMap = {}) {
  const merged = Object.assign({}, DEFAULT_B2B_PLANS, plansMap || {});
  if (!planId) return merged.plano_starter || DEFAULT_B2B_PLANS.plano_starter;
  const rawId = String(planId).toLowerCase().trim();
  if (merged[rawId]) return merged[rawId];
  const withPrefix = rawId.startsWith('plano_') ? rawId : `plano_${rawId}`;
  const withoutPrefix = rawId.startsWith('plano_') ? rawId.replace('plano_', '') : rawId;
  if (merged[withPrefix]) return merged[withPrefix];
  if (merged[withoutPrefix]) return merged[withoutPrefix];
  for (const key of Object.keys(merged)) {
    const pl = merged[key];
    if (pl && pl.nome_plano && pl.nome_plano.toLowerCase().trim() === rawId) return pl;
  }
  return merged.plano_starter || DEFAULT_B2B_PLANS.plano_starter;
}

async function loadB2bPlansMap() {
  await initMysqlDatabase();
  const rows = await db.all('SELECT * FROM planos_b2b ORDER BY valor_mensal ASC');
  const map = {};
  for (const r of rows) {
    map[r.id] = { id: r.id, nome_plano: r.nome_plano, limite_lojas: Number(r.limite_lojas || 50), valor_mensal: Number(r.valor_mensal || 0), descricao: r.descricao || '', created_at: r.created_at };
  }
  return Object.keys(map).length > 0 ? map : Object.assign({}, DEFAULT_B2B_PLANS);
}

function mapPartnerRow(row, plansMap = {}) {
  if (!row) return null;
  const plan = getB2bPlanFromMap(row.plano_id || 'plano_starter', plansMap);
  const valorMensal = Number(plan.valor_mensal || 0);
  const limiteLojas = Number(plan.limite_lojas || 50);
  return {
    id: row.id, apiKey: row.api_key || '', name: row.nome || 'Parceiro Sem Nome', nome: row.nome || 'Parceiro Sem Nome',
    cnpj: row.cnpj || '', phone: row.telefone || '', telefone: row.telefone || '', email: row.email || '',
    pin: row.pin || '4546', plano_id: plan.id, plano: plan.id, nome_plano: plan.nome_plano,
    limite_lojas: limiteLojas, limite_tokens: limiteLojas, valor_mensal: valorMensal, valorPorLoja: valorMensal,
    faturaEstimada: valorMensal, dia_vencimento: normalizePartnerDueDay(row.dia_vencimento, 15),
    status: row.status || 'ATIVO', createdAt: row.created_at || new Date().toISOString(), updatedAt: row.updated_at || row.created_at || new Date().toISOString()
  };
}

function mapStoreRow(row) {
  if (!row) return null;
  return {
    id: row.id, tenant_id: row.id, parceiro_id: row.parceiro_id, partnerId: row.parceiro_id,
    name: row.nome_loja, nome_loja: row.nome_loja, cnpj: row.cnpj || '', apiKey: row.api_key, api_key: row.api_key,
    status: row.status || 'ativo', isOverage: Boolean(row.is_overage),
    requisicoesMes: Number(row.requisicoes_mes || 0), requisicoes_mes: Number(row.requisicoes_mes || 0),
    bloqueado_em: row.bloqueado_em || null, createdAt: row.created_at || new Date().toISOString(), data_cadastro: row.created_at || new Date().toISOString()
  };
}

function mapInvoiceRow(row, plansMap = {}) {
  if (!row) return null;
  const plan = row.plano_id ? getB2bPlanFromMap(row.plano_id, plansMap) : null;
  return {
    id: row.id, partnerId: row.parceiro_id, parceiro_id: row.parceiro_id, plano_id: row.plano_id || (plan && plan.id) || null,
    nome_plano: row.nome_plano || (plan && plan.nome_plano) || 'Starter',
    mesReferencia: row.mes_referencia, mes_referencia: row.mes_referencia,
    lojasCobradas: Number(row.lojas_cobradas || 0), lojas_cobradas: Number(row.lojas_cobradas || 0),
    limite_lojas: Number(row.limite_lojas || 50), limiteLojas: Number(row.limite_lojas || 50),
    excedentesQtd: Number(row.excedentes_qtd || 0),
    overageFee: Number(row.overage_fee || 19.90), overageTotal: Number(row.overage_total || 0),
    valor_mensal: Number(row.valor_mensal || row.valor_total || 0), valorTotal: Number(row.valor_total || 0), valor_total: Number(row.valor_total || 0),
    status: row.status || 'Pendente', fechada: row.fechada !== undefined ? Boolean(row.fechada) : true,
    dataFechamento: row.data_fechamento || null, dataVencimento: row.data_vencimento, data_vencimento: row.data_vencimento,
    dataPagamento: row.data_pagamento || null, data_pagamento: row.data_pagamento || null,
    pdfUrl: row.pdf_url || null, paymentId: row.payment_id || null, gateway: row.gateway || null,
    paidBy: row.paid_by || null, autoGenerated: Boolean(row.auto_generated), snapshotAt: row.snapshot_at || null,
    createdAt: row.created_at || new Date().toISOString()
  };
}

function safeIsoDate(val, fallbackIso = null) {
  if (!val) return fallbackIso;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? fallbackIso : val.toISOString();
  }
  const str = String(val).trim();
  if (!str || str.startsWith('0000-00-00')) return fallbackIso;
  const d = new Date(str);
  return isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}

function mapMerchantRow(row) {
  if (!row) return null;
  const phone = cleanDigits(row.telefone);
  const createdIso = safeIsoDate(row.created_at, new Date().toISOString());
  const proExp = row.pro_expires_at || row.pro_expiry || null;
  return {
    phone,
    name: row.nome || 'Lojista',
    pin: row.pin || '1234',
    plano: row.plano || 'free',
    planoCiclo: row.plano_ciclo || null,
    status: row.status || 'ativo',
    hasXmlImport: Boolean(row.has_xml_import),
    trialStartDate: row.trial_start_date || null,
    trialDays: row.trial_days !== undefined && row.trial_days !== null ? Number(row.trial_days) : 14,
    email: row.email || '',
    documento: row.documento || '',
    cpf: row.cpf || '',
    cnpj: row.cnpj || '',
    nicheMode: row.niche_mode || 'mercado',
    redDays: row.red_days !== undefined && row.red_days !== null ? Number(row.red_days) : 7,
    yellowDays: row.yellow_days !== undefined && row.yellow_days !== null ? Number(row.yellow_days) : 30,
    redMonths: row.red_months !== undefined && row.red_months !== null ? Number(row.red_months) : 2,
    yellowMonths: row.yellow_months !== undefined && row.yellow_months !== null ? Number(row.yellow_months) : 6,
    capitalParadoDays: row.capital_parado_days !== undefined && row.capital_parado_days !== null ? Number(row.capital_parado_days) : 90,
    frequencia_alerta: row.frequencia_alerta || 'diario',
    proExpiry: proExp,
    proExpiresAt: proExp,
    lastPayment: parseJsonSafe(row.last_payment_json, null),
    lastXmlPayment: parseJsonSafe(row.last_xml_payment_json, null),
    updatedAt: safeIsoDate(row.updated_at, createdIso),
    createdAt: createdIso
  };
}

function mapProductRow(row) {
  if (!row) return null;
  const extra = parseJsonSafe(row.payload_json, {}) || {};
  return Object.assign({}, extra, {
    id: extra.id !== undefined ? extra.id : row.id,
    ownerPhone: row.owner_phone || extra.ownerPhone || '', name: row.name || extra.name || '',
    barcode: row.barcode || extra.barcode || '', codigo_barras: row.codigo_barras || row.barcode || extra.codigo_barras || '',
    batch: row.batch || extra.batch || 'S/L', expiry: row.expiry || extra.expiry || '',
    qty: row.qty !== undefined && row.qty !== null ? Number(row.qty) : (extra.qty || 1),
    unitPrice: row.unit_price !== undefined && row.unit_price !== null ? Number(row.unit_price) : (extra.unitPrice || 0),
    status: row.status || extra.status || 'ativo', resolvedReason: row.resolved_reason || extra.resolvedReason || '',
    tipo_baixa: extra.tipo_baixa || row.resolved_reason || '', resolvedAt: row.resolved_at || extra.resolvedAt || '',
    data_baixa: extra.data_baixa || row.resolved_at || '',
    data_cadastro: row.data_cadastro || extra.data_cadastro || row.created_at || '',
    data_ultima_movimentacao: row.data_ultima_movimentacao || extra.data_ultima_movimentacao || '',
    updatedAt: row.updated_at || extra.updatedAt || ''
  });
}

function mapPaymentRow(row) {
  if (!row) return null;
  return {
    id: row.id, internalId: row.internal_id || row.id, gateway: row.gateway || 'pix_static',
    environment: row.environment || 'concierge', method: row.method || 'pix', amount: Number(row.amount || 0),
    nome_plano: row.nome_plano || '', description: row.description || '', type: row.type || 'merchant_pro_monthly',
    phone: row.phone || '', partnerId: row.partner_id || '', planId: row.plan_id || '', invoiceId: row.invoice_id || '',
    status: row.status || 'pending', statusDetail: row.status_detail || '', payload_pix: row.payload_pix || '',
    qr_code: row.qr_code || '', chave_pix: row.chave_pix || '', beneficiario: row.beneficiario || '', cidade: row.cidade || '',
    approvedAt: row.approved_at || null, createdAt: row.created_at || new Date().toISOString()
  };
}

async function execWithConn(conn, sql, params) {
  const cleanParams = Array.isArray(params) ? params.map(p => (p === undefined ? null : p)) : [];
  if (conn && typeof conn.query === 'function' && conn !== db) return conn.query(sql, cleanParams);
  return db.run(sql, cleanParams);
}

async function upsertPartner(p, conn = db) {
  const sql = `
    INSERT INTO parceiros (id, nome, cnpj, email, telefone, pin, status, plano_id, api_key, dia_vencimento, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      nome = VALUES(nome), cnpj = VALUES(cnpj), email = VALUES(email), telefone = VALUES(telefone),
      pin = VALUES(pin), status = VALUES(status), plano_id = VALUES(plano_id), api_key = VALUES(api_key),
      dia_vencimento = VALUES(dia_vencimento), updated_at = VALUES(updated_at)`;
  await execWithConn(conn, sql, [
    String(p.id).trim(), String(p.name || p.nome || 'Parceiro Sem Nome').trim(), String(p.cnpj || '').trim(),
    String(p.email || '').trim(), cleanDigits(p.phone || p.telefone || '') || String(p.phone || p.telefone || ''),
    String(p.pin || '4546').trim(), String(p.status || 'ATIVO').trim(), String(p.plano_id || 'plano_starter').trim(),
    String(p.apiKey || p.api_key || '').trim(), normalizePartnerDueDay(p.dia_vencimento ?? p.diaVencimento, 15),
    toMysqlDatetime(p.updatedAt || new Date()), toMysqlDatetime(p.createdAt || new Date())
  ]);
}

async function upsertMerchant(phone, m, conn = db) {
  const cleanPhone = cleanDigits(phone || m.phone || m.telefone);
  if (!cleanPhone) return;
  const proExp = m.proExpiresAt || m.proExpiry || null;
  const sql = `
    INSERT INTO lojistas (
      telefone, nome, pin, plano, plano_ciclo, status, has_xml_import, trial_start_date, trial_days,
      email, documento, cpf, cnpj, niche_mode, red_days, yellow_days, red_months, yellow_months,
      capital_parado_days, frequencia_alerta, pro_expiry, pro_expires_at, last_payment_json, last_xml_payment_json, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      nome = VALUES(nome), pin = VALUES(pin), plano = VALUES(plano), plano_ciclo = VALUES(plano_ciclo), status = VALUES(status),
      has_xml_import = VALUES(has_xml_import), trial_start_date = VALUES(trial_start_date), trial_days = VALUES(trial_days),
      email = VALUES(email), documento = VALUES(documento), cpf = VALUES(cpf), cnpj = VALUES(cnpj),
      niche_mode = VALUES(niche_mode), red_days = VALUES(red_days), yellow_days = VALUES(yellow_days),
      red_months = VALUES(red_months), yellow_months = VALUES(yellow_months), capital_parado_days = VALUES(capital_parado_days),
      frequencia_alerta = VALUES(frequencia_alerta), pro_expiry = VALUES(pro_expiry), pro_expires_at = VALUES(pro_expires_at),
      last_payment_json = VALUES(last_payment_json), last_xml_payment_json = VALUES(last_xml_payment_json), updated_at = VALUES(updated_at)`;
  await execWithConn(conn, sql, [
    cleanPhone, String(m.name || m.nome || 'Lojista').trim(), String(m.pin || '1234').trim(),
    String(m.plano || 'free').trim(), m.planoCiclo || null, String(m.status || 'ativo').trim(), m.hasXmlImport || m.has_xml_import ? 1 : 0,
    m.trialStartDate || m.trial_start_date || null, m.trialDays !== undefined && m.trialDays !== null ? Number(m.trialDays) : 14,
    m.email || '', m.documento || '', m.cpf || '', m.cnpj || '', m.nicheMode || 'mercado',
    m.redDays !== undefined ? Number(m.redDays) : 7, m.yellowDays !== undefined ? Number(m.yellowDays) : 30,
    m.redMonths !== undefined ? Number(m.redMonths) : 2, m.yellowMonths !== undefined ? Number(m.yellowMonths) : 6,
    m.capitalParadoDays !== undefined ? Number(m.capitalParadoDays) : 90, m.frequencia_alerta || 'diario',
    proExp, proExp, m.lastPayment ? JSON.stringify(m.lastPayment) : null,
    m.lastXmlPayment ? JSON.stringify(m.lastXmlPayment) : null, m.updatedAt || new Date().toISOString(),
    toMysqlDatetime(m.createdAt || new Date())
  ]);
}

async function upsertProduct(prod, conn = db) {
  if (!prod || prod.id === undefined || prod.id === null) return;
  const qty = parseInt(prod.qty !== undefined ? prod.qty : (prod.quantity !== undefined ? prod.quantity : (prod.quantidade !== undefined ? prod.quantidade : 1)), 10);
  const unitPrice = parseFloat(prod.unitPrice !== undefined ? prod.unitPrice : (prod.preco_unitario || 0)) || 0;
  const nowIso = new Date().toISOString();
  const sql = `
    INSERT INTO lojistas_produtos (
      id, owner_phone, name, barcode, codigo_barras, batch, expiry, qty, unit_price,
      status, resolved_reason, resolved_at, data_cadastro, data_ultima_movimentacao, payload_json, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      owner_phone = VALUES(owner_phone), name = VALUES(name), barcode = VALUES(barcode), codigo_barras = VALUES(codigo_barras),
      batch = VALUES(batch), expiry = VALUES(expiry), qty = VALUES(qty), unit_price = VALUES(unit_price),
      status = VALUES(status), resolved_reason = VALUES(resolved_reason), resolved_at = VALUES(resolved_at),
      data_cadastro = VALUES(data_cadastro), data_ultima_movimentacao = VALUES(data_ultima_movimentacao),
      payload_json = VALUES(payload_json), updated_at = VALUES(updated_at)`;
  await execWithConn(conn, sql, [
    String(prod.id), cleanDigits(prod.ownerPhone || '11987654321') || '11987654321',
    String(prod.name || 'Produto').trim(), String(prod.barcode || prod.codigo_barras || prod.ean || '').trim(),
    String(prod.codigo_barras || prod.barcode || prod.ean || '').trim(), String(prod.batch || 'S/L').trim(),
    String(prod.expiry || '').trim(), isNaN(qty) ? 1 : qty, unitPrice, String(prod.status || 'ativo').trim(),
    String(prod.resolvedReason || prod.tipo_baixa || '').trim(), prod.resolvedAt || prod.data_baixa || null,
    prod.data_cadastro || prod.createdAt || nowIso, prod.data_ultima_movimentacao || nowIso,
    JSON.stringify(prod), prod.updatedAt || nowIso, toMysqlDatetime(prod.createdAt || nowIso)
  ]);
}

async function upsertPayment(payment) {
  await initMysqlDatabase();
  await db.run(
    `INSERT INTO pagamentos_pix (
      id, internal_id, gateway, environment, method, amount, nome_plano, description, type,
      phone, partner_id, plan_id, invoice_id, status, status_detail, payload_pix, qr_code,
      chave_pix, beneficiario, cidade, approved_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE status = VALUES(status), status_detail = VALUES(status_detail), approved_at = VALUES(approved_at)`,
    [
      String(payment.id), String(payment.internalId || payment.id), String(payment.gateway || 'pix_static'),
      String(payment.environment || 'concierge'), String(payment.method || 'pix'), Number(payment.amount || 0),
      String(payment.nome_plano || ''), String(payment.description || ''), String(payment.type || 'merchant_pro_monthly'),
      String(payment.phone || ''), String(payment.partnerId || ''), String(payment.planId || ''), String(payment.invoiceId || ''),
      String(payment.status || 'pending'), String(payment.statusDetail || ''), String(payment.payload_pix || ''),
      String(payment.qr_code || ''), String(payment.chave_pix || ''), String(payment.beneficiario || ''),
      String(payment.cidade || ''), payment.approvedAt || null, toMysqlDatetime(payment.createdAt || new Date())
    ]
  );
}

async function findPartnerInMysql(rawIdentifier) {
  await initMysqlDatabase();
  const plansMap = await loadB2bPlansMap();
  const rawInput = String(rawIdentifier || '').trim();
  const clean = cleanDigits(rawInput);
  const rows = await db.all('SELECT * FROM parceiros');
  for (const r of rows) {
    const pPhone = cleanDigits(r.telefone || '');
    const pCnpj = cleanDigits(r.cnpj || '');
    const pId = String(r.id || '').toUpperCase().trim();
    const pEmail = String(r.email || '').trim().toLowerCase();
    if ((clean && (clean === pPhone || clean === pCnpj)) || (rawInput && rawInput.toUpperCase() === pId) ||
        (clean && clean === cleanDigits(pId)) || (rawInput && rawInput.toLowerCase() === pEmail && pEmail.length > 3)) {
      return mapPartnerRow(r, plansMap);
    }
  }
  return null;
}

async function computeLivePartnerBillingMysql(targetPartnerId, partnerObj = null, preloadedStores = null) {
  if (!targetPartnerId) return null;
  const plansMap = await loadB2bPlansMap();
  const pIdUpper = String(targetPartnerId).toUpperCase().trim();
  const partner = partnerObj || (await findPartnerInMysql(targetPartnerId)) || { id: targetPartnerId, plano_id: 'plano_starter', dia_vencimento: 15 };
  const partnerPlan = getB2bPlanFromMap(partner.plano_id || partner.plano || 'plano_starter', plansMap);
  const planName = partner.nome_plano || partnerPlan.nome_plano || 'Starter';
  const planLimit = parseInt(partner.limite_lojas || partner.limite_tokens || partnerPlan.limite_lojas || 50, 10);
  const planPrice = parseFloat(partner.valor_mensal !== undefined ? partner.valor_mensal : partnerPlan.valor_mensal);
  const overageFee = await getOverageFee();

  const stores = Array.isArray(preloadedStores)
    ? preloadedStores
    : (await db.all('SELECT * FROM parceiro_lojas WHERE UPPER(parceiro_id) = UPPER(?)', [pIdUpper])).map(mapStoreRow);

  const billing = calculateOverageBilling({ ...partner, limite_lojas: planLimit, valor_mensal: planPrice }, stores, overageFee);
  const partnerDueDay = normalizePartnerDueDay(partner.dia_vencimento ?? partner.diaVencimento, 15);
  const cycle = cronEngine.getOpenBillingCycleInfo(new Date(), partnerDueDay);
  const fmtDate = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

  return {
    ...billing, planName, diaVencimento: partnerDueDay,
    dataFechamento: fmtDate(cycle.closingDate), dataVencimentoPrevisto: fmtDate(cycle.dueDate),
    faturaAberta: {
      status: 'ABERTA', diaVencimento: partnerDueDay,
      dataFechamento: fmtDate(cycle.closingDate), dataVencimentoPrevisto: fmtDate(cycle.dueDate),
      planoNome: planName, limiteLojas: billing.limiteLojas, valorPlano: billing.valorMensal,
      lojasAtivas: billing.totalLojasAtivas, excedentesQtd: billing.excedentesQtd,
      overageFee: billing.overageFee, overageTotal: billing.overageTotal, valorParcialEstimado: billing.valorFinal
    }
  };
}

async function applyDataRetentionMysql() {
  await initMysqlDatabase();
  const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
  const retentionDays = parseInt(gs.retentionDays || 90, 10);
  if (retentionDays <= 0) return 0;

  const productRows = await db.all('SELECT * FROM lojistas_produtos');
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const row of productRows) {
    const p = mapProductRow(row);
    if (p.status !== 'baixado' && p.status !== 'resolvido' && p.status !== 'descartado') continue;
    const recordTime = p.resolvedAt ? new Date(p.resolvedAt).getTime() : (p.expiry ? new Date(p.expiry).getTime() : (typeof p.id === 'number' && p.id > 1000000000 ? p.id : 0));
    if (!recordTime || (now - recordTime) >= maxAgeMs) {
      await db.run('DELETE FROM lojistas_produtos WHERE id = ?', [String(row.id)]);
      removed++;
    }
  }
  return removed;
}

async function safeSelectAll(sql, label) {
  try {
    return await db.all(sql);
  } catch (err) {
    console.warn(`⚠️ [MYSQL SNAPSHOT ${label}]:`, err.message);
    return [];
  }
}

async function loadFullStateSnapshot() {
  await initMysqlDatabase();
  const plansMap = await loadB2bPlansMap();
  const [merchantRows, repList, productRows, partnerRows, storeRows, invoiceRows, paymentRows, globalSettings, adminCredentials, config] = await Promise.all([
    safeSelectAll('SELECT * FROM lojistas', 'lojistas'),
    getRepositoresMysql(''),
    safeSelectAll('SELECT * FROM lojistas_produtos', 'lojistas_produtos'),
    safeSelectAll('SELECT * FROM parceiros', 'parceiros'),
    safeSelectAll('SELECT * FROM parceiro_lojas ORDER BY created_at DESC', 'parceiro_lojas'),
    safeSelectAll('SELECT * FROM faturas_parceiros ORDER BY created_at DESC', 'faturas_parceiros'),
    safeSelectAll('SELECT * FROM pagamentos_pix ORDER BY created_at DESC', 'pagamentos_pix'),
    getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS),
    getSettingJson('adminCredentials', DEFAULT_ADMIN_CREDENTIALS),
    getSettingJson('config', DEFAULT_SYSTEM_CONFIG)
  ]);

  const merchants = {};
  for (const row of merchantRows) { const m = mapMerchantRow(row); if (m && m.phone) merchants[m.phone] = m; }
  const repositores = {};
  for (const rep of repList) { if (rep && rep.phone) repositores[cleanDigits(rep.phone)] = rep; }

  const partnerStores = storeRows.map(mapStoreRow);
  const partners = {};
  for (const row of partnerRows) {
    const p = mapPartnerRow(row, plansMap);
    if (!p) continue;
    const pStores = partnerStores.filter(s => String(s.partnerId || '').toUpperCase() === String(p.id).toUpperCase());
    const activeStores = pStores.filter(s => !s.status || String(s.status).toLowerCase() === 'ativo');
    p.storesCount = pStores.length;
    p.activeStoresCount = activeStores.length;
    p.totalReqs = pStores.reduce((sum, s) => sum + (Number(s.requisicoesMes) || 0), 0);
    partners[p.id] = p;
  }

  const payments = {};
  for (const row of paymentRows) { const pay = mapPaymentRow(row); if (pay && pay.id) payments[pay.id] = pay; }

  return {
    merchants, repositores, products: productRows.map(mapProductRow), partners, partnerStores,
    partnerInvoices: invoiceRows.map(r => mapInvoiceRow(r, plansMap)),
    b2bPlans: plansMap, globalSettings, adminCredentials, config, payments
  };
}

function getActiveMpCredentials(settings) {
  const gs = settings || {};
  const isSandbox = (gs.mp_environment === 'sandbox' || gs.mpEnvironment === 'sandbox');
  let accessToken = isSandbox ? (gs.mp_access_token_test || gs.mpAccessTokenTest || '') : (gs.mp_access_token_prod || gs.mpAccessTokenProd || '');
  let publicKey = isSandbox ? (gs.mp_public_key_test || gs.mpPublicKeyTest || '') : (gs.mp_public_key_prod || gs.mpPublicKeyProd || '');
  if (!accessToken && gs.mpAccessToken) accessToken = gs.mpAccessToken;
  if (!publicKey && gs.mpPublicKey) publicKey = gs.mpPublicKey;
  return { environment: isSandbox ? 'sandbox' : 'production', isSandbox, accessToken: (accessToken || '').trim(), publicKey: (publicKey || '').trim() };
}

function callMercadoPagoApi(endpoint, method, token, data) {
  return new Promise((resolve) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: 'api.mercadopago.com', port: 443, path: endpoint, method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `mp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}` }
    };
    if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); } catch (e) { resolve({ status: res.statusCode, raw: body, data: { message: body } }); } });
    });
    req.on('error', err => resolve({ status: 502, error: err.message, data: { message: err.message } }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 504, error: 'Timeout MP', data: { message: 'Timeout na API do Mercado Pago' } }); });
    if (postData) req.write(postData);
    req.end();
  });
}

function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = ((crc & 0x8000) !== 0) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function emvField(id, value) { const s = String(value); return `${id}${String(s.length).padStart(2, '0')}${s}`; }

function generatePixEmvCo({ key = '38032274880', name = 'Fernando Alves', city = 'Caieiras', amount, txid = '***', description }) {
  const cleanName = (name || 'Fernando Alves').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().substring(0, 25);
  const cleanCity = (city || 'Caieiras').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().substring(0, 15);
  let merchantAccountInfo = emvField('00', 'br.gov.bcb.pix') + emvField('01', String(key || '38032274880').trim());
  if (description) merchantAccountInfo += emvField('02', String(description).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().substring(0, 25));

  let payload = emvField('00', '01') + emvField('26', merchantAccountInfo) + emvField('52', '0000') + emvField('53', '986');
  if (amount && parseFloat(amount) > 0) payload += emvField('54', parseFloat(amount).toFixed(2));
  payload += emvField('58', 'BR') + emvField('59', cleanName) + emvField('60', cleanCity) + emvField('62', emvField('05', (txid || '***').substring(0, 25))) + '6304';
  return payload + crc16(payload);
}

async function processPaymentActivation(payment) {
  if (!payment) return false;
  await initMysqlDatabase();
  payment.status = 'approved';
  payment.approvedAt = new Date().toISOString();
  await db.run('UPDATE pagamentos_pix SET status = ?, approved_at = ? WHERE id = ?', ['approved', payment.approvedAt, String(payment.id)]);

  const type = payment.type || '';
  if (type === 'merchant_pro_monthly' || type === 'merchant_pro_annual' || type === 'merchant_xml') {
    const phone = cleanDigits(payment.phone || payment.merchantPhone || '');
    if (phone) {
      const mRow = await db.get('SELECT * FROM lojistas WHERE telefone = ?', [phone]);
      if (mRow) {
        const m = mapMerchantRow(mRow);
        if (type === 'merchant_xml') {
          m.hasXmlImport = true;
          if (m.plano !== 'premium') m.plano = 'automacao';
          m.status = 'ativo';
          m.lastXmlPayment = { amount: payment.amount, date: new Date().toISOString(), paymentId: payment.id, gateway: 'mercadopago_pix' };
        } else {
          const days = type === 'merchant_pro_annual' ? 365 : 30;
          m.plano = 'premium';
          m.status = 'ativo';
          m.proExpiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          m.lastPayment = { amount: payment.amount, date: new Date().toISOString(), paymentId: payment.id, gateway: 'mercadopago_pix' };
        }
        await upsertMerchant(phone, m);
      }
    }
  } else if (type === 'partner_plan_upgrade' || type === 'partner_plan') {
    const pid = String(payment.partnerId || payment.parceiro_id || '').trim();
    const planId = String(payment.planId || payment.plano_id || '').trim();
    if (pid) {
      const pRow = await db.get('SELECT * FROM parceiros WHERE id = ?', [pid]);
      if (pRow) {
        const plansMap = await loadB2bPlansMap();
        const newPlan = getB2bPlanFromMap(planId, plansMap);
        await db.run('UPDATE parceiros SET plano_id = ?, status = ?, updated_at = ? WHERE id = ?', [newPlan.id, 'ATIVO', toMysqlDatetime(new Date()), pid]);
        const countRow = await db.get("SELECT COUNT(*) AS cnt FROM parceiro_lojas WHERE parceiro_id = ? AND (status = 'ativo' OR status IS NULL)", [pid]);
        const invoiceCode = `FAT-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await db.run(
          `INSERT INTO faturas_parceiros (id, parceiro_id, plano_id, nome_plano, mes_referencia, lojas_cobradas, limite_lojas, valor_mensal, valor_total, status, fechada, data_vencimento, data_pagamento, payment_id, gateway, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceCode, pid, newPlan.id, newPlan.nome_plano,
            `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`,
            Number((countRow && countRow.cnt) || 0), newPlan.limite_lojas, newPlan.valor_mensal,
            Number(payment.amount || newPlan.valor_mensal), 'Paga', 1, new Date().toISOString().split('T')[0],
            toMysqlDatetime(new Date()), String(payment.id), 'mercadopago_pix', toMysqlDatetime(new Date())
          ]
        );
      }
    }
  } else if (type === 'partner_invoice') {
    const invId = String(payment.invoiceId || '').trim();
    if (invId) {
      await db.run('UPDATE faturas_parceiros SET status = ?, data_pagamento = ?, payment_id = ?, gateway = ? WHERE id = ?', ['Paga', toMysqlDatetime(new Date()), String(payment.id), 'mercadopago_pix', invId]);
    }
  }
  return true;
}

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const XML_UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads', 'xml_nfe');
if (!fs.existsSync(XML_UPLOADS_DIR)) fs.mkdirSync(XML_UPLOADS_DIR, { recursive: true });

function cleanupExpiredXmlFiles() {
  try {
    if (!fs.existsSync(XML_UPLOADS_DIR)) return;
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(XML_UPLOADS_DIR)) {
      try {
        const fp = path.join(XML_UPLOADS_DIR, file);
        if ((now - fs.statSync(fp).mtimeMs) > SEVEN_DAYS_MS) fs.unlinkSync(fp);
      } catch (e) {}
    }
  } catch (err) {}
}

cleanupExpiredXmlFiles();
const xmlCleanupTimer = setInterval(cleanupExpiredXmlFiles, 60 * 60 * 1000);
if (typeof xmlCleanupTimer.unref === 'function') xmlCleanupTimer.unref();

const requirePartnerAuth = createRequirePartnerAuth();

async function handleApiRequest(req, res, pathname) {
  if (pathname === '/api/cleanup-retention' && req.method === 'POST') {
    try { sendJson(res, 200, { success: true, removed: await applyDataRetentionMysql() }); }
    catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/backup' || pathname === '/api/backup.json') && req.method === 'GET') {
    try {
      const snapshot = await loadFullStateSnapshot();
      const filename = `alerta_vencimento_backup_${new Date().toISOString().slice(0, 10)}.json`;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
      res.end(JSON.stringify(snapshot, null, 2));
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    try {
      sendJson(res, 200, await loadFullStateSnapshot(), { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // POST /auth/parceiro
  if ((pathname === '/auth/parceiro' || pathname === '/api/auth/parceiro' || pathname === '/api/login/parceiro' || pathname === '/api/parceiro/login') && req.method === 'POST') {
    try {
      const { phone, cnpj, email, id, tenantId, identifier, pin } = await readJsonBody(req);
      const rawInput = (identifier || phone || cnpj || email || id || tenantId || '').trim();
      const clean = cleanDigits(rawInput);
      const cleanPin = (pin || '').trim();
      const foundPartner = await findPartnerInMysql(rawInput);
      if (!foundPartner || (foundPartner.pin || '4546').trim() !== cleanPin) {
        sendJson(res, 401, { success: false, error: GENERIC_AUTH_ERROR });
        return true;
      }
      if (String(foundPartner.status || 'ATIVO').trim().toUpperCase() !== 'ATIVO') {
        sendJson(res, 403, { success: false, error: 'Acesso do parceiro inativo ou bloqueado pelo administrador. Contate o suporte para reativação.', code: 'PARTNER_INACTIVE' });
        return true;
      }
      await registerLog(foundPartner.id, 'PARCEIRO', 'LOGIN_PARCEIRO', { nome: foundPartner.name, plano: foundPartner.nome_plano });
      sendJson(res, 200, {
        success: true, role: 'PARCEIRO', redirect: '/dashboard-parceiro',
        token: `token_parc_${foundPartner.id}_${Date.now().toString(36)}`,
        user: {
          id: foundPartner.id, parceiro_id: foundPartner.id, partnerId: foundPartner.id, name: foundPartner.name, nome: foundPartner.name,
          cnpj: foundPartner.cnpj || '', phone: foundPartner.phone || clean, telefone: foundPartner.phone || clean, email: foundPartner.email || '',
          plano_id: foundPartner.plano_id, plano: foundPartner.plano_id, nome_plano: foundPartner.nome_plano,
          limite_lojas: foundPartner.limite_lojas, limite_tokens: foundPartner.limite_lojas, valor_mensal: foundPartner.valor_mensal,
          dia_vencimento: foundPartner.dia_vencimento || 15, role: 'PARCEIRO', status: 'ATIVO'
        }
      });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro interno ao processar login do parceiro: ' + err.message }); }
    return true;
  }

  // POST /auth/admin (com Bypass Super Admin PIN 4546)
  if ((pathname === '/auth/admin' || pathname === '/api/auth/admin' || pathname === '/api/admin/login') && req.method === 'POST') {
    try {
      const { pin, phone, identifier } = await readJsonBody(req);
      const cleanPin = String(pin || '').trim();
      const rawPhone = cleanDigits(phone || identifier || '');
      const isMasterPhone = !rawPhone || rawPhone === '11996466498' || rawPhone === '5511996466498';

      if (cleanPin === '4546' && isMasterPhone) {
        registerLog('11996466498', 'SUPER_ADMIN', 'LOGIN_SUPER_ADMIN_MASTER_BYPASS', { status: 'SUCESSO' }).catch(() => {});
        sendJson(res, 200, {
          success: true, role: 'ADMIN', redirect: '/admin',
          token: `token_admin_master_${Date.now().toString(36)}`,
          user: { phone: '11996466498', name: 'Administrador Master', role: 'ADMIN', plano: 'master' }
        });
        return true;
      }

      await initMysqlDatabase();
      const adminCreds = await getSettingJson('adminCredentials', DEFAULT_ADMIN_CREDENTIALS);
      const adminPhone = cleanDigits(adminCreds.phone || '11996466498');
      const adminPin = String(adminCreds.pin || '4546').trim();
      if (cleanPin === adminPin && (!rawPhone || rawPhone === adminPhone)) {
        registerLog(adminPhone || 'MASTER_ADMIN', 'SUPER_ADMIN', 'LOGIN_SUPER_ADMIN', { status: 'SUCESSO' }).catch(() => {});
        sendJson(res, 200, {
          success: true, role: 'ADMIN', redirect: '/admin', token: `token_admin_${Date.now().toString(36)}`,
          user: { phone: adminPhone, name: adminCreds.name || 'Administrador Master', role: 'ADMIN', plano: 'master' }
        });
      } else {
        sendJson(res, 401, { success: false, error: GENERIC_AUTH_ERROR });
      }
    } catch (e) { sendJson(res, 500, { success: false, error: e.message }); }
    return true;
  }

  // POST /auth/lojista
  if ((pathname === '/auth/lojista' || pathname === '/api/auth/lojista' || pathname === '/api/login') && req.method === 'POST') {
    try {
      const { phone, pin, identifier } = await readJsonBody(req);
      const rawInput = (identifier || phone || '').trim();
      const clean = cleanDigits(rawInput);
      const cleanPin = (pin || '').trim();

      if ((clean === '11996466498' || clean === '5511996466498') && cleanPin === '4546') {
        registerLog('11996466498', 'SUPER_ADMIN', 'LOGIN_SUPER_ADMIN_MASTER_BYPASS', { status: 'SUCESSO' }).catch(() => {});
        sendJson(res, 200, {
          success: true, role: 'ADMIN', redirect: '/admin', token: `token_admin_master_${Date.now().toString(36)}`,
          user: { phone: '11996466498', name: 'Administrador Master', role: 'ADMIN', plano: 'master' }
        });
        return true;
      }

      await initMysqlDatabase();
      if (await findPartnerInMysql(rawInput)) {
        sendJson(res, 401, { success: false, error: GENERIC_AUTH_ERROR });
        return true;
      }

      let mRow = clean ? await db.get('SELECT * FROM lojistas WHERE telefone = ?', [clean]) : null;
      if (!mRow && clean) {
        const allMerchants = await db.all('SELECT * FROM lojistas');
        mRow = allMerchants.find(m => cleanDigits(m.telefone) === clean || (m.cnpj && cleanDigits(m.cnpj) === clean)) || null;
      }

      if (mRow) {
        const m = mapMerchantRow(mRow);
        if ((m.pin || '').trim() !== cleanPin) { sendJson(res, 401, { success: false, error: GENERIC_AUTH_ERROR }); return true; }
        if (String(m.status || 'ativo').toLowerCase() === 'bloqueado') {
          sendJson(res, 403, { success: false, error: 'Conta do lojista bloqueada pelo administrador. Entre em contato com o suporte.', code: 'MERCHANT_BLOCKED' });
          return true;
        }
        await registerLog(m.phone, 'LOJISTA', 'LOGIN_LOJISTA', { nome: m.name, plano: m.plano || 'free' });
        sendJson(res, 200, {
          success: true, role: 'LOJISTA', redirect: '/dashboard-lojista',
          user: { phone: m.phone, name: m.name, email: m.email || '', documento: m.documento || m.cnpj || m.cpf || '', role: 'LOJISTA', plano: m.plano || 'free', hasXmlImport: !!m.hasXmlImport, status: m.status || 'ativo' }
        });
        return true;
      }

      const rep = clean ? await findRepositorByPhoneMysql(clean) : null;
      if (rep) {
        if ((rep.pin || '').trim() !== cleanPin) { sendJson(res, 401, { success: false, error: GENERIC_AUTH_ERROR }); return true; }
        if (String(rep.status || 'ativo').toLowerCase() === 'bloqueado') { sendJson(res, 403, { success: false, error: 'Acesso do funcionário bloqueado pelo lojista.' }); return true; }
        await registerLog(clean, 'REPOSITOR', 'LOGIN_REPOSITOR', { nome: rep.name, storeOwnerPhone: rep.storeOwnerPhone || rep.tenantId });
        sendJson(res, 200, {
          success: true, role: 'REPOSITOR', redirect: '/leitor',
          user: { phone: clean, name: rep.name, role: 'REPOSITOR', storeOwnerPhone: rep.storeOwnerPhone || rep.tenantId, storeName: rep.storeName || 'Estoque', status: rep.status || 'ativo' }
        });
        return true;
      }

      sendJson(res, 401, { success: false, error: GENERIC_AUTH_ERROR });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro interno ao autenticar: ' + err.message }); }
    return true;
  }

  // Repositores CRUD
  if ((pathname === '/api/repositores' || pathname === '/api/v1/repositores') && req.method === 'GET') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const tenantId = cleanDigits(urlObj.searchParams.get('tenantId') || urlObj.searchParams.get('storeId') || '');
      sendJson(res, 200, { success: true, repositores: await getRepositoresMysql(tenantId) });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/repositores' || pathname === '/api/v1/repositores') && req.method === 'POST') {
    try {
      const { tenantId, storeId, phone, pin, name } = await readJsonBody(req);
      const cleanPhone = cleanDigits(phone);
      const cleanPin = (pin || '').trim();
      const cleanTenant = cleanDigits(tenantId || storeId);
      if (!cleanPhone || cleanPhone.length < 10) { sendJson(res, 400, { success: false, error: 'Informe um WhatsApp válido para o Repositor com DDD.' }); return true; }
      if (!cleanPin || cleanPin.length !== 4) { sendJson(res, 400, { success: false, error: 'O PIN do Repositor deve ter exatamente 4 dígitos numéricos.' }); return true; }
      if (!cleanTenant) { sendJson(res, 400, { success: false, error: 'Identificador da loja (tenantId) não informado.' }); return true; }

      await initMysqlDatabase();
      const mRow = await db.get('SELECT nome FROM lojistas WHERE telefone = ?', [cleanTenant]);
      const storeName = (mRow && mRow.nome) || 'Seu Mercado';
      const existingRep = await findRepositorByPhoneMysql(cleanPhone);
      const repRecord = { phone: cleanPhone, pin: cleanPin, name: (name || 'Repositor').trim(), tenantId: cleanTenant, storeName, status: 'ativo', createdAt: existingRep ? existingRep.createdAt : new Date().toISOString() };
      const mysqlResult = await insertRepositorMysql(repRecord);
      await registerLog(cleanTenant, 'LOJISTA', 'CREATE_REPOSITOR', { repositor_phone: cleanPhone, nome: repRecord.name, loja: storeName });
      const welcomeMessage = `Fala! O *${storeName}* liberou seu acesso ao Scanner de Validade. Seu PIN é: *${cleanPin}*. Acesse o sistema por aqui: http://${req.headers.host || ('localhost:' + PORT)}`;
      sendJson(res, 200, { success: true, changes: mysqlResult ? mysqlResult.changes : 1, repositor: repRecord, welcomeMessage, whatsappUrl: `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(welcomeMessage)}` });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro interno ao salvar repositor: ' + err.message }); }
    return true;
  }

  if ((pathname === '/api/repositores' || pathname === '/api/v1/repositores') && req.method === 'DELETE') {
    try {
      const { phone, tenantId, storeId } = await readJsonBody(req);
      const cleanPhone = cleanDigits(phone);
      const cleanTenant = cleanDigits(tenantId || storeId);
      const delRes = await deleteRepositorMysql(cleanPhone, cleanTenant);
      if (delRes && delRes.changes > 0) {
        await registerLog(cleanTenant || 'LOJISTA', 'LOJISTA', 'DELETE_REPOSITOR', { repositor_phone: cleanPhone });
        sendJson(res, 200, { success: true, changes: delRes.changes });
        return true;
      }
      sendJson(res, 404, { success: false, error: 'Repositor não encontrado para esta loja.' });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro ao remover repositor.' }); }
    return true;
  }

  // Capital Parado
  if (pathname === '/api/capital-parado' && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const urlObj = new URL(req.url, 'http://localhost');
      const tenantId = cleanDigits(urlObj.searchParams.get('tenantId') || '');
      const mRow = tenantId ? await db.get('SELECT capital_parado_days FROM lojistas WHERE telefone = ?', [tenantId]) : null;
      const configuredDays = parseInt(urlObj.searchParams.get('days') || (mRow && mRow.capital_parado_days) || 90, 10);
      const productRows = tenantId ? await db.all('SELECT * FROM lojistas_produtos WHERE owner_phone = ?', [tenantId]) : await db.all('SELECT * FROM lojistas_produtos');
      const now = Date.now();
      const slowMovingProducts = productRows.map(mapProductRow).filter(p => {
        if (!p || p.status === 'baixado' || p.status === 'resolvido' || p.status === 'descartado') return false;
        const regDateStr = p.data_cadastro || p.createdAt || p.data_ultima_movimentacao || (p.id ? new Date(p.id).toISOString() : null);
        let regTime = regDateStr ? new Date(regDateStr).getTime() : now;
        if (isNaN(regTime)) regTime = now;
        p._idleDays = Math.max(0, Math.floor((now - regTime) / (1000 * 60 * 60 * 24)));
        return p._idleDays >= configuredDays;
      }).map(p => ({ id: p.id, name: p.name, batch: p.batch || 'S/L', expiry: p.expiry, data_cadastro: p.data_cadastro || p.createdAt || new Date(p.id || now).toISOString(), data_ultima_movimentacao: p.data_ultima_movimentacao || p.data_cadastro || p.createdAt || new Date().toISOString(), idleDays: p._idleDays, ownerPhone: p.ownerPhone }));
      slowMovingProducts.sort((a, b) => b.idleDays - a.idleDays);
      sendJson(res, 200, { success: true, tenantId, thresholdDays: configuredDays, count: slowMovingProducts.length, products: slowMovingProducts });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // Crons manuais
  if (pathname === '/api/cron/daily-alerts' && req.method === 'POST') {
    try { sendJson(res, 200, await cronEngine.runDailyRedAlerts()); } catch (err) { sendJson(res, 500, { error: err.message }); }
    return true;
  }
  if (pathname === '/api/cron/monthly-roi' && req.method === 'POST') {
    try { sendJson(res, 200, await cronEngine.runMonthlyRoiRecap()); } catch (err) { sendJson(res, 500, { error: err.message }); }
    return true;
  }
  if (pathname === '/api/cron/partner-billing' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const simDate = payload.simulatedDate ? new Date(payload.simulatedDate) : new Date();
      sendJson(res, 200, await cronEngine.runPartnerBillingAutomation(simDate));
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // API v1 B2B (PDVs + FIFO MySQL)
  if ((pathname === '/api/v1/products/alerts' || pathname === '/api/v1/alerts') && req.method === 'GET') {
    let authorized = false;
    await requirePartnerAuth(req, res, () => { authorized = true; });
    if (!authorized) return true;
    try {
      await db.run('UPDATE parceiro_lojas SET requisicoes_mes = COALESCE(requisicoes_mes, 0) + 1 WHERE id = ?', [req.store_id]);
      const mysqlLotes = await db.all('SELECT id, codigo_barras, nome, lote, data_validade, quantidade, preco_unitario FROM Produtos_Lotes WHERE tenant_id = ? AND quantidade > 0 ORDER BY data_validade ASC', [req.store_id]);
      const alerts = [];
      for (const l of mysqlLotes) {
        const diff = daysDiff(l.data_validade);
        if (diff <= 30) {
          const isHardBlock = diff <= 0;
          alerts.push({
            id: l.id, ean: l.codigo_barras, codigo_barras: l.codigo_barras, name: l.nome, batch: l.lote || 'LT-PDV',
            quantity: l.quantidade, unit_price: parseFloat(l.preco_unitario || 0), expiry_date: l.data_validade,
            days_remaining: diff, alert_level: isHardBlock ? 'vencido' : (diff <= 7 ? 'vermelho' : 'amarelo'),
            hard_block: isHardBlock, action: isHardBlock ? 'BLOQUEAR_VENDA' : 'ALERTA_APROXIMACAO',
            sanitary_status: isHardBlock ? 'PROIBIDO_VENDA_ANVISA' : 'PERMITIDO_COM_ALERTA',
            instruction: isHardBlock ? 'BLOQUEIO FÍSICO OBRIGATÓRIO: Produto com validade expirada. Impedir leitura no checkout.' : `Alerta Comercial: Validade expira em ${diff} dias. Aplicar desconto ou priorizar na gôndola.`
          });
        }
      }
      alerts.sort((a, b) => a.days_remaining - b.days_remaining);
      const hardBlocksCount = alerts.filter(a => a.hard_block).length;
      sendJson(res, 200, { success: true, tenant_id: req.store_id, store_name: req.store.name, timestamp: new Date().toISOString(), today: new Date().toISOString().split('T')[0], total_alerts: alerts.length, hard_blocks_count: hardBlocksCount, requires_immediate_action: hardBlocksCount > 0, products: alerts });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/v1/products/sync' || pathname === '/api/v1/sync') && req.method === 'POST') {
    let authorized = false;
    await requirePartnerAuth(req, res, () => { authorized = true; });
    if (!authorized) return true;
    try { await handleProductSync(req, res, await readJsonBody(req)); } catch (err) { sendJson(res, 400, { success: false, error: 'Payload JSON inválido: ' + err.message }); }
    return true;
  }

  if ((pathname === '/api/v1/products/checkout' || pathname === '/api/v1/checkout') && req.method === 'POST') {
    let authorized = false;
    await requirePartnerAuth(req, res, () => { authorized = true; });
    if (!authorized) return true;
    try { await handleProductCheckout(req, res, await readJsonBody(req)); } catch (err) { sendJson(res, 400, { success: false, error: 'Payload JSON inválido: ' + err.message }); }
    return true;
  }

  // A. GET /api/partner/dashboard (Overage + Fatura Aberta)
  if (pathname === '/api/partner/dashboard' && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const urlObj = new URL(req.url, 'http://localhost');
      const partnerId = (urlObj.searchParams.get('partnerId') || urlObj.searchParams.get('parceiro_id') || '').trim();
      const partner = (partnerId ? await findPartnerInMysql(partnerId) : null) || { id: partnerId || 'PARC-001', name: 'Parceiro Integrador PDV', cnpj: '', plano_id: 'plano_starter', dia_vencimento: 15 };
      const partnerPlan = getB2bPlanFromMap(partner.plano_id || partner.plano || 'plano_starter', plansMap);
      const planName = partner.nome_plano || partnerPlan.nome_plano || 'Starter';
      const planLimit = parseInt(partner.limite_tokens || partner.limite_lojas || partnerPlan.limite_lojas || 50, 10);
      const planPrice = parseFloat(partner.valor_mensal !== undefined ? partner.valor_mensal : partnerPlan.valor_mensal);

      const storeRows = partner.id ? await db.all('SELECT * FROM parceiro_lojas WHERE UPPER(parceiro_id) = UPPER(?) ORDER BY created_at DESC', [partner.id]) : [];
      const stores = storeRows.map(mapStoreRow);
      const totalReqs = stores.reduce((sum, s) => sum + (parseInt(s.requisicoesMes, 10) || 0), 0);

      const billing = await computeLivePartnerBillingMysql(partner.id, partner, stores);
      const faturaEstimada = billing.valorFinal;
      const invoiceRows = partner.id ? await db.all('SELECT * FROM faturas_parceiros WHERE UPPER(parceiro_id) = UPPER(?) ORDER BY created_at DESC', [partner.id]) : [];
      const invoices = invoiceRows.map(r => mapInvoiceRow(r, plansMap)).filter(inv => isClosedPartnerInvoice(inv));

      sendJson(res, 200, {
        success: true,
        partner: Object.assign({}, partner, { plano_id: partnerPlan.id, nome_plano: planName, limite_lojas: planLimit, valor_mensal: planPrice, dia_vencimento: billing.diaVencimento }),
        plano: { id: partnerPlan.id, nome_plano: planName, limite_lojas: planLimit, valor_mensal: planPrice },
        plano_texto: `Plano: ${planName} | Uso: ${billing.totalLojasAtivas} / ${planLimit} Tokens`,
        totalLojasAtivas: billing.totalLojasAtivas, total_lojas_ativas: billing.totalLojasAtivas, totalLojasGeral: stores.length,
        limiteLojas: planLimit, uso_percentual: planLimit > 0 ? Math.round((billing.totalLojasAtivas / planLimit) * 100) : 0,
        requisicoesMes: totalReqs, valorUnitario: planPrice, overageFee: billing.overageFee, overageCount: billing.excedentesQtd,
        overageTotal: billing.overageTotal, faturaAtualEstimada: faturaEstimada, faturaAberta: billing.faturaAberta,
        stores, lojas: stores, invoices, faturas: invoices,
        metrics: { totalStores: billing.totalLojasAtivas, totalRequestsMonth: totalReqs, overageFee: billing.overageFee, overageCount: billing.excedentesQtd, overageTotal: billing.overageTotal, estimatedInvoiceAmount: faturaEstimada }
      });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // B1. GET /api/partner/lojas
  if ((pathname === '/api/partner/lojas' || pathname === '/api/partner/stores' || pathname === '/api/v1/partner/lojas' || pathname === '/api/v1/partner/stores') && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const urlObj = new URL(req.url, 'http://localhost');
      const pId = (urlObj.searchParams.get('partnerId') || urlObj.searchParams.get('parceiro_id') || '').trim();
      const rows = pId ? await db.all('SELECT * FROM parceiro_lojas WHERE UPPER(parceiro_id) = UPPER(?) ORDER BY created_at DESC', [pId]) : await db.all('SELECT * FROM parceiro_lojas ORDER BY created_at DESC');
      const stores = rows.map(mapStoreRow);
      sendJson(res, 200, { success: true, total: stores.length, lojas: stores, stores });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // B2. POST /api/partner/lojas (permite Excedentes / Overage)
  if ((pathname === '/api/partner/lojas' || pathname === '/api/partner/stores' || pathname === '/api/v1/partner/lojas' || pathname === '/api/v1/partner/stores') && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const cleanName = (payload.name || payload.nome_loja || payload.nome || '').trim();
      const cleanCnpj = (payload.cnpj || '').trim();
      const resolvedPartnerId = (payload.partnerId || payload.parceiro_id || payload.partner_id || req.headers['x-parceiro-id'] || req.headers['x-partner-id'] || '').trim();
      if (!cleanName || !cleanCnpj) { sendJson(res, 400, { success: false, error: 'Nome da loja e CNPJ são obrigatórios.' }); return true; }

      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      let targetPartnerId = resolvedPartnerId;
      if (!targetPartnerId) {
        const allPartners = await db.all('SELECT id FROM parceiros');
        targetPartnerId = allPartners.length === 1 ? allPartners[0].id : 'PARC-001';
      }
      const partner = await findPartnerInMysql(targetPartnerId);
      if (partner && (String(partner.status || '').toLowerCase() === 'bloqueado' || String(partner.status || '').toLowerCase() === 'inativo')) {
        sendJson(res, 403, { success: false, error: 'Parceiro bloqueado pelo administrador. Cadastro de lojas e geração de tokens suspensos.', code: 'PARTNER_BLOCKED' });
        return true;
      }

      const partnerPlan = getB2bPlanFromMap(partner ? partner.plano_id : 'plano_starter', plansMap);
      const planLimit = parseInt((partner && (partner.limite_lojas || partner.limite_tokens)) || partnerPlan.limite_lojas || 50, 10);
      const activeRows = await db.all("SELECT id FROM parceiro_lojas WHERE UPPER(parceiro_id) = UPPER(?) AND (status = 'ativo' OR status IS NULL)", [targetPartnerId]);
      const isOverage = activeRows.length >= planLimit;

      const tenantId = `TNT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const apiKey = `ak_live_${crypto.randomBytes(16).toString('hex')}`;
      const nowIso = new Date().toISOString();

      await db.run(
        'INSERT INTO parceiro_lojas (id, parceiro_id, nome_loja, cnpj, api_key, status, is_overage, requisicoes_mes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [tenantId, targetPartnerId, cleanName, cleanCnpj, apiKey, 'ativo', isOverage ? 1 : 0, 0, toMysqlDatetime(nowIso)]
      );

      const newStore = { id: tenantId, tenant_id: tenantId, parceiro_id: targetPartnerId, partnerId: targetPartnerId, name: cleanName, nome_loja: cleanName, cnpj: cleanCnpj, apiKey, api_key: apiKey, status: 'ativo', isOverage, requisicoesMes: 0, requisicoes_mes: 0, createdAt: nowIso, data_cadastro: nowIso };
      const billing = await computeLivePartnerBillingMysql(targetPartnerId, partner);

      sendJson(res, 201, {
        success: true, isOverage, overageFee: billing ? billing.overageFee : await getOverageFee(),
        excedentesQtd: billing ? billing.excedentesQtd : Math.max(0, (activeRows.length + 1) - planLimit),
        valorTotalEstimado: billing ? billing.valorFinal : undefined,
        loja: newStore, store: newStore, tenant: newStore, uso_franquia: `${activeRows.length + 1} / ${planLimit} Tokens`
      });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha interna ao cadastrar loja.' }); }
    return true;
  }

  if ((pathname === '/api/partner/stores/toggle-block' || pathname === '/api/partner/lojas/status') && req.method === 'POST') {
    try {
      const { storeId, blocked } = await readJsonBody(req);
      await initMysqlDatabase();
      const storeRow = await db.get('SELECT * FROM parceiro_lojas WHERE id = ?', [String(storeId || '')]);
      if (!storeRow) { sendJson(res, 404, { success: false, error: 'Loja não encontrada.' }); return true; }

      const newStatus = blocked ? 'bloqueado' : 'ativo';
      await db.run('UPDATE parceiro_lojas SET status = ?, bloqueado_em = ? WHERE id = ?', [newStatus, blocked ? new Date().toISOString() : null, storeRow.id]);
      const activeRows = await db.all("SELECT id FROM parceiro_lojas WHERE UPPER(parceiro_id) = UPPER(?) AND (status = 'ativo' OR status IS NULL)", [storeRow.parceiro_id]);
      sendJson(res, 200, { success: true, storeId: storeRow.id, status: newStatus, activeStoresCount: activeRows.length, tokensEmUso: activeRows.length, message: blocked ? 'Loja bloqueada com sucesso. Token liberado.' : 'Loja reativada com sucesso.' });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/v1/status' || pathname === '/api/v1/health') && req.method === 'GET') {
    sendJson(res, 200, { status: 'online', version: 'v1.4', database: 'mysql', api_name: 'VOKZO B2B Engine', server_time: new Date().toISOString(), latency_ms: 12 });
    return true;
  }

  if (pathname === '/api/partner/simulator' && req.method === 'POST') {
    try {
      const { tenantId, ean } = await readJsonBody(req);
      await initMysqlDatabase();
      const storeRow = tenantId ? await db.get('SELECT id, nome_loja FROM parceiro_lojas WHERE id = ?', [String(tenantId)]) : null;
      const store = storeRow ? { id: storeRow.id, name: storeRow.nome_loja } : { id: tenantId, name: 'Drogaria Teste Sandbox' };
      const chosenProd = [
        { name: 'Dipirona Monoidratada 500mg 20 Comprimidos', validade: '2026-11-20', diasVencer: 13, lote: 'LT-884102', cor: 'amarelo' },
        { name: 'Amoxicilina + Clavulanato 875mg 14 Comprimidos', validade: '2026-11-10', diasVencer: 3, lote: 'LT-110294', cor: 'vermelho' },
        { name: 'Paracetamol 750mg 20 Comprimidos', validade: '2027-04-15', diasVencer: 159, lote: 'LT-492011', cor: 'verde' }
      ][Math.floor(Math.random() * 3)];
      if (storeRow && storeRow.id) await db.run('UPDATE parceiro_lojas SET requisicoes_mes = COALESCE(requisicoes_mes, 0) + 1 WHERE id = ?', [storeRow.id]);
      sendJson(res, 200, {
        success: true, status: 'ok', message: 'Webhook simulado com sucesso! Conexão de API operacional.',
        data: {
          webhook_event: 'inventory.product_scanned', timestamp: new Date().toISOString(), tenant_id: store.id, store_name: store.name,
          ean: ean || '7896004701234', product: chosenProd.name, lote: chosenProd.lote, validade: chosenProd.validade, dias_ate_vencimento: chosenProd.diasVencer,
          classificacao_risco: chosenProd.cor.toUpperCase(),
          acao_recomendada: chosenProd.cor === 'vermelho' ? 'PRIORIDADE_IMEDIATA_PROMOVER_DESCONTO' : (chosenProd.cor === 'amarelo' ? 'MONITORAR_ESTOQUE' : 'NENHUMA_ACAO_NECESSARIA'),
          api_response_status: 200, api_response_message: 'Notificação recebida com sucesso. Sincronização em tempo real realizada.'
        }
      });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha ao processar simulador.' }); }
    return true;
  }

  // D. GET /api/partner/invoices
  if (pathname === '/api/partner/invoices' && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const urlObj = new URL(req.url, 'http://localhost');
      const partnerId = (urlObj.searchParams.get('partnerId') || urlObj.searchParams.get('parceiro_id') || '').trim();
      const overageFee = await getOverageFee();
      const liveBilling = partnerId ? await computeLivePartnerBillingMysql(partnerId) : null;
      const rows = partnerId ? await db.all('SELECT * FROM faturas_parceiros WHERE UPPER(parceiro_id) = UPPER(?) ORDER BY created_at DESC', [partnerId]) : await db.all('SELECT * FROM faturas_parceiros ORDER BY created_at DESC');
      const list = rows.map(r => mapInvoiceRow(r, plansMap)).filter(inv => isClosedPartnerInvoice(inv));
      sendJson(res, 200, { success: true, invoices: list, overageFee, faturaAberta: liveBilling ? liveBilling.faturaAberta : null });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // E. GET /api/partner/invoices/pdf
  if ((pathname === '/api/partner/invoices/pdf' || pathname.startsWith('/api/partner/invoices/download')) && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const urlObj = new URL(req.url, 'http://localhost');
      const invoiceId = (urlObj.searchParams.get('id') || '').trim();
      const partnerId = (urlObj.searchParams.get('partnerId') || urlObj.searchParams.get('parceiro_id') || 'PARC-001').trim();
      const mesParam = (urlObj.searchParams.get('mes') || '').trim();

      const partner = (await findPartnerInMysql(partnerId)) || { id: partnerId || 'PARC-001', name: 'Parceiro PDV', cnpj: '', email: '', plano_id: 'plano_starter', dia_vencimento: 15 };
      const partnerPlan = getB2bPlanFromMap(partner.plano_id || partner.plano || 'plano_starter', plansMap);
      const planName = partner.nome_plano || partnerPlan.nome_plano || 'Starter';
      const planLimit = parseInt(partner.limite_lojas || partner.limite_tokens || partnerPlan.limite_lojas || 50, 10);
      const planMonthlyPrice = parseFloat(partner.valor_mensal !== undefined ? partner.valor_mensal : partnerPlan.valor_mensal);
      const overageFee = await getOverageFee();

      const storeRows = await db.all('SELECT * FROM parceiro_lojas WHERE UPPER(parceiro_id) = UPPER(?)', [partner.id]);
      const stores = storeRows.map(mapStoreRow);
      const billing = calculateOverageBilling({ ...partner, limite_lojas: planLimit, valor_mensal: planMonthlyPrice }, stores, overageFee);

      const nowDate = new Date();
      const monthsPt = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      const defaultMesRef = mesParam || `${monthsPt[nowDate.getMonth()]} / ${nowDate.getFullYear()}`;
      const defaultInvoiceId = invoiceId || `FAT-${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(partner.id || partnerId).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}`;

      const matchedInvRow = invoiceId ? await db.get('SELECT * FROM faturas_parceiros WHERE id = ?', [invoiceId]) : null;
      const invoice = matchedInvRow ? mapInvoiceRow(matchedInvRow, plansMap) : {
        id: defaultInvoiceId, mesReferencia: defaultMesRef, nome_plano: planName, limite_lojas: planLimit,
        lojasCobradas: billing.totalLojasUsando, excedentesQtd: billing.excedentesQtd, overageFee: billing.overageFee,
        overageTotal: billing.overageTotal, valor_mensal: billing.valorMensal, valorTotal: billing.valorFinal,
        status: 'Pendente/Aberta', dataVencimento: `${String(normalizePartnerDueDay(partner.dia_vencimento, 15)).padStart(2, '0')}/${String(nowDate.getMonth() + 1).padStart(2, '0')}/${nowDate.getFullYear()}`
      };

      invoice.nome_plano = invoice.nome_plano || planName;
      invoice.limite_lojas = invoice.limite_lojas || planLimit;
      invoice.lojasCobradas = invoice.lojasCobradas !== undefined ? invoice.lojasCobradas : billing.totalLojasAtivas;
      invoice.lojas_cobradas = invoice.lojas_cobradas !== undefined ? invoice.lojas_cobradas : invoice.lojasCobradas;
      invoice.valor_mensal = invoice.valor_mensal !== undefined ? invoice.valor_mensal : planMonthlyPrice;
      invoice.overageFee = invoice.overageFee !== undefined ? invoice.overageFee : billing.overageFee;
      invoice.excedentesQtd = invoice.excedentesQtd !== undefined ? invoice.excedentesQtd : billing.excedentesQtd;
      invoice.overageTotal = invoice.overageTotal !== undefined ? invoice.overageTotal : billing.overageTotal;
      invoice.valorTotal = invoice.valorTotal !== undefined ? invoice.valorTotal : billing.valorFinal;
      partner.nome_plano = planName;
      partner.limite_lojas = planLimit;
      partner.valor_mensal = planMonthlyPrice;

      const pdfBuffer = generateInvoicePdfBuffer(invoice, partner, stores, { overageFee });
      const pdfFilename = buildInvoicePdfFilename(invoice.mesReferencia);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdfFilename}"`, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Length': pdfBuffer.length, 'Cache-Control': 'no-cache' });
      res.end(pdfBuffer);
    } catch (err) { sendJson(res, 500, { error: 'Erro ao gerar fatura em PDF.' }); }
    return true;
  }

  // Configurações de PIX Estático
  if ((pathname === '/api/v1/settings/pix-static' || pathname === '/api/settings/pix-static' || pathname === '/api/v1/settings/gateway' || pathname === '/api/settings/gateway') && (req.method === 'PUT' || req.method === 'POST')) {
    try {
      const data = await readJsonBody(req);
      await initMysqlDatabase();
      const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
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
      if (data.pixAmountXml !== undefined) { gs.pixAmountXml = parseFloat(data.pixAmountXml).toFixed(2); gs.xmlModulePrice = gs.pixAmountXml; }
      gs.activeGateway = 'pix_static';
      gs.enablePix = true;
      gs.enableCreditCard = false;

      await setSettingJson('globalSettings', gs);
      await registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'UPDATE_CONFIG_PIX', { chave: gs.pixKey, titular: gs.pixName, cidade: gs.pixCity });
      sendJson(res, 200, { success: true, message: 'Configurações de PIX Estático salvas com sucesso no MySQL!', settings: { pixKey: gs.pixKey, pixKeyType: gs.pixKeyType || 'cpf', pixName: gs.pixName, pixCity: gs.pixCity, pixTxId: gs.pixTxId || '***', supportPhone: gs.supportPhone, pixInstructions: gs.pixInstructions, pixAmount: gs.pixAmount, pixAmountAnnual: gs.pixAmountAnnual, pixAmountXml: gs.pixAmountXml } });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/v1/settings/pix-static' || pathname === '/api/settings/pix-static' || pathname === '/api/v1/settings/gateway' || pathname === '/api/settings/gateway') && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
      sendJson(res, 200, { success: true, settings: { pixKey: gs.pixKey || '38032274880', pixKeyType: gs.pixKeyType || 'cpf', pixName: gs.pixName || 'Fernando Alves', pixCity: gs.pixCity || 'Caieiras', pixTxId: gs.pixTxId || '***', supportPhone: gs.supportPhone || '11996466498', pixInstructions: gs.pixInstructions || 'Após o pagamento, seu acesso será liberado em instantes pelo administrador.', pixAmount: gs.pixAmount || '49.90', pixAmountAnnual: gs.pixAmountAnnual || '199.00', pixAmountXml: gs.pixAmountXml || gs.xmlModulePrice || '19.90' } });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/payments/create-card' || pathname === '/api/v1/payments/card') && req.method === 'POST') {
    sendJson(res, 400, { success: false, error: 'Pagamento via Cartão de Crédito descontinuado. Os pagamentos são realizados exclusivamente via PIX.' });
    return true;
  }

  if ((pathname === '/api/webhooks/asaas' || pathname === '/api/asaas/webhook' || pathname === '/api/webhooks/efi' || pathname === '/api/efi/webhook') && req.method === 'POST') {
    sendJson(res, 200, { success: true, message: 'Webhooks externos descontinuados. Sistema operando em modo PIX Estático Concierge.' });
    return true;
  }

  if ((pathname === '/api/v1/payments/pix-static' || pathname === '/api/v1/payments/pix' || pathname === '/api/payments/create-pix' || pathname === '/api/v1/payments') && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      await initMysqlDatabase();
      const globalSettings = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
      const rawPlanName = String(payload.nome_plano || payload.description || payload.planName || 'Alerta Vencimento PRO').trim();
      const serviceType = String(payload.type || '').trim();
      let numAmount = parseFloat(payload.valor !== undefined ? payload.valor : (payload.amount !== undefined ? payload.amount : 0));
      if (!numAmount || numAmount <= 0) {
        numAmount = serviceType === 'merchant_pro_annual' ? parseFloat(globalSettings.pixAmountAnnual || 199.00) : (serviceType === 'merchant_xml' ? parseFloat(globalSettings.pixAmountXml || globalSettings.xmlModulePrice || 19.90) : parseFloat(globalSettings.pixAmount || 49.90));
      }
      if (numAmount <= 0) { sendJson(res, 400, { success: false, error: 'Valor da cobrança PIX deve ser maior que zero.' }); return true; }

      const serviceDesc = rawPlanName.toLowerCase().startsWith('plano:') ? rawPlanName : ('Plano: ' + rawPlanName);
      const planDescription = serviceDesc.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 :_-]/g, '').trim().substring(0, 25);
      const staticKey = String(globalSettings.pixKey || '38032274880').trim();
      const staticReceiverName = String(globalSettings.pixName || 'Fernando Alves').trim();
      const staticCity = String(globalSettings.pixCity || 'Caieiras').trim();
      const payloadPix = generatePixEmvCo({ key: staticKey, name: staticReceiverName, city: staticCity, amount: numAmount, txid: String(globalSettings.pixTxId || '***').trim(), description: planDescription });
      const paymentId = `pix_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      await upsertPayment({
        id: paymentId, internalId: paymentId, gateway: 'pix_static', environment: 'concierge', method: 'pix',
        amount: numAmount, nome_plano: rawPlanName, description: planDescription, type: serviceType || 'merchant_pro_monthly',
        phone: cleanDigits(payload.phone || ''), partnerId: payload.partnerId || '', planId: payload.planId || '', invoiceId: payload.invoiceId || '',
        status: 'pending', statusDetail: 'pending_concierge_proof', payload_pix: payloadPix, qr_code: payloadPix,
        chave_pix: staticKey, beneficiario: staticReceiverName, cidade: staticCity, createdAt: new Date().toISOString()
      });
      await registerLog(cleanDigits(payload.phone || '') || payload.partnerId || 'CLIENTE', payload.partnerId ? 'PARCEIRO' : 'LOJISTA', 'GERAR_PIX_ESTATICO', { paymentId, type: serviceType || 'merchant_pro_monthly', valor: numAmount, servico: rawPlanName });

      sendJson(res, 200, { success: true, payload_pix: payloadPix, qr_code: payloadPix, paymentId, amount: numAmount, nome_plano: rawPlanName, description: planDescription, beneficiario: staticReceiverName, chave_pix: staticKey, cidade: staticCity });
    } catch (err) { sendJson(res, 500, { success: false, error: `Erro ao gerar PIX estático: ${err.message}` }); }
    return true;
  }

  if (pathname === '/api/payments/status' && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const urlObj = new URL(req.url, 'http://localhost:3000');
      const paymentId = urlObj.searchParams.get('id') || urlObj.searchParams.get('paymentId') || '';
      const payment = mapPaymentRow(await db.get('SELECT * FROM pagamentos_pix WHERE id = ? OR internal_id = ?', [paymentId, paymentId]));
      if (!payment) { sendJson(res, 404, { success: false, error: 'Pagamento não localizado.' }); return true; }

      const mpToken = getActiveMpCredentials(await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS)).accessToken;
      if (payment.status === 'pending' && mpToken && !payment.id.startsWith('mp_sim_') && !isNaN(payment.id)) {
        try {
          const mpCheck = await callMercadoPagoApi(`/v1/payments/${payment.id}`, 'GET', mpToken);
          if (mpCheck.status === 200 && mpCheck.data && mpCheck.data.status === 'approved') await processPaymentActivation(payment);
        } catch (err) {}
      }
      sendJson(res, 200, { success: true, paymentId: payment.id, status: payment.status, type: payment.type, amount: payment.amount, approvedAt: payment.approvedAt || null });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/webhooks/mercadopago' || pathname === '/api/mercadopago/webhook') && req.method === 'POST') {
    try {
      const hookData = await readJsonBody(req);
      const urlObj = new URL(req.url, 'http://localhost:3000');
      const resourceId = (hookData.data && hookData.data.id) || hookData.id || urlObj.searchParams.get('id') || urlObj.searchParams.get('data.id');
      await initMysqlDatabase();
      const mpToken = getActiveMpCredentials(await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS)).accessToken;

      if (resourceId) {
        const resIdStr = String(resourceId);
        let payment = mapPaymentRow(await db.get('SELECT * FROM pagamentos_pix WHERE id = ? OR internal_id = ?', [resIdStr, resIdStr]));
        if (mpToken && !resIdStr.startsWith('mp_sim_')) {
          try {
            const mpCheck = await callMercadoPagoApi(`/v1/payments/${resIdStr}`, 'GET', mpToken);
            if (mpCheck.status === 200 && mpCheck.data && mpCheck.data.status === 'approved') {
              if (!payment) {
                const meta = mpCheck.data.metadata || {};
                payment = { id: resIdStr, internalId: resIdStr, gateway: 'mercadopago', amount: mpCheck.data.transaction_amount, type: meta.type || 'merchant_pro_monthly', phone: meta.phone || '', partnerId: meta.partner_id || meta.partnerId || '', planId: meta.plan_id || meta.planId || '', invoiceId: meta.invoice_id || meta.invoiceId || '', status: 'approved', createdAt: new Date().toISOString() };
                await upsertPayment(payment);
              }
              await processPaymentActivation(payment);
            }
          } catch (err) {}
        } else if (payment) {
          await processPaymentActivation(payment);
        }
      }
      sendJson(res, 200, { success: true, message: 'Webhook processado com sucesso.' });
    } catch (err) { sendJson(res, 200, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/payments/simulate-approve' && req.method === 'POST') {
    try {
      const { paymentId, id } = await readJsonBody(req);
      const targetId = String(paymentId || id || '');
      await initMysqlDatabase();
      const payment = mapPaymentRow(await db.get('SELECT * FROM pagamentos_pix WHERE id = ? OR internal_id = ?', [targetId, targetId]));
      if (!payment) { sendJson(res, 404, { success: false, error: 'Pagamento não encontrado para simulação.' }); return true; }
      await processPaymentActivation(payment);
      sendJson(res, 200, { success: true, message: 'Pagamento aprovado com sucesso via simulação!', payment });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // CRUD Planos B2B
  if ((pathname === '/api/v1/planos/b2b' || pathname === '/api/planos/b2b' || pathname === '/api/admin/b2b-plans' || pathname === '/api/b2b-plans') && req.method === 'GET') {
    try {
      const plansMap = await loadB2bPlansMap();
      const plansList = Object.values(plansMap).sort((a, b) => (parseFloat(a.valor_mensal) || 0) - (parseFloat(b.valor_mensal) || 0));
      sendJson(res, 200, { success: true, plans: plansList, planos: plansList });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/admin/b2b-plans' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const nome_plano = (payload.nome_plano || payload.nome || '').trim();
      const limite_lojas = parseInt(payload.limite_lojas || payload.limite || 0, 10);
      const valor_mensal = parseFloat(payload.valor_mensal || payload.valor || 0);
      if (!nome_plano || limite_lojas <= 0 || isNaN(valor_mensal) || valor_mensal < 0) {
        sendJson(res, 400, { success: false, error: 'Nome do plano, limite de lojas (>0) e valor mensal válido são obrigatórios.' });
        return true;
      }
      await initMysqlDatabase();
      const planKey = (payload.id || `plano_${nome_plano.toLowerCase().replace(/[^a-z0-9]/g, '_')}`).trim();
      const descricao = payload.descricao || `Franquia ${nome_plano} - Até ${limite_lojas} lojas com API de Validade`;
      const nowIso = new Date().toISOString();
      await db.run('INSERT INTO planos_b2b (id, nome_plano, limite_lojas, valor_mensal, descricao, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nome_plano = VALUES(nome_plano), limite_lojas = VALUES(limite_lojas), valor_mensal = VALUES(valor_mensal), descricao = VALUES(descricao)', [planKey, nome_plano, limite_lojas, valor_mensal, descricao, toMysqlDatetime(nowIso)]);
      sendJson(res, 201, { success: true, plan: { id: planKey, nome_plano, limite_lojas, valor_mensal, descricao, created_at: nowIso }, message: 'Plano B2B salvo com sucesso!' });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha interna ao salvar plano B2B.' }); }
    return true;
  }

  if (pathname === '/api/admin/b2b-plans' && req.method === 'PUT') {
    try {
      const payload = await readJsonBody(req);
      const planId = (payload.id || '').trim();
      if (!planId) { sendJson(res, 400, { success: false, error: 'ID do plano é obrigatório.' }); return true; }
      await initMysqlDatabase();
      const existing = await db.get('SELECT * FROM planos_b2b WHERE id = ?', [planId]);
      if (!existing) { sendJson(res, 404, { success: false, error: 'Plano B2B não encontrado.' }); return true; }
      const nome_plano = payload.nome_plano ? payload.nome_plano.trim() : existing.nome_plano;
      const limite_lojas = payload.limite_lojas !== undefined ? parseInt(payload.limite_lojas, 10) : Number(existing.limite_lojas);
      const valor_mensal = payload.valor_mensal !== undefined ? parseFloat(payload.valor_mensal) : Number(existing.valor_mensal);
      const descricao = payload.descricao ? payload.descricao.trim() : existing.descricao;
      await db.run('UPDATE planos_b2b SET nome_plano = ?, limite_lojas = ?, valor_mensal = ?, descricao = ? WHERE id = ?', [nome_plano, limite_lojas, valor_mensal, descricao, planId]);
      sendJson(res, 200, { success: true, plan: { id: planId, nome_plano, limite_lojas, valor_mensal, descricao }, message: 'Plano B2B atualizado com sucesso!' });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha interna ao atualizar plano B2B.' }); }
    return true;
  }

  if (pathname === '/api/admin/b2b-plans' && req.method === 'DELETE') {
    try {
      const planId = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      await initMysqlDatabase();
      const countRow = await db.get('SELECT COUNT(*) AS cnt FROM planos_b2b');
      if (Number((countRow && countRow.cnt) || 0) <= 1) { sendJson(res, 400, { success: false, error: 'O sistema deve manter pelo menos 1 plano B2B ativo.' }); return true; }
      const linkedRow = await db.get('SELECT COUNT(*) AS cnt FROM parceiros WHERE plano_id = ?', [planId]);
      if (Number((linkedRow && linkedRow.cnt) || 0) > 0) { sendJson(res, 400, { success: false, error: 'Não é possível excluir um plano que possui parceiros vinculados.' }); return true; }
      await db.run('DELETE FROM planos_b2b WHERE id = ?', [planId]);
      sendJson(res, 200, { success: true, message: 'Plano excluído com sucesso.' });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // Partners List / Create / Update / Assign-Plan
  if ((pathname === '/api/admin/partners' || pathname === '/api/v1/partners' || pathname === '/api/partners') && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const [partnerRows, storeRows, gs] = await Promise.all([db.all('SELECT * FROM parceiros ORDER BY created_at DESC'), db.all('SELECT * FROM parceiro_lojas'), getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS)]);
      const allStores = storeRows.map(mapStoreRow);
      const partnerList = partnerRows.map(r => {
        const p = mapPartnerRow(r, plansMap);
        const pIdStr = String(p.id || '').toUpperCase().trim();
        const pPhoneStr = cleanDigits(p.phone || '');
        const pCnpjStr = cleanDigits(p.cnpj || '');
        const stores = allStores.filter(st => {
          const sPid = String(st.partnerId || st.parceiro_id || '').toUpperCase().trim();
          return sPid === pIdStr || (pPhoneStr && cleanDigits(st.partnerId || st.parceiro_id || '') === pPhoneStr) || (pCnpjStr && cleanDigits(st.cnpj || '') === pCnpjStr);
        });
        const activeStores = stores.filter(st => !st.status || String(st.status).toLowerCase() === 'ativo');
        const totalReqs = stores.reduce((sum, st) => sum + (parseInt(st.requisicoesMes || st.requisicoes_mes, 10) || 0), 0);
        return Object.assign({}, p, { storesCount: stores.length, activeStoresCount: activeStores.length, faturaEstimada: p.valor_mensal, totalReqs });
      });
      const totalStores = allStores.filter(st => !st.status || String(st.status).toLowerCase() === 'ativo').length;
      const totalMrr = partnerList.filter(p => ['ativo', 'active'].includes(String(p.status || 'ativo').toLowerCase().trim())).reduce((sum, p) => sum + (parseFloat(p.valor_mensal) || 0), 0);
      sendJson(res, 200, {
        success: true, partners: partnerList, plans: Object.values(plansMap),
        metrics: { totalPartners: partnerList.length, totalStores, totalMrr: isNaN(totalMrr) ? 0 : totalMrr, total_partners: partnerList.length, total_tenants: totalStores, monthly_revenue: isNaN(totalMrr) ? 0 : totalMrr, totalPlans: Object.keys(plansMap).length, defaultTokenPrice: gs.partnerTokenPrice || 29.90 }
      });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro ao buscar parceiros', details: err.message }); }
    return true;
  }

  if ((pathname === '/api/v1/partners' || pathname === '/api/admin/partners' || pathname === '/api/partners') && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { name, cnpj, phone, pin, email, plano_id, plano_tipo, planId, dia_vencimento, diaVencimento } = body;
      if (!name || !name.trim()) { sendJson(res, 400, { success: false, error: 'O Nome do Parceiro (Empresa PDV) é obrigatório.' }); return true; }

      const rawCreateDueDay = dia_vencimento !== undefined ? dia_vencimento : diaVencimento;
      let finalCreateDueDay = 15;
      if (rawCreateDueDay !== undefined && rawCreateDueDay !== null && rawCreateDueDay !== '') {
        const parsedDueDay = parseInt(rawCreateDueDay, 10);
        if (!ALLOWED_PARTNER_DUE_DAYS.includes(parsedDueDay)) {
          sendJson(res, 400, { success: false, error: 'Dia de vencimento inválido. Escolha entre: 05, 10, 15, 20 ou 25.' });
          return true;
        }
        finalCreateDueDay = parsedDueDay;
      }

      const cleanPhone = cleanDigits(phone || '');
      if (!cleanPhone || cleanPhone.length < 10) { sendJson(res, 400, { success: false, error: 'O Telefone/WhatsApp com DDD é obrigatório.' }); return true; }

      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const existingRows = await db.all('SELECT id FROM parceiros');
      let maxNum = 0;
      for (const row of existingRows) {
        const match = String(row.id || '').match(/PARC-(\d+)/i);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
      const partnerId = 'PARC-' + String(maxNum + 1).padStart(3, '0');
      const plan = getB2bPlanFromMap((plano_id || plano_tipo || planId || '').trim(), plansMap);
      const newPartner = {
        id: partnerId, apiKey: 'ak_partner_' + crypto.randomBytes(16).toString('hex'), name: name.trim(), cnpj: (cnpj || '').trim(),
        phone: cleanPhone, email: (email || '').trim(), pin: (pin || '').trim() || '4546', plano_id: plan.id, nome_plano: plan.nome_plano,
        limite_lojas: plan.limite_lojas, valor_mensal: plan.valor_mensal, valorPorLoja: plan.valor_mensal, dia_vencimento: finalCreateDueDay,
        status: 'ATIVO', createdAt: new Date().toISOString(), storesCount: 0, activeStoresCount: 0, faturaEstimada: plan.valor_mensal, totalReqs: 0
      };
      await upsertPartner(newPartner);
      await registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'CREATE_PARCEIRO', { parceiro_id: partnerId, nome: newPartner.name, plano: plan.nome_plano, limite_tokens: plan.limite_lojas, dia_vencimento: newPartner.dia_vencimento });
      sendJson(res, 201, { success: true, partner: newPartner, message: 'Parceiro ' + newPartner.name + ' cadastrado com sucesso no plano ' + plan.nome_plano + '! ID: ' + partnerId });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha interna ao cadastrar parceiro.' }); }
    return true;
  }

  const adminPartnerPlanMatch = pathname.match(/^\/api\/v1\/admin\/parceiros\/([^/]+)\/plano$/);
  const partnerIdCandidate = pathname.match(/^\/api\/(?:v1\/)?(?:admin\/)?(?:partners|parceiros)\/([^/]+)$/);
  const reservedPartnerSubpaths = ['assign-plan', 'plan', 'toggle-status', 'status'];
  const partnerByIdMatch = (partnerIdCandidate && !reservedPartnerSubpaths.includes(partnerIdCandidate[1].toLowerCase())) ? partnerIdCandidate : null;
  const isAssignPlanRoute = (pathname === '/api/admin/partners/assign-plan' || pathname === '/api/admin/partners/plan' || !!adminPartnerPlanMatch);
  const isUpdatePartnerRoute = (pathname === '/api/admin/partners' || pathname === '/api/v1/partners' || pathname === '/api/partners' || !!partnerByIdMatch);

  if ((isAssignPlanRoute && (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST')) || (isUpdatePartnerRoute && (req.method === 'PUT' || req.method === 'PATCH'))) {
    try {
      const parsed = await readJsonBody(req);
      const urlId = adminPartnerPlanMatch ? decodeURIComponent(adminPartnerPlanMatch[1]) : (partnerByIdMatch ? decodeURIComponent(partnerByIdMatch[1]) : '');
      const rawTargetId = (urlId || parsed.id || parsed.partnerId || parsed.parceiro_id || '').trim();
      const actorId = (parsed.actor_id || req.headers['x-actor-id'] || 'MASTER_ADMIN').toString().trim();

      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const p = rawTargetId ? await findPartnerInMysql(rawTargetId) : null;
      if (!p) { sendJson(res, 404, { success: false, error: 'Parceiro não encontrado', changes: 0 }); return true; }

      const oldPlanName = p.nome_plano || p.plano_id || 'Starter';
      if (parsed.name) p.name = parsed.name.trim();
      if (parsed.cnpj !== undefined) p.cnpj = parsed.cnpj.trim();
      if (parsed.phone !== undefined) p.phone = cleanDigits(parsed.phone);
      if (parsed.pin !== undefined && String(parsed.pin).trim() !== '') p.pin = String(parsed.pin).trim();
      if (parsed.email !== undefined) p.email = parsed.email.trim();
      if (parsed.status) p.status = parsed.status;

      const rawDueDay = parsed.dia_vencimento !== undefined ? parsed.dia_vencimento : parsed.diaVencimento;
      if (rawDueDay !== undefined && rawDueDay !== null && rawDueDay !== '') {
        const parsedDueDay = parseInt(rawDueDay, 10);
        if (!ALLOWED_PARTNER_DUE_DAYS.includes(parsedDueDay)) {
          sendJson(res, 400, { success: false, error: 'Dia de vencimento inválido. Escolha entre: 05, 10, 15, 20 ou 25.' });
          return true;
        }
        p.dia_vencimento = parsedDueDay;
      } else if (!p.dia_vencimento) {
        p.dia_vencimento = 15;
      }

      const requestedPlan = parsed.plano_id || parsed.planId || parsed.plano;
      if (requestedPlan) {
        const plan = getB2bPlanFromMap(requestedPlan, plansMap);
        const finalLimit = parseInt(parsed.limite_tokens || parsed.limite_lojas || plan.limite_lojas || 50, 10);
        const finalPrice = parseFloat(parsed.valor_mensal !== undefined ? parsed.valor_mensal : plan.valor_mensal);
        p.plano_id = plan.id; p.plano = plan.id; p.nome_plano = plan.nome_plano;
        p.limite_lojas = finalLimit; p.limite_tokens = finalLimit;
        p.valor_mensal = finalPrice; p.valorPorLoja = finalPrice; p.faturaEstimada = finalPrice;
      }

      p.updatedAt = new Date().toISOString();
      await upsertPartner(p);
      await registerLog(actorId, 'SUPER_ADMIN', 'UPDATE_PARCEIRO_PERFIL', { parceiro_id: p.id, parceiro_nome: p.name, plano_anterior: oldPlanName, novo_plano: p.nome_plano, plano_id: p.plano_id, dia_vencimento: p.dia_vencimento, limite_tokens: p.limite_lojas, valor_mensal: p.valor_mensal });
      sendJson(res, 200, { success: true, changes: 1, partner: p });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // Logs Admin
  if ((pathname === '/api/v1/admin/logs' || pathname === '/api/admin/logs') && req.method === 'GET') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const page = Math.max(parseInt(urlObj.searchParams.get('page') || '1', 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit') || '15', 10) || 15, 1), 100);
      const result = await getSystemLogsPaginated(page, limit);
      sendJson(res, 200, { success: true, data: result.data, pagination: result.pagination });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro ao consultar logs de auditoria: ' + err.message }); }
    return true;
  }

  if ((pathname === '/api/partner/upgrade' || pathname === '/api/partner/plan') && (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT')) {
    try {
      const { partnerId, parceiro_id, plano_id, planId } = await readJsonBody(req);
      const pid = (partnerId || parceiro_id || req.headers['x-parceiro-id'] || req.headers['x-partner-id'] || '').trim();
      const partner = await findPartnerInMysql(pid);
      if (!partner) { sendJson(res, 404, { success: false, error: 'Parceiro não localizado no sistema.' }); return true; }
      const plansMap = await loadB2bPlansMap();
      const newPlan = getB2bPlanFromMap((plano_id || planId || '').trim(), plansMap);
      partner.plano_id = newPlan.id; partner.nome_plano = newPlan.nome_plano;
      partner.limite_lojas = newPlan.limite_lojas; partner.valor_mensal = newPlan.valor_mensal;
      partner.valorPorLoja = newPlan.valor_mensal; partner.faturaEstimada = newPlan.valor_mensal;
      partner.updatedAt = new Date().toISOString();
      await upsertPartner(partner);
      await registerLog(partner.id, 'PARCEIRO', 'UPGRADE_PLANO_PARCEIRO', { parceiro_nome: partner.name, novo_plano: newPlan.nome_plano, limite_tokens: newPlan.limite_lojas, valor_mensal: newPlan.valor_mensal });
      sendJson(res, 200, { success: true, message: `Plano atualizado com sucesso para ${newPlan.nome_plano}!`, partner, plan: newPlan });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha ao processar upgrade de plano.' }); }
    return true;
  }

  if ((pathname === '/api/admin/merchants' || pathname === '/api/v1/admin/merchants') && req.method === 'GET') {
    try {
      await initMysqlDatabase();
      const [merchantRows, productRows] = await Promise.all([
        db.all('SELECT * FROM lojistas'),
        safeSelectAll('SELECT id, owner_phone, status FROM lojistas_produtos', 'lojistas_produtos')
      ]);
      const productCounts = {};
      for (const pr of productRows) {
        if (pr && String(pr.status || 'ativo').toLowerCase() === 'ativo') {
          const owner = cleanDigits(pr.owner_phone || '');
          if (owner) productCounts[owner] = (productCounts[owner] || 0) + 1;
        }
      }
      const merchantsMap = {};
      const merchants = [];
      for (const row of merchantRows) {
        const m = mapMerchantRow(row);
        if (!m || !m.phone) continue;
        m.activeProductsCount = productCounts[m.phone] || 0;
        merchantsMap[m.phone] = m;
        merchants.push(m);
      }
      sendJson(res, 200, {
        success: true,
        total: merchants.length,
        merchants,
        merchantsMap
      });
    } catch (err) {
      sendJson(res, 500, { success: false, error: 'Erro ao listar lojistas do MySQL: ' + err.message });
    }
    return true;
  }

  if ((pathname === '/api/admin/merchants/update' || pathname === '/api/v1/admin/merchants/update') && (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST')) {
    try {
      const payload = await readJsonBody(req);
      const clean = cleanDigits(payload.phone || '');
      if (!clean) { sendJson(res, 400, { success: false, error: 'Telefone do lojista é obrigatório.' }); return true; }
      await initMysqlDatabase();
      const mRow = await db.get('SELECT * FROM lojistas WHERE telefone = ?', [clean]);
      if (!mRow) { sendJson(res, 404, { success: false, error: 'Lojista não encontrado no MySQL.' }); return true; }
      const m = mapMerchantRow(mRow);
      if (payload.name !== undefined) m.name = String(payload.name).trim() || m.name;
      if (payload.pin !== undefined && /^\d{4}$/.test(String(payload.pin).trim())) m.pin = String(payload.pin).trim();
      if (payload.plano !== undefined) m.plano = String(payload.plano).trim();
      if (payload.planoCiclo !== undefined) m.planoCiclo = payload.planoCiclo;
      if (payload.status !== undefined) m.status = String(payload.status).trim();
      if (payload.hasXmlImport !== undefined) m.hasXmlImport = Boolean(payload.hasXmlImport);
      if (payload.proExpiresAt !== undefined) { m.proExpiresAt = payload.proExpiresAt; m.proExpiry = payload.proExpiresAt; }
      if (payload.proExpiry !== undefined) { m.proExpiry = payload.proExpiry; m.proExpiresAt = payload.proExpiry; }
      if (payload.trialDays !== undefined) m.trialDays = parseInt(payload.trialDays, 10) || 14;
      m.updatedAt = new Date().toISOString();
      await upsertMerchant(clean, m);
      await registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'UPDATE_LOJISTA', { lojista_phone: clean, nome: m.name, plano: m.plano, hasXmlImport: m.hasXmlImport, status: m.status });
      sendJson(res, 200, { success: true, merchant: m });
    } catch (err) {
      sendJson(res, 500, { success: false, error: 'Erro ao atualizar lojista no MySQL: ' + err.message });
    }
    return true;
  }

  if ((pathname === '/api/admin/merchants/toggle-status' || pathname === '/api/admin/merchants/status') && (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST')) {
    try {
      const { phone, status } = await readJsonBody(req);
      const clean = cleanDigits(phone || '');
      if (!clean) { sendJson(res, 400, { success: false, error: 'Telefone do lojista é obrigatório.' }); return true; }
      await initMysqlDatabase();
      const mRow = await db.get('SELECT * FROM lojistas WHERE telefone = ?', [clean]);
      if (!mRow) { sendJson(res, 404, { success: false, error: 'Lojista não encontrado no sistema.' }); return true; }
      const m = mapMerchantRow(mRow);
      const newStatus = status || (String(m.status || 'ativo').toLowerCase() === 'ativo' ? 'bloqueado' : 'ativo');
      m.status = newStatus;
      await db.run('UPDATE lojistas SET status = ?, updated_at = ? WHERE telefone = ?', [newStatus, new Date().toISOString(), clean]);
      await registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'TOGGLE_STATUS_LOJISTA', { lojista_phone: clean, nome: m.name, novo_status: newStatus });
      sendJson(res, 200, { success: true, phone: clean, status: newStatus, merchant: m, message: `Lojista ${m.name} ${newStatus === 'bloqueado' ? 'bloqueado' : 'desbloqueado'} com sucesso!` });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Falha interna ao alterar status do lojista.' }); }
    return true;
  }

  // Baixa Manual de Fatura B2B
  const invoiceStatusMatch = pathname.match(/^\/api\/(?:v1\/)?admin\/invoices\/([^/]+)\/status\/?$/);
  if (invoiceStatusMatch && (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST')) {
    try {
      const targetInvoiceId = decodeURIComponent(invoiceStatusMatch[1]).trim();
      const payload = await readJsonBody(req);
      const reqSt = String(payload.status || 'PAGO').trim().toUpperCase();
      const normalizedStatus = (reqSt === 'PAID' || reqSt === 'PAGA' || reqSt === 'PAGO') ? 'PAGO' : reqSt;

      await initMysqlDatabase();
      const plansMap = await loadB2bPlansMap();
      const invRow = await db.get('SELECT * FROM faturas_parceiros WHERE UPPER(id) = UPPER(?)', [targetInvoiceId]);
      if (!invRow) { sendJson(res, 404, { success: false, error: 'Fatura não encontrada no banco de dados.' }); return true; }

      if (normalizedStatus === 'PAGO') {
        await db.run('UPDATE faturas_parceiros SET status = ?, data_pagamento = ?, paid_by = ? WHERE id = ?', [normalizedStatus, toMysqlDatetime(new Date()), 'SUPER_ADMIN_MANUAL', invRow.id]);
      } else {
        await db.run('UPDATE faturas_parceiros SET status = ? WHERE id = ?', [normalizedStatus, invRow.id]);
      }
      const inv = mapInvoiceRow(await db.get('SELECT * FROM faturas_parceiros WHERE id = ?', [invRow.id]), plansMap);
      await registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'BAIXA_MANUAL_FATURA_B2B', { invoiceId: inv.id, partnerId: inv.partnerId || inv.parceiro_id, status: inv.status, valorTotal: inv.valorTotal });
      sendJson(res, 200, { success: true, invoice: inv });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro ao atualizar status da fatura: ' + err.message }); }
    return true;
  }

  if ((pathname === '/api/admin/partners/toggle-status' || pathname === '/api/v1/partners/toggle-status' || pathname === '/api/admin/partners/status') && (req.method === 'PATCH' || req.method === 'PUT' || req.method === 'POST')) {
    try {
      const { id, status } = await readJsonBody(req);
      const partner = await findPartnerInMysql(id);
      if (!partner) { sendJson(res, 404, { success: false, error: 'Parceiro não encontrado.' }); return true; }
      const newStatus = status || (String(partner.status || 'ativo').toLowerCase() === 'ativo' ? 'bloqueado' : 'ativo');
      partner.status = newStatus;
      await db.run('UPDATE parceiros SET status = ?, updated_at = ? WHERE id = ?', [newStatus, toMysqlDatetime(new Date()), partner.id]);
      await registerLog('MASTER_ADMIN', 'SUPER_ADMIN', 'TOGGLE_STATUS_PARCEIRO', { parceiro_id: partner.id, nome: partner.name, novo_status: newStatus });
      sendJson(res, 200, { success: true, id: partner.id, status: newStatus, partner, message: `Parceiro ${partner.name} ${newStatus === 'bloqueado' ? 'bloqueado' : 'desbloqueado'} com sucesso.` });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // Suporte Impersonation
  if (pathname === '/api/admin/support-session' && req.method === 'POST') {
    try {
      const { partnerId } = await readJsonBody(req);
      const partner = await findPartnerInMysql(partnerId);
      if (!partner) { sendJson(res, 404, { success: false, error: 'Parceiro não encontrado.' }); return true; }
      const supportToken = 'supp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      supportSessions[supportToken] = { token: supportToken, partnerId: partner.id, partnerName: partner.name, createdAt: Date.now(), expiresAt: Date.now() + 60 * 60 * 1000 };
      sendJson(res, 200, { success: true, token: supportToken, partnerId: partner.id, partnerName: partner.name, url: `/parceiro.html?support_token=${supportToken}&partner_id=${partner.id}` });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/partner/support-session' && req.method === 'GET') {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const token = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('support_token');
    if (!token || !supportSessions[token]) { sendJson(res, 401, { success: false, error: 'Sessão de suporte expirada ou inválida.' }); return true; }
    const session = supportSessions[token];
    if (Date.now() > session.expiresAt) { delete supportSessions[token]; sendJson(res, 401, { success: false, error: 'Sessão de suporte expirada.' }); return true; }
    sendJson(res, 200, { success: true, session, partner: (await findPartnerInMysql(session.partnerId)) || { id: session.partnerId, name: session.partnerName }, impersonatedByAdmin: true });
    return true;
  }

  if ((pathname === '/api/admin/support-session' || pathname === '/api/partner/support-session') && (req.method === 'DELETE' || req.method === 'POST')) {
    try {
      const tokenFromQuery = new URL(req.url, 'http://localhost').searchParams.get('token') || new URL(req.url, 'http://localhost').searchParams.get('support_token');
      const { token } = await readJsonBody(req);
      const targetToken = token || tokenFromQuery;
      if (targetToken && supportSessions[targetToken]) delete supportSessions[targetToken];
      sendJson(res, 200, { success: true, message: 'Sessão de suporte encerrada com sucesso.' });
    } catch (err) { sendJson(res, 200, { success: true }); }
    return true;
  }

  // Overage Fee & Token Price
  if (pathname === '/api/admin/overage-fee' && req.method === 'GET') {
    try { sendJson(res, 200, { success: true, overageFee: await getOverageFee() }); } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/admin/overage-fee' && (req.method === 'POST' || req.method === 'PUT')) {
    try {
      const { overageFee, fee } = await readJsonBody(req);
      const parsedFee = parseFloat(overageFee !== undefined ? overageFee : fee);
      if (isNaN(parsedFee) || parsedFee < 0) { sendJson(res, 400, { success: false, error: 'Valor de OVERAGE_FEE inválido.' }); return true; }
      const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
      const cfg = await getSettingJson('config', DEFAULT_SYSTEM_CONFIG);
      gs.overageFee = parsedFee; cfg.overageFee = parsedFee;
      await setSettingJson('globalSettings', gs);
      await setSettingJson('config', cfg);
      await setSettingValue('overage_fee', parsedFee.toFixed(2));
      await registerLog('MASTER_ADMIN', 'ADMIN', 'UPDATE_OVERAGE_FEE', { overageFee: parsedFee });
      sendJson(res, 200, { success: true, overageFee: parsedFee });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/admin/token-price' && req.method === 'POST') {
    try {
      const { price } = await readJsonBody(req);
      const parsedPrice = parseFloat(price) || 29.90;
      const cfg = await getSettingJson('config', DEFAULT_SYSTEM_CONFIG);
      const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
      cfg.partnerTokenPrice = parsedPrice; gs.partnerTokenPrice = parsedPrice;
      await setSettingJson('config', cfg);
      await setSettingJson('globalSettings', gs);
      sendJson(res, 200, { success: true, price: parsedPrice });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  // Merchants & Products
  if (pathname === '/api/register-merchant' && req.method === 'POST') {
    try {
      const { name, phone, pin, plano } = await readJsonBody(req);
      const clean = cleanDigits(phone);
      const cleanPin = (pin || '').trim();
      if (!name || clean.length < 10 || cleanPin.length !== 4) { sendJson(res, 400, { success: false, error: 'Parâmetros incompletos' }); return true; }
      await initMysqlDatabase();
      const existing = mapMerchantRow(await db.get('SELECT * FROM lojistas WHERE telefone = ?', [clean]));
      const merchantObj = Object.assign({}, existing || {}, { phone: clean, name: name.trim(), pin: cleanPin, plano: plano || (existing && existing.plano) || 'free', status: existing ? (existing.status || 'ativo') : 'ativo', createdAt: existing ? existing.createdAt : new Date().toISOString() });
      await upsertMerchant(clean, merchantObj);
      await registerLog(clean, 'LOJISTA', existing ? 'UPDATE_LOJISTA' : 'CREATE_LOJISTA', { nome: name, plano: merchantObj.plano });
      sendJson(res, 200, { success: true, merchant: merchantObj });
    } catch (err) { sendJson(res, 400, { success: false, error: 'Erro ao processar cadastro' }); }
    return true;
  }

  if ((pathname === '/api/v1/merchants/profile' || pathname === '/api/merchant/settings' || pathname === '/api/merchants/profile') && (req.method === 'POST' || req.method === 'PUT')) {
    try {
      const payload = await readJsonBody(req);
      const cleanPhone = cleanDigits(payload.phone || payload.originalPhone || '');
      if (!cleanPhone || cleanPhone.length < 10) { sendJson(res, 400, { success: false, error: 'Telefone inválido' }); return true; }
      await initMysqlDatabase();
      const origClean = cleanDigits(payload.originalPhone || '');
      let existingRow = await db.get('SELECT * FROM lojistas WHERE telefone = ?', [cleanPhone]);
      if (!existingRow && origClean && origClean !== cleanPhone) {
        existingRow = await db.get('SELECT * FROM lojistas WHERE telefone = ?', [origClean]);
        if (existingRow) {
          await db.run('UPDATE lojistas SET telefone = ? WHERE telefone = ?', [cleanPhone, origClean]);
          await db.run('UPDATE lojistas_produtos SET owner_phone = ? WHERE owner_phone = ?', [cleanPhone, origClean]);
        }
      }
      const m = existingRow ? mapMerchantRow(existingRow) : { phone: cleanPhone, name: payload.name || 'Lojista', plano: 'free', status: 'ativo', createdAt: new Date().toISOString() };
      if (payload.name) m.name = payload.name.trim();
      if (payload.email) m.email = payload.email.trim();
      if (payload.documento) m.documento = payload.documento.trim();
      const cleanDoc = cleanDigits(payload.documento || payload.cpf || payload.cnpj || '');
      if (cleanDoc.length === 11) m.cpf = cleanDoc;
      else if (cleanDoc.length === 14) m.cnpj = cleanDoc;
      if (payload.nicheMode) m.nicheMode = payload.nicheMode;
      if (payload.redDays !== undefined) m.redDays = parseInt(payload.redDays, 10) || 7;
      if (payload.yellowDays !== undefined) m.yellowDays = parseInt(payload.yellowDays, 10) || 30;
      if (payload.redMonths !== undefined) m.redMonths = parseInt(payload.redMonths, 10) || 2;
      if (payload.yellowMonths !== undefined) m.yellowMonths = parseInt(payload.yellowMonths, 10) || 6;
      if (payload.capitalParadoDays !== undefined) m.capitalParadoDays = parseInt(payload.capitalParadoDays, 10) || 90;
      if (payload.frequencia_alerta) m.frequencia_alerta = payload.frequencia_alerta;
      m.updatedAt = new Date().toISOString();
      await upsertMerchant(cleanPhone, m);
      sendJson(res, 200, { success: true, merchant: m });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro ao salvar perfil do lojista', details: err.message }); }
    return true;
  }

  if (pathname === '/api/state' && req.method === 'POST') {
    try {
      const parsed = await readJsonBody(req);
      await initMysqlDatabase();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        if (parsed.merchants && typeof parsed.merchants === 'object') {
          for (const key of Object.keys(parsed.merchants)) { if (parsed.merchants[key]) await upsertMerchant(key, parsed.merchants[key], conn); }
        }
        if (Array.isArray(parsed.products) && (parsed.products.length > 0 || parsed.replaceProducts === true)) {
          await conn.execute('DELETE FROM lojistas_produtos');
          for (const p of parsed.products) { if (p) await upsertProduct(p, conn); }
        }
        if (parsed.repositores && typeof parsed.repositores === 'object') {
          for (const rKey of Object.keys(parsed.repositores)) {
            const rep = parsed.repositores[rKey];
            if (rep && rep.phone) {
              await conn.execute('INSERT IGNORE INTO Repositores (phone, pin, name, tenant_id, store_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [cleanDigits(rep.phone), String(rep.pin || '1234').trim(), String(rep.name || 'Repositor').trim(), cleanDigits(rep.tenantId || rep.storeOwnerPhone || ''), String(rep.storeName || 'Seu Mercado').trim(), String(rep.status || 'ativo').trim(), toMysqlDatetime(rep.createdAt || new Date())]);
            }
          }
        }
        if (parsed.partners && typeof parsed.partners === 'object') {
          for (const pid of Object.keys(parsed.partners)) {
            const part = parsed.partners[pid];
            if (!part) continue;
            const [existing] = await conn.execute('SELECT id FROM parceiros WHERE id = ?', [String(pid)]);
            if (!existing || existing.length === 0) await upsertPartner(Object.assign({ id: pid }, part), conn);
          }
        }
        await conn.commit();
      } catch (txErr) {
        await conn.rollback().catch(() => {});
        throw txErr;
      } finally {
        conn.release();
      }
      if (parsed.globalSettings) {
        const gs = await getSettingJson('globalSettings', DEFAULT_GLOBAL_SETTINGS);
        await setSettingJson('globalSettings', Object.assign(gs, parsed.globalSettings));
        if (parsed.globalSettings.overageFee !== undefined) {
          const parsedFee = parseFloat(parsed.globalSettings.overageFee);
          if (!isNaN(parsedFee) && parsedFee >= 0) await setSettingValue('overage_fee', parsedFee.toFixed(2));
        }
      }
      sendJson(res, 200, { success: true });
    } catch (e) { sendJson(res, 400, { error: 'JSON inválido: ' + e.message }); }
    return true;
  }

  if (pathname === '/api/products/batch' && req.method === 'POST') {
    try {
      const batch = await readJsonBody(req, []);
      if (!Array.isArray(batch)) { sendJson(res, 400, { success: false, error: 'O corpo da requisição deve ser um array de produtos.' }); return true; }
      await initMysqlDatabase();
      for (const p of batch) {
        const mRow = p.ownerPhone ? await db.get('SELECT niche_mode FROM lojistas WHERE telefone = ?', [cleanDigits(p.ownerPhone)]) : null;
        if (mRow && mRow.niche_mode === 'farmacia' && (!p.batch || p.batch.trim() === '' || p.batch.toUpperCase() === 'S/L')) {
          sendJson(res, 400, { success: false, error: 'O lote é obrigatório no Modo Farmácia (Anvisa) para o produto: ' + (p.name || '') });
          return true;
        }
        if (p.expiry && p.expiry.includes('/') && p.expiry.length <= 5) {
          const digits = p.expiry.replace(/\D/g, '');
          if (digits.length >= 3) {
            const mm = parseInt(digits.slice(0, 2), 10);
            let yy = parseInt(digits.slice(2, 4), 10);
            yy = (yy < 100) ? 2000 + yy : yy;
            p.expiry = yy + '-' + String(mm).padStart(2, '0') + '-' + String(new Date(yy, mm, 0).getDate()).padStart(2, '0');
          }
        }
      }
      for (const p of batch) await upsertProduct(p);
      const countRow = await db.get('SELECT COUNT(*) AS cnt FROM lojistas_produtos');
      sendJson(res, 200, { success: true, count: batch.length, total: Number((countRow && countRow.cnt) || 0) });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/products/')) {
    const rawId = pathname.replace('/api/products/', '');
    try {
      await initMysqlDatabase();
      const delRes = await db.run('DELETE FROM lojistas_produtos WHERE id = ?', [String(rawId)]);
      sendJson(res, 200, { success: true, removedCount: Number((delRes && delRes.changes) || 0), id: isNaN(rawId) ? rawId : Number(rawId) });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if ((pathname === '/api/products/baixa' && (req.method === 'POST' || req.method === 'PATCH')) || (req.method === 'PATCH' && /^\/api\/products\/[^/]+\/baixa$/.test(pathname))) {
    try {
      const payload = await readJsonBody(req);
      const pathParts = pathname.split('/').filter(Boolean);
      const rawId = (pathParts[2] && pathParts[2] !== 'baixa') ? pathParts[2] : (payload.id || payload.productId || '');
      const codigoBarras = String(payload.codigo_barras || payload.ean || '').trim();
      const quantidade = parseInt(payload.quantidade !== undefined ? payload.quantidade : payload.qty, 10);
      if (isNaN(quantidade) || quantidade <= 0) { sendJson(res, 400, { success: false, error: 'A quantidade informada para baixa deve ser maior que zero.' }); return true; }

      await initMysqlDatabase();
      let pRow = rawId ? await db.get('SELECT * FROM lojistas_produtos WHERE id = ?', [String(rawId)]) : null;
      if (!pRow && codigoBarras) pRow = await db.get('SELECT * FROM lojistas_produtos WHERE codigo_barras = ? OR barcode = ?', [codigoBarras, codigoBarras]);
      if (!pRow) { sendJson(res, 404, { success: false, error: 'Produto não encontrado no estoque.' }); return true; }

      const prod = mapProductRow(pRow);
      const currentQty = parseInt(prod.qty !== undefined ? prod.qty : (prod.quantity !== undefined ? prod.quantity : (prod.quantidade !== undefined ? prod.quantidade : 1)), 10) || 1;
      const baixaEfetiva = Math.min(quantidade, currentQty);
      const saldoRestante = Math.max(0, currentQty - baixaEfetiva);
      const nowIso = new Date().toISOString();
      prod.qty = saldoRestante;
      if (prod.quantity !== undefined) prod.quantity = saldoRestante;
      if (prod.quantidade !== undefined) prod.quantidade = saldoRestante;
      prod.updatedAt = nowIso;
      if (saldoRestante <= 0) {
        prod.status = 'baixado'; prod.resolvedReason = payload.reason || 'promocao_venda'; prod.tipo_baixa = prod.resolvedReason; prod.resolvedAt = nowIso; prod.data_baixa = nowIso;
      } else { prod.status = 'ativo'; }
      await upsertProduct(prod);
      await registerLog(prod.ownerPhone || 'LOJISTA', 'LOJISTA', 'BAIXA_PRODUTO', { productId: prod.id, nome: prod.name, quantidade_baixada: baixaEfetiva, saldo_restante: saldoRestante });
      sendJson(res, 200, { success: true, id: prod.id, quantidade_baixada: baixaEfetiva, saldo_restante: saldoRestante, status: prod.status, product: prod });
    } catch (err) { sendJson(res, 500, { success: false, error: 'Erro ao processar baixa de produto: ' + err.message }); }
    return true;
  }

  if (pathname === '/api/products/batch-action' && req.method === 'POST') {
    try {
      const { action, productIds, reason } = await readJsonBody(req);
      const ids = Array.isArray(productIds) ? productIds.map(x => String(x)) : [];
      await initMysqlDatabase();
      if (action === 'delete') {
        for (const id of ids) await db.run('DELETE FROM lojistas_produtos WHERE id = ?', [id]);
      } else if (action === 'dar_baixa') {
        const nowIso = new Date().toISOString();
        for (const id of ids) {
          const pRow = await db.get('SELECT * FROM lojistas_produtos WHERE id = ?', [id]);
          if (!pRow) continue;
          const prod = mapProductRow(pRow);
          prod.status = 'baixado'; prod.resolvedReason = reason || 'baixa_em_lote'; prod.tipo_baixa = prod.resolvedReason; prod.resolvedAt = nowIso; prod.data_baixa = nowIso; prod.updatedAt = nowIso;
          await upsertProduct(prod);
        }
      }
      sendJson(res, 200, { success: true, action, affectedCount: ids.length });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/products' && req.method === 'POST') {
    try {
      const prod = await readJsonBody(req);
      await initMysqlDatabase();
      await upsertProduct(prod);
      sendJson(res, 200, { success: true, product: prod });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  if (pathname === '/api/upload-xml' && req.method === 'POST') {
    try {
      const { storePhone, filename, xmlContent } = await readJsonBody(req);
      if (!xmlContent) { sendJson(res, 400, { success: false, error: 'Conteúdo XML ausente.' }); return true; }
      const savedFileName = `nfe_${cleanDigits(storePhone || 'geral')}_${Date.now()}_${(filename || 'nota.xml').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      fs.writeFileSync(path.join(XML_UPLOADS_DIR, savedFileName), xmlContent, 'utf-8');
      cleanupExpiredXmlFiles();
      sendJson(res, 200, { success: true, savedFile: savedFileName, retentionDays: 7, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
    } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, x-api-key, x-tenant-id, x-parceiro-id, x-partner-id, x-actor-id, bypass-tunnel-reminder');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    try {
      if (await handleApiRequest(req, res, pathname)) return;
    } catch (apiErr) {
      if (!res.headersSent) sendJson(res, 500, { success: false, error: apiErr.message || 'Erro interno na API' });
      return;
    }
    sendJson(res, 404, { success: false, error: 'Endpoint de API não encontrado: ' + pathname });
    return;
  }

  const normalizedAdminPath = pathname.toLowerCase().replace(/\/+$/, '');
  if (req.method === 'GET' && (normalizedAdminPath === '/vokzo-boss' || normalizedAdminPath === '/vokz-boss')) {
    fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (errAdmin, htmlContent) => {
      if (errAdmin) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Erro ao carregar o painel administrativo.'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(htmlContent);
    });
    return;
  }

  let reqPath = pathname;
  if (['/', '', '/dashboard-lojista', '/leitor', '/scanner', '/dashboard-parceiro', '/admin', '/admin-login'].includes(reqPath)) reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Acesso Negado'); return; }

  fs.stat(filePath, (err, stats) => {
    const targetFile = (!err && stats.isFile()) ? filePath : path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(targetFile).toLowerCase();
    fs.readFile(targetFile, (readErr, content) => {
      if (readErr) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Arquivo não encontrado.'); return; }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600' });
      res.end(content);
    });
  });
});

if (require.main === module) {
  initAuditDatabase().catch(err => console.warn('⚠️ [MYSQL STARTUP]:', err.message));
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 VOKZO / ALERTA VENCIMENTO - SERVIDOR MYSQL ONLY!`);
    console.log(`💻 http://localhost:${PORT} | 📱 http://${getLocalIpAddress()}:${PORT}`);
    console.log(`💾 MySQL: ${MYSQL_CONFIG.database}@${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}\n`);
    cronEngine.startScheduler();
  });
}

server.db = db;
server.pool = pool;
server.registerLog = registerLog;
server.getSystemLogs = getSystemLogs;
server.getMysqlPool = () => pool;
server.initMysqlDatabase = initMysqlDatabase;
server.handleApiRequest = handleApiRequest;
module.exports = server;
