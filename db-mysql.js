'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/**
 * Carrega variáveis do arquivo .env raiz sem sobrescrever variáveis já definidas no ambiente.
 */
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn('⚠️ [ENV] Aviso ao ler .env:', err.message);
  }
}

loadEnvFile();

const MYSQL_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  database: process.env.DB_NAME || 'vokzo_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(MYSQL_CONFIG);

function getMysqlPool() {
  return pool;
}

/**
 * Normaliza parâmetros recebidos no padrão SQLite (array, args soltos, ou undefined).
 */
function extractQueryArgs(restArgs) {
  let callback = null;
  const args = [...restArgs];
  if (args.length > 0 && typeof args[args.length - 1] === 'function') {
    callback = args.pop();
  }
  let params = [];
  if (args.length === 1 && Array.isArray(args[0])) {
    params = args[0];
  } else if (args.length === 1 && args[0] === undefined) {
    params = [];
  } else if (args.length > 0) {
    params = args;
  }
  return { params, callback };
}

/**
 * Adapta pequenas diferenças sintáticas do SQLite para MySQL 8/MariaDB (XAMPP).
 */
function normalizeSqlForMysql(sql) {
  return String(sql || '')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO')
    .replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT')
    .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()')
    .replace(/datetime\s*\(\s*([a-zA-Z0-9_.]+)\s*\)/gi, '$1');
}

/**
 * Converte Date ou valor SQLite em string ISO/MySQL compatível quando necessário.
 */
function toMysqlDatetime(val) {
  if (!val) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function sanitizeParams(params) {
  if (!Array.isArray(params)) return [];
  return params.map(p => (p === undefined ? null : p));
}

/**
 * Wrapper MySQL mantendo a assinatura SQLite (db.run, db.get, db.all, db.exec, db.prepare)
 * com suporte total a async/await e callbacks opcionais.
 */
const db = {
  async run(sql, ...rest) {
    const { params, callback } = extractQueryArgs(rest);
    try {
      const normalized = normalizeSqlForMysql(sql);
      const [result] = await pool.query(normalized, sanitizeParams(params));
      const out = {
        changes: Number((result && result.affectedRows) || 0),
        affectedRows: Number((result && result.affectedRows) || 0),
        lastInsertRowid: Number((result && result.insertId) || 0),
        insertId: Number((result && result.insertId) || 0)
      };
      if (callback) callback(null, out);
      return out;
    } catch (err) {
      if (callback) {
        callback(err);
        return null;
      }
      throw err;
    }
  },

  async get(sql, ...rest) {
    const { params, callback } = extractQueryArgs(rest);
    try {
      const normalized = normalizeSqlForMysql(sql);
      const [rows] = await pool.query(normalized, sanitizeParams(params));
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
      if (callback) callback(null, row);
      return row;
    } catch (err) {
      if (callback) {
        callback(err);
        return undefined;
      }
      throw err;
    }
  },

  async all(sql, ...rest) {
    const { params, callback } = extractQueryArgs(rest);
    try {
      const normalized = normalizeSqlForMysql(sql);
      const [rows] = await pool.query(normalized, sanitizeParams(params));
      const list = Array.isArray(rows) ? rows : [];
      if (callback) callback(null, list);
      return list;
    } catch (err) {
      if (callback) {
        callback(err);
        return [];
      }
      throw err;
    }
  },

  async exec(sqlScript) {
    const statements = String(sqlScript || '')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await pool.query(normalizeSqlForMysql(stmt));
    }
    return true;
  },

  prepare(sql) {
    return {
      run: (...params) => db.run(sql, ...params),
      get: (...params) => db.get(sql, ...params),
      all: (...params) => db.all(sql, ...params)
    };
  },

  pool
};

