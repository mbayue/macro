/* Runs before first paint (loaded without defer). External file because the CSP forbids inline scripts. */
/* Old links such as https://macro.my.id/#/run/<id> point at the app, which now lives at /app/.
   Only on the landing page: the app itself uses the same hash routes. */
if (location.pathname === '/' && (/^#\/(run|probe)\//.test(location.hash) || location.hash === '#/')) {
  location.replace('/app/' + location.hash);
}
/* Reveal animations hide content only when scripting works. */
document.documentElement.classList.add('js');
/* If the page script has not started after 3 s (failed or blocked), show everything without reveals. */
setTimeout(function () {
  var root = document.documentElement;
  if (!root.classList.contains('motion-ready')) root.classList.remove('js');
}, 3000);
/* Dark is the default (data-theme="dark" in the HTML). Apply a saved light choice before anything
   is drawn. Same key as src/theme.ts. */
try {
  if (localStorage.getItem('macro-theme') === 'light') {
    delete document.documentElement.dataset.theme;
    var themeColor = document.querySelector('meta[name="theme-color"]');
    var onApp = location.pathname === '/app' || location.pathname.indexOf('/app/') === 0;
    if (themeColor) themeColor.setAttribute('content', onApp ? '#fdfff5' : '#f2f2ed');
  }
} catch (e) {
  /* Storage blocked: stay dark. */
}
