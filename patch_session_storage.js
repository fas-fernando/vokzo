const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

for (const p of files) {
  let c = fs.readFileSync(p, 'utf8');

  // 1. Inserir sessionStorage no impersonatePartner se não tiver
  if (!c.includes("sessionStorage.setItem('admin_impersonating_backup'")) {
    const target = '// Guarda sessão do Super Admin para restauração fácil';
    c = c.replace(target, "try { sessionStorage.setItem('admin_impersonating_backup', JSON.stringify(appState.currentUser)); } catch (e) {}\n      " + target);
  }

  // 2. Inserir restauração de sessionStorage no stopImpersonatingPartner
  if (!c.includes("sessionStorage.getItem('admin_impersonating_backup')")) {
    const targetStop = 'function stopImpersonatingPartner() {';
    c = c.replace(targetStop, `function stopImpersonatingPartner() {
      let restored = null;
      try {
        const backup = sessionStorage.getItem('admin_impersonating_backup');
        if (backup) restored = JSON.parse(backup);
        sessionStorage.removeItem('admin_impersonating_backup');
      } catch (e) {}
      if (restored && restored.role) {
        appState.currentUser = restored;
      } else`);
  }

  // 3. Ajustar linha isolamento estrito
  c = c.replace(
    "if (viewPartner) viewPartner.classList.add('hidden');",
    "if (viewPartner) { viewPartner.classList.add('hidden'); viewPartner.style.setProperty('display', 'none', 'important'); }"
  );

  fs.writeFileSync(p, c, 'utf8');
  console.log('[OK] Atualizado:', p);
}
