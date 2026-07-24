// 扫描 photos/ 目录，去重后生成 PHOTOS 数据，写入 photography.html
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PHOTOS_DIR = path.join(__dirname, 'photos');
const HTML_FILE = path.join(__dirname, 'photography.html');

// 文件夹 → category 映射
const DIR_CATEGORY = {
  nature: 'nature',
  architecture: 'arch',
  rail: 'rail',
  society: 'street'
};

// ========== 1. 扫描所有文件，计算 MD5 ==========
const fileMap = new Map(); // hash → { name, categories: Set, size }

const dirs = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && DIR_CATEGORY[d.name]);

for (const dir of dirs) {
  const cat = DIR_CATEGORY[dir.name];
  const dirPath = path.join(PHOTOS_DIR, dir.name);
  const files = fs.readdirSync(dirPath).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  });

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const buf = fs.readFileSync(filePath);
    const hash = crypto.createHash('md5').update(buf).digest('hex');

    if (fileMap.has(hash)) {
      fileMap.get(hash).categories.add(cat);
    } else {
      fileMap.set(hash, {
        name: file,
        categories: new Set([cat]),
        size: buf.length
      });
    }
  }
}

// ========== 2. 统计 ==========
let totalSize = 0;
const uniquePhotos = [];
for (const [hash, info] of fileMap) {
  totalSize += info.size;
  uniquePhotos.push(info);
}

console.log(`总文件数: ${fileMap.size} 个唯一照片`);
console.log(`总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

const catCount = {};
for (const p of uniquePhotos) {
  for (const c of p.categories) {
    catCount[c] = (catCount[c] || 0) + 1;
  }
}
for (const [cat, count] of Object.entries(catCount)) {
  console.log(`  ${cat}: ${count} 张`);
}

// 显示跨分类的照片
const multiCat = uniquePhotos.filter(p => p.categories.size > 1);
if (multiCat.length > 0) {
  console.log(`\n跨分类照片: ${multiCat.length} 张`);
  for (const p of multiCat) {
    console.log(`  ${p.name} → [${[...p.categories].join(', ')}]`);
  }
}

// ========== 3. 生成 HTML 内容 ==========
// 按原始文件夹顺序排序：nature → arch → rail → street
const catOrder = ['nature', 'arch', 'rail', 'street'];
uniquePhotos.sort((a, b) => {
  const aCats = [...a.categories].sort();
  const bCats = [...b.categories].sort();
  const aIdx = catOrder.indexOf(aCats[0]);
  const bIdx = catOrder.indexOf(bCats[0]);
  return aIdx - bIdx;
});

let photosJson = 'const PHOTOS = [\n';
let id = 1;
for (const p of uniquePhotos) {
  const cats = [...p.categories].sort();
  const catsStr = JSON.stringify(cats.length === 1 ? cats[0] : cats);
  const filePath = `photos/${Object.entries(DIR_CATEGORY).find(([d]) => DIR_CATEGORY[d] === cats[0])[0]}/${p.name}`;
  photosJson += `  { id: ${id}, src: '${filePath}', category: ${catsStr} },\n`;
  id++;
}
photosJson += '];';

// ========== 4. 写入 photography.html ==========
let html = fs.readFileSync(HTML_FILE, 'utf-8');

// 替换 PHOTOS 数组（从 const PHOTOS = [ 到 ];）
html = html.replace(
  /const PHOTOS = \[[\s\S]*?\];/,
  photosJson
);

// 修改 renderGallery 支持多分类数组
// 把 filtered = cat === 'all' ? [...PHOTOS] : PHOTOS.filter(p => p.category === cat);
// 改成支持 category 可能是数组的情况
html = html.replace(
  /filtered = cat === 'all' \? \[...PHOTOS\] : PHOTOS\.filter\(p => p\.category === cat\);/,
  `filtered = cat === 'all' ? [...PHOTOS] : PHOTOS.filter(p => {
    const cats = Array.isArray(p.category) ? p.category : [p.category];
    return cats.includes(cat);
  });`
);

// 修改 showLightboxPhoto 中获取 category 的逻辑
// lbImg.alt = CATEGORY_ALTS[photo.category] || '';
html = html.replace(
  /lbImg\.alt = CATEGORY_ALTS\[photo\.category\] \|\| '';/,
  `const cat = Array.isArray(photo.category) ? photo.category[0] : photo.category;
  lbImg.alt = CATEGORY_ALTS[cat] || '';`
);

// 修改 renderGallery 中获取 alt 的逻辑  
// img.alt = CATEGORY_ALTS[photo.category] || '';
html = html.replace(
  /img\.alt = CATEGORY_ALTS\[photo\.category\] \|\| '';/,
  `const cat = Array.isArray(photo.category) ? photo.category[0] : photo.category;
    img.alt = CATEGORY_ALTS[cat] || '';`
);

// 修改 showLightboxPhoto 中第二个 alt 引用
html = html.replace(
  /lbImg\.alt = CATEGORY_ALTS\[photo\.category\] \|\| '';/g,
  `const cat = Array.isArray(photo.category) ? photo.category[0] : photo.category;
  lbImg.alt = CATEGORY_ALTS[cat] || '';`
);

// 更新评论：静态硬编码 → 本地照片
html = html.replace(
  '//  ① 数据模块 — 静态硬编码（与 admin 后台解耦）',
  '//  ① 数据模块 — 自动生成自 photos/ 目录'
);

fs.writeFileSync(HTML_FILE, html, 'utf-8');

console.log(`\n已更新 photography.html，共 ${uniquePhotos.length} 张照片`);
console.log('完成！');
