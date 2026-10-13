/* Собирает список логотипов партнёров из папки public/партнеры.

   Как добавить партнёра: положите логотип (png, svg, jpg, jpeg, webp) в public/партнеры.
   Порядок на сайте — по имени файла: 01-khs.png, 02-serac.svg, 03-sacmi.png …
   Подпись (для alt) берётся из имени без номера: «01-khs.png» → «khs».

   Локальный сервер собирает список сам при каждом запросе; для GitHub Pages
   workflow запускает этот скрипт перед публикацией:  node scripts/partners.js
*/
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'партнеры');
const EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);

function buildPartners() {
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (e) { return []; }
  return files
    .filter((f) => EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }))
    .map((file) => ({
      file,
      name: path.basename(file, path.extname(file)).replace(/^\d+[\s._-]*/, '').replace(/[_-]+/g, ' ').trim() || file,
    }));
}

module.exports = { buildPartners, PARTNERS_DIR: DIR };

if (require.main === module) {
  const list = buildPartners();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'partners.json'), JSON.stringify(list, null, 2));
  console.log(`partners.json: ${list.length} логотип(ов)`);
}
