const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const idx = html.indexOf('function magicLoginAsMerchant');
console.log('magicLoginAsMerchant idx:', idx);
if (idx !== -1) {
  console.log(html.substring(idx, idx + 1200));
}
