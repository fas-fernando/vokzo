/**
 * setup_support_impersonation_architecture.js
 *
 * Implementa a nova arquitetura de suporte (Impersonation em nova aba):
 * 1. server.js:
 *    - Endpoints /api/admin/support-session (POST, GET, DELETE)
 *    - Rota estática amigável para /parceiro e /partner -> parceiro.html
 * 2. Cria parceiro.html (arquivo dedicado com tema escuro e banner de suporte com window.close())
 * 3. index.html e alerta_vencimento_app.html:
 *    - Remove completamente a div #partner-wrapper e modais do parceiro
 *    - Atualiza a função impersonatePartner() para abrir parceiro.html em nova aba via fetch
 */

const fs = require('fs');
const path = require('path');

const SERVER_PATH = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/server.js';
const INDEX_PATH = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html';
const APP_MIRROR_PATH = 'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html';
const PARTNER_HTML_PATH = 'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/parceiro.html';

// =============================================================================
// PARTE 1: ATUALIZAR SERVER.JS
// =============================================================================
console.log('=== ETAPA 1: ATUALIZANDO SERVER.JS ===');
let serverContent = fs.readFileSync(SERVER_PATH, 'utf8');

// Adiciona supportSessions se não existir
if (!serverContent.includes('const supportSessions = {};')) {
  serverContent = serverContent.replace(
    "const DB_FILE = path.join(PUBLIC_DIR, 'database.json');",
    "const DB_FILE = path.join(PUBLIC_DIR, 'database.json');\n\n// Sessões ativas de suporte (Impersonation em nova aba)\nconst supportSessions = {};"
  );
  console.log('  [OK] supportSessions declarado no topo do server.js');
}

// Adiciona endpoints de sessão de suporte
const supportApiEndpoints = `
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

        console.log(\`🛡️ [SESSÃO DE SUPORTE CRIADA]: Parceiro \${partner.name} (\${partner.id}) -> Token: \${supportToken}\`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          token: supportToken,
          partnerId: partner.id,
          partnerName: partner.name,
          url: \`/parceiro.html?support_token=\${supportToken}&partner_id=\${partner.id}\`
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
          console.log(\`🔒 [SESSÃO DE SUPORTE ENCERRADA]: Token \${targetToken}\`);
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
`;

if (!serverContent.includes('/api/admin/support-session')) {
  serverContent = serverContent.replace(
    "  // POST /api/admin/token-price - Atualiza o valor base do token nas configurações globais",
    supportApiEndpoints + "\n  // POST /api/admin/token-price - Atualiza o valor base do token nas configurações globais"
  );
  console.log('  [OK] Endpoints /api/admin/support-session adicionados ao server.js');
}

// Rota estática amigável /parceiro e /partner
const staticRouteOld = `  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }`;

const staticRouteNew = `  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  } else if (reqPath === '/parceiro' || reqPath === '/partner') {
    reqPath = '/parceiro.html';
  }`;

if (serverContent.includes(staticRouteOld)) {
  serverContent = serverContent.replace(staticRouteOld, staticRouteNew);
  console.log('  [OK] Rota /parceiro -> parceiro.html configurada');
}

fs.writeFileSync(SERVER_PATH, serverContent, 'utf8');
console.log('  [OK] server.js salvo com sucesso.');

// =============================================================================
// PARTE 2: CRIAR PARCEIRO.HTML DEDICADO
// =============================================================================
console.log('\n=== ETAPA 2: CRIANDO PARCEIRO.HTML ===');

