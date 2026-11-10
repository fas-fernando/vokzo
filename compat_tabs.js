const fs = require('fs');

const files = [
  'C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html',
  'C:/Users/fasal/.gemini/antigravity/brain/8dcdc677-9fde-4f84-9df5-78f4a1cdf27b/alerta_vencimento_app.html'
];

files.forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(
    'id="tab-sim-sync"',
    'id="tab-sim-sync" data-testid="btn-sim-route-sync"'
  );
  content = content.replace(
    'id="tab-sim-alerts"',
    'id="tab-sim-alerts" data-testid="btn-sim-route-alerts"'
  );
  content = content.replace(
    'id="tab-sim-status"',
    'id="tab-sim-status" data-testid="btn-sim-route-status"'
  );
  fs.writeFileSync(filePath, content, 'utf8');
});

console.log('✅ IDs e data-testids compatibilizados em ambas as abas!');
