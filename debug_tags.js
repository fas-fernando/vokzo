const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const viewAdminIdx = content.indexOf('id="view-admin"');
const adminBlock = content.substring(viewAdminIdx, viewAdminIdx + 2500);

let depth = 0;
const divRegex = /<\/?div(\s|>)/gi;
let match;
while ((match = divRegex.exec(adminBlock)) !== null) {
  const isClose = match[0].startsWith('</');
  if (isClose) depth--;
  else depth++;
  console.log(`Tag: ${match[0].trim()} at ${match.index}, depth becomes: ${depth}`);
}
