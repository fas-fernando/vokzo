const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  const startMarker = '<div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">';
  const endMarker = '<!-- Botões Contextuais Dinâmicos Conforme a Aba Selecionada -->';

  const sIdx = c.indexOf(startMarker);
  const eIdx = c.indexOf(endMarker);

  if (sIdx !== -1 && eIdx !== -1) {
    const replacement = `<div class="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl w-full sm:w-auto overflow-x-auto whitespace-nowrap scrollbar-none snap-x" style="-webkit-overflow-scrolling: touch;">
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
        </div>

        `;

    c = c.substring(0, sIdx) + replacement.replace(/\n/g, '\r\n') + c.substring(eIdx);
    console.log('[OK] Abas de navegação substituídas com sucesso em:', p);
    fs.writeFileSync(p, c, 'utf8');
  } else {
    console.log('[WARN] Não foi possível encontrar marcadores das abas em:', p);
  }
}