const parceiroHtmlContent = `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Portal do Parceiro B2B - Alerta Vencimento</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🤝</text></svg>">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .touch-scroll { -webkit-overflow-scrolling: touch; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased select-none">

  <!-- ==================================================================== -->
  <!-- BARRA DE SUPORTE AO VIVO (EXIBIDA QUANDO ACESSADO PELO SUPER ADMIN)   -->
  <!-- ==================================================================== -->
  <div id="partner-impersonation-bar" class="hidden bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 text-slate-950 font-bold text-xs p-3.5 shadow-xl border-b border-amber-300 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
      <div class="flex items-center gap-2.5">
        <span class="text-xl">🛡️</span>
        <div>
          <div class="flex items-center gap-2">
            <span class="bg-slate-950 text-amber-300 font-mono text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">Modo Suporte ao Vivo</span>
            <span class="text-[11px] font-mono text-slate-900 font-extrabold" id="impersonation-tenant-id">Tenant: PARC-001</span>
          </div>
          <p class="text-xs text-slate-950 mt-0.5">
            Você está operando como <strong id="impersonation-partner-name" class="underline">Parceiro PDV</strong>. Todas as ações refletem na conta real.
          </p>
        </div>
      </div>
      <button 
        type="button" 
        id="btn-close-support"
        onclick="closeSupportSession()" 
        class="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-900 text-amber-300 hover:text-white font-black text-xs transition cursor-pointer shadow-md active:scale-95 flex items-center justify-center gap-1.5 shrink-0"
        title="Encerrar sessão de suporte e fechar esta aba"
      >
        <span>✕</span>
        <span>Sair do Suporte & Voltar ao Admin</span>
      </button>
    </div>
  </div>

  <!-- ==================================================================== -->
  <!-- HEADER DO PORTAL DO PARCEIRO B2B                                     -->
  <!-- ==================================================================== -->
  <header class="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40 px-4 py-3">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black shadow-md text-base">
          🤝
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-sm sm:text-base font-black text-white tracking-tight">Alerta Vencimento B2B</h1>
            <span class="text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">Portal do Parceiro</span>
          </div>
          <p class="text-[11px] text-slate-400">Gestão e sincronização de farmácias via API de PDV</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div class="text-right hidden sm:block">
          <div class="text-xs font-bold text-white" id="header-partner-name">Carregando parceiro...</div>
          <div class="text-[10px] text-slate-400 font-mono" id="header-partner-cnpj">CNPJ: ...</div>
        </div>
        <button onclick="renderPartnerDashboard()" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs font-bold" title="Recarregar Dados">
          🔄
        </button>
      </div>
    </div>
  </header>

  <!-- ==================================================================== -->
  <!-- CONTEÚDO PRINCIPAL DO PARCEIRO                                       -->
  <!-- ==================================================================== -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 space-y-5">
    
    <!-- Topo Executivo do Parceiro B2B -->
    <div class="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 rounded-2xl p-4 sm:p-5 text-white shadow-lg border border-indigo-700/50 relative overflow-hidden">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
        <div class="space-y-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-sm font-bold shrink-0">🤝</span>
            <h2 id="partner-company-name" class="text-base sm:text-lg font-black tracking-tight text-white">Carregando Parceiro...</h2>
            <span class="text-[10px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 px-2 py-0.5 rounded-full uppercase tracking-wider">Integrador Homologado</span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed" id="partner-company-subtitle">
            Gerencie as farmácias vinculadas à sua licença, monitore chamadas de API em tempo real e consulte faturas mensais.
          </p>
        </div>
        <div class="flex items-center gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-indigo-500/30 text-xs shrink-0">
          <div class="space-y-0.5">
            <span class="text-[10px] text-slate-400 font-medium block">Contrato Franquia Fixa B2B:</span>
            <span id="partner-plan-usage" class="font-bold text-amber-300 font-mono">0 / 50 lojas</span>
          </div>
        </div>
      </div>
    </div>

    <!-- CARDS DE MÉTRICAS (KPIS) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      <!-- Card 1: Lojas / Farmácias Ativas -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Farmácias Integradas</span>
          <span class="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-xs">🏪</span>
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span id="partner-kpi-stores" class="text-2xl font-black text-white tracking-tight">0</span>
          <span class="text-xs text-slate-400">farmácias ativas</span>
        </div>
      </div>

      <!-- Card 2: Requisições de API no Mês -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sincronizações no Mês</span>
          <span class="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-xs">⚡</span>
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span id="partner-kpi-requests" class="text-2xl font-black text-white tracking-tight">0</span>
          <span class="text-xs text-slate-400">chamadas API</span>
        </div>
      </div>

      <!-- Card 3: Plano Atual & Upgrade -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Franquia B2B Contratada</span>
          <button onclick="openPartnerUpgradeModal()" class="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold hover:bg-amber-500/30 transition">
            Upgrade ↗
          </button>
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span id="partner-kpi-plan-name" class="text-lg font-black text-amber-300">Starter</span>
          <span id="partner-kpi-plan-price" class="text-xs text-slate-400">R$ 390,00/mês</span>
        </div>
        <div class="mt-2.5 space-y-1">
          <div class="flex justify-between text-[10px] text-slate-400">
            <span id="partner-kpi-contract-usage">0 / 50 lojas</span>
            <span id="partner-kpi-contract-pct" class="font-bold text-amber-400">0%</span>
          </div>
          <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div id="partner-kpi-progress-bar" class="bg-amber-400 h-full rounded-full transition-all duration-300" style="width: 0%;"></div>
          </div>
        </div>
      </div>

      <!-- Card 4: Fatura Mensal Estimada -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Fatura Mensal B2B</span>
          <span class="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-xs">💳</span>
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span id="partner-kpi-invoice" class="text-2xl font-black text-emerald-400 tracking-tight">R$ 0,00</span>
          <span class="text-xs text-slate-400">/mês fixo</span>
        </div>
      </div>
    </div>

    <!-- NAVEGAÇÃO DE ABAS DO PARCEIRO -->
    <div class="border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
      <button 
        type="button" 
        id="btn-partner-tab-lojas" 
        onclick="setPartnerTab('lojas')" 
        class="px-4 py-2.5 font-bold text-xs rounded-t-xl transition border-b-2 border-indigo-500 text-indigo-400 bg-slate-900 flex items-center gap-2"
      >
        <span>🏪</span>
        <span>Farmácias Conectadas & Tokens</span>
      </button>
      <button 
        type="button" 
        id="btn-partner-tab-api" 
        onclick="setPartnerTab('api')" 
        class="px-4 py-2.5 font-bold text-xs rounded-t-xl transition border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-2"
      >
        <span>⚡</span>
        <span>Integração de API & Simulador</span>
      </button>
      <button 
        type="button" 
        id="btn-partner-tab-fin" 
        onclick="setPartnerTab('fin')" 
        class="px-4 py-2.5 font-bold text-xs rounded-t-xl transition border-b-2 border-transparent text-slate-400 hover:text-white flex items-center gap-2"
      >
        <span>📄</span>
        <span>Financeiro & Faturas B2B</span>
      </button>
    </div>

    <!-- ABA 1: LOJAS / FARMÁCIAS -->
    <div id="partner-panel-lojas" class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <h3 class="font-extrabold text-sm text-white">Farmácias Vinculadas ao seu Plano</h3>
          <p class="text-xs text-slate-400">Cada loja possui uma Chave de API única para sincronizar automaticamente os lotes do PDV.</p>
        </div>
        <button 
          type="button" 
          onclick="openAddPartnerStoreModal()" 
          class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
        >
          <span>+</span>
          <span>Nova Farmácia</span>
        </button>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-950/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th class="p-3.5">Farmácia / Tenant</th>
                <th class="p-3.5">Chave API (Token)</th>
                <th class="p-3.5">Requisições (Mês)</th>
                <th class="p-3.5">Status</th>
                <th class="p-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody id="partner-stores-list" class="divide-y divide-slate-800 text-slate-200">
              <tr>
                <td colspan="5" class="p-6 text-center text-slate-500">Carregando farmácias...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ABA 2: INTEGRAÇÃO API & SIMULADOR -->
    <div id="partner-panel-api" class="hidden space-y-4">
      <div class="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-3">
        <h3 class="font-extrabold text-sm text-white">Documentação da API de Validade para PDV</h3>
        <p class="text-xs text-slate-400">Endpoint para sincronizar produtos com lote e validade a partir do seu sistema de automação comercial:</p>
        <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 flex items-center justify-between">
          <span>POST /api/partner/lojas/sync</span>
          <span class="text-[10px] text-slate-500">Header: x-api-key: SEU_TOKEN_DA_LOJA</span>
        </div>
      </div>
    </div>

    <!-- ABA 3: FINANCEIRO & FATURAS -->
    <div id="partner-panel-fin" class="hidden space-y-4">
      <div class="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-3">
        <h3 class="font-extrabold text-sm text-white">Histórico de Faturas B2B</h3>
        <p class="text-xs text-slate-400">Consulte os demonstrativos mensais contratados e realize o download das faturas em PDF oficial.</p>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-slate-800 bg-slate-950/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th class="p-3.5">Mês Referência</th>
                <th class="p-3.5">Plano Contratado</th>
                <th class="p-3.5">Valor Total</th>
                <th class="p-3.5">Status</th>
                <th class="p-3.5 text-right">PDF Oficial</th>
              </tr>
            </thead>
            <tbody id="partner-invoices-list" class="divide-y divide-slate-800 text-slate-200">
              <tr>
                <td colspan="5" class="p-6 text-center text-slate-500">Carregando faturas...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </main>

  <!-- ==================================================================== -->
  <!-- MODAL: CADASTRAR NOVA FARMÁCIA VINCULADA AO PARCEIRO                 -->
  <!-- ==================================================================== -->
  <div id="modal-add-partner-store" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto hidden">
    <div class="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-md w-full shadow-2xl p-5 sm:p-6 space-y-4 text-xs animate-in fade-in zoom-in-95 my-auto">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2.5">
          <span class="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-base">🏪</span>
          <div>
            <h3 class="font-extrabold text-sm text-white">Cadastrar Nova Farmácia</h3>
            <p class="text-[11px] text-slate-400">Gera um token de sincronização vinculado ao seu plano</p>
          </div>
        </div>
        <button type="button" onclick="closeAddPartnerStoreModal()" class="text-slate-400 hover:text-white font-black text-lg p-1">✕</button>
      </div>

      <form onsubmit="handleCreatePartnerStore(event); return false;" class="space-y-3.5">
        <div>
          <label class="block font-bold text-slate-300 mb-1">Nome Fantasia da Farmácia *</label>
          <input id="partner-new-store-name" required type="text" placeholder="Ex: Farmácia Central Matriz" class="w-full border border-slate-700 bg-slate-950 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block font-bold text-slate-300 mb-1">CNPJ da Farmácia *</label>
          <input id="partner-new-store-cnpj" required type="text" placeholder="00.000.000/0000-00" class="w-full border border-slate-700 bg-slate-950 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500">
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
          <button type="button" onclick="closeAddPartnerStoreModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold">Cancelar</button>
          <button type="submit" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold shadow-md">Cadastrar Farmácia</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ==================================================================== -->
  <!-- MODAL: UPGRADE DE PLANO B2B                                          -->
  <!-- ==================================================================== -->
  <div id="modal-partner-upgrade" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto hidden">
    <div class="bg-slate-900 border border-slate-700 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 text-white my-auto">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-3">
          <span class="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-xl font-bold">🚀</span>
          <div>
            <h3 class="text-base font-black text-white">Upgrade de Plano & Franquia B2B</h3>
            <p class="text-xs text-slate-400">Amplie a quantidade de lojas simultâneas do seu PDV</p>
          </div>
        </div>
        <button type="button" onclick="closePartnerUpgradeModal()" class="text-slate-400 hover:text-white font-black text-lg p-1">✕</button>
      </div>

      <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
        <div class="text-xs text-slate-400">Entre em contato com o suporte ou selecione o plano para upgrade imediato:</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
          <div class="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center">
            <div class="font-bold text-white text-xs">Starter</div>
            <div class="text-amber-400 font-black text-sm">50 Lojas</div>
            <div class="text-[10px] text-slate-400">R$ 390/mês</div>
          </div>
          <div class="p-3 bg-slate-900 border border-indigo-500/40 rounded-xl text-center">
            <div class="font-bold text-white text-xs">Pro</div>
            <div class="text-indigo-400 font-black text-sm">150 Lojas</div>
            <div class="text-[10px] text-slate-400">R$ 890/mês</div>
          </div>
          <div class="p-3 bg-slate-900 border border-emerald-500/40 rounded-xl text-center">
            <div class="font-bold text-white text-xs">Enterprise</div>
            <div class="text-emerald-400 font-black text-sm">500 Lojas</div>
            <div class="text-[10px] text-slate-400">R$ 1.990/mês</div>
          </div>
        </div>
      </div>

      <div class="flex justify-end pt-2 border-t border-slate-800">
        <button type="button" onclick="closePartnerUpgradeModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs">Fechar</button>
      </div>
    </div>
  </div>

  <!-- SCRIPT DEDICADO DO PARCEIRO -->
  <script>
    // Recupera parâmetros da URL
    const urlParams = new URLSearchParams(window.location.search);
    const supportToken = urlParams.get('support_token');
    const partnerIdParam = urlParams.get('partner_id') || 'PARC-001';

    let currentPartner = null;
    let partnerStores = [];
    let partnerInvoices = [];

    // =========================================================================
    // 3. AÇÃO SAIR DO SUPORTE (Painel do Parceiro):
    // Encerra a sessão de suporte no backend e fecha a aba atual (window.close())
    // =========================================================================
    async function closeSupportSession() {
      const btn = document.getElementById('btn-close-support');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span><span>Encerrando sessão...</span>';
      }

      try {
        if (supportToken) {
          await fetch('/api/admin/support-session', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
            body: JSON.stringify({ token: supportToken })
          });
        }
      } catch (err) {
        console.error('Erro ao registrar encerramento da sessão:', err);
      } finally {
        // Fecha esta aba e retorna o usuário à aba original do Super Admin
        window.close();
        // Fallback caso o navegador bloqueie window.close()
        setTimeout(() => {
          document.body.innerHTML = '<div class="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center space-y-3"><div class="text-4xl">🔒</div><h2 class="text-lg font-bold">Sessão de Suporte Encerrada</h2><p class="text-xs text-slate-400">Você já pode fechar esta aba e retornar ao painel do Super Admin.</p></div>';
        }, 300);
      }
    }
    window.closeSupportSession = closeSupportSession;

    // Inicialização da interface
    async function initPartnerPortal() {
      // 1. Verifica se está operando no Modo Suporte
      if (supportToken) {
        const impBar = document.getElementById('partner-impersonation-bar');
        if (impBar) impBar.classList.remove('hidden');

        try {
          const sRes = await fetch(\`/api/partner/support-session?token=\${encodeURIComponent(supportToken)}\`, {
            headers: { 'bypass-tunnel-reminder': 'true' }
          });
          const sData = await sRes.json();
          if (sData.success && sData.partner) {
            currentPartner = sData.partner;
            const nameEl = document.getElementById('impersonation-partner-name');
            const tenantEl = document.getElementById('impersonation-tenant-id');
            if (nameEl) nameEl.innerText = currentPartner.name || 'Parceiro PDV';
            if (tenantEl) tenantEl.innerText = \`Tenant: \${currentPartner.id || partnerIdParam}\`;
          }
        } catch (e) {
          console.warn('Não foi possível verificar sessão de suporte:', e);
        }
      }

      // 2. Carrega Dashboard do Parceiro
      await renderPartnerDashboard();
    }

    async function renderPartnerDashboard() {
      const pId = (currentPartner && currentPartner.id) || partnerIdParam || 'PARC-001';
      try {
        const res = await fetch(\`/api/partner/dashboard?partnerId=\${encodeURIComponent(pId)}\`, {
          headers: { 'bypass-tunnel-reminder': 'true' }
        });
        const data = await res.json();
        if (data.success) {
          applyPartnerData(data);
        }
      } catch (err) {
        console.error('Erro ao carregar dados do parceiro:', err);
      }
    }
    window.renderPartnerDashboard = renderPartnerDashboard;

    function applyPartnerData(data) {
      const p = data.partner || {};
      const m = data.metrics || {};
      partnerStores = data.stores || data.lojas || [];
      partnerInvoices = data.invoices || data.faturas || [];

      // Dados do Topo
      document.getElementById('partner-company-name').innerText = p.name || 'Parceiro PDV';
      document.getElementById('header-partner-name').innerText = p.name || 'Parceiro PDV';
      document.getElementById('header-partner-cnpj').innerText = \`CNPJ: \${p.cnpj || '12.345.678/0001-90'}\`;

      // KPIs
      const activeStores = partnerStores.filter(s => s.status === 'ativo' || !s.status);
      const totalStores = m.totalStores !== undefined ? m.totalStores : activeStores.length;
      const totalReqs = m.totalRequestsMonth !== undefined ? m.totalRequestsMonth : (data.requisicoesMes || 0);

      const planLimit = parseInt((p.plano && p.plano.limite_lojas) || p.limite_lojas || 50, 10);
      const planName = (p.plano && p.plano.nome_plano) || p.nome_plano || 'Starter';
      const planPrice = parseFloat((p.plano && p.plano.valor_mensal) || p.valor_mensal || 390.00);

      document.getElementById('partner-kpi-stores').innerText = totalStores;
      document.getElementById('partner-kpi-requests').innerText = Number(totalReqs).toLocaleString('pt-BR');
      document.getElementById('partner-kpi-plan-name').innerText = planName;
      document.getElementById('partner-kpi-plan-price').innerText = \`R$ \${planPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês\`;
      document.getElementById('partner-kpi-invoice').innerText = \`R$ \${planPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\`;

      const usageText = \`\${totalStores} / \${planLimit} lojas\`;
      document.getElementById('partner-plan-usage').innerText = usageText;
      document.getElementById('partner-kpi-contract-usage').innerText = usageText;

      const pct = planLimit > 0 ? Math.min(100, Math.round((totalStores / planLimit) * 100)) : 0;
      document.getElementById('partner-kpi-contract-pct').innerText = \`\${pct}%\`;
      document.getElementById('partner-kpi-progress-bar').style.width = \`\${pct}%\`;

      // Renderiza Lojas e Faturas
      renderStoresList();
      renderInvoicesList();
    }

    function renderStoresList() {
      const tbody = document.getElementById('partner-stores-list');
      if (!tbody) return;

      if (partnerStores.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">Nenhuma farmácia cadastrada ainda. Clique em "+ Nova Farmácia" para integrar o primeiro PDV.</td></tr>';
        return;
      }

      tbody.innerHTML = partnerStores.map(s => {
        const maskedKey = (s.apiKey || '').substring(0, 14) + '••••••••';
        return \`
          <tr class="hover:bg-slate-800/50 transition">
            <td class="p-3.5">
              <div class="font-bold text-white">\${s.nome || s.name || 'Farmácia Integrada'}</div>
              <div class="text-[10px] text-slate-400 font-mono">\${s.cnpj || s.tenant_id || s.id || ''}</div>
            </td>
            <td class="p-3.5 font-mono text-[11px] text-indigo-300">
              <div class="flex items-center gap-2">
                <span>\${maskedKey}</span>
                <button type="button" onclick="navigator.clipboard.writeText('\${s.apiKey || ''}'); alert('Chave API copiada!')" class="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded text-slate-300" title="Copiar Chave">Copiar</button>
              </div>
            </td>
            <td class="p-3.5 font-mono">\${Number(s.requisicoesMes || 0).toLocaleString('pt-BR')} reqs</td>
            <td class="p-3.5">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">ATIVO</span>
            </td>
            <td class="p-3.5 text-right font-mono text-[10px] text-slate-400">
              OK
            </td>
          </tr>
        \`;
      }).join('');
    }

    function renderInvoicesList() {
      const tbody = document.getElementById('partner-invoices-list');
      if (!tbody) return;

      if (partnerInvoices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">Nenhuma fatura emitida ainda. As faturas são geradas no fechamento do ciclo mensal.</td></tr>';
        return;
      }

      tbody.innerHTML = partnerInvoices.map(inv => \`
        <tr class="hover:bg-slate-800/50 transition">
          <td class="p-3.5 font-bold text-white">\${inv.mesReferencia || 'Mês Atual'}</td>
          <td class="p-3.5 text-slate-300">\${inv.planoNome || 'Enterprise B2B'}</td>
          <td class="p-3.5 font-bold text-emerald-400">R$ \${Number(inv.valorTotal || 1990).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td class="p-3.5">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">\${(inv.status || 'PAGO').toUpperCase()}</span>
          </td>
          <td class="p-3.5 text-right">
            <a href="/api/partner/invoices/pdf?invoiceId=\${inv.id || ''}" target="_blank" class="px-2.5 py-1 rounded bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 text-[11px] font-bold">PDF Oficial 📄</a>
          </td>
        </tr>
      \`).join('');
    }

    function setPartnerTab(tab) {
      ['lojas', 'api', 'fin'].forEach(t => {
        const btn = document.getElementById('btn-partner-tab-' + t);
        const panel = document.getElementById('partner-panel-' + t);
        if (t === tab) {
          if (btn) { btn.classList.add('border-indigo-500', 'text-indigo-400', 'bg-slate-900'); btn.classList.remove('border-transparent', 'text-slate-400'); }
          if (panel) panel.classList.remove('hidden');
        } else {
          if (btn) { btn.classList.remove('border-indigo-500', 'text-indigo-400', 'bg-slate-900'); btn.classList.add('border-transparent', 'text-slate-400'); }
          if (panel) panel.classList.add('hidden');
        }
      });
    }
    window.setPartnerTab = setPartnerTab;

    function openAddPartnerStoreModal() {
      document.getElementById('modal-add-partner-store').classList.remove('hidden');
    }
    function closeAddPartnerStoreModal() {
      document.getElementById('modal-add-partner-store').classList.add('hidden');
    }
    window.openAddPartnerStoreModal = openAddPartnerStoreModal;
    window.closeAddPartnerStoreModal = closeAddPartnerStoreModal;

    function openPartnerUpgradeModal() {
      document.getElementById('modal-partner-upgrade').classList.remove('hidden');
    }
    function closePartnerUpgradeModal() {
      document.getElementById('modal-partner-upgrade').classList.add('hidden');
    }
    window.openPartnerUpgradeModal = openPartnerUpgradeModal;
    window.closePartnerUpgradeModal = closePartnerUpgradeModal;

    async function handleCreatePartnerStore(e) {
      if (e) e.preventDefault();
      const inName = document.getElementById('partner-new-store-name');
      const inCnpj = document.getElementById('partner-new-store-cnpj');
      const name = inName ? inName.value.trim() : '';
      const cnpj = inCnpj ? inCnpj.value.trim() : '';

      if (!name) return alert('Por favor, informe o nome da farmácia.');

      const pId = (currentPartner && currentPartner.id) || partnerIdParam || 'PARC-001';

      try {
        const res = await fetch('/api/partner/lojas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
          body: JSON.stringify({ nome: name, cnpj: cnpj, partnerId: pId })
        });
        const data = await res.json();
        if (data.success) {
          alert('Farmácia cadastrada com sucesso! Chave de API gerada.');
          closeAddPartnerStoreModal();
          inName.value = '';
          inCnpj.value = '';
          await renderPartnerDashboard();
        } else {
          alert('Erro ao cadastrar farmácia: ' + (data.error || 'Erro desconhecido.'));
        }
      } catch (err) {
        alert('Erro de comunicação: ' + err.message);
      }
    }
    window.handleCreatePartnerStore = handleCreatePartnerStore;

    // Inicia quando a página carregar
    window.addEventListener('DOMContentLoaded', initPartnerPortal);
  </script>
</body>
</html>
`;

