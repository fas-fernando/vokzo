const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // Adiciona a ocultação explícita imediata dentro de impersonatePartner
  const target1 = "saveState();\r\n      renderUI();\r\n      window.scrollTo({ top: 0, behavior: 'smooth' });\r\n      showToast('👁️ Modo Login Mágico ativado: Acessando como '";
  const target1LF = "saveState();\n      renderUI();\n      window.scrollTo({ top: 0, behavior: 'smooth' });\n      showToast('👁️ Modo Login Mágico ativado: Acessando como '";

  const replace1 = `saveState();
      // Força ocultação imediata do admin antes e durante a renderização
      const _vAdm = document.getElementById('view-admin');
      const _vPart = document.getElementById('view-partner');
      if (_vAdm) { _vAdm.classList.add('hidden'); _vAdm.style.setProperty('display', 'none', 'important'); }
      if (_vPart) { _vPart.classList.remove('hidden'); _vPart.style.removeProperty('display'); _vPart.style.display = 'flex'; }
      renderUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('👁️ Modo Login Mágico ativado: Acessando como '`;

  if (c.includes(target1)) {
    c = c.replace(target1, replace1.replace(/\n/g, '\r\n'));
    console.log('[OK] impersonatePartner patch CRLF aplicado em', p);
  } else if (c.includes(target1LF)) {
    c = c.replace(target1LF, replace1);
    console.log('[OK] impersonatePartner patch LF aplicado em', p);
  }

  // Adiciona a restauração explícita imediata dentro de stopImpersonatingPartner
  const target2 = "saveState();\r\n      renderUI();\r\n      switchAdminTab('partners');\r\n      window.scrollTo({ top: 0, behavior: 'smooth' });\r\n      showToast('🛡️ Retornou com sucesso ao Painel do Administrador Master');";
  const target2LF = "saveState();\n      renderUI();\n      switchAdminTab('partners');\n      window.scrollTo({ top: 0, behavior: 'smooth' });\n      showToast('🛡️ Retornou com sucesso ao Painel do Administrador Master');";

  const replace2 = `saveState();
      // Força ocultação imediata do parceiro e restauração exclusiva do admin
      const _vAdm = document.getElementById('view-admin');
      const _vPart = document.getElementById('view-partner');
      if (_vPart) { _vPart.classList.add('hidden'); _vPart.style.setProperty('display', 'none', 'important'); }
      if (_vAdm) { _vAdm.classList.remove('hidden'); _vAdm.style.removeProperty('display'); _vAdm.style.display = 'flex'; }
      renderUI();
      switchAdminTab('partners');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('🛡️ Retornou com sucesso ao Painel do Administrador Master');`;

  if (c.includes(target2)) {
    c = c.replace(target2, replace2.replace(/\n/g, '\r\n'));
    console.log('[OK] stopImpersonatingPartner patch CRLF aplicado em', p);
  } else if (c.includes(target2LF)) {
    c = c.replace(target2LF, replace2);
    console.log('[OK] stopImpersonatingPartner patch LF aplicado em', p);
  }

  fs.writeFileSync(p, c, 'utf8');
}
