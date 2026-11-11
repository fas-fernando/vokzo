'use strict';

const { db, pool, initMysqlDatabase, toMysqlDatetime } = require('./db-mysql');
const { registerLog } = require('./audit-logger');

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

function createRequirePartnerAuth() {
  return async function requirePartnerAuth(req, res, next) {
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

    try {
      await initMysqlDatabase();
      const storeRow = await db.get(
        'SELECT id, parceiro_id, nome_loja, cnpj, api_key, status, requisicoes_mes, bloqueado_em, is_overage, created_at FROM parceiro_lojas WHERE id = ?',
        [tenantId]
      );

      if (!storeRow) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: 'Unauthorized: Tenant ID (x-tenant-id) não encontrado.'
        }));
        return false;
      }

      const store = {
        id: storeRow.id,
        tenant_id: storeRow.id,
        parceiro_id: storeRow.parceiro_id,
        partnerId: storeRow.parceiro_id,
        name: storeRow.nome_loja,
        nome_loja: storeRow.nome_loja,
        cnpj: storeRow.cnpj,
        apiKey: storeRow.api_key,
        api_key: storeRow.api_key,
        status: storeRow.status || 'ativo',
        isOverage: Boolean(storeRow.is_overage),
        requisicoesMes: Number(storeRow.requisicoes_mes || 0)
      };

      const partnerRow = store.parceiro_id
        ? await db.get('SELECT id, nome, cnpj, email, telefone, status, plano_id, api_key, dia_vencimento FROM parceiros WHERE id = ?', [store.parceiro_id])
        : null;
      const keyOwnerRow = !partnerRow || partnerRow.api_key !== apiKey
        ? await db.get('SELECT id, nome, cnpj, email, telefone, status, plano_id, api_key, dia_vencimento FROM parceiros WHERE api_key = ?', [apiKey])
        : partnerRow;

      const storeMatchesKey = store.api_key && store.api_key === apiKey;
      const partnerMatchesKey = partnerRow && partnerRow.api_key && partnerRow.api_key === apiKey;
      const belongsToKeyOwner = keyOwnerRow && keyOwnerRow.id === store.parceiro_id;

      if (!storeMatchesKey && !partnerMatchesKey && !belongsToKeyOwner) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: 'Unauthorized: x-api-key inválida ou sem permissão para este x-tenant-id.'
        }));
        return false;
      }

      const partner = partnerRow || keyOwnerRow || null;
      if (partner) {
        const pStatus = String(partner.status || 'ativo').toLowerCase();
        if (pStatus === 'bloqueado' || pStatus === 'inativo') {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: false,
            code: 'PARTNER_BLOCKED',
            error: 'Acesso suspenso: Parceiro bloqueado pelo administrador.'
          }));
          return false;
        }
      }

      const sStatus = String(store.status || 'ativo').toLowerCase();
      if (sStatus === 'bloqueado' || sStatus === 'bloqueada' || sStatus === 'inativo') {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          code: 'STORE_BLOCKED',
          error: 'Acesso revogado: Esta loja está bloqueada pelo parceiro integrador.'
        }));
        return false;
      }

      req.store_id = store.id;
      req.tenant_id = store.id;
      req.partner_id = (partner && partner.id) || store.parceiro_id || null;
      req.store = store;
      req.partner = partner;

      if (typeof next === 'function') await next();
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Erro interno na autenticação B2B: ' + err.message }));
      return false;
    }
  };
}

async function handleProductSync(req, res, payload) {
  try {
    await initMysqlDatabase();
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
    const nowMysql = toMysqlDatetime(nowIso);

    let operation = 'INSERTED';
    let batchRecord = null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.execute(
        'SELECT id, quantidade FROM Produtos_Lotes WHERE tenant_id = ? AND codigo_barras = ? AND data_validade = ? FOR UPDATE',
        [tenantId, codigoBarras, dataValidadeIso]
      );
      const existing = existingRows && existingRows[0];

      if (existing) {
        const novaQtd = (parseInt(existing.quantidade, 10) || 0) + quantidade;
        await conn.execute(
          'UPDATE Produtos_Lotes SET nome = ?, lote = ?, quantidade = ?, preco_unitario = ?, updated_at = ? WHERE id = ?',
          [nome, lote, novaQtd, precoUnitario, nowMysql, existing.id]
        );
        operation = 'UPDATED';
        const [rows] = await conn.execute('SELECT * FROM Produtos_Lotes WHERE id = ?', [existing.id]);
        batchRecord = rows[0];
      } else {
        const [insertRes] = await conn.execute(
          'INSERT INTO Produtos_Lotes (tenant_id, codigo_barras, nome, lote, data_validade, quantidade, preco_unitario, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [tenantId, codigoBarras, nome, lote, dataValidadeIso, quantidade, precoUnitario, nowMysql, nowMysql]
        );
        operation = 'INSERTED';
        const [rows] = await conn.execute('SELECT * FROM Produtos_Lotes WHERE id = ?', [insertRes.insertId]);
        batchRecord = rows[0];
      }

      await conn.execute(
        'UPDATE parceiro_lojas SET requisicoes_mes = COALESCE(requisicoes_mes, 0) + 1 WHERE id = ?',
        [tenantId]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      throw txErr;
    } finally {
      conn.release();
    }

    const diff = daysUntilExpiry(dataValidadeIso);
    const isHardBlock = diff <= 0;

    await registerLog(tenantId, 'PARCEIRO', 'API_PRODUCT_SYNC', {
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

async function handleProductCheckout(req, res, payload) {
  try {
    await initMysqlDatabase();
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

    const nowIso = new Date().toISOString();
    const nowMysql = toMysqlDatetime(nowIso);
    const lotesAfetados = [];
    let restanteParaBaixar = quantidadeVendida;
    let totalBaixado = 0;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [lotes] = await conn.execute(
        `SELECT id, nome, lote, data_validade, quantidade
         FROM Produtos_Lotes
         WHERE tenant_id = ? AND codigo_barras = ? AND quantidade > 0
         ORDER BY data_validade ASC, id ASC
         FOR UPDATE`,
        [tenantId, codigoBarras]
      );

      if (!lotes || lotes.length === 0) {
        await conn.rollback();
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
          const consumido = qtdLote;
          restanteParaBaixar -= consumido;
          totalBaixado += consumido;

          await conn.execute('DELETE FROM Produtos_Lotes WHERE id = ?', [loteRow.id]);

          lotesAfetados.push({
            lote_id: loteRow.id,
            lote: loteRow.lote,
            data_validade: loteRow.data_validade,
            quantidade_baixada: consumido,
            quantidade_restante: 0,
            acao: 'DELETE_LOTE_ZERADO'
          });
        } else {
          const consumido = restanteParaBaixar;
          const novaQtd = qtdLote - consumido;
          restanteParaBaixar = 0;
          totalBaixado += consumido;

          await conn.execute(
            'UPDATE Produtos_Lotes SET quantidade = ?, updated_at = ? WHERE id = ?',
            [novaQtd, nowMysql, loteRow.id]
          );

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

      await conn.execute(
        'UPDATE parceiro_lojas SET requisicoes_mes = COALESCE(requisicoes_mes, 0) + 1 WHERE id = ?',
        [tenantId]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      throw txErr;
    } finally {
      conn.release();
    }

    await registerLog(tenantId, 'PARCEIRO', 'API_FIFO_CHECKOUT', {
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
  createRequirePartnerAuth,
  handleProductSync,
  handleProductCheckout
};
