const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // 1. Atualizar impersonatePartner
  const oldImp = "      saveState();\r\n      renderUI();\r\n      showToast(`🛡️ Acesso de Suporte: Você está operando como ${partner.name}!`);";
  const oldImpLF = "      saveState();\n      renderUI();\n      showToast(`🛡️ Acesso de Suporte: Você está operando como ${partner.name}!`);";

  const newImp = `      saveState();

      // Força ocultação imediata do Super Admin e exibição do Parceiro
      const _vAdm = document.getElementById('view-admin');
      const _vPart = document.getElementById('view-partner');
      if (_vAdm) { _vAdm.classList.add('hidden'); _vAdm.style.setProperty('display', 'none', 'important'); }
      if (_vPart) { _vPart.classList.remove('hidden'); _vPart.style.removeProperty('display'); _vPart.style.display = 'flex'; }

      renderUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(\`🛡️ Acesso de Suporte: Você está operando como \${partner.name}!\`);`;

  if (c.includes(oldImp)) {
    c = c.replace(oldImp, newImp.replace(/\n/g, '\r\n'));
    console.log('[OK] impersonatePartner atualizado (CRLF) em', p);
  } else if (c.includes(oldImpLF)) {
    c = c.replace(oldImpLF, newImp);
    console.log('[OK] impersonatePartner atualizado (LF) em', p);
  }

  // 2. Atualizar stopImpersonatingPartner
  const oldStop = "      saveState();\r\n      renderUI();\r\n      switchAdminTab('partners');\r\n      showToast('🛡️ Retornado com sucesso ao Painel do Administrador Master.');";
  const oldStopLF = "      saveState();\n      renderUI();\n      switchAdminTab('partners');\n      showToast('🛡️ Retornado com sucesso ao Painel do Administrador Master.');";

  const newStop = `      saveState();

      // Força ocultação imediata do Parceiro e exibição do Super Admin
      const _vAdm = document.getElementById('view-admin');
      const _vPart = document.getElementById('view-partner');
      if (_vPart) { _vPart.classList.add('hidden'); _vPart.style.setProperty('display', 'none', 'important'); }
      if (_vAdm) { _vAdm.classList.remove('hidden'); _vAdm.style.removeProperty('display'); _vAdm.style.display = 'flex'; }

      renderUI();
      switchAdminTab('partners');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('🛡️ Retornado com sucesso ao Painel do Administrador Master.');`;

  if (c.includes(oldStop)) {
    c = c.replace(oldStop, newStop.replace(/\n/g, '\r\n'));
    console.log('[OK] stopImpersonatingPartner atualizado (CRLF) em', p);
  } else if (c.includes(oldStopLF)) {
    c = c.replace(oldStopLF, newStop);
    console.log('[OK] stopImpersonatingPartner atualizado (LF) em', p);
  }

  fs.writeFileSync(p, c, 'utf8');
}
