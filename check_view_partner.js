const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const idx = html.indexOf('id="view-partner"');
console.log('view-partner idx:', idx);
if (idx !== -1) {
  console.log(html.substring(idx, idx + 2500));
}
