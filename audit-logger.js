'use strict';

const {
  db,
  pool,
  initMysqlDatabase,
  toMysqlDatetime,
  getSettingValue,
  setSettingValue
} = require('./db-mysql');

async function initAuditDatabase() {
  return initMysqlDatabase();
}

async function registerLog(actorId, actorRole, action, details) {
  const safeActorId = String(actorId || 'SISTEMA').trim();
  const safeActorRole = String(actorRole || 'SISTEMA').toUpperCase().trim();
  const safeAction = String(action || 'UNKNOWN_ACTION').toUpperCase().trim();
  const safeDetails = typeof details === 'string'
    ? details
    : JSON.stringify(details || {});
  const createdAt = toMysqlDatetime(new Date());

  try {
    await initMysqlDatabase();
    const info = await db.run(
      'INSERT INTO System_Logs (actor_id, actor_role, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [safeActorId, safeActorRole, safeAction, safeDetails, createdAt]
    );
    return {
      success: true,
      changes: Number((info && info.changes) || 1),
      id: Number((info && info.lastInsertRowid) || 0)
    };
  } catch (err) {
    console.error('❌ [AUDIT MYSQL] Erro ao gravar System_Logs:', err.message);
    return { success: false, changes: 0, error: err.message };
  }
}

async function getSystemLogs(limit = 100) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  try {
    await initMysqlDatabase();
    const [rows] = await pool.query(
      'SELECT id, actor_id, actor_role, action, details, created_at FROM System_Logs ORDER BY created_at DESC, id DESC LIMIT ?',
      [safeLimit]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error('❌ [AUDIT MYSQL] Erro ao consultar System_Logs:', err.message);
    return [];
  }
}

async function getSystemLogsPaginated(page = 1, limit = 15) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  try {
    await initMysqlDatabase();
    const countRow = await db.get('SELECT COUNT(id) AS total FROM System_Logs');
    const total = Number((countRow && countRow.total) || 0);
    const [rows] = await pool.query(
      'SELECT id, actor_id, actor_role, action, details, created_at FROM System_Logs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [safeLimit, offset]
    );

    return {
      data: Array.isArray(rows) ? rows : [],
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit)
      }
    };
  } catch (err) {
    console.error('❌ [AUDIT MYSQL] Erro ao paginar System_Logs:', err.message);
    return {
      data: [],
      pagination: { total: 0, page: safePage, limit: safeLimit, totalPages: 0 }
    };
  }
}

async function insertRepositorMysql({ phone, pin, name, tenantId, storeName, status, createdAt }) {
  try {
    await initMysqlDatabase();
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const cleanTenant = String(tenantId || '').replace(/\D/g, '');
    const mysqlCreated = toMysqlDatetime(createdAt || new Date());

    const info = await db.run(
      `INSERT INTO Repositores (phone, pin, name, tenant_id, store_name, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         pin = VALUES(pin),
         name = VALUES(name),
         tenant_id = VALUES(tenant_id),
         store_name = VALUES(store_name),
         status = VALUES(status)`,
      [
        cleanPhone,
        String(pin || '').trim(),
        String(name || 'Repositor').trim(),
        cleanTenant,
        String(storeName || 'Seu Mercado').trim(),
        String(status || 'ativo').trim(),
        mysqlCreated
      ]
    );
    return { success: true, changes: Number((info && info.changes) || 1) };
  } catch (err) {
    console.error('❌ [MYSQL REPOSITORES] Erro no INSERT/UPDATE:', err.message);
    return { success: false, changes: 0, error: err.message };
  }
}

async function getRepositoresMysql(tenantId) {
  try {
    await initMysqlDatabase();
    const cleanTenant = String(tenantId || '').replace(/\D/g, '');
    const rows = cleanTenant
      ? await db.all(
          'SELECT phone, pin, name, tenant_id, store_name, status, created_at FROM Repositores WHERE tenant_id = ? ORDER BY created_at DESC',
          [cleanTenant]
        )
      : await db.all(
          'SELECT phone, pin, name, tenant_id, store_name, status, created_at FROM Repositores ORDER BY created_at DESC'
        );

    return rows.map(r => ({
      phone: r.phone,
      pin: r.pin,
      name: r.name,
      tenantId: r.tenant_id,
      storeName: r.store_name,
      status: r.status || 'ativo',
      createdAt: r.created_at
    }));
  } catch (err) {
    console.error('❌ [MYSQL REPOSITORES] Erro no SELECT:', err.message);
    return [];
  }
}

async function findRepositorByPhoneMysql(phone) {
  try {
    await initMysqlDatabase();
    const clean = String(phone || '').replace(/\D/g, '');
    if (!clean) return null;
    const r = await db.get(
      'SELECT phone, pin, name, tenant_id, store_name, status, created_at FROM Repositores WHERE phone = ?',
      [clean]
    );
    if (!r) return null;
    return {
      phone: r.phone,
      pin: r.pin,
      name: r.name,
      tenantId: r.tenant_id,
      storeOwnerPhone: r.tenant_id,
      storeName: r.store_name,
      status: r.status || 'ativo',
      createdAt: r.created_at
    };
  } catch (err) {
    console.error('❌ [MYSQL REPOSITORES] Erro no FIND:', err.message);
    return null;
  }
}

async function deleteRepositorMysql(phone, tenantId) {
  try {
    await initMysqlDatabase();
    const clean = String(phone || '').replace(/\D/g, '');
    const cleanTenant = String(tenantId || '').replace(/\D/g, '');
    const info = cleanTenant
      ? await db.run('DELETE FROM Repositores WHERE phone = ? AND tenant_id = ?', [clean, cleanTenant])
      : await db.run('DELETE FROM Repositores WHERE phone = ?', [clean]);
    return { success: true, changes: Number((info && info.changes) || 0) };
  } catch (err) {
    console.error('❌ [MYSQL REPOSITORES] Erro no DELETE:', err.message);
    return { success: false, changes: 0, error: err.message };
  }
}

module.exports = {
  initAuditDatabase,
  registerLog,
  getSystemLogs,
  getSystemLogsPaginated,
  insertRepositorMysql,
  getRepositoresMysql,
  findRepositorByPhoneMysql,
  deleteRepositorMysql,
  getGlobalSettingMysql: getSettingValue,
  setGlobalSettingMysql: setSettingValue
};
