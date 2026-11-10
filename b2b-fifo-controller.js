const path = require('path');
const { registerLog } = require('./audit-logger');

const SQLITE_DB_PATH = path.join(__dirname, 'vokzo_audit.db');
let sqliteDb = null;

/**
 * Obtém/inicializa conexão SQLite (node:sqlite) e garante a tabela Produtos_Lotes.
 */
function getFifoDb() {
  if (sqliteDb) return sqliteDb;
  const { DatabaseSync } = require('node:sqlite');
  sqliteDb = new DatabaseSync(SQLITE_DB_PATH);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS Produtos_Lotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      codigo_barras TEXT NOT NULL,
      nome TEXT NOT NULL,
      lote TEXT DEFAULT 'LT-PDV',
      data_validade TEXT NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 0,
      preco_unitario REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, codigo_barras, data_validade)
    );
    CREATE INDEX IF NOT EXISTS idx_lotes_fifo
      ON Produtos_Lotes(tenant_id, codigo_barras, data_validade ASC);
  `);
  return sqliteDb;
}

/**
 * Converte data DD/MM/AAAA ou MM/AAAA para ISO YYYY-MM-DD para ordenação FIFO precisa.
 */
function normalizeDateIso(rawDate) {
  const str = String(rawDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  }

  const mmYyMatch = str.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
  if (mmYyMatch) {
    const year = mmYyMatch[2].length === 2 ? `20${mmYyMatch[2]}` : mmYyMatch[2];
    const month = parseInt(mmYyMatch[1], 10);
    const lastDay = new Date(parseInt(year, 10), month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return str;
}

function daysUntilExpiry(isoDate) {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Middleware de Segurança B2B: requirePartnerAuth(req, res, next)
 * Exige headers obrigatórios `x-api-key` e `x-tenant-id`.
 * Valida se a API Key existe e se o Tenant ID pertence ao Parceiro.
 * Em sucesso, injeta `req.store_id = tenantId`.
 */
function createRequirePartnerAuth(readDbFn) {
  return function requirePartnerAuth(req, res, next) {
    const apiKey = String(req.headers['x-api-key'] || '').trim();
    const tenantId = String(req.headers['x-tenant-id'] || '').trim();

    if (!apiKey || !tenantId) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: 'Unauthorized: Headers obrigatórios "x-api-key" e "x-tenant-id" não fornecidos.'
      }));
      return false;
    }

    const db = readDbFn();
    const partnersMap = db.partners || {};
    const allStores = Array.isArray(db.partnerStores) ? db.partnerStores : [];

    // Localiza a loja pelo tenant_id
    const store = allStores.find(s => s && (s.id === tenantId || s.tenant_id === tenantId));
    if (!store) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: 'Unauthorized: Tenant ID (x-tenant-id) não encontrado.'
      }));
      return false;
    }

    const partnerId = store.partnerId || store.parceiro_id;
    const partner = partnerId ? partnersMap[partnerId] : null;

    // Valida se a API Key pertence ao Parceiro dono do Tenant OU diretamente à loja do Parceiro
    const partnerMatchesKey = partner && partner.apiKey && partner.apiKey === apiKey;
    const storeMatchesKey = store.apiKey && store.apiKey === apiKey;

    // Caso a chave pertença a outro parceiro, também verifica pertencimento
    const keyOwnerPartner = Object.values(partnersMap).find(p => p && p.apiKey === apiKey);
    const belongsToKeyOwner = keyOwnerPartner && (keyOwnerPartner.id === partnerId);

    if (!storeMatchesKey && !partnerMatchesKey && !belongsToKeyOwner) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: 'Unauthorized: x-api-key inválida ou sem permissão para este x-tenant-id.'
      }));
      return false;
    }

    // Verifica se o Parceiro ou Loja está bloqueado
    if (partner && (String(partner.status || 'ativo').toLowerCase() === 'bloqueado' || String(partner.status || '').toLowerCase() === 'inativo')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        code: 'PARTNER_BLOCKED',
        error: 'Acesso suspenso: Parceiro bloqueado pelo administrador.'
      }));
      return false;
    }

    if (String(store.status || 'ativo').toLowerCase() === 'bloqueado' || String(store.status || '').toLowerCase() === 'bloqueada' || String(store.status || '').toLowerCase() === 'inativo') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        code: 'STORE_BLOCKED',
        error: 'Acesso revogado: Esta loja está bloqueada pelo parceiro integrador.'
      }));
      return false;
    }

    // Injeta credenciais validadas no request para as rotas consumirem
    req.store_id = store.id;
    req.tenant_id = store.id;
    req.partner_id = partnerId || (keyOwnerPartner && keyOwnerPartner.id) || null;
    req.store = store;
    req.partner = partner || keyOwnerPartner || null;

    if (typeof next === 'function') next();
    return true;
  };
}

/**
 * Controller: POST /api/v1/products/sync
 * Executa Upsert em Produtos_Lotes no SQLite para req.store_id.
 * Se (tenant_id, codigo_barras, data_validade) já existir, soma a quantidade.
 */
function handleProductSync(req, res, payload, dbHelpers) {
  try {
    const tenantId = req.store_id;
    const codigoBarras = String(payload.codigo_barras || payload.ean || '').trim();
    const nome = String(payload.nome || payload.name || 'Produto PDV').trim();
    const rawValidade = payload.data_validade || payload.expiryDate || payload.expiry_date || payload.validade;
    const quantidade = parseInt(payload.quantidade !== undefined ? payload.quantidade : (payload.quantity !== undefined ? payload.quantity : 1), 10);
    const lote = String(payload.lote || payload.batch || 'LT-PDV').trim();
    const precoUnitario = parseFloat(payload.preco_unitario !== undefined ? payload.preco_unitario : (payload.unitPrice || 0)) || 0;

    if (!codigoBarras || !rawValidade) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: 'Campos obrigatórios ausentes: "codigo_barras" e "data_validade".'
      }));
      return;
    }

    if (isNaN(quantidade) || quantidade <= 0) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        error: 'O campo "quantidade" deve ser um número inteiro maior que zero.'
      }));
      return;
    }

    const dataValidadeIso = normalizeDateIso(rawValidade);
    const nowIso = new Date().toISOString();
    const fdb = getFifoDb();

    let operation = 'INSERTED';
    let batchRecord = null;

    fdb.exec('BEGIN TRANSACTION');
    try {
      const existing = fdb.prepare(`
        SELECT id, quantidade
        FROM Produtos_Lotes
        WHERE tenant_id = ? AND codigo_barras = ? AND data_validade = ?
      `).get(tenantId, codigoBarras, dataValidadeIso);

      if (existing) {
        const novaQtd = (parseInt(existing.quantidade, 10) || 0) + quantidade;
        fdb.prepare(`
          UPDATE Produtos_Lotes
          SET nome = ?, lote = ?, quantidade = ?, preco_unitario = ?, updated_at = ?
          WHERE id = ?
        `).run(nome, lote, novaQtd, precoUnitario, nowIso, existing.id);

        operation = 'UPDATED';
        batchRecord = fdb.prepare('SELECT * FROM Produtos_Lotes WHERE id = ?').get(existing.id);
      } else {
        const info = fdb.prepare(`
          INSERT INTO Produtos_Lotes (tenant_id, codigo_barras, nome, lote, data_validade, quantidade, preco_unitario, updated_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenantId, codigoBarras, nome, lote, dataValidadeIso, quantidade, precoUnitario, nowIso, nowIso);

        operation = 'INSERTED';
        batchRecord = fdb.prepare('SELECT * FROM Produtos_Lotes WHERE id = ?').get(Number(info.lastInsertRowid));
      }

      fdb.exec('COMMIT');
    } catch (txErr) {
      try { fdb.exec('ROLLBACK'); } catch (e) {}
      throw txErr;
    }

    // Incrementa métricas de API da loja no database.json se helper fornecido
    if (dbHelpers && dbHelpers.readDatabase && dbHelpers.writeDatabase) {
      try {
        const db = dbHelpers.readDatabase();
        const st = (db.partnerStores || []).find(s => s.id === tenantId || s.tenant_id === tenantId);
        if (st) {
          st.requisicoesMes = (parseInt(st.requisicoesMes, 10) || 0) + 1;
          dbHelpers.writeDatabase(db);
        }
      } catch (e) {}
    }

    const diff = daysUntilExpiry(dataValidadeIso);
    const isHardBlock = diff <= 0;

    registerLog(tenantId, 'PARCEIRO', 'API_PRODUCT_SYNC', {
      operation,
      codigo_barras: codigoBarras,
      data_validade: dataValidadeIso,
      quantidade_adicionada: quantidade,
      quantidade_total_lote: batchRecord.quantidade
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      operation,
      tenant_id: tenantId,
      lote_id: batchRecord.id,
      codigo_barras: codigoBarras,
      nome: batchRecord.nome,
      data_validade: dataValidadeIso,
      quantidade_lote: batchRecord.quantidade,
      days_remaining: diff,
      hard_block: isHardBlock,
      action: isHardBlock ? 'BLOQUEAR_VENDA' : (diff <= 30 ? 'ALERTA_APROXIMACAO' : 'LIBERADO_VENDA'),
      evaluated_at: nowIso
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: 'Erro ao sincronizar lote: ' + err.message }));
  }
}

