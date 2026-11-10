const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // =========================================================================
  // ITEM 1: ABAS DE NAVEGAÇÃO COM TEXTO COMPLETO E SCROLL HORIZONTAL
  // =========================================================================
  const oldTabsContainer = `<div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
          <button 
            type="button" 
            id="admin-tab-btn-dashboard" 
            onclick="switchAdminTab('dashboard')" 
            class="px-4 py-2 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 bg-indigo-600 text-white shadow-xs cursor-pointer flex-1 sm:flex-none justify-center"
            title="Lojistas, mercados e farmácias clientes finais"
          >
            <span>🏪</span>
            <span>Lojistas</span>
          </button>
          <button 
            type="button" 
            id="admin-tab-btn-partners" 
            onclick="switchAdminTab('partners')" 
            class="px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer flex-1 sm:flex-none justify-center"
            title="Revendedores B2B e empresas de sistemas PDV"
          >
            <span>🤝</span>
            <span class="hidden sm:inline">Parceiros (Revendedores B2B)</span><span class="sm:hidden">Parceiros</span>
          </button>
          <button 
            type="button" 
            id="admin-tab-btn-settings" 
            onclick="switchAdminTab('settings')" 
            class="px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer flex-1 sm:flex-none justify-center"
          >
            <span>⚙️</span>
            <span class="hidden sm:inline">Configurações</span>
            <span class="sm:hidden">Ajustes</span>
          </button>
        </div>`;

  const newTabsContainer = `<div class="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl w-full sm:w-auto overflow-x-auto whitespace-nowrap scrollbar-none snap-x" style="-webkit-overflow-scrolling: touch;">
          <button 
            type="button" 
            id="admin-tab-btn-dashboard" 
            onclick="switchAdminTab('dashboard')" 
            class="px-4 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 bg-indigo-600 text-white shadow-xs cursor-pointer shrink-0"
            title="Lojistas, mercados e farmácias clientes finais"
          >
            <span>🏪</span>
            <span>Lojistas</span>
          </button>
          <button 
            type="button" 
            id="admin-tab-btn-partners" 
            onclick="switchAdminTab('partners')" 
            class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer shrink-0"
            title="Revendedores B2B e empresas de sistemas PDV"
          >
            <span>🤝</span>
            <span>Parceiros (Revendedores B2B)</span>
          </button>
          <button 
            type="button" 
            id="admin-tab-btn-settings" 
            onclick="switchAdminTab('settings')" 
            class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer shrink-0"
            title="Configurações gerais do sistema"
          >
            <span>⚙️</span>
            <span>Configurações</span>
          </button>
        </div>`;

  if (c.includes(oldTabsContainer.replace(/\n/g, '\r\n'))) {
    c = c.replace(oldTabsContainer.replace(/\n/g, '\r\n'), newTabsContainer.replace(/\n/g, '\r\n'));
    console.log('[OK] Abas de navegação atualizadas (CRLF) em:', p);
  } else if (c.includes(oldTabsContainer)) {
    c = c.replace(oldTabsContainer, newTabsContainer);
    console.log('[OK] Abas de navegação atualizadas (LF) em:', p);
  }

  // Atualiza classes do switchAdminTab
  const oldSwitchReset = "[dashBtn, settBtn, partBtn].forEach(b => {\r\n        if (b) b.className = 'px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer flex-1 sm:flex-none justify-center';\r\n      });";
  const oldSwitchResetLF = "[dashBtn, settBtn, partBtn].forEach(b => {\n        if (b) b.className = 'px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer flex-1 sm:flex-none justify-center';\n      });";
  const newSwitchReset = `[dashBtn, settBtn, partBtn].forEach(b => {
        if (b) b.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer shrink-0';
      });`;

  if (c.includes(oldSwitchReset)) {
    c = c.replace(oldSwitchReset, newSwitchReset.replace(/\n/g, '\r\n'));
  } else if (c.includes(oldSwitchResetLF)) {
    c = c.replace(oldSwitchResetLF, newSwitchReset);
  }

  // Atualiza botões ativos no switchAdminTab
  c = c.replace(
    "if (dashBtn) dashBtn.className = 'px-3.5 py-2 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 bg-indigo-600 text-white shadow-xs cursor-pointer flex-1 sm:flex-none justify-center';",
    "if (dashBtn) dashBtn.className = 'px-4 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 bg-indigo-600 text-white shadow-xs cursor-pointer shrink-0';"
  );
  c = c.replace(
    "if (settBtn) settBtn.className = 'px-3.5 py-2 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 bg-indigo-600 text-white shadow-xs cursor-pointer flex-1 sm:flex-none justify-center';",
    "if (settBtn) settBtn.className = 'px-4 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 bg-indigo-600 text-white shadow-xs cursor-pointer shrink-0';"
  );
  c = c.replace(
    "if (partBtn) partBtn.className = 'px-3.5 py-2 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 bg-emerald-600 text-white shadow-xs cursor-pointer flex-1 sm:flex-none justify-center';",
    "if (partBtn) partBtn.className = 'px-4 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 bg-emerald-600 text-white shadow-xs cursor-pointer shrink-0';"
  );

  // =========================================================================
  // ITEM 2: MODAL NOVO PARCEIRO COM SCROLL INTERNO E FOOTER FIXO
  // =========================================================================
  const modalStartTag = '<div id="modal-create-partner" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto hidden">';
  const modalEndMarker = '<!-- MODAL: GERENCIAMENTO E CADASTRO DE PLANOS B2B -->';

  const mIdxStart = c.indexOf(modalStartTag);
  const mIdxEnd = c.indexOf(modalEndMarker);

  if (mIdxStart !== -1 && mIdxEnd !== -1) {
    const newModalHtml = `<div id="modal-create-partner" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto hidden">
      <div class="bg-white rounded-3xl max-w-md w-full shadow-2xl p-5 sm:p-6 space-y-4 text-xs text-slate-700 animate-in fade-in zoom-in-95 border border-slate-100 my-auto max-h-[92vh] flex flex-col overflow-hidden">
        <!-- Topo Fixo do Modal -->
        <div class="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div class="flex items-center gap-2.5">
            <span class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center font-bold text-base">🤝</span>
            <div>
              <h3 class="font-extrabold text-sm text-slate-900">Novo Parceiro (Revendedor B2B)</h3>
              <p class="text-[11px] text-slate-500">Cadastro direto de empresa desenvolvedora de PDV</p>
            </div>
          </div>
          <button type="button" onclick="closeCreatePartnerModal()" class="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 text-base font-bold cursor-pointer transition">
            ✕
          </button>
        </div>

        <!-- Formulário Estruturado: Corpo Rolável + Rodapé Fixo -->
        <form id="form-create-partner" onsubmit="handleCreatePartnerSubmit(event)" class="flex flex-col flex-1 min-h-0 overflow-hidden">
          <!-- Corpo com Scroll Interno (overflow-y-auto) -->
          <div class="flex-1 overflow-y-auto pr-1 sm:pr-2 space-y-3.5 overscroll-contain">
            <!-- 1. Nome do Parceiro -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                Nome do Parceiro (Empresa PDV) <span class="text-rose-500">*</span>
              </label>
              <input 
                type="text" 
                id="partner-create-name" 
                required 
                placeholder="Ex: Softpharma Sistemas / Linx PDV" 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-bold text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition"
              />
            </div>

            <!-- 2. CNPJ com Máscara Automática -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                CNPJ da Empresa <span class="text-slate-400 font-normal">(Opcional)</span>
              </label>
              <input 
                type="text" 
                id="partner-create-cnpj" 
                maxlength="18"
                oninput="applyCnpjMask(this)"
                placeholder="00.000.000/0000-00" 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-mono text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition"
              >
            </div>

            <!-- 3. Telefone / WhatsApp com Máscara Automática -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                Telefone / WhatsApp (com DDD) <span class="text-rose-500">*</span>
              </label>
              <input 
                type="tel" 
                id="partner-create-phone" 
                required 
                maxlength="15"
                oninput="applyPhoneMask(this)"
                placeholder="(00) 00000-0000" 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-mono font-bold text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition"
              >
              <p class="text-[10px] text-slate-400 mt-1">Utilizado pelo parceiro para login e comunicações.</p>
            </div>

            <!-- 4. PIN de Acesso (4 dígitos) -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                PIN de Acesso (4 dígitos) <span class="text-rose-500">*</span>
              </label>
              <input 
                type="password" 
                inputmode="numeric"
                maxlength="4"
                pattern="\\d{4}"
                id="partner-create-pin" 
                required 
                placeholder="Ex: 1234" 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-mono text-center tracking-widest text-base font-bold text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition"
                oninput="this.value = this.value.replace(/\\D/g, '').slice(0, 4)"
              />
              <p class="text-[10px] text-slate-400 mt-1">Senha numérica de 4 dígitos para o parceiro acessar seu portal.</p>
            </div>

            <!-- 5. Email -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                Email de Contato & Faturamento <span class="text-slate-400 font-normal">(Opcional)</span>
              </label>
              <input 
                type="email" 
                id="partner-create-email" 
                placeholder="contato@sistemapdv.com.br" 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition"
              />
            </div>

            <!-- 6. Seleção de Plano B2B -->
            <div>
              <label class="block font-bold text-slate-700 mb-1">
                Plano B2B (Franquia de Lojas / Tokens) <span class="text-rose-500">*</span>
              </label>
              <select 
                id="partner-create-plan" 
                required 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-bold text-slate-800 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition cursor-pointer"
              >
                <option value="plano_starter">Starter (Até 50 Lojas) — R$ 390,00 / mês</option>
                <option value="plano_pro">Pro (Até 150 Lojas) — R$ 890,00 / mês</option>
                <option value="plano_enterprise">Enterprise (Até 500 Lojas) — R$ 1.990,00 / mês</option>
              </select>
              <p class="text-[10px] text-slate-400 mt-1">Vincula o parceiro a um pacote com limite de Tenants e fatura mensal fixa.</p>
            </div>
          </div>

          <!-- Rodapé Fixo (Footer) com Botões Cancelar e Salvar Parceiro -->
          <div class="shrink-0 pt-3.5 mt-2 border-t border-slate-100 flex items-center justify-end gap-2.5 bg-white">
            <button 
              type="button" 
              onclick="closeCreatePartnerModal()" 
              class="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800 font-bold text-xs transition cursor-pointer"
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              id="btn-submit-create-partner" 
              class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-xs transition shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <span>Salvar Parceiro</span>
              <span>✓</span>
            </button>
          </div>
        </form>
      </div>
    </div>\n\n    `;

    c = c.substring(0, mIdxStart) + newModalHtml + c.substring(mIdxEnd);
    console.log('[OK] modal-create-partner atualizado com rodapé fixo e scroll interno em:', p);
  }

  // Atualiza funções open/close modal-create-partner
  c = c.replace(
    "modal.classList.remove('hidden');\r\n    }\r\n    window.openCreatePartnerModal = openCreatePartnerModal;\r\n\r\n    function closeCreatePartnerModal() {\r\n      const modal = document.getElementById('modal-create-partner');\r\n      if (modal) modal.classList.add('hidden');",
    "modal.classList.remove('hidden');\r\n      modal.style.removeProperty('display');\r\n      modal.style.display = 'flex';\r\n    }\r\n    window.openCreatePartnerModal = openCreatePartnerModal;\r\n\r\n    function closeCreatePartnerModal() {\r\n      const modal = document.getElementById('modal-create-partner');\r\n      if (modal) {\r\n        modal.classList.add('hidden');\r\n        modal.style.setProperty('display', 'none', 'important');\r\n      }"
  );

  // =========================================================================
  // ITEM 3: CARROSSEL MOBILE NOS 3 CARDS DE PARCEIROS
  // =========================================================================
  const oldCardsContainer = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
          <div class="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Parceiros Cadastrados</span>
            <div id="admin-stat-partners-count" class="text-xl font-black text-slate-900 mt-0.5">0 <span class="text-xs text-indigo-600 font-bold">parceiros</span></div>
            <div class="text-[11px] text-slate-500 mt-1">Total de integradores no sistema</div>
          </div>

          <div class="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lojas Integradas</span>
            <div id="admin-stat-partner-stores-count" class="text-xl font-black text-emerald-700 mt-0.5">0 <span class="text-xs text-emerald-600 font-bold">farmácias</span></div>
            <div class="text-[11px] text-slate-500 mt-1">Tenants sincronizando via API</div>
          </div>

          <div class="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Faturamento Mensal (Franquia B2B)</span>
            <div id="admin-stat-partner-mrr" class="text-xl font-black text-indigo-700 mt-0.5">R$ 0,00</div>
            <div class="text-[11px] text-slate-500 mt-1">Receita recorrente contratada</div>
          </div>
        </div>`;

  const newCardsContainer = `<div class="flex overflow-x-auto pb-1.5 sm:pb-0 sm:grid sm:grid-cols-3 gap-2.5 sm:gap-3 sm:overflow-visible scrollbar-none snap-x snap-mandatory" style="-webkit-overflow-scrolling: touch;">
          <div class="min-w-[210px] sm:min-w-0 flex-1 shrink-0 snap-start bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Parceiros Cadastrados</span>
            <div id="admin-stat-partners-count" class="text-xl font-black text-slate-900 mt-0.5">0 <span class="text-xs text-indigo-600 font-bold">parceiros</span></div>
            <div class="text-[11px] text-slate-500 mt-1">Total de integradores no sistema</div>
          </div>

          <div class="min-w-[210px] sm:min-w-0 flex-1 shrink-0 snap-start bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lojas Integradas</span>
            <div id="admin-stat-partner-stores-count" class="text-xl font-black text-emerald-700 mt-0.5">0 <span class="text-xs text-emerald-600 font-bold">farmácias</span></div>
            <div class="text-[11px] text-slate-500 mt-1">Tenants sincronizando via API</div>
          </div>

          <div class="min-w-[210px] sm:min-w-0 flex-1 shrink-0 snap-start bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Faturamento Mensal (Franquia B2B)</span>
            <div id="admin-stat-partner-mrr" class="text-xl font-black text-indigo-700 mt-0.5">R$ 0,00</div>
            <div class="text-[11px] text-slate-500 mt-1">Receita recorrente contratada</div>
          </div>
        </div>`;

  if (c.includes(oldCardsContainer.replace(/\n/g, '\r\n'))) {
    c = c.replace(oldCardsContainer.replace(/\n/g, '\r\n'), newCardsContainer.replace(/\n/g, '\r\n'));
    console.log('[OK] Cards de resumo atualizados para carrossel mobile (CRLF) em:', p);
  } else if (c.includes(oldCardsContainer)) {
    c = c.replace(oldCardsContainer, newCardsContainer);
    console.log('[OK] Cards de resumo atualizados para carrossel mobile (LF) em:', p);
  }

  // Atualiza cálculo do Faturamento Mensal no frontend para SUM dos planos ativos
  const oldMrrCalc = `const totalMrrCalculated = partners.filter(p => p.status !== 'bloqueado' && p.status !== 'inativo').reduce((sum, p) => {
        const val = parseFloat(p.valor_mensal !== undefined ? p.valor_mensal : (p.faturaEstimada !== undefined ? p.faturaEstimada : 390.00));
        return sum + val;
      }, 0);`;

  const newMrrCalc = `const totalMrrCalculated = partners.filter(p => {
        const st = String(p.status || 'ativo').toLowerCase().trim();
        return st === 'ativo' || st === 'active';
      }).reduce((sum, p) => {
        const plan = (typeof cachedB2bPlans !== 'undefined' && Array.isArray(cachedB2bPlans))
          ? (cachedB2bPlans.find(pl => pl.id === p.plano_id) || {})
          : {};
        const val = parseFloat(plan.valor_mensal !== undefined ? plan.valor_mensal : (p.valor_mensal !== undefined ? p.valor_mensal : (p.faturaEstimada || 390.00))) || 0;
        return sum + val;
      }, 0);`;

  if (c.includes(oldMrrCalc)) {
    c = c.replace(oldMrrCalc, newMrrCalc);
    console.log('[OK] Cálculo do totalMrr atualizado (LF) em:', p);
  } else if (c.includes(oldMrrCalc.replace(/\n/g, '\r\n'))) {
    c = c.replace(oldMrrCalc.replace(/\n/g, '\r\n'), newMrrCalc.replace(/\n/g, '\r\n'));
    console.log('[OK] Cálculo do totalMrr atualizado (CRLF) em:', p);
  }

  fs.writeFileSync(p, c, 'utf8');
}