const DEFAULT_GLOBAL_SETTINGS = {
  systemName: 'Alerta Vencimento',
  systemLogo: '',
  supportPhone: '11996466498',
  supportEmail: 'fas.alves.souza@gmail.com',
  retentionDays: 90,
  pixKey: '38032274880',
  pixKeyType: 'cpf',
  pixName: 'Fernando Alves',
  pixCity: 'Caieiras',
  pixTxId: '***',
  pixInstructions: 'Após o pagamento, seu acesso será liberado em instantes pelo administrador.',
  pixAmount: '49.90',
  pixAmountAnnual: '199.00',
  pixAmountXml: '19.90',
  xmlModulePrice: '19.90',
  toleranceDays: 3,
  freeLimit: 30,
  systemStatus: 'online',
  trialDays: 14,
  alertRedDays: 7,
  alertYellowDays: 30,
  partnerTokenPrice: 29.90,
  tplBilling: 'Olá, {nome_loja}! Seu período de teste no Alerta Vencimento expirou. Para continuar utilizando sem limites, renove por apenas R$ {valor} via Chave PIX: {chave_pix}. Enviamos o comprovante por aqui!',
  tplExpiry: '🚨 *ALERTA DE VENCIMENTO*\nO item *{nome_produto}* está a *{dias_vencer} dias* do vencimento. Acelere a saída para evitar prejuízos!'
};

const DEFAULT_ADMIN_CREDENTIALS = {
  phone: '11996466498',
  email: 'fas.alves.souza@gmail.com',
  pin: '4546',
  name: 'Administrador Master'
};

const DEFAULT_SYSTEM_CONFIG = {
  partnerTokenPrice: 29.90
};

