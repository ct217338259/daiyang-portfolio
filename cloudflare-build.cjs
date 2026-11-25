const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const output = path.resolve(process.argv[2] || 'dist');
const maxAssetBytes = 25 * 1024 * 1024;
const videoPartBytes = 2 * 1024 * 1024;
const introPath = 'media/scene-art/intro-motion-1080.mp4';
const sceneVideos = new Set([
  introPath,
  'media/scene-art/timeline-desktop.mp4',
  'media/scene-art/timeline-mobile.mp4',
  'media/scene-art/contact-desktop.mp4',
  'media/scene-art/contact-mobile.mp4',
]);
const index = fs.readFileSync('index.html', 'utf8');
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

  if (relativePath === introPath) {
    if (size !== Number(readIntroAttribute('data-motion-bytes'))) {
      throw new Error('Intro video and its byte offsets are out of sync');
    }
    offsets.push(Number(readIntroAttribute('data-motion-init')));
    offsets.push(...readIntroAttribute('data-motion-offsets').split(',').map(Number));
  } else {
    for (let start = videoPartBytes; start < size; start += videoPartBytes) {
      offsets.push(start);
    }
  }
  offsets.push(size);

  for (let i = 0; i < offsets.length - 1; i++) {
    if (!Number.isSafeInteger(offsets[i]) || offsets[i] >= offsets[i + 1]) {
      throw new Error(`Invalid video offsets: ${relativePath}`);
    }
    writeAsset(`${folder}/${i}.bin`, contents.subarray(offsets[i], offsets[i + 1]));
  }
  manifest[`/${relativePath}`] = { folder, size, offsets, etag: `"${hash}"` };
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

writeAsset('index.html', Buffer.from(index));
writeAsset('mobile-video-worker.js', fs.readFileSync('mobile-video-worker.js'));
copyMedia('media');
writeAsset('_video/index.json', Buffer.from(JSON.stringify(manifest)));
writeAsset('_routes.json', Buffer.from(JSON.stringify({
  version: 1,
  include: Object.keys(manifest),
  exclude: [],
})));

console.log(`Built ${output} with ${Object.keys(manifest).length} original-byte video routes.`);
