const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const viewAdminIdx = content.indexOf('id="view-admin"');
const viewPartnerIdx = content.indexOf('id="view-partner"');
const adminBlock = content.substring(viewAdminIdx, viewPartnerIdx);

let depth = 0;
const divRegex = /<\/?div(\s|>)/gi;
let match;
while ((match = divRegex.exec(adminBlock)) !== null) {
  const isClose = match[0].startsWith('</');
  if (isClose) depth--;
  else depth++;
  if (depth <= 0) {
    console.log(`Depth hit <= 0: depth = ${depth} at offset ${match.index}`);
    console.log(adminBlock.substring(match.index - 80, match.index + 80));
    console.log('---------------------------------------------------------');
  }
}
