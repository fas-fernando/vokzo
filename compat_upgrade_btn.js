const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(
    'onclick="openUpgradeModal()"',
    'onclick="openUpgradeModal(); openPartnerUpgradeModal();"'
  );
  fs.writeFileSync(filePath, content, 'utf8');
});

console.log('✅ Botão compatibilizado com ambos os nomes de função!');
