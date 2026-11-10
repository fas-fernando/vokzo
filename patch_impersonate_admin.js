const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

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

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let content = fs.readFileSync(f, 'utf8');

  // Localiza função impersonatePartner atual
  const regex = /\/\/ Acessar como Parceiro \(Impersonation para prestar suporte\)[\s\S]*?window\.impersonatePartner = impersonatePartner;/;
  if (regex.test(content)) {
    content = content.replace(regex, newImpersonateAdminCode);
    fs.writeFileSync(f, content, 'utf8');
    console.log('impersonatePartner atualizado com sucesso em:', f);
  } else {
    console.log('Regex não bateu em:', f);
  }
}
