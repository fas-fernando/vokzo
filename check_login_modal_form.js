const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const idx = html.indexOf('id="modal-phone-pin-login"');
console.log(html.substring(idx + 1000, idx + 3500));
