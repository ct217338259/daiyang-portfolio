async function readManifest(assets, url) {
  const response = await assets.fetch(new URL('/_video/index.json', url));
  if (!response.ok) throw new Error('Video index unavailable');
  return response.json();
}

function readRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(size - Number(match[2]), 0);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) return null;
  return { start, end };
}

async function writeRange(assets, url, video, range, writable) {
  const writer = writable.getWriter();
  try {
    const { offsets, folder } = video;
    for (let i = 0; i < offsets.length - 1 && offsets[i] <= range.end; i++) {
      if (offsets[i + 1] <= range.start) continue;
      const response = await assets.fetch(new URL(`/${folder}/${i}.bin`, url));
      if (!response.ok) throw new Error('Video segment unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writer.write(bytes.subarray(
        Math.max(range.start - offsets[i], 0),
        range.end + 1 - offsets[i],
      ));
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error);
  }
}

export async function serveVideo(request, assets, waitUntil) {
  const url = new URL(request.url);
  const manifest = await readManifest(assets, url);
  const video = manifest[url.pathname];
  if (!video) return assets.fetch(request);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600, no-transform',
    'Content-Type': 'video/mp4',
    ETag: video.etag,
  });
  const ifRange = request.headers.get('If-Range');
  const requestedRange = request.method === 'GET' && (!ifRange || ifRange === video.etag)
    ? request.headers.get('Range')
    : null;
  if (!requestedRange && request.headers.get('If-None-Match') === video.etag) {
    return new Response(null, { status: 304, headers });
  }
  const range = requestedRange
    ? readRange(requestedRange, video.size)
    : { start: 0, end: video.size - 1 };

  if (!range) {
    headers.set('Content-Range', `bytes */${video.size}`);
    return new Response(null, { status: 416, headers });
  }
  const length = range.end - range.start + 1;
  const status = requestedRange ? 206 : 200;
  headers.set('Content-Length', String(length));
  if (requestedRange) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${video.size}`);
  }
  if (request.method === 'HEAD') return new Response(null, { status, headers });

  const { readable, writable } = new FixedLengthStream(length);
  waitUntil(writeRange(assets, url, video, range, writable));
  return new Response(readable, { status, headers });
}
