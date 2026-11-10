const fs = require('fs');
const content = fs.readFileSync('C:/Users/fasal/.gemini/antigravity/scratch/alerta-vencimento/index.html', 'utf8');
const viewAdminStart = content.lastIndexOf('<div', content.indexOf('id="view-admin"'));
const viewPartnerStart = content.lastIndexOf('<div', content.indexOf('id="view-partner"'));
const block = content.substring(viewAdminStart, viewPartnerStart);

let depth = 0;
const divRegex = /<\/?div(\s|>)/gi;
let match;
let zeroCount = 0;
while ((match = divRegex.exec(block)) !== null) {
  const isClose = match[0].startsWith('</');
  if (isClose) depth--;
  else depth++;
  if (depth === 0) {
    zeroCount++;
    console.log(`ZERO DEPTH #${zeroCount} at offset ${match.index}:`);
    console.log(block.substring(match.index - 60, match.index + 60));
    console.log('------------------------------------------------');
  }
}
console.log('Final depth at view-partner start:', depth);
