const path = require('path');
const fs = require('fs');

const SQLITE_DB_PATH = path.join(__dirname, 'vokzo_audit.db');
let sqliteDb = null;
let useSqlite = false;

/**
 * Inicializa o banco SQLite nativo (node:sqlite) e cria a tabela System_Logs.
 */
function initAuditDatabase() {
  if (sqliteDb) return sqliteDb;
  try {
    const { DatabaseSync } = require('node:sqlite');
    sqliteDb = new DatabaseSync(SQLITE_DB_PATH);
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS System_Logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON System_Logs(created_at DESC);

      CREATE TABLE IF NOT EXISTS Repositores (
        phone TEXT PRIMARY KEY,
        pin TEXT NOT NULL,
        name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        store_name TEXT,
        status TEXT DEFAULT 'ativo',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_repositores_tenant ON Repositores(tenant_id);
    `);
    useSqlite = true;
    return sqliteDb;
  } catch (err) {
    console.warn('⚠️ [AUDIT] node:sqlite indisponível, ativando fallback JSON:', err.message);
    useSqlite = false;
    return null;
  }
}

/**
 * Registra uma ação na trilha de auditoria (System_Logs).
 * @param {string|number} actorId - ID/Telefone do usuário que executou a ação
 * @param {string} actorRole - Papel do usuário ('SUPER_ADMIN', 'ADMIN', 'PARCEIRO', 'LOJISTA', 'REPOSITOR', 'SISTEMA')
 * @param {string} action - Nome identificador da ação (ex: 'UPDATE_PLANO_PARCEIRO')
 * @param {object|string} details - Dados alterados ou contexto da operação
 * @returns {{ success: boolean, id?: number, changes?: number }}
 */
function registerLog(actorId, actorRole, action, details) {
  const safeActorId = String(actorId || 'SISTEMA').trim();
  const safeActorRole = String(actorRole || 'SISTEMA').toUpperCase().trim();
  const safeAction = String(action || 'UNKNOWN_ACTION').toUpperCase().trim();
  const safeDetails = typeof details === 'string'
    ? details
    : JSON.stringify(details || {});
  const timestampIso = new Date().toISOString();

  initAuditDatabase();

  if (useSqlite && sqliteDb) {
    try {
      const stmt = sqliteDb.prepare(
        'INSERT INTO System_Logs (actor_id, actor_role, action, details, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      const info = stmt.run(safeActorId, safeActorRole, safeAction, safeDetails, timestampIso);
      return {
        success: true,
        changes: info.changes,
        id: Number(info.lastInsertRowid)
      };
    } catch (err) {
      console.error('❌ [AUDIT] Erro ao gravar log no SQLite:', err.message);
    }
  }

  // Fallback seguro em arquivo JSON caso SQLite falhe
  try {
    const jsonLogPath = path.join(__dirname, 'system_logs_fallback.json');
    let list = [];
    if (fs.existsSync(jsonLogPath)) {
      list = JSON.parse(fs.readFileSync(jsonLogPath, 'utf8') || '[]');
    }
    const nextId = list.length > 0 ? (Number(list[0].id || 0) + 1) : 1;
    list.unshift({
      id: nextId,
      actor_id: safeActorId,
      actor_role: safeActorRole,
      action: safeAction,
      details: safeDetails,
      created_at: timestampIso
    });
    if (list.length > 500) list = list.slice(0, 500);
    fs.writeFileSync(jsonLogPath, JSON.stringify(list, null, 2), 'utf8');
    return { success: true, changes: 1, id: nextId };
  } catch (e) {
    console.error('❌ [AUDIT] Erro no fallback JSON de log:', e.message);
    return { success: false, changes: 0 };
  }
}

/**
 * Busca os últimos registros da tabela System_Logs ordenados por data decrescente.
 * @param {number} limit - Máximo de registros (padrão 100)
 * @returns {Array<object>}
 */
function getSystemLogs(limit = 100) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  initAuditDatabase();

  if (useSqlite && sqliteDb) {
    try {
      const stmt = sqliteDb.prepare(
        'SELECT id, actor_id, actor_role, action, details, created_at FROM System_Logs ORDER BY datetime(created_at) DESC, id DESC LIMIT ?'
      );
      return stmt.all(safeLimit);
    } catch (err) {
      console.error('❌ [AUDIT] Erro ao consultar System_Logs:', err.message);
    }
  }

  try {
    const jsonLogPath = path.join(__dirname, 'system_logs_fallback.json');
    if (fs.existsSync(jsonLogPath)) {
      const list = JSON.parse(fs.readFileSync(jsonLogPath, 'utf8') || '[]');
      return list.slice(0, safeLimit);
    }
  } catch (e) {}

  return [];
}

/**
 * Busca registros da tabela System_Logs com paginação Server-Side.
 * @param {number} page - Página atual (padrão 1)
 * @param {number} limit - Registros por página (padrão 15)
 */
function getSystemLogsPaginated(page = 1, limit = 15) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  initAuditDatabase();

  if (useSqlite && sqliteDb) {
    try {
      const countRow = sqliteDb.prepare('SELECT COUNT(id) as total FROM System_Logs').get();
      const total = Number((countRow && countRow.total) || 0);
      const rows = sqliteDb.prepare(
        'SELECT id, actor_id, actor_role, action, details, created_at FROM System_Logs ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?'
      ).all(safeLimit, offset);

      return {
        data: rows,
        pagination: {
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit)
        }
      };
    } catch (err) {
      console.error('❌ [AUDIT] Erro ao paginar System_Logs:', err.message);
    }
  }

  try {
    const jsonLogPath = path.join(__dirname, 'system_logs_fallback.json');
    if (fs.existsSync(jsonLogPath)) {
      const list = JSON.parse(fs.readFileSync(jsonLogPath, 'utf8') || '[]');
      const total = list.length;
      return {
        data: list.slice(offset, offset + safeLimit),
        pagination: {
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit)
        }
      };
    }
  } catch (e) {}

  return {
    data: [],
    pagination: { total: 0, page: safePage, limit: safeLimit, totalPages: 0 }
  };
}

function insertRepositorSqlite({ phone, pin, name, tenantId, storeName, status, createdAt }) {
  initAuditDatabase();
  if (!useSqlite || !sqliteDb) return { success: false, changes: 0 };
  try {
    const stmt = sqliteDb.prepare(`
      INSERT OR REPLACE INTO Repositores (phone, pin, name, tenant_id, store_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      String(phone || '').trim(),
      String(pin || '').trim(),
      String(name || 'Repositor').trim(),
      String(tenantId || '').trim(),
      String(storeName || 'Seu Mercado').trim(),
      String(status || 'ativo').trim(),
      createdAt || new Date().toISOString()
    );
    return { success: true, changes: info.changes };
  } catch (err) {
    console.error('❌ [SQLITE REPOSITORES] Erro no INSERT:', err.message);
    return { success: false, changes: 0, error: err.message };
  }
}

function getRepositoresSqlite(tenantId) {
  initAuditDatabase();
  if (!useSqlite || !sqliteDb) return null;
  try {
    const cleanTenant = String(tenantId || '').replace(/\D/g, '');
    const rows = cleanTenant
      ? sqliteDb.prepare('SELECT phone, pin, name, tenant_id, store_name, status, created_at FROM Repositores WHERE tenant_id = ? ORDER BY datetime(created_at) DESC').all(cleanTenant)
      : sqliteDb.prepare('SELECT phone, pin, name, tenant_id, store_name, status, created_at FROM Repositores ORDER BY datetime(created_at) DESC').all();
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
    console.error('❌ [SQLITE REPOSITORES] Erro no SELECT:', err.message);
    return null;
  }
}

function findRepositorByPhoneSqlite(phone) {
  initAuditDatabase();
  if (!useSqlite || !sqliteDb) return null;
  try {
    const clean = String(phone || '').replace(/\D/g, '');
    if (!clean) return null;
    const r = sqliteDb.prepare('SELECT phone, pin, name, tenant_id, store_name, status, created_at FROM Repositores WHERE phone = ?').get(clean);
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
    return null;
  }
}

function deleteRepositorSqlite(phone, tenantId) {
  initAuditDatabase();
  if (!useSqlite || !sqliteDb) return { success: false, changes: 0 };
  try {
    const clean = String(phone || '').replace(/\D/g, '');
    const cleanTenant = String(tenantId || '').replace(/\D/g, '');
    const info = cleanTenant
      ? sqliteDb.prepare('DELETE FROM Repositores WHERE phone = ? AND tenant_id = ?').run(clean, cleanTenant)
      : sqliteDb.prepare('DELETE FROM Repositores WHERE phone = ?').run(clean);
    return { success: true, changes: info.changes };
  } catch (err) {
    return { success: false, changes: 0 };
  }
}

// Inicializa automaticamente ao importar
initAuditDatabase();

module.exports = {
  initAuditDatabase,
  registerLog,
  getSystemLogs,
  getSystemLogsPaginated,
  insertRepositorSqlite,
  getRepositoresSqlite,
  findRepositorByPhoneSqlite,
  deleteRepositorSqlite
};
