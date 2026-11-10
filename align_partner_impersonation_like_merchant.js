/**
 * align_partner_impersonation_like_merchant.js
 *
 * Faz o acesso ao Parceiro funcionar EXATAMENTE IGUAL ao do Lojista:
 * 1. impersonatePartner:
 *    - Guarda backup em sessionStorage.getItem('admin_impersonating_backup') (mesma chave do lojista)
 *    - Define appState.currentUser = { id, partnerId, name, cnpj, role: 'partner', isImpersonated: true, impersonatedByAdmin: true }
 *    - saveState(), renderUI(), showToast() instantâneo, sem fetch nem pop-ups!
 * 2. stopImpersonatingPartner:
 *    - Restaura backup de sessionStorage (mesma chave do lojista)
 *    - saveState(), renderUI(), switchAdminTab('partners'), showToast()
 * 3. renderUI:
 *    - Garante que viewVisitor, viewMerchant, viewAdmin e viewPartner tenham display explícito
 *      (style.display = 'none' e style.display = '') além de classList hidden, eliminando
 *      qualquer sobreposição visual de divs!
 *    - Exibe o banner laranja no topo com o botão de voltar ao Admin.
 */

const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const filePath of files) {
  if (!fs.existsSync(filePath)) {
    console.log(`Arquivo ${filePath} não encontrado, pulando.`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Atualizar impersonatePartner e stopImpersonatingPartner
  // Substitui a versão que tentava fazer fetch ou window.open pela versão idêntica ao Lojista
  const oldImpersonateBlockRegex = /\/\/ Acessar como Parceiro[\s\S]*?window\.stopImpersonatingPartner = stopImpersonatingPartner;/;

  const newImpersonatePartnerCode = `// Acessar como Parceiro (Modo Login Mágico - IDÊNTICO AO LOJISTA)
    function impersonatePartner(partnerId) {
      const partner = (cachedAdminPartners && cachedAdminPartners.find(p => p.id === partnerId)) || 
                      (appState.partners && appState.partners[partnerId]) || {
                        id: partnerId,
                        name: 'Parceiro PDV',
                        cnpj: '12.345.678/0001-90'
                      };

      // 1. Guarda sessão do Admin Master em sessionStorage (mesma chave do Lojista)
      try {
        sessionStorage.setItem('admin_impersonating_backup', JSON.stringify(appState.currentUser));
      } catch (e) {}

      // 2. Injeta as credenciais do Parceiro
      appState.currentUser = {
        id: partner.id,
        partnerId: partner.id,
        name: partner.name,
        cnpj: partner.cnpj || '',
        phone: partner.phone || '',
        role: 'partner',
        isImpersonated: true,
        impersonatedByAdmin: true
      };

      // 3. Salva e renderiza instantaneamente na mesma tela (padrão SPA)
      saveState();
      renderUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('👁️ Modo Login Mágico ativado: Acessando como ' + (partner.name || partner.id));
    }
    window.impersonatePartner = impersonatePartner;

    // Sair do Modo Parceiro e retornar ao painel do Admin Master (IDÊNTICO AO LOJISTA)
    function stopImpersonatingPartner() {
      let restored = null;
      try {
        const backup = sessionStorage.getItem('admin_impersonating_backup');
        if (backup) restored = JSON.parse(backup);
        sessionStorage.removeItem('admin_impersonating_backup');
      } catch (e) {}

      if (restored) {
        appState.currentUser = restored;
      } else {
        const masterPhone = cleanDigits((appState.adminCredentials && appState.adminCredentials.phone) || ADMIN_PHONE);
        appState.currentUser = {
          phone: masterPhone,
          name: (appState.adminCredentials && appState.adminCredentials.name) || 'Administrador Master',
          role: 'admin',
          plano: 'master'
        };
      }

      saveState();
      renderUI();
      switchAdminTab('partners');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast('🛡️ Retornou com sucesso ao Painel do Administrador Master');
    }
    window.stopImpersonatingPartner = stopImpersonatingPartner;`;

  if (oldImpersonateBlockRegex.test(content)) {
    content = content.replace(oldImpersonateBlockRegex, newImpersonatePartnerCode);
    console.log(`[OK] impersonatePartner e stopImpersonatingPartner sincronizados com padrão Lojista em ${filePath}`);
  } else {
    console.log(`[AVISO] Regex de impersonatePartner não bateu em ${filePath}`);
  }

  // 2. Garantir isolamento visual completo no renderUI()
  // No caso PARCEIRO:
  const partnerCaseOld = `      // Se for PARCEIRO B2B LOGADO, exibe exclusivamente o Portal do Parceiro PDV
      if (user && (user.role === 'partner' || user.role === 'parceiro')) {
        if (viewVisitor) viewVisitor.classList.add('hidden');
        if (viewMerchant) viewMerchant.classList.add('hidden');
        if (viewAdmin) viewAdmin.classList.add('hidden');
        if (viewPartner) viewPartner.classList.remove('hidden');`;

  const partnerCaseNew = `      // Se for PARCEIRO B2B LOGADO, exibe exclusivamente o Portal do Parceiro PDV
      if (user && (user.role === 'partner' || user.role === 'parceiro')) {
        if (viewVisitor) { viewVisitor.classList.add('hidden'); viewVisitor.style.display = 'none'; }
        if (viewMerchant) { viewMerchant.classList.add('hidden'); viewMerchant.style.display = 'none'; }
        if (viewAdmin) { viewAdmin.classList.add('hidden'); viewAdmin.style.display = 'none'; }
        if (viewPartner) { viewPartner.classList.remove('hidden'); viewPartner.style.display = ''; }`;

  if (content.includes(partnerCaseOld)) {
    content = content.replace(partnerCaseOld, partnerCaseNew);
    console.log(`[OK] renderUI caso partner com display explícito em ${filePath}`);
  }

  // No caso ADMIN:
  const adminCaseOld = `      // CASO 2: ADMINISTRADOR MASTER (DIRECIONA PARA O PAINEL DE ADMINISTRAÇÃO)
      if (isAdmin) {
        viewVisitor.classList.add('hidden');
        viewMerchant.classList.add('hidden');
        viewAdmin.classList.remove('hidden');`;

  const adminCaseNew = `      // CASO 2: ADMINISTRADOR MASTER (DIRECIONA PARA O PAINEL DE ADMINISTRAÇÃO)
      if (isAdmin) {
        if (viewVisitor) { viewVisitor.classList.add('hidden'); viewVisitor.style.display = 'none'; }
        if (viewMerchant) { viewMerchant.classList.add('hidden'); viewMerchant.style.display = 'none'; }
        if (viewPartner) { viewPartner.classList.add('hidden'); viewPartner.style.display = 'none'; }
        if (viewAdmin) { viewAdmin.classList.remove('hidden'); viewAdmin.style.display = ''; }`;

  if (content.includes(adminCaseOld)) {
    content = content.replace(adminCaseOld, adminCaseNew);
    console.log(`[OK] renderUI caso admin com display explícito em ${filePath}`);
  }

  // No caso LOJISTA:
  const merchantCaseOld = `      // CASO 3: LOJISTA LOGADO (DIRECIONA PARA O PAINEL DO LOJISTA)
      viewVisitor.classList.add('hidden');
      viewMerchant.classList.remove('hidden');
      viewAdmin.classList.add('hidden');`;

  const merchantCaseNew = `      // CASO 3: LOJISTA LOGADO (DIRECIONA PARA O PAINEL DO LOJISTA)
      if (viewVisitor) { viewVisitor.classList.add('hidden'); viewVisitor.style.display = 'none'; }
      if (viewAdmin) { viewAdmin.classList.add('hidden'); viewAdmin.style.display = 'none'; }
      if (viewPartner) { viewPartner.classList.add('hidden'); viewPartner.style.display = 'none'; }
      if (viewMerchant) { viewMerchant.classList.remove('hidden'); viewMerchant.style.display = ''; }`;

  if (content.includes(merchantCaseOld)) {
    content = content.replace(merchantCaseOld, merchantCaseNew);
    console.log(`[OK] renderUI caso merchant com display explícito em ${filePath}`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('Script finalizado com sucesso!');
