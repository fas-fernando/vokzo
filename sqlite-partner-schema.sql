-- =========================================================================
-- ESQUEMA SQLITE COMPLETO: MÓDULO PARCEIRO / REVENDEDOR B2B & GESTÃO DE FATURAS
-- Modelo de Negócio: Franquia Fixa de Tokens (Pacotes B2B)
-- Sistema: Alerta Vencimento SaaS - Arquitetura Multi-Tenant
-- =========================================================================

-- 1. TABELA DE PACOTES / PLANOS DE FRANQUIA FIXA (B2B)
CREATE TABLE IF NOT EXISTS planos_b2b (
    id TEXT PRIMARY KEY,                                      -- Identificador único do plano (ex: 'plano_starter')
    nome_plano TEXT NOT NULL,                                 -- Nome comercial (ex: 'Starter', 'Pro', 'Enterprise')
    limite_lojas INTEGER NOT NULL,                            -- Quantidade máxima de lojas/tenants permitidas (Tokens)
    valor_mensal REAL NOT NULL,                               -- Valor fixo mensal da franquia em R$
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- SEED: Planos Padrão do Sistema
INSERT OR IGNORE INTO planos_b2b (id, nome_plano, limite_lojas, valor_mensal) VALUES
('plano_starter', 'Starter', 50, 390.00),
('plano_pro', 'Pro', 150, 890.00),
('plano_enterprise', 'Enterprise', 500, 1990.00);

-- 2. TABELA DE PARCEIROS (EMPRESAS DE PDV & INTEGRADORES B2B)
-- Entidade TOTALMENTE INDEPENDENTE de Lojistas
CREATE TABLE IF NOT EXISTS parceiros (
    id TEXT PRIMARY KEY,                                      -- Tenant_ID único do parceiro (ex: 'PARC-001')
    nome TEXT NOT NULL,                                       -- Razão Social / Nome da Empresa de PDV
    cnpj TEXT UNIQUE NOT NULL,                                -- CNPJ da Empresa Parceira
    email TEXT NOT NULL,                                      -- E-mail para contato e faturamento
    telefone TEXT NOT NULL,                                   -- WhatsApp do responsável
    pin TEXT NOT NULL DEFAULT '4546',                         -- PIN de 4 dígitos para autenticação rápida
    status TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ativo', 'bloqueado')), -- 'ativo' ou 'bloqueado' (Soft Lock)
    plano_id TEXT NOT NULL DEFAULT 'plano_starter',           -- Vínculo com Planos_B2B (Foreign Key)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plano_id) REFERENCES planos_b2b(id) ON DELETE RESTRICT
);

-- 3. TABELA DE LOJAS / TENANTS VINCULADOS AO PARCEIRO
CREATE TABLE IF NOT EXISTS parceiro_lojas (
    id TEXT PRIMARY KEY,                                      -- Tenant_ID da Loja (ex: 'TNT-DSP01')
    parceiro_id TEXT NOT NULL,                                -- Chave estrangeira referenciando parceiros(id)
    nome_loja TEXT NOT NULL,                                  -- Nome da Farmácia / Mercado
    cnpj TEXT NOT NULL,                                       -- CNPJ da Loja vinculada
    api_key TEXT UNIQUE NOT NULL,                             -- Chave secreta de API para autenticação Bearer
    status TEXT DEFAULT 'ativo',                              -- 'ativo', 'inativo'
    requisicoes_mes INTEGER DEFAULT 0,                        -- Contador de requisições da API
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parceiro_id) REFERENCES parceiros(id) ON DELETE RESTRICT
);

-- 4. TABELA DE FATURAS DOS PARCEIROS (INVOICES B2B - FRANQUIA FIXA)
CREATE TABLE IF NOT EXISTS faturas_parceiros (
    id TEXT PRIMARY KEY,                                      -- Código da fatura (ex: 'FAT-2026-11-001')
    parceiro_id TEXT NOT NULL,                                -- Chave estrangeira referenciando parceiros(id)
    plano_id TEXT,                                            -- Identificador do plano contratado
    mes_referencia TEXT NOT NULL,                             -- Mês/Ano (ex: '11/2026')
    lojas_cobradas INTEGER NOT NULL,                          -- Lojas ativas no período (Tokens em uso)
    limite_lojas INTEGER NOT NULL DEFAULT 50,                 -- Limite contratado da franquia
    valor_total REAL NOT NULL,                                -- Valor fixo da franquia mensal (R$)
    status TEXT NOT NULL CHECK (status IN ('Pendente/Aberta', 'Pendente', 'Paga', 'Vencida', 'Cancelada')),
    data_vencimento DATE NOT NULL,
    data_pagamento DATETIME,
    pdf_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parceiro_id) REFERENCES parceiros(id) ON DELETE RESTRICT,
    FOREIGN KEY (plano_id) REFERENCES planos_b2b(id) ON DELETE SET NULL
);

