const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // 1. Declarar variáveis de paginação no topo para evitar qualquer TDZ
  if (!c.includes('var adminStoresPage = 1;')) {
    const targetState = 'let activeFilter = \'all\';';
    c = c.replace(targetState, `let activeFilter = 'all';
    var merchantProductsPage = 1;
    var merchantProductsPageSize = 10;
    var adminStoresPage = 1;
    var adminStoresPageSize = 10;
    var adminPartnersPage = 1;
    var adminPartnersPageSize = 10;
    var partnerStoresPage = 1;
    var partnerStoresPageSize = 10;`);
  }

  // 2. Inserir funções do Kebab Menu se ainda não existirem
  if (!c.includes('function toggleMerchantKebabMenu')) {
    const kebabJs = `
    // Controle do Kebab Menu (Dropdown dos Lojistas)
    function toggleMerchantKebabMenu(event, phone) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      const targetId = 'kebab-menu-' + phone;
      const currentMenu = document.getElementById(targetId);
      const isOpen = currentMenu && !currentMenu.classList.contains('hidden');

      closeAllMerchantKebabMenus();

      if (!isOpen && currentMenu) {
        currentMenu.classList.remove('hidden');
        const parentCard = currentMenu.closest('.merchant-store-card');
        if (parentCard) parentCard.style.zIndex = '40';
      }
    }
    window.toggleMerchantKebabMenu = toggleMerchantKebabMenu;

    function closeAllMerchantKebabMenus() {
      document.querySelectorAll('.merchant-kebab-dropdown').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.merchant-store-card').forEach(c => c.style.zIndex = '');
    }
    window.closeAllMerchantKebabMenus = closeAllMerchantKebabMenus;

    document.addEventListener('click', () => {
      closeAllMerchantKebabMenus();
    });
`;
    // Inserir antes de renderAdminStoresList
    const renderAdminIdx = c.indexOf('function renderAdminStoresList()');
    if (renderAdminIdx !== -1) {
      c = c.substring(0, renderAdminIdx) + kebabJs + '\n    ' + c.substring(renderAdminIdx);
    }
  }

  // 3. Substituir o corpo da renderAdminStoresList com os cards do padrão enterprise
  const startMarker = 'container.innerHTML = paginatedList.map(m => {';
  const endMarker = "// --- 11. RENDERIZAÇÃO DOS PRODUTOS DO LOJISTA ---";

  const idxStart = c.indexOf(startMarker);
  const idxEnd = c.indexOf(endMarker);

  if (idxStart !== -1 && idxEnd !== -1) {
    const newRenderBody = `container.innerHTML = paginatedList.map(m => {
        const storeProducts = (appState.products || []).filter(p => cleanDigits(p.ownerPhone) === cleanDigits(m.phone) && p.status === 'ativo');
        const trialInfo = getMerchantTrialInfo(m);
        const isPro = (m.plano === 'premium');
        const isBlocked = (m.status === 'bloqueado');
        const hasXml = (m.hasXmlImport || m.plano === 'automacao');

        return \`
          <div class="merchant-store-card relative bg-white hover:bg-slate-50/70 border \${isBlocked ? 'border-rose-300 bg-rose-50/20' : 'border-slate-200'} rounded-2xl p-4 shadow-xs transition space-y-3">
            <!-- Linha Superior: Info do Lojista + Kebab Menu no Canto Superior Direito -->
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span class="text-sm font-black text-slate-900 truncate">\${m.name || 'Loja sem nome'}</span>
                  <span class="text-[10px] font-bold border px-2 py-0.5 rounded-full \${trialInfo.badgeClass}">
                    \${trialInfo.label}
                  </span>
                  \${isBlocked 
                    ? '<span class="text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">🔒 Bloqueado</span>' 
                    : '<span class="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">Ativo</span>'}
                  \${hasXml 
                    ? '<span class="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full flex items-center gap-1">📄 XML Ativo</span>' 
                    : ''}
                </div>

                <div class="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-slate-500 font-mono">
                  <span>📱 WhatsApp: <strong class="text-slate-800 font-bold">\${formatPhone(m.phone)}</strong></span>
                  <span>🔑 PIN: <strong class="text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded font-black">\${m.pin || '1234'}</strong></span>
                  <span>📦 <strong class="text-slate-800 font-bold">\${storeProducts.length}</strong> \${storeProducts.length === 1 ? 'item monitorado' : 'itens monitorados'}</span>
                  <span>📅 Cadastro: <span class="text-slate-700 font-semibold">\${formatDateTimeFriendly(m.createdAt || m.data_cadastro || '2026-11-05T00:00:00')}</span></span>
                </div>
              </div>

              <!-- Menu Kebab (Três Pontinhos) -->
              <div class="relative shrink-0">
                <button 
                  type="button" 
                  id="kebab-btn-\${m.phone}"
                  onclick="toggleMerchantKebabMenu(event, '\${m.phone}')" 
                  class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200/80 flex items-center justify-center transition cursor-pointer active:scale-95 shadow-2xs"
                  title="Mais ações do lojista"
                  aria-label="Mais ações"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
                  </svg>
                </button>

                <!-- Dropdown Flutuante com z-index alto -->
                <div 
                  id="kebab-menu-\${m.phone}" 
                  class="merchant-kebab-dropdown hidden absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95"
                  onclick="event.stopPropagation()"
                >
                  <div class="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
                    Ações Administrativas
                  </div>

                  <!-- 1. Liberar / Bloquear XML -->
                  <button 
                    type="button" 
                    onclick="toggleMerchantXmlPermission('\${m.phone}'); closeAllMerchantKebabMenus();" 
                    class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-between transition cursor-pointer"
                  >
                    <span class="flex items-center gap-2">
                      <span>📄</span>
                      <span>\${hasXml ? 'Bloquear XML' : 'Liberar XML'}</span>
                    </span>
                    <span class="text-[10px] font-bold \${hasXml ? 'text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded' : 'text-slate-400'}">
                      \${hasXml ? 'Ativo ✓' : '🔒 Inativo'}
                    </span>
                  </button>

                  <!-- 2. Enviar Acesso via WhatsApp -->
                  <button 
                    type="button" 
                    onclick="shareMerchantAccessFromList('\${m.phone}'); closeAllMerchantKebabMenus();" 
                    class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2 transition cursor-pointer"
                  >
                    <span>📲</span>
                    <span>Enviar Acesso (WhatsApp)</span>
                  </button>

                  <!-- 3. Liberar PRO / Mudar p/ Trial -->
                  <button 
                    type="button" 
                    onclick="toggleMerchantPlan('\${m.phone}'); closeAllMerchantKebabMenus();" 
                    class="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-800 flex items-center justify-between transition cursor-pointer"
                  >
                    <span class="flex items-center gap-2">
                      <span>⭐</span>
                      <span>\${isPro ? 'Mudar p/ Trial' : 'Liberar PRO'}</span>
                    </span>
                    <span class="text-[10px] font-bold \${isPro ? 'text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded' : 'text-slate-400'}">
                      \${isPro ? 'Plano PRO' : 'Trial'}
                    </span>
                  </button>

                  <div class="my-1 border-t border-slate-100"></div>

                  <!-- 4. Bloquear / Desbloquear (Soft Lock) com ícone de cadeado -->
                  <button 
                    type="button" 
                    onclick="toggleMerchantStatus('\${m.phone}'); closeAllMerchantKebabMenus();" 
                    class="w-full text-left px-3 py-2 text-xs font-bold \${isBlocked ? 'text-emerald-700 hover:bg-emerald-50' : 'text-rose-600 hover:bg-rose-50'} flex items-center justify-between transition cursor-pointer"
                  >
                    <span class="flex items-center gap-2">
                      <span>\${isBlocked ? '🔓' : '🔒'}</span>
                      <span>\${isBlocked ? 'Desbloquear Acesso' : 'Bloquear Acesso'}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Linha Inferior: APENAS OS 2 BOTÕES PRINCIPAIS ("Cobrar" e "Acessar como Cliente") -->
            <div class="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full \${isBlocked ? 'bg-rose-500' : 'bg-emerald-500'}"></span>
                <span>\${isBlocked ? 'Acesso bloqueado pelo Super Admin' : 'Operação em tempo real'}</span>
              </div>

              <div class="flex items-center gap-2 self-end sm:self-auto w-full sm:w-auto">
                <!-- Botão 1: Cobrar via WhatsApp -->
                <button 
                  type="button" 
                  onclick="sendBillingWhatsApp('\${m.phone}')" 
                  class="flex-1 sm:flex-none px-3.5 py-1.5 bg-amber-50 hover:bg-amber-100 active:scale-95 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-2xs"
                  title="Enviar mensagem de cobrança personalizada via WhatsApp"
                >
                  <span>💬</span>
                  <span>Cobrar</span>
                </button>

                <!-- Botão 2: Acessar como Cliente (Login Mágico) -->
                <button 
                  type="button" 
                  onclick="magicLoginAsMerchant('\${m.phone}')" 
                  class="flex-1 sm:flex-none px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-2xs"
                  title="Acessar painel da loja diretamente como cliente"
                >
                  <span>🔑</span>
                  <span>Acessar como Cliente</span>
                </button>
              </div>
            </div>
          </div>
        \`;
      }).join('') + buildPaginationControlsHtml('adminStores', adminStoresPage, adminStoresPageSize, totalItems);
    }

    `;

    c = c.substring(0, idxStart) + newRenderBody + c.substring(idxEnd);
    console.log('[OK] renderAdminStoresList refatorada com Kebab Menu e Paginação em:', p);
  }

  fs.writeFileSync(p, c, 'utf8');
}
