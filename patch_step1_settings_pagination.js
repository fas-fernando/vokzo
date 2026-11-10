const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // =========================================================================
  // 1. CORREÇÃO DO BOTÃO ÓRFÃO DE CONFIGURAÇÕES
  // =========================================================================
  // Remove o fechamento espúrio '</div> <!-- Fim do Grid 2x2 -->'
  const oldGridClose = "</div> <!-- Fim do Grid 2x2 -->";
  if (c.includes(oldGridClose)) {
    c = c.replace(oldGridClose, "<!-- Fim dos Cards Semânticos de Configuração -->");
    console.log('[OK] </div> espúrio removido em:', p);
  }

  // Encapsula o rodapé com ID específico para controle via JS
  const oldFooterMarker = '<!-- RODAPÉ FIXO / CENTRALIZADO DE AÇÕES -->\r\n          <div class="pt-4 border-t border-slate-200';
  const oldFooterMarkerLF = '<!-- RODAPÉ FIXO / CENTRALIZADO DE AÇÕES -->\n          <div class="pt-4 border-t border-slate-200';
  const newFooterMarker = '<!-- RODAPÉ FIXO / CENTRALIZADO DE AÇÕES -->\n          <div id="admin-settings-save-footer" class="pt-4 border-t border-slate-200';

  if (c.includes(oldFooterMarker)) {
    c = c.replace(oldFooterMarker, newFooterMarker.replace(/\n/g, '\r\n'));
    console.log('[OK] ID admin-settings-save-footer injetado (CRLF) em:', p);
  } else if (c.includes(oldFooterMarkerLF)) {
    c = c.replace(oldFooterMarkerLF, newFooterMarker);
    console.log('[OK] ID admin-settings-save-footer injetado (LF) em:', p);
  }

  // =========================================================================
  // 2. JS DO TAB SWITCHER: GARANTIR QUE O BOTÃO SEJA OCULTO EM OUTRAS ABAS
  // =========================================================================
  const oldTabSwitch = "if (tab === 'dashboard') {\r\n        if (dashContent) dashContent.classList.remove('hidden');";
  const oldTabSwitchLF = "if (tab === 'dashboard') {\n        if (dashContent) dashContent.classList.remove('hidden');";
  
  const newTabSwitchPrefix = `const btnSaveSettings = document.getElementById('admin-settings-save-footer');
      if (btnSaveSettings) {
        if (tab === 'settings') {
          btnSaveSettings.classList.remove('hidden');
          btnSaveSettings.style.removeProperty('display');
        } else {
          btnSaveSettings.classList.add('hidden');
          btnSaveSettings.style.setProperty('display', 'none', 'important');
        }
      }

      if (tab === 'dashboard') {
        if (dashContent) dashContent.classList.remove('hidden');`;

  if (c.includes(oldTabSwitch)) {
    c = c.replace(oldTabSwitch, newTabSwitchPrefix.replace(/\n/g, '\r\n'));
    console.log('[OK] switchAdminTab atualizado para ocultar footer (CRLF) em:', p);
  } else if (c.includes(oldTabSwitchLF)) {
    c = c.replace(oldTabSwitchLF, newTabSwitchPrefix);
    console.log('[OK] switchAdminTab atualizado para ocultar footer (LF) em:', p);
  }

  // =========================================================================
  // 3. PAGINAÇÃO COM CONTROLES NUMÉRICOS 1, 2, 3...
  // =========================================================================
  const oldBuildPagination = `function buildPaginationControlsHtml(listType, currentPage, pageSize, totalItems) {
      if (totalItems <= 0) return '';
      const totalPages = Math.ceil(totalItems / pageSize) || 1;
      const startItem = (currentPage - 1) * pageSize + 1;
      const endItem = Math.min(currentPage * pageSize, totalItems);

      return \`
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3.5 px-3 border-t border-slate-200 text-xs text-slate-600 bg-slate-50/60 rounded-b-2xl mt-2">
          <div class="flex items-center gap-2">
            <span>Exibindo <strong>\${startItem}-\${endItem}</strong> de <strong>\${totalItems}</strong></span>
            <span class="text-slate-300">|</span>
            <label class="flex items-center gap-1">
              <span>Por pág:</span>
              <select onchange="changePagination('\${listType}', undefined, this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-800 outline-none cursor-pointer focus:ring-1 focus:ring-emerald-500">
                <option value="10" \${pageSize === 10 ? 'selected' : ''}>10</option>
                <option value="25" \${pageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" \${pageSize === 50 ? 'selected' : ''}>50</option>
                <option value="100" \${pageSize === 100 ? 'selected' : ''}>100</option>
              </select>
            </label>
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="changePagination('\${listType}', \${currentPage - 1})" \${currentPage <= 1 ? 'disabled class="opacity-40 cursor-not-allowed px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-400 font-bold"' : 'class="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-bold transition cursor-pointer shadow-2xs active:scale-95"'}>
              &laquo; Anterior
            </button>
            <span class="px-2 font-bold text-slate-800 text-[11px]">
              Página \${currentPage} de \${totalPages}
            </span>
            <button type="button" onclick="changePagination('\${listType}', \${currentPage + 1})" \${currentPage >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-400 font-bold"' : 'class="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-bold transition cursor-pointer shadow-2xs active:scale-95"'}>
              Próxima &raquo;
            </button>
          </div>
        </div>
      \`;
    }`;

  const newBuildPagination = `function buildPaginationControlsHtml(listType, currentPage, pageSize, totalItems) {
      if (totalItems <= 0) return '';
      const totalPages = Math.ceil(totalItems / pageSize) || 1;
      const startItem = (currentPage - 1) * pageSize + 1;
      const endItem = Math.min(currentPage * pageSize, totalItems);

      // Constrói botões de páginas numéricas ("1", "2", "3"...)
      let pageNumbersHtml = '';
      const maxButtons = 5;
      let startP = Math.max(1, currentPage - 2);
      let endP = Math.min(totalPages, startP + maxButtons - 1);
      if (endP - startP < maxButtons - 1) {
        startP = Math.max(1, endP - maxButtons + 1);
      }

      if (startP > 1) {
        pageNumbersHtml += \`<button type="button" onclick="changePagination('\${listType}', 1)" class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition cursor-pointer bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-2xs">1</button>\`;
        if (startP > 2) {
          pageNumbersHtml += \`<span class="text-slate-400 text-xs px-1">...</span>\`;
        }
      }

      for (let p = startP; p <= endP; p++) {
        const isActive = (p === currentPage);
        pageNumbersHtml += \`
          <button 
            type="button" 
            onclick="changePagination('\${listType}', \${p})" 
            class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition cursor-pointer \${isActive ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-2xs'}"
          >
            \${p}
          </button>
        \`;
      }

      if (endP < totalPages) {
        if (endP < totalPages - 1) {
          pageNumbersHtml += \`<span class="text-slate-400 text-xs px-1">...</span>\`;
        }
        pageNumbersHtml += \`<button type="button" onclick="changePagination('\${listType}', \${totalPages})" class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition cursor-pointer bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-2xs">\${totalPages}</button>\`;
      }

      return \`
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3.5 px-3 border-t border-slate-200 text-xs text-slate-600 bg-slate-50/60 rounded-b-2xl mt-2">
          <div class="flex items-center gap-2">
            <span>Exibindo <strong>\${startItem}-\${endItem}</strong> de <strong>\${totalItems}</strong></span>
            <span class="text-slate-300">|</span>
            <label class="flex items-center gap-1">
              <span>Por pág:</span>
              <select onchange="changePagination('\${listType}', undefined, this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-800 outline-none cursor-pointer focus:ring-1 focus:ring-indigo-500">
                <option value="10" \${pageSize === 10 ? 'selected' : ''}>10</option>
                <option value="25" \${pageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" \${pageSize === 50 ? 'selected' : ''}>50</option>
                <option value="100" \${pageSize === 100 ? 'selected' : ''}>100</option>
              </select>
            </label>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap justify-center">
            <button type="button" onclick="changePagination('\${listType}', \${currentPage - 1})" \${currentPage <= 1 ? 'disabled class="opacity-40 cursor-not-allowed px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-400 font-bold text-xs"' : 'class="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-bold transition cursor-pointer shadow-2xs active:scale-95 text-xs"'}>
              &laquo; Anterior
            </button>
            <div class="flex items-center gap-1 mx-0.5">
              \${pageNumbersHtml}
            </div>
            <button type="button" onclick="changePagination('\${listType}', \${currentPage + 1})" \${currentPage >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-400 font-bold text-xs"' : 'class="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-bold transition cursor-pointer shadow-2xs active:scale-95 text-xs"'}>
              Próxima &raquo;
            </button>
          </div>
        </div>
      \`;
    }`;

  if (c.includes(oldBuildPagination)) {
    c = c.replace(oldBuildPagination, newBuildPagination);
    console.log('[OK] buildPaginationControlsHtml atualizado em:', p);
  } else if (c.includes(oldBuildPagination.replace(/\r\n/g, '\n'))) {
    c = c.replace(oldBuildPagination.replace(/\r\n/g, '\n'), newBuildPagination);
    console.log('[OK] buildPaginationControlsHtml (LF) atualizado em:', p);
  }

  fs.writeFileSync(p, c, 'utf8');
}