-- 5. TABELA DE AUDITORIA DE REQUISIÇÕES DA API
CREATE TABLE IF NOT EXISTS api_requests_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    ip_origem TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_parceiros_status ON parceiros(status);
CREATE INDEX IF NOT EXISTS idx_parceiros_plano ON parceiros(plano_id);
CREATE INDEX IF NOT EXISTS idx_parceiro_lojas_pid ON parceiro_lojas(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_faturas_parceiro_pid ON faturas_parceiros(parceiro_id);

-- 6. TABELA DE LOJISTAS DIRETOS (COMÉRCIO LOCAL / ASSINANTES PIX)
-- REGRA DE ARQUITETURA: Lojistas e Parceiros são entidades 100% independentes.
CREATE TABLE IF NOT EXISTS lojistas (
    telefone TEXT PRIMARY KEY,                                -- WhatsApp normalizado com DDI/DDD (ex: '5511999998888')
    nome TEXT NOT NULL,                                       -- Nome fantasia da loja ou estabelecimento
    pin TEXT NOT NULL DEFAULT '1234',                         -- PIN de 4 dígitos para autenticação
    plano TEXT NOT NULL DEFAULT 'free',                       -- 'free' (Trial), 'premium' (PRO) ou 'automacao'
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'bloqueado')), -- Soft Lock (sem delete físico)
    has_xml_import INTEGER DEFAULT 0,                         -- Permissão de importação XML NF-e (0=Não, 1=Sim)
    trial_start_date DATE,                                    -- Data de início do período trial
    trial_days INTEGER DEFAULT 14,                            -- Duração do teste grátis
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lojistas_status ON lojistas(status);
CREATE INDEX IF NOT EXISTS idx_lojistas_plano ON lojistas(plano);

-- =========================================================================
-- 7. TABELA DE CREDENCIAIS DE GATEWAY DE PAGAMENTO (MULTI-AMBIENTE)
-- Armazena simultaneamente chaves de Produção e Testes sem sobrescrita
-- =========================================================================
CREATE TABLE IF NOT EXISTS system_gateways (
    id TEXT PRIMARY KEY DEFAULT 'primary_gateway',            -- Identificador único do registro de gateways
    active_gateway TEXT NOT NULL DEFAULT 'mercadopago',       -- 'mercadopago', 'asaas', 'efi'
    
    -- MERCADO PAGO: PRODUÇÃO OFICIAL (APP_USR-...)
    mp_access_token_prod TEXT,                                -- Token privado de produção
    mp_public_key_prod TEXT,                                  -- Chave pública de produção para tokenização
    
    -- MERCADO PAGO: SANDBOX / TESTES (TEST-...)
    mp_access_token_test TEXT,                                -- Token privado de testes
    mp_public_key_test TEXT,                                  -- Chave pública de testes
    
    -- CONTROLE DE AMBIENTE ATIVO MERCADO PAGO ('production' | 'sandbox')
    mp_environment TEXT NOT NULL DEFAULT 'production' CHECK (mp_environment IN ('production', 'sandbox')),
    
    -- GATEWAY ASAAS (MULTI-AMBIENTE)
    asaas_api_key_prod TEXT,
    asaas_api_key_test TEXT,
    asaas_environment TEXT DEFAULT 'production',
    
    -- GATEWAY EFÍ BANK (MULTI-AMBIENTE)
    efi_client_id_prod TEXT,
    efi_client_secret_prod TEXT,
    efi_client_id_test TEXT,
    efi_client_secret_test TEXT,
    efi_environment TEXT DEFAULT 'production',

    enable_pix INTEGER DEFAULT 1,                             -- Habilita checkout via PIX
    enable_credit_card INTEGER DEFAULT 1,                     -- Habilita checkout via Cartão
    webhook_url TEXT,                                         -- Endpoint para webhooks bancários
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================================
-- QUERY SQL B2B: LISTA DE PARCEIROS (LEFT JOIN PARA PREVENÇÃO DE FALHAS)
-- =========================================================================
-- SELECT 
--     p.id,
--     p.nome AS name,
--     p.cnpj,
--     p.telefone AS phone,
--     p.email,
--     p.status,
--     p.created_at AS createdAt,
--     COALESCE(pb.id, 'plano_starter') AS plano_id,
--     COALESCE(pb.nome_plano, 'Starter') AS nome_plano,
--     COALESCE(pb.limite_lojas, 50) AS limite_lojas,
--     COALESCE(pb.valor_mensal, 0.0) AS valor_mensal,
--     COUNT(DISTINCT s.id) AS storesCount,
--     COUNT(DISTINCT CASE WHEN LOWER(s.status) = 'ativo' THEN s.id END) AS activeStoresCount
-- FROM parceiros p
-- LEFT JOIN planos_b2b pb ON p.plano_id = pb.id
-- LEFT JOIN parceiro_lojas s ON s.parceiro_id = p.id
-- GROUP BY p.id;

-- =========================================================================
-- QUERY SQL B2B: FATURAMENTO MENSAL TOTAL (SUM DO VALOR_MENSAL DOS PLANOS)
-- =========================================================================
-- SELECT 
--     COUNT(DISTINCT p.id) AS total_partners,
--     COUNT(DISTINCT CASE WHEN LOWER(s.status) = 'ativo' THEN s.id END) AS total_tenants,
--     COALESCE(SUM(CASE WHEN LOWER(p.status) = 'ativo' THEN pb.valor_mensal ELSE 0 END), 0) AS monthly_revenue
-- FROM parceiros p
-- LEFT JOIN planos_b2b pb ON p.plano_id = pb.id
-- LEFT JOIN parceiro_lojas s ON s.parceiro_id = p.id;


-- ============================================================================
-- TABELA DE AUDITORIA GLOBAL DO SISTEMA (AUDIT TRAIL)
-- ============================================================================
CREATE TABLE IF NOT EXISTS System_Logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON System_Logs(created_at DESC);

-- ============================================================================
-- TABELA DE REPOSITORES & CONTROLE DE LOTES FIFO (SQLITE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS Repositores (
    phone TEXT PRIMARY KEY,
    pin TEXT NOT NULL,
    name TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    store_name TEXT,
    status TEXT DEFAULT 'ativo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
CREATE INDEX IF NOT EXISTS idx_lotes_fifo ON Produtos_Lotes(tenant_id, codigo_barras, data_validade ASC);
