// The editor's old address.
//
// Until 2026-10-24 this tool was Otter EDID Editor, at otter-edid.stoatworks-labs.com.
// It is EDID Editor now, at edid-editor.stoatworks-labs.com, and every request to the
// old address is sent there with its path and query intact, so a bookmark or a link
// in an old forum post still lands on the same page.
//
// One path is not redirected: /sw.js. A browser that installed the old site keeps
// its service worker and checks /sw.js for an update now and then, and that check
// refuses a redirect. A 301 there would leave the old worker in charge for good,
// serving its cached copy of the old site whenever the network is slow. So /sw.js
// answers with a worker that empties the caches, sends any open tab on to the new
// address and unregisters itself.

const NEW_ORIGIN = 'https://edid-editor.stoatworks-labs.com'

const RETIRING_WORKER = `// EDID Editor moved to ${NEW_ORIGIN}. This worker retires the old one.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) await caches.delete(name)
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    await self.registration.unregister()
    for (const tab of tabs) {
      const url = new URL(tab.url)
      tab.navigate('${NEW_ORIGIN}' + url.pathname + url.search + url.hash).catch(() => {})
    }
  })())
})
`

export default {
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/sw.js') {
      return new Response(RETIRING_WORKER, {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
    return Response.redirect(NEW_ORIGIN + url.pathname + url.search, 301)
  },
}
