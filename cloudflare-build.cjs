const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { minify } = require('html-minifier-terser');

const output = path.resolve(process.argv[2] || 'dist');
const maxAssetBytes = 25 * 1024 * 1024;
const videoPartBytes = 4 * 1024 * 1024;
const introPath = 'media/scene-art/intro-motion-1080.mp4';
const sceneVideos = new Set([
  introPath,
  'media/scene-art/timeline-desktop.mp4',
  'media/scene-art/timeline-mobile.mp4',
  'media/scene-art/contact-desktop.mp4',
  'media/scene-art/contact-mobile.mp4',
]);
let index = fs.readFileSync('index.html', 'utf8');
const intro = index.match(/<video id="intro-video"[^>]+>/)[0];
const readIntroAttribute = name => intro.match(new RegExp(name + '="([^"]+)"'))[1];
const manifest = {};

function writeAsset(relativePath, contents) {
  if (contents.length > maxAssetBytes) {
    throw new Error(`Cloudflare Pages asset exceeds 25 MiB: ${relativePath}`);
  }
  const destination = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function writeVideo(relativePath, contents) {
  const size = contents.length;
  const hash = createHash('sha256').update(contents).digest('hex');
  const folder = `_video/${hash}`;
  const offsets = [0];
  for (let start = videoPartBytes; start < size; start += videoPartBytes) {
    offsets.push(start);
  }
  offsets.push(size);
  const video = { folder, size, offsets, etag: `"${hash}"` };
  writeParts(folder, offsets, contents);

  if (relativePath === introPath) {
    if (size !== Number(readIntroAttribute('data-motion-bytes'))) {
      throw new Error('Intro video and its byte offsets are out of sync');
    }
    const motionOffsets = [
      0,
      Number(readIntroAttribute('data-motion-init')),
      ...readIntroAttribute('data-motion-offsets').split(',').map(Number),
      size,
    ];
    const motionFolder = `${folder}/motion`;
    writeParts(motionFolder, motionOffsets, contents);
    writeAsset(`${motionFolder}/start.bin`, contents.subarray(0, motionOffsets[3]));
    index = index.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-video-delivery="pages">');
    index = index.replace(intro, intro.replace(' data-src=', ` data-motion-parts="${motionFolder}/" data-src=`));
    index = index.replace('</title>', `</title>\n  <script>if(!window.DYMobileMedia.matches && matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches && window.MediaSource){const link=document.createElement('link');link.rel='preload';link.as='fetch';link.href='${motionFolder}/start.bin';link.crossOrigin='anonymous';document.head.append(link);}</script>`);
    video.motion = { folder: motionFolder, offsets: motionOffsets };
  }
  manifest[`/${relativePath}`] = video;
}

function writeParts(folder, offsets, contents) {
  for (let i = 0; i < offsets.length - 1; i++) {
    if (!Number.isSafeInteger(offsets[i]) || offsets[i] >= offsets[i + 1]) {
      throw new Error(`Invalid video offsets: ${folder}`);
    }
    writeAsset(`${folder}/${i}.bin`, contents.subarray(offsets[i], offsets[i + 1]));
  }
}

function copyMedia(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      copyMedia(relativePath);
    } else if (sceneVideos.has(relativePath) || /^media\/mobile\/[^/]+\.mp4$/.test(relativePath)) {
      writeVideo(relativePath, fs.readFileSync(relativePath));
    } else if (!relativePath.endsWith('.mp4') || relativePath.startsWith('media/works/')) {
      writeAsset(relativePath, fs.readFileSync(relativePath));
    }
  }
}

async function build() {
  writeAsset('mobile-video-worker.js', fs.readFileSync('mobile-video-worker.js'));
  copyMedia('media');
  const html = await minify(index, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: true,
  });
  writeAsset('index.html', Buffer.from(html));
  writeAsset('_video/index.json', Buffer.from(JSON.stringify(manifest)));
  writeAsset('_headers', Buffer.from('/_video/:hash/:part\n  Cache-Control: public, max-age=31536000, immutable\n\n/_video/:hash/motion/:part\n  Cache-Control: public, max-age=31536000, immutable\n'));
  writeAsset('_routes.json', Buffer.from(JSON.stringify({
    version: 1,
    include: Object.keys(manifest),
    exclude: [],
  })));
  console.log(`Built ${output} with ${Object.keys(manifest).length} video routes.`);
}

build().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