async function ensureColumnExists(conn, tableName, columnName, columnDef) {
  try {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    const exists = rows && rows[0] && Number(rows[0].cnt) > 0;
    if (!exists) {
      await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDef}`);
    }
  } catch (err) {
    console.warn(`⚠️ [MYSQL SCHEMA] Aviso ao verificar coluna ${tableName}.${columnName}:`, err.message);
  }
}

async function ensureTableColumns(conn, tableName, columnSpecs) {
  try {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName]
    );
    const existing = new Set((rows || []).map(r => String(r.COLUMN_NAME || '').toLowerCase()));
    for (const [colName, colDef] of columnSpecs) {
      if (!existing.has(String(colName).toLowerCase())) {
        try {
          await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${colName}\` ${colDef}`);
          console.log(`🔧 [MYSQL SCHEMA] Coluna adicionada: ${tableName}.${colName}`);
        } catch (alterErr) {
          console.warn(`⚠️ [MYSQL SCHEMA] Falha ao adicionar ${tableName}.${colName}:`, alterErr.message);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ [MYSQL SCHEMA] Aviso ao inspecionar ${tableName}:`, err.message);
  }
}

async function ensureGlobalSettingsSchema(conn) {
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Global_Settings'`
  );
  const colNames = (cols || []).map(c => String(c.COLUMN_NAME || '').toLowerCase());
  const hasKey = colNames.includes('setting_key');
  const hasVal = colNames.includes('setting_value');

  if (hasKey && hasVal) {
    await ensureTableColumns(conn, 'Global_Settings', [
      ['updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
    ]);
    try {
      const [idxRows] = await conn.query(
        `SHOW INDEX FROM \`Global_Settings\` WHERE Column_name = 'setting_key' AND Non_unique = 0`
      );
      if (!idxRows || idxRows.length === 0) {
        await conn.query(`ALTER TABLE \`Global_Settings\` ADD UNIQUE INDEX \`uq_global_settings_key\` (\`setting_key\`)`);
      }
    } catch (idxErr) {
      console.warn('⚠️ [MYSQL SCHEMA] Aviso índice Global_Settings:', idxErr.message);
    }
    return;
  }

  let legacyRows = [];
  try {
    const [rows] = await conn.query('SELECT * FROM `Global_Settings`');
    if (Array.isArray(rows)) legacyRows = rows;
  } catch (e) {}

  const backupName = `Global_Settings_legacy_${Date.now()}`;
  await conn.query(`RENAME TABLE \`Global_Settings\` TO \`${backupName}\``);
  console.warn(`⚠️ [MYSQL SCHEMA] Tabela Global_Settings antiga sem coluna setting_key renomeada para ${backupName} e recriada.`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS Global_Settings (
      setting_key VARCHAR(128) PRIMARY KEY,
      setting_value LONGTEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const row of legacyRows) {
    if (!row || typeof row !== 'object') continue;
    const key = row.setting_key || row.chave || row.key_name || row.key || row.name || row.setting_name || row.config_key || row.id;
    const val = row.setting_value !== undefined ? row.setting_value
      : (row.valor !== undefined ? row.valor
      : (row.value !== undefined ? row.value
      : (row.val !== undefined ? row.val : row.config_value)));
    if (key !== undefined && key !== null && String(key).trim() !== '' && val !== undefined) {
      await conn.query(
        'INSERT IGNORE INTO Global_Settings (setting_key, setting_value) VALUES (?, ?)',
        [String(key).trim(), typeof val === 'string' ? val : JSON.stringify(val)]
      );
    }
  }
}

let initPromise = null;

/**
 * Inicializa banco vokzo_db no MySQL e cria todas as tabelas 1:1 caso ainda não existam.
 */
async function initMysqlDatabase() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // 1. Garante existência do schema vokzo_db no MySQL
    const bootstrapConn = await mysql.createConnection({
      host: MYSQL_CONFIG.host,
      port: MYSQL_CONFIG.port,
      user: MYSQL_CONFIG.user,
      password: MYSQL_CONFIG.password,
      charset: 'utf8mb4'
    });
    try {
      await bootstrapConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${MYSQL_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } finally {
      await bootstrapConn.end();
    }

    // 2. Cria todas as tabelas 1:1 + tabelas operacionais do sistema
    const conn = await pool.getConnection();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS planos_b2b (
          id VARCHAR(100) PRIMARY KEY,
          nome_plano VARCHAR(255) NOT NULL,
          limite_lojas INT NOT NULL,
          valor_mensal DOUBLE NOT NULL,
          descricao TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS parceiros (
          id VARCHAR(100) PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          cnpj VARCHAR(64) NOT NULL DEFAULT '',
          email VARCHAR(255) NOT NULL DEFAULT '',
          telefone VARCHAR(64) NOT NULL,
          pin VARCHAR(32) NOT NULL DEFAULT '4546',
          status VARCHAR(32) NOT NULL DEFAULT 'ATIVO',
          plano_id VARCHAR(100) NOT NULL DEFAULT 'plano_starter',
          api_key VARCHAR(255),
          dia_vencimento INT NOT NULL DEFAULT 15,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_parceiros_status (status),
          INDEX idx_parceiros_plano (plano_id),
          INDEX idx_parceiros_telefone (telefone)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS parceiro_lojas (
          id VARCHAR(100) PRIMARY KEY,
          parceiro_id VARCHAR(100) NOT NULL,
          nome_loja VARCHAR(255) NOT NULL,
          cnpj VARCHAR(64) NOT NULL,
          api_key VARCHAR(255) UNIQUE NOT NULL,
          status VARCHAR(32) DEFAULT 'ativo',
          requisicoes_mes INT DEFAULT 0,
          bloqueado_em VARCHAR(64),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_parceiro_lojas_pid (parceiro_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS faturas_parceiros (
          id VARCHAR(100) PRIMARY KEY,
          parceiro_id VARCHAR(100) NOT NULL,
          plano_id VARCHAR(100),
          mes_referencia VARCHAR(64) NOT NULL,
          lojas_cobradas INT NOT NULL DEFAULT 0,
          limite_lojas INT NOT NULL DEFAULT 50,
          valor_total DOUBLE NOT NULL,
          status VARCHAR(64) NOT NULL DEFAULT 'Pendente/Aberta',
          data_vencimento VARCHAR(32) NOT NULL,
          data_pagamento DATETIME NULL,
          pdf_url TEXT,
          payment_id VARCHAR(128),
          gateway VARCHAR(64),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_faturas_parceiro_pid (parceiro_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS api_requests_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          endpoint VARCHAR(255) NOT NULL,
          status_code INT NOT NULL,
          latency_ms INT NOT NULL,
          ip_origem VARCHAR(100),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS lojistas (
          telefone VARCHAR(64) PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          pin VARCHAR(32) NOT NULL DEFAULT '1234',
          plano VARCHAR(64) NOT NULL DEFAULT 'free',
          status VARCHAR(32) NOT NULL DEFAULT 'ativo',
          has_xml_import TINYINT(1) DEFAULT 0,
          trial_start_date VARCHAR(32),
          trial_days INT DEFAULT 14,
          email VARCHAR(255),
          documento VARCHAR(64),
          cpf VARCHAR(32),
          cnpj VARCHAR(32),
          niche_mode VARCHAR(32) DEFAULT 'mercado',
          red_days INT DEFAULT 7,
          yellow_days INT DEFAULT 30,
          red_months INT DEFAULT 2,
          yellow_months INT DEFAULT 6,
          capital_parado_days INT DEFAULT 90,
          frequencia_alerta VARCHAR(32) DEFAULT 'diario',
          pro_expiry VARCHAR(64),
          last_payment_json LONGTEXT,
          last_xml_payment_json LONGTEXT,
          updated_at VARCHAR(64),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lojistas_status (status),
          INDEX idx_lojistas_plano (plano)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS system_gateways (
          id VARCHAR(100) PRIMARY KEY,
          active_gateway VARCHAR(64) NOT NULL DEFAULT 'mercadopago',
          mp_access_token_prod TEXT,
          mp_public_key_prod TEXT,
          mp_access_token_test TEXT,
          mp_public_key_test TEXT,
          mp_environment VARCHAR(32) NOT NULL DEFAULT 'production',
          asaas_api_key_prod TEXT,
          asaas_api_key_test TEXT,
          asaas_environment VARCHAR(32) DEFAULT 'production',
          efi_client_id_prod TEXT,
          efi_client_secret_prod TEXT,
          efi_client_id_test TEXT,
          efi_client_secret_test TEXT,
          efi_environment VARCHAR(32) DEFAULT 'production',
          enable_pix TINYINT(1) DEFAULT 1,
          enable_credit_card TINYINT(1) DEFAULT 1,
          webhook_url TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS System_Logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          actor_id VARCHAR(128) NOT NULL,
          actor_role VARCHAR(64) NOT NULL,
          action VARCHAR(128) NOT NULL,
          details LONGTEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_system_logs_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS Repositores (
          phone VARCHAR(64) PRIMARY KEY,
          pin VARCHAR(32) NOT NULL,
          name VARCHAR(255) NOT NULL,
          tenant_id VARCHAR(64) NOT NULL,
          store_name VARCHAR(255),
          status VARCHAR(32) DEFAULT 'ativo',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_repositores_tenant (tenant_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS Produtos_Lotes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id VARCHAR(100) NOT NULL,
          codigo_barras VARCHAR(128) NOT NULL,
          nome VARCHAR(255) NOT NULL,
          lote VARCHAR(128) DEFAULT 'LT-PDV',
          data_validade VARCHAR(32) NOT NULL,
          quantidade INT NOT NULL DEFAULT 0,
          preco_unitario DOUBLE DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_lote_tenant_ean_val (tenant_id, codigo_barras, data_validade),
          INDEX idx_lotes_fifo (tenant_id, codigo_barras, data_validade)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS Global_Settings (
          setting_key VARCHAR(128) PRIMARY KEY,
          setting_value LONGTEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS lojistas_produtos (
          id VARCHAR(100) PRIMARY KEY,
          owner_phone VARCHAR(64) NOT NULL,
          name VARCHAR(255) NOT NULL,
          barcode VARCHAR(128),
          codigo_barras VARCHAR(128),
          batch VARCHAR(128) DEFAULT 'S/L',
          expiry VARCHAR(32),
          qty INT DEFAULT 1,
          unit_price DOUBLE DEFAULT 0,
          status VARCHAR(32) DEFAULT 'ativo',
          resolved_reason VARCHAR(128),
          resolved_at VARCHAR(64),
          data_cadastro VARCHAR(64),
          data_ultima_movimentacao VARCHAR(64),
          payload_json LONGTEXT,
          updated_at VARCHAR(64),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_lojistas_produtos_owner (owner_phone),
          INDEX idx_lojistas_produtos_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS pagamentos_pix (
          id VARCHAR(128) PRIMARY KEY,
          internal_id VARCHAR(128),
          gateway VARCHAR(64) DEFAULT 'pix_static',
          environment VARCHAR(64) DEFAULT 'concierge',
          method VARCHAR(64) DEFAULT 'pix',
          amount DOUBLE DEFAULT 0,
          nome_plano VARCHAR(255),
          description VARCHAR(255),
          type VARCHAR(64),
          phone VARCHAR(64),
          partner_id VARCHAR(100),
          plan_id VARCHAR(100),
          invoice_id VARCHAR(100),
          status VARCHAR(64) DEFAULT 'pending',
          status_detail VARCHAR(128),
          payload_pix LONGTEXT,
          qr_code LONGTEXT,
          chave_pix VARCHAR(255),
          beneficiario VARCHAR(255),
          cidade VARCHAR(128),
          approved_at VARCHAR(64),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_pagamentos_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Garante colunas adicionais em todas as tabelas caso já existissem de schema anterior
      await ensureGlobalSettingsSchema(conn);
      await ensureTableColumns(conn, 'planos_b2b', [
        ['nome_plano', "VARCHAR(255) NOT NULL DEFAULT 'Starter'"],
        ['limite_lojas', 'INT NOT NULL DEFAULT 50'],
        ['valor_mensal', 'DOUBLE NOT NULL DEFAULT 390.00'],
        ['descricao', 'TEXT'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'parceiros', [
        ['nome', "VARCHAR(255) NOT NULL DEFAULT 'Parceiro'"],
        ['cnpj', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ['email', "VARCHAR(255) NOT NULL DEFAULT ''"],
        ['telefone', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ['pin', "VARCHAR(32) NOT NULL DEFAULT '4546'"],
        ['status', "VARCHAR(32) NOT NULL DEFAULT 'ATIVO'"],
        ['plano_id', "VARCHAR(100) NOT NULL DEFAULT 'plano_starter'"],
        ['api_key', 'VARCHAR(255)'],
        ['dia_vencimento', 'INT NOT NULL DEFAULT 15'],
        ['updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'parceiro_lojas', [
        ['parceiro_id', "VARCHAR(100) NOT NULL DEFAULT ''"],
        ['nome_loja', "VARCHAR(255) NOT NULL DEFAULT ''"],
        ['cnpj', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ['api_key', 'VARCHAR(255)'],
        ['status', "VARCHAR(32) DEFAULT 'ativo'"],
        ['requisicoes_mes', 'INT DEFAULT 0'],
        ['bloqueado_em', 'VARCHAR(64)'],
        ['is_overage', 'TINYINT(1) DEFAULT 0'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'faturas_parceiros', [
        ['parceiro_id', "VARCHAR(100) NOT NULL DEFAULT ''"],
        ['plano_id', 'VARCHAR(100)'],
        ['mes_referencia', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ['lojas_cobradas', 'INT NOT NULL DEFAULT 0'],
        ['limite_lojas', 'INT NOT NULL DEFAULT 50'],
        ['valor_unitario', 'DOUBLE DEFAULT 0'],
        ['valor_total', 'DOUBLE NOT NULL DEFAULT 0'],
        ['status', "VARCHAR(64) NOT NULL DEFAULT 'Pendente/Aberta'"],
        ['data_vencimento', "VARCHAR(32) NOT NULL DEFAULT ''"],
        ['data_pagamento', 'DATETIME NULL'],
        ['pdf_url', 'TEXT'],
        ['payment_id', 'VARCHAR(128)'],
        ['gateway', 'VARCHAR(64)'],
        ['nome_plano', 'VARCHAR(128)'],
        ['excedentes_qtd', 'INT DEFAULT 0'],
        ['overage_fee', 'DOUBLE DEFAULT 19.90'],
        ['overage_total', 'DOUBLE DEFAULT 0'],
        ['valor_mensal', 'DOUBLE DEFAULT 0'],
        ['fechada', 'TINYINT(1) DEFAULT 1'],
        ['data_fechamento', 'VARCHAR(32)'],
        ['paid_by', 'VARCHAR(64)'],
        ['auto_generated', 'TINYINT(1) DEFAULT 0'],
        ['snapshot_at', 'VARCHAR(64)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'lojistas', [
        ['nome', "VARCHAR(255) NOT NULL DEFAULT 'Lojista'"],
        ['pin', "VARCHAR(32) NOT NULL DEFAULT '1234'"],
        ['plano', "VARCHAR(64) NOT NULL DEFAULT 'free'"],
        ['status', "VARCHAR(32) NOT NULL DEFAULT 'ativo'"],
        ['has_xml_import', 'TINYINT(1) DEFAULT 0'],
        ['trial_start_date', 'VARCHAR(32)'],
        ['trial_days', 'INT DEFAULT 14'],
        ['email', 'VARCHAR(255)'],
        ['documento', 'VARCHAR(64)'],
        ['cpf', 'VARCHAR(32)'],
        ['cnpj', 'VARCHAR(32)'],
        ['niche_mode', "VARCHAR(32) DEFAULT 'mercado'"],
        ['red_days', 'INT DEFAULT 7'],
        ['yellow_days', 'INT DEFAULT 30'],
        ['red_months', 'INT DEFAULT 2'],
        ['yellow_months', 'INT DEFAULT 6'],
        ['capital_parado_days', 'INT DEFAULT 90'],
        ['frequencia_alerta', "VARCHAR(32) DEFAULT 'diario'"],
        ['pro_expiry', 'VARCHAR(64)'],
        ['last_payment_json', 'LONGTEXT'],
        ['last_xml_payment_json', 'LONGTEXT'],
        ['plano_ciclo', 'VARCHAR(32)'],
        ['pro_expires_at', 'VARCHAR(64)'],
        ['updated_at', 'VARCHAR(64)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'lojistas_produtos', [
        ['owner_phone', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ['name', "VARCHAR(255) NOT NULL DEFAULT ''"],
        ['barcode', 'VARCHAR(128)'],
        ['codigo_barras', 'VARCHAR(128)'],
        ['batch', "VARCHAR(128) DEFAULT 'S/L'"],
        ['expiry', 'VARCHAR(32)'],
        ['qty', 'INT DEFAULT 1'],
        ['unit_price', 'DOUBLE DEFAULT 0'],
        ['status', "VARCHAR(32) DEFAULT 'ativo'"],
        ['resolved_reason', 'VARCHAR(128)'],
        ['resolved_at', 'VARCHAR(64)'],
        ['data_cadastro', 'VARCHAR(64)'],
        ['data_ultima_movimentacao', 'VARCHAR(64)'],
        ['payload_json', 'LONGTEXT'],
        ['updated_at', 'VARCHAR(64)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'System_Logs', [
        ['actor_id', "VARCHAR(128) NOT NULL DEFAULT 'SISTEMA'"],
        ['actor_role', "VARCHAR(64) NOT NULL DEFAULT 'SISTEMA'"],
        ['action', "VARCHAR(128) NOT NULL DEFAULT 'LOG'"],
        ['details', 'LONGTEXT'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'Repositores', [
        ['pin', "VARCHAR(32) NOT NULL DEFAULT '1234'"],
        ['name', "VARCHAR(255) NOT NULL DEFAULT 'Repositor'"],
        ['tenant_id', "VARCHAR(64) NOT NULL DEFAULT ''"],
        ['store_name', 'VARCHAR(255)'],
        ['status', "VARCHAR(32) DEFAULT 'ativo'"],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'Produtos_Lotes', [
        ['tenant_id', "VARCHAR(100) NOT NULL DEFAULT ''"],
        ['codigo_barras', "VARCHAR(128) NOT NULL DEFAULT ''"],
        ['nome', "VARCHAR(255) NOT NULL DEFAULT ''"],
        ['lote', "VARCHAR(128) DEFAULT 'LT-PDV'"],
        ['data_validade', "VARCHAR(32) NOT NULL DEFAULT ''"],
        ['quantidade', 'INT NOT NULL DEFAULT 0'],
        ['preco_unitario', 'DOUBLE DEFAULT 0'],
        ['updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);
      await ensureTableColumns(conn, 'pagamentos_pix', [
        ['internal_id', 'VARCHAR(128)'],
        ['gateway', "VARCHAR(64) DEFAULT 'pix_static'"],
        ['environment', "VARCHAR(64) DEFAULT 'concierge'"],
        ['method', "VARCHAR(64) DEFAULT 'pix'"],
        ['amount', 'DOUBLE DEFAULT 0'],
        ['nome_plano', 'VARCHAR(255)'],
        ['description', 'VARCHAR(255)'],
        ['type', 'VARCHAR(64)'],
        ['phone', 'VARCHAR(64)'],
        ['partner_id', 'VARCHAR(100)'],
        ['plan_id', 'VARCHAR(100)'],
        ['invoice_id', 'VARCHAR(100)'],
        ['status', "VARCHAR(64) DEFAULT 'pending'"],
        ['status_detail', 'VARCHAR(128)'],
        ['payload_pix', 'LONGTEXT'],
        ['qr_code', 'LONGTEXT'],
        ['chave_pix', 'VARCHAR(255)'],
        ['beneficiario', 'VARCHAR(255)'],
        ['cidade', 'VARCHAR(128)'],
        ['approved_at', 'VARCHAR(64)'],
        ['created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP']
      ]);

      // Seeds idempotentes
      await conn.query(`
        INSERT IGNORE INTO planos_b2b (id, nome_plano, limite_lojas, valor_mensal, descricao) VALUES
        ('plano_starter', 'Starter', 50, 390.00, 'Franquia Starter - Até 50 lojas/PDVs com API ilimitada'),
        ('plano_pro', 'Pro', 150, 890.00, 'Franquia Pro - Até 150 lojas/PDVs com API ilimitada'),
        ('plano_enterprise', 'Enterprise', 500, 1990.00, 'Franquia Enterprise - Até 500 lojas/PDVs com SLA prioritário')
      `);

      const defaultOverageFee = String(process.env.OVERAGE_FEE || '19.90');
      await conn.query(
        'INSERT IGNORE INTO Global_Settings (setting_key, setting_value) VALUES (?, ?)',
        ['overage_fee', defaultOverageFee]
      );
      await conn.query(
        'INSERT IGNORE INTO Global_Settings (setting_key, setting_value) VALUES (?, ?)',
        ['globalSettings', JSON.stringify(DEFAULT_GLOBAL_SETTINGS)]
      );
      await conn.query(
        'INSERT IGNORE INTO Global_Settings (setting_key, setting_value) VALUES (?, ?)',
        ['adminCredentials', JSON.stringify(DEFAULT_ADMIN_CREDENTIALS)]
      );
      await conn.query(
        'INSERT IGNORE INTO Global_Settings (setting_key, setting_value) VALUES (?, ?)',
        ['config', JSON.stringify(DEFAULT_SYSTEM_CONFIG)]
      );

      console.log(`✅ [MYSQL] Conectado e sincronizado com sucesso (${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database})`);
    } finally {
      conn.release();
    }
  })().catch(err => {
    initPromise = null;
    console.error('❌ [MYSQL INIT ERROR]:', err.message);
    throw err;
  });

  return initPromise;
}

async function getSettingValue(key, defaultValue = null) {
  await initMysqlDatabase();
  const row = await db.get(
    'SELECT setting_value FROM Global_Settings WHERE setting_key = ?',
    [String(key)]
  );
  if (!row || row.setting_value === undefined || row.setting_value === null) {
    return defaultValue;
  }
  return row.setting_value;
}

async function setSettingValue(key, value) {
  await initMysqlDatabase();
  const valStr = typeof value === 'string' ? value : JSON.stringify(value);
  await db.run(
    `INSERT INTO Global_Settings (setting_key, setting_value, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
    [String(key), valStr]
  );
  return valStr;
}

async function getSettingJson(key, fallbackObj = {}) {
  const raw = await getSettingValue(key, null);
  if (!raw) return Object.assign({}, fallbackObj);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? Object.assign({}, fallbackObj, parsed) : Object.assign({}, fallbackObj);
  } catch (e) {
    return Object.assign({}, fallbackObj);
  }
}

async function setSettingJson(key, obj) {
  await setSettingValue(key, JSON.stringify(obj || {}));
  return obj;
}

module.exports = {
  MYSQL_CONFIG,
  pool,
  db,
  getMysqlPool,
  initMysqlDatabase,
  normalizeSqlForMysql,
  sanitizeParams,
  toMysqlDatetime,
  getSettingValue,
  setSettingValue,
  getSettingJson,
  setSettingJson,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_ADMIN_CREDENTIALS,
  DEFAULT_SYSTEM_CONFIG
};
