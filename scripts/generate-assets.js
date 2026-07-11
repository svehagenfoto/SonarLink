const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const ROOT = path.join(__dirname, '..');
const MASTER = path.join(ROOT, 'Assets', 'SonarLink.png');
const OUT = path.join(ROOT, 'Assets', 'generated');

async function resizeContained(size) {
  return sharp(MASTER)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(MASTER)) {
    console.error('Missing master asset: Assets/SonarLink.png');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });

  await sharp(await resizeContained(64)).toFile(path.join(OUT, 'mark-64.png'));
  await sharp(await resizeContained(16)).toFile(path.join(OUT, 'tray-16.png'));
  await sharp(await resizeContained(32)).toFile(path.join(OUT, 'tray-32.png'));

  await sharp(MASTER)
    .resize(256, null, { fit: 'inside' })
    .png()
    .toFile(path.join(OUT, 'logo-256.png'));

  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(icoSizes.map((size) => resizeContained(size)));
  const ico = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);

  console.log('Generated assets in Assets/generated/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