/**
 * Controller: POST /api/v1/products/checkout
 * Baixa inteligente de estoque por FIFO (data_validade ASC) dentro de Transação SQLite.
 */
function handleProductCheckout(req, res, payload, dbHelpers) {
  try {
    const tenantId = req.store_id;
    const codigoBarras = String(payload.codigo_barras || payload.ean || '').trim();
    const quantidadeVendida = parseInt(
      payload.quantidade_vendida !== undefined ? payload.quantidade_vendida : (payload.quantity !== undefined ? payload.quantity : payload.qty),
      10
    );

    if (!codigoBarras) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'O campo "codigo_barras" é obrigatório.' }));
      return;
    }

    if (isNaN(quantidadeVendida) || quantidadeVendida <= 0) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'O campo "quantidade_vendida" deve ser um inteiro maior que zero.' }));
      return;
    }

    const fdb = getFifoDb();
    const nowIso = new Date().toISOString();
    const lotesAfetados = [];
    let restanteParaBaixar = quantidadeVendida;
    let totalBaixado = 0;

    fdb.exec('BEGIN TRANSACTION');
    try {
      // Busca todos os lotes ativos ordenados do mais próximo a vencer para o mais distante (FIFO)
      const lotes = fdb.prepare(`
        SELECT id, nome, lote, data_validade, quantidade
        FROM Produtos_Lotes
        WHERE tenant_id = ? AND codigo_barras = ? AND quantidade > 0
        ORDER BY data_validade ASC, id ASC
      `).all(tenantId, codigoBarras);

      if (!lotes || lotes.length === 0) {
        fdb.exec('ROLLBACK');
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: 'Nenhum lote ativo encontrado para este código de barras nesta loja.'
        }));
        return;
      }

      for (const loteRow of lotes) {
        if (restanteParaBaixar <= 0) break;

        const qtdLote = parseInt(loteRow.quantidade, 10) || 0;
        if (qtdLote <= 0) continue;

        if (qtdLote <= restanteParaBaixar) {
          // Lote atual zera completamente -> DELETE
          const consumido = qtdLote;
          restanteParaBaixar -= consumido;
          totalBaixado += consumido;

          fdb.prepare('DELETE FROM Produtos_Lotes WHERE id = ?').run(loteRow.id);

          lotesAfetados.push({
            lote_id: loteRow.id,
            lote: loteRow.lote,
            data_validade: loteRow.data_validade,
            quantidade_baixada: consumido,
            quantidade_restante: 0,
            acao: 'DELETE_LOTE_ZERADO'
          });
        } else {
          // Lote atual possui saldo sobrando -> UPDATE
          const consumido = restanteParaBaixar;
          const novaQtd = qtdLote - consumido;
          restanteParaBaixar = 0;
          totalBaixado += consumido;

          fdb.prepare('UPDATE Produtos_Lotes SET quantidade = ?, updated_at = ? WHERE id = ?')
            .run(novaQtd, nowIso, loteRow.id);

          lotesAfetados.push({
            lote_id: loteRow.id,
            lote: loteRow.lote,
            data_validade: loteRow.data_validade,
            quantidade_baixada: consumido,
            quantidade_restante: novaQtd,
            acao: 'UPDATE_PARCIAL'
          });
        }
      }

      fdb.exec('COMMIT');
    } catch (txErr) {
      try { fdb.exec('ROLLBACK'); } catch (e) {}
      throw txErr;
    }

    if (dbHelpers && dbHelpers.readDatabase && dbHelpers.writeDatabase) {
      try {
        const db = dbHelpers.readDatabase();
        const st = (db.partnerStores || []).find(s => s.id === tenantId || s.tenant_id === tenantId);
        if (st) {
          st.requisicoesMes = (parseInt(st.requisicoesMes, 10) || 0) + 1;
          dbHelpers.writeDatabase(db);
        }
      } catch (e) {}
    }

    registerLog(tenantId, 'PARCEIRO', 'API_FIFO_CHECKOUT', {
      codigo_barras: codigoBarras,
      quantidade_vendida: quantidadeVendida,
      total_baixado: totalBaixado,
      saldo_nao_atendido: restanteParaBaixar,
      lotes_afetados: lotesAfetados.length
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      tenant_id: tenantId,
      codigo_barras: codigoBarras,
      quantidade_solicitada: quantidadeVendida,
      quantidade_baixada: totalBaixado,
      saldo_nao_atendido: restanteParaBaixar,
      lotes_afetados: lotesAfetados,
      processed_at: nowIso
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: 'Erro ao processar checkout FIFO: ' + err.message }));
  }
}

module.exports = {
  getFifoDb,
  createRequirePartnerAuth,
  handleProductSync,
  handleProductCheckout
};
