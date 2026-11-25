import { serveVideo } from '../../cloudflare-media.mjs';

export function onRequest(context) {
  return serveVideo(context.request, context.env.ASSETS, work => context.waitUntil(work));
}