fs.writeFileSync(PARTNER_HTML_PATH, parceiroHtmlContent, 'utf8');
console.log('  [OK] parceiro.html criado com sucesso!');

// =============================================================================
// PARTE 3: LIMPAR INDEX.HTML E ATUALIZAR BOTÃO ACESSAR DO ADMIN
// =============================================================================
console.log('\n=== ETAPA 3: LIMPANDO INDEX.HTML E ATUALIZANDO BOTÃO ACESSAR ===');

const htmlFiles = [INDEX_PATH, APP_MIRROR_PATH];

for (const hFile of htmlFiles) {
  if (!fs.existsSync(hFile)) {
    console.log(`Arquivo ${hFile} não encontrado, pulando.`);
    continue;
  }

  let html = fs.readFileSync(hFile, 'utf8');

  // 1. Remove completamente o bloco <div id="partner-wrapper" ...> ... </div>
  const partnerWrapperStart = '<div id="partner-wrapper"';
  const partnerWrapperEndMarker = '<!-- ======================================================== -->\r\n    <!-- MODAL: CADASTRAR NOVO PARCEIRO / EMPRESA DE PDV B2B     -->';
  const partnerWrapperEndMarkerLF = '<!-- ======================================================== -->\n    <!-- MODAL: CADASTRAR NOVO PARCEIRO / EMPRESA DE PDV B2B     -->';

  if (html.includes(partnerWrapperStart)) {
    const sIdx = html.indexOf(partnerWrapperStart);
    let eIdx = html.indexOf(partnerWrapperEndMarker, sIdx);
    if (eIdx === -1) eIdx = html.indexOf(partnerWrapperEndMarkerLF, sIdx);

    if (sIdx !== -1 && eIdx !== -1) {
      html = html.substring(0, sIdx) + html.substring(eIdx);
      console.log(`  [OK] Bloco #partner-wrapper removido do HTML: ${path.basename(hFile)}`);
    } else {
      console.log(`  [AVISO] Marcadores de fim de #partner-wrapper não encontrados exatamente em ${path.basename(hFile)}`);
    }
  }

  // 2. Remove modal-add-partner-store do index.html (agora está no parceiro.html)
  const modalAddPartnerStoreStr = '<div id="modal-add-partner-store"';
  if (html.includes(modalAddPartnerStoreStr)) {
    const mIdx = html.indexOf(modalAddPartnerStoreStr);
    const endDiv = '</div>\r\n    </div>\r\n\r\n    <!-- ======================================================== -->\r\n    <!-- MODAL: CADASTRAR NOVO LOJISTA / CLIENTE                  -->';
    const endDivLF = '</div>\n    </div>\n\n    <!-- ======================================================== -->\n    <!-- MODAL: CADASTRAR NOVO LOJISTA / CLIENTE                  -->';
    
    let mEnd = html.indexOf(endDiv, mIdx);
    if (mEnd === -1) mEnd = html.indexOf(endDivLF, mIdx);

    if (mIdx !== -1 && mEnd !== -1) {
      html = html.substring(0, mIdx) + html.substring(mEnd + (endDiv.length - 120));
      console.log(`  [OK] modal-add-partner-store removido de ${path.basename(hFile)}`);
    }
  }

  // 3. Atualiza impersonatePartner no JavaScript do Super Admin:
  // Faz requisição fetch para /api/admin/support-session e abre parceiro.html em nova aba
  const oldImpersonatePattern = /\/\/ Acessar como Parceiro \(Impersonation para prestar suporte\)[\s\S]*?window\.impersonatePartner = impersonatePartner;/;

  const newImpersonateAdminCode = `// Acessar como Parceiro (Impersonation em NOVA ABA - Padrão da Indústria)
    async function impersonatePartner(partnerId) {
      try {
        showToast('🛡️ Iniciando sessão de suporte segura...');
        
        // 1. Cria a sessão temporária de suporte no backend
        const response = await fetch('/api/admin/support-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'bypass-tunnel-reminder': 'true'
          },
          body: JSON.stringify({ partnerId })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Falha ao gerar sessão de suporte.');
        }

        showToast(\`🚀 Abrindo painel de \${data.partnerName || 'Parceiro'} em nova aba...\`);

        // 2. Abre o Painel do Parceiro completamente isolado em nova aba
        const partnerUrl = data.url || \`/parceiro.html?support_token=\${data.token}&partner_id=\${partnerId}\`;
        window.open(partnerUrl, '_blank');
      } catch (err) {
        console.error('Erro ao acessar parceiro:', err);
        alert('Erro ao iniciar sessão de suporte: ' + err.message);
      }
    }
    window.impersonatePartner = impersonatePartner;`;

  if (oldImpersonatePattern.test(html)) {
    html = html.replace(oldImpersonatePattern, newImpersonateAdminCode);
    console.log(`  [OK] impersonatePartner atualizado com fetch e window.open em ${path.basename(hFile)}`);
  } else {
    console.log(`  [AVISO] oldImpersonatePattern não bateu em ${path.basename(hFile)}`);
  }

  fs.writeFileSync(hFile, html, 'utf8');
  console.log(`  [OK] ${path.basename(hFile)} salvo.`);
}

console.log('\n=== ARQUITETURA DE IMPERSONATION EM NOVA ABA CONCLUÍDA COM SUCESSO! ===');
