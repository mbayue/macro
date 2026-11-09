/* Runs before first paint (loaded without defer). External file because the CSP forbids inline scripts. */
/* Old links such as https://macro.my.id/#/run/<id> point at the app, which now lives at /app/. */
if (/^#\/(run|probe)\//.test(location.hash) || location.hash === '#/') {
  location.replace('/app/' + location.hash);
}
/* Reveal animations hide content only when scripting works. */
document.documentElement.classList.add('js');
