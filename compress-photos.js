// 扫描 photos/ 目录，去重后压缩到 images/ 目录，并更新 photography.html
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const PHOTOS_DIR = path.join(__dirname, 'photos');
const IMAGES_DIR = path.join(__dirname, 'images');
const HTML_FILE = path.join(__dirname, 'photography.html');

// 文件夹 → category 映射
const DIR_CATEGORY = {
  nature: 'nature',
  architecture: 'arch',
  rail: 'rail',
  society: 'street'
};

// ========== 1. 扫描并去重（与 build-photos.js 逻辑一致） ==========
const fileMap = new Map();

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
        originalPath: filePath,
        categories: new Set([cat])
      });
    }
  }
}

const uniquePhotos = [...fileMap.values()];

// ========== 2. 排序 ==========
const catOrder = ['nature', 'arch', 'rail', 'street'];
uniquePhotos.sort((a, b) => {
  const aCats = [...a.categories].sort();
  const bCats = [...b.categories].sort();
  return catOrder.indexOf(aCats[0]) - catOrder.indexOf(bCats[0]);
});

console.log(`去重后 ${uniquePhotos.length} 张照片，开始压缩...\n`);

// ========== 3. 创建输出目录 ==========
fs.mkdirSync(path.join(IMAGES_DIR, 'thumb'), { recursive: true });
fs.mkdirSync(path.join(IMAGES_DIR, 'full'), { recursive: true });

// ========== 4. 逐张压缩 ==========
let totalOriginal = 0;
let totalCompressed = 0;

async function compressAll() {
  for (let i = 0; i < uniquePhotos.length; i++) {
    const photo = uniquePhotos[i];
    const originalSize = fs.statSync(photo.originalPath).size;
    totalOriginal += originalSize;

    // 生成安全的文件名（替换空格和特殊字符）
    const safeName = path.parse(photo.name).name
      .replace(/[\s()（）]+/g, '-')
      .replace(/[^\w\u4e00-\u9fff\-]/g, '')
      + '.jpg';
    const thumbFile = path.join(IMAGES_DIR, 'thumb', safeName);
    const fullFile = path.join(IMAGES_DIR, 'full', safeName);

    // 压缩缩略图 600px
    try {
      await sharp(photo.originalPath)
        .resize(600, null, { withoutEnlargement: true })
        .jpeg({ quality: 75, progressive: true })
        .toFile(thumbFile);
    } catch (e) {
      console.error(`  缩略图失败: ${photo.name}`, e.message);
    }

    // 压缩大图 1600px
    try {
      await sharp(photo.originalPath)
        .resize(1600, null, { withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toFile(fullFile);
    } catch (e) {
      console.error(`  大图失败: ${photo.name}`, e.message);
    }

    totalCompressed += (fs.existsSync(thumbFile) ? fs.statSync(thumbFile).size : 0);
    totalCompressed += (fs.existsSync(fullFile) ? fs.statSync(fullFile).size : 0);

    // 进度
    const pct = Math.round((i + 1) / uniquePhotos.length * 100);
    process.stdout.write(`\r  进度: ${i + 1}/${uniquePhotos.length} (${pct}%)`);
  }
  console.log('\n');

  console.log(`原始大小: ${(totalOriginal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`压缩后: ${(totalCompressed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`压缩率: ${((1 - totalCompressed / totalOriginal) * 100).toFixed(1)}%\n`);

  // ========== 5. 生成 PHOTOS 数据 ==========
  let photosJson = 'const PHOTOS = [\n';
  let id = 1;
  for (const p of uniquePhotos) {
    const cats = [...p.categories].sort();
    const catsStr = JSON.stringify(cats.length === 1 ? cats[0] : cats);
    const safeName = path.parse(p.name).name
      .replace(/[\s()（）]+/g, '-')
      .replace(/[^\w\u4e00-\u9fff\-]/g, '')
      + '.jpg';
    photosJson += `  { id: ${id}, src: 'images/full/${safeName}', thumb: 'images/thumb/${safeName}', category: ${catsStr} },\n`;
    id++;
  }
  photosJson += '];';

  // ========== 6. 写入 photography.html ==========
  let html = fs.readFileSync(HTML_FILE, 'utf-8');

  html = html.replace(
    /const PHOTOS = \[[\s\S]*?\];/,
    photosJson
  );

  // 恢复 thumb 引用
  html = html.replace(
    /img\.src = photo\.src;/,
    'img.src = photo.thumb;'
  );

  // 恢复宽高解析逻辑
  html = html.replace(
    /img\.alt = CATEGORY_ALTS\[cat\] \|\| '';\n    img\.loading = 'lazy';\n    img\.decoding = 'async';/,
    `img.alt = CATEGORY_ALTS[cat] || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // 从 thumb URL 解析宽高，预留比例空间
    const dim = photo.thumb.match(/(\\d+)\\/(\\d+)$/);
    if (dim) { img.width = dim[1]; img.height = dim[2]; }`
  );

  // 恢复灯箱缩略图预加载
  html = html.replace(
    /function showLightboxPhoto\(photo\) \{\n  const cat = Array\.isArray\(photo\.category\) \? photo\.category\[0\] : photo\.category;\n  lbImg\.alt = CATEGORY_ALTS\[cat\] \|\| '';\n  lbImg\.src = photo\.src;\n\}/,
    `// 先用缩略图即时出图，全尺寸在后台上载完成后自动替换
function showLightboxPhoto(photo) {
  const seq = ++lbSeq;
  const cat = Array.isArray(photo.category) ? photo.category[0] : photo.category;
  lbImg.alt = CATEGORY_ALTS[cat] || '';
  lbImg.src = photo.thumb;
  const full = new Image();
  full.decoding = 'async';
  full.onload = () => { if (seq === lbSeq && lbIndex !== -1) lbImg.src = photo.src; };
  full.src = photo.src;
}`
  );

  // 恢复 lbSeq 变量
  html = html.replace(
    /let lbIndex = -1;/,
    'let lbIndex = -1;\nlet lbSeq = 0; // 大图加载令牌'
  );

  fs.writeFileSync(HTML_FILE, html, 'utf-8');

  console.log(`已更新 photography.html，共 ${uniquePhotos.length} 张照片`);
  console.log('完成！');
}

compressAll().catch(e => {
  console.error('出错:', e);
  process.exit(1);
});
