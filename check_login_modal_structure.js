const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const idx = html.indexOf('id="modal-phone-pin-login"');
console.log(html.substring(idx, idx + 2500));
