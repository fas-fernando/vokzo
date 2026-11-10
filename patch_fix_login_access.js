const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // 1. Remover declarações duplicadas que causam SyntaxError
  const dupLet = `    // --- ESTADO GLOBAL DE PAGINAÇÃO DAS LISTAGENS ---
    let merchantProductsPage = 1;
    let merchantProductsPageSize = 10;

    let adminStoresPage = 1;
    let adminStoresPageSize = 10;

    let adminPartnersPage = 1;
    let adminPartnersPageSize = 10;

    let partnerStoresPage = 1;
    let partnerStoresPageSize = 10;`;

  const dupLetCRLF = dupLet.replace(/\n/g, '\r\n');

  if (c.includes(dupLetCRLF)) {
    c = c.replace(dupLetCRLF, '    // --- ESTADO GLOBAL DE PAGINAÇÃO DAS LISTAGENS (declarado no topo) ---');
    console.log('[OK] Declarações duplicadas removidas (CRLF) em:', p);
  } else if (c.includes(dupLet)) {
    c = c.replace(dupLet, '    // --- ESTADO GLOBAL DE PAGINAÇÃO DAS LISTAGENS (declarado no topo) ---');
    console.log('[OK] Declarações duplicadas removidas (LF) em:', p);
  }

  // 2. Corrigir buildInitialData para currentUser: null (permitindo tela de visitante e botão Entrar)
  const oldInitAdmin = `currentUser: {
          role: 'admin',
          phone: ADMIN_PHONE,
          name: 'Administrador Master',
          email: 'fas.alves.souza@gmail.com'
        },`;

  const oldInitAdminCRLF = oldInitAdmin.replace(/\n/g, '\r\n');
  if (c.includes(oldInitAdminCRLF)) {
    c = c.replace(oldInitAdminCRLF, 'currentUser: null,');
    console.log('[OK] buildInitialData restaurado para currentUser: null (CRLF) em:', p);
  } else if (c.includes(oldInitAdmin)) {
    c = c.replace(oldInitAdmin, 'currentUser: null,');
    console.log('[OK] buildInitialData restaurado para currentUser: null (LF) em:', p);
  }

  // 3. Garantir que openPhonePinLoginModal e closePhonePinLoginModal manipulem style.display flex / none
  const oldOpenModal = `    function openPhonePinLoginModal() {
      const err = document.getElementById('login-error-msg');
      if (err) err.classList.add('hidden');
      const pInp = document.getElementById('login-input-phone');
      if (pInp) pInp.value = '';
      const pinInp = document.getElementById('login-input-pin');
      if (pinInp) pinInp.value = '';
      document.getElementById('modal-phone-pin-login').classList.remove('hidden');
      setTimeout(() => { if (pInp) pInp.focus(); }, 100);
    }
    window.openPhonePinLoginModal = openPhonePinLoginModal;

    function closePhonePinLoginModal() {
      document.getElementById('modal-phone-pin-login').classList.add('hidden');
    }`;

  const newOpenModal = `    function openPhonePinLoginModal() {
      const err = document.getElementById('login-error-msg');
      if (err) err.classList.add('hidden');
      const pInp = document.getElementById('login-input-phone');
      if (pInp) pInp.value = '';
      const pinInp = document.getElementById('login-input-pin');
      if (pinInp) pinInp.value = '';
      const modal = document.getElementById('modal-phone-pin-login');
      if (modal) {
        modal.classList.remove('hidden');
        modal.style.removeProperty('display');
        modal.style.display = 'flex';
      }
      setTimeout(() => { if (pInp) pInp.focus(); }, 100);
    }
    window.openPhonePinLoginModal = openPhonePinLoginModal;

    function closePhonePinLoginModal() {
      const modal = document.getElementById('modal-phone-pin-login');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.setProperty('display', 'none', 'important');
      }
    }`;

  if (c.includes(oldOpenModal)) {
    c = c.replace(oldOpenModal, newOpenModal);
    console.log('[OK] openPhonePinLoginModal atualizado (LF) em:', p);
  } else if (c.includes(oldOpenModal.replace(/\n/g, '\r\n'))) {
    c = c.replace(oldOpenModal.replace(/\n/g, '\r\n'), newOpenModal.replace(/\n/g, '\r\n'));
    console.log('[OK] openPhonePinLoginModal atualizado (CRLF) em:', p);
  }

  // 4. Garantir que renderUI limpe style.display em viewVisitor quando !user
  const oldRenderVisitor = `      // CASO 1: VISITANTE NÃO LOGADO (NENHUM ÍCONE DE USUÁRIO DEVE APARECER)
      if (!user) {
        viewVisitor.classList.remove('hidden');
        viewMerchant.classList.add('hidden');
        viewAdmin.classList.add('hidden');`;

  const newRenderVisitor = `      // CASO 1: VISITANTE NÃO LOGADO (NENHUM ÍCONE DE USUÁRIO DEVE APARECER)
      if (!user) {
        if (viewVisitor) {
          viewVisitor.classList.remove('hidden');
          viewVisitor.style.removeProperty('display');
          viewVisitor.style.display = 'block';
        }
        if (viewMerchant) {
          viewMerchant.classList.add('hidden');
          viewMerchant.style.setProperty('display', 'none', 'important');
        }
        if (viewAdmin) {
          viewAdmin.classList.add('hidden');
          viewAdmin.style.setProperty('display', 'none', 'important');
        }
        if (viewPartner) {
          viewPartner.classList.add('hidden');
          viewPartner.style.setProperty('display', 'none', 'important');
        }`;

  if (c.includes(oldRenderVisitor)) {
    c = c.replace(oldRenderVisitor, newRenderVisitor);
    console.log('[OK] renderUI visitante atualizado (LF) em:', p);
  } else if (c.includes(oldRenderVisitor.replace(/\n/g, '\r\n'))) {
    c = c.replace(oldRenderVisitor.replace(/\n/g, '\r\n'), newRenderVisitor.replace(/\n/g, '\r\n'));
    console.log('[OK] renderUI visitante atualizado (CRLF) em:', p);
  }

  fs.writeFileSync(p, c, 'utf8');
}
