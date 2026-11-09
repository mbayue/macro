/* Runs before first paint (loaded without defer). External file because the CSP forbids inline scripts. */
/* Old links such as https://macro.my.id/#/run/<id> point at the app, which now lives at /app/. */
if (/^#\/(run|probe)\//.test(location.hash) || location.hash === '#/') {
  location.replace('/app/' + location.hash);
}
/* Reveal animations hide content only when scripting works. */
document.documentElement.classList.add('js');
/* If the page script has not started after 3 s (failed or blocked), show everything without reveals. */
setTimeout(function () {
  var root = document.documentElement;
  if (!root.classList.contains('motion-ready')) root.classList.remove('js');
}, 3000);
/* Apply a saved dark theme before anything is drawn (light is the default). Same key as src/theme.ts. */
try {
  if (localStorage.getItem('macro-theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', '#0f0f0f');
  }
} catch (e) {
  /* Storage blocked: stay light. */
}
