(function () {
  var root = document.documentElement;
  document.querySelectorAll('[data-i]').forEach(function (el) { el.style.setProperty('--i', el.getAttribute('data-i')); });
  root.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Policy gate: the same limits the product enforces ---- */
  var ALLOW = ['https://yue.macro.my.id'];
  var t = document.getElementById('g-target'), v = document.getElementById('g-vus'), d = document.getElementById('g-dur');
  var chip = document.getElementById('gate-chip'), out = document.getElementById('gate-verdict');
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function check() {
    var problems = [];
    var raw = t.value.trim(), origin = null;
    try { var u = new URL(raw); origin = u.protocol + '//' + u.host; if (u.protocol !== 'https:') problems.push('target must be an https:// origin'); else if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.indexOf(':') >= 0 || u.hostname.charAt(0) === '[') problems.push('IP addresses are refused as targets'); else if (ALLOW.indexOf(origin) < 0) problems.push('target origin ' + origin + ' is not in the Target_Allowlist'); }
    catch (e) { problems.push('target is not a valid URL'); }
    var vus = parseInt(v.value, 10), dur = parseInt(d.value, 10);
    if (!(vus >= 1)) problems.push('peak virtual users must be at least 1');
    else if (vus > 500) problems.push('peak virtual users ' + fmt(vus) + ' is above the limit of 500');
    if (!(dur >= 30)) problems.push('total duration must be at least 30 seconds');
    else if (dur > 600) problems.push('total duration ' + fmt(dur) + ' s is above the limit of 600 s');
    out.innerHTML = '';
    if (problems.length === 0) {
      chip.textContent = 'Accepted'; chip.className = 'chip chip--ok';
      out.className = 'gate__verdict gate__verdict--ok';
      var s = document.createElement('strong'); s.textContent = 'Ready for your approval.'; out.appendChild(s);
      out.appendChild(document.createTextNode(' Nothing has run yet.'));
    } else {
      chip.textContent = 'Rejected'; chip.className = 'chip chip--bad';
      out.className = 'gate__verdict gate__verdict--bad';
      var s2 = document.createElement('strong'); s2.textContent = 'Rejected by the policy gate. 0 requests were sent.'; out.appendChild(s2);
      var ul = document.createElement('ul');
      problems.forEach(function (p) { var li = document.createElement('li'); li.textContent = p; ul.appendChild(li); });
      out.appendChild(ul);
    }
  }
  [t, v, d].forEach(function (el) { el.addEventListener('input', check); });
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = b.getAttribute('data-preset');
      if (p === 'site') { t.value = 'https://shop.example.com'; v.value = 200; d.value = 240; }
      if (p === 'load') { t.value = 'https://yue.macro.my.id'; v.value = 50000; d.value = 240; }
      if (p === 'ok') { t.value = 'https://yue.macro.my.id'; v.value = 200; d.value = 240; }
      check();
    });
  });
  document.querySelector('.gate').addEventListener('submit', function (e) { e.preventDefault(); });
  check();

  /* ---- Showcase switch ---- */
  var sw = document.getElementById('sw'), sec = document.getElementById('showcase');
  sw.addEventListener('click', function () {
    var on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    sec.classList.toggle('is-on', on);
    document.getElementById('sw-word').textContent = on ? 'approved' : 'draft';
    document.getElementById('sw-value').textContent = on ? 'Plan f1913cb7, hash locked' : 'Plan f1913cb7, still a draft';
  });

  /* ---- How it works slider ---- */
  var STEPS = [
    { name: 'Describe', h: 'First, describe the traffic', p: 'Write what you expect in plain words: who arrives, when, and what they do. The AI planner turns it into a staged k6 plan.', img: '/landing/img/ui-describe.png', w: 1016, hgt: 600, alt: "Macro's planner: a text box for describing the expected traffic, three example prompts and the demo target." },
    { name: 'Check', h: 'Then the gate checks it', p: 'Fixed code checks the target, the routes, the users and the duration. A rejected plan has no approve button, and nothing is sent.', img: '/landing/img/ui-gate.png', w: 1016, hgt: 840, alt: 'A plan aimed at another website, rejected by the policy gate with rule 4.2 on the target field and 0 requests sent.' },
    { name: 'Run', h: 'Each stage runs sandboxed', p: 'Stages of 25, 50, 100 and 200 users run in fresh gVisor sandboxes. After each one, the supervisor decides whether to go on.', img: '/landing/img/ui-run.png', w: 1018, hgt: 720, alt: 'A running test: stage 1 of 4 at 25 users, with stages 2 to 4 pending and a Stop run button.' },
    { name: 'Report', h: 'Finally, read the report', p: 'Safe capacity, breaking point and the first route to slow down, all from measured numbers. The AI explanation sits in its own section.', img: '/landing/img/ui-report.png', w: 1040, hgt: 890, alt: 'The capacity report: safe capacity 200 users, breaking point not reached, first degraded route store_home, and a p95 chart.' }
  ];
  var how = document.getElementById('how'), range = document.getElementById('how-range');
  var hTitle = document.getElementById('how-title'), hText = document.getElementById('how-text'), hImg = document.getElementById('how-img');
  var stops = document.querySelectorAll('.how__stops li'), cur = 0, timer = null;
  STEPS.forEach(function (s) { var i = new Image(); i.src = s.img; });
  function setStep(i) {
    i = Math.max(0, Math.min(3, i));
    range.value = i; document.getElementById('how-fill').style.setProperty('--fill', (i / 3 * 100) + '%');
    range.setAttribute('aria-valuetext', STEPS[i].name);
    stops.forEach(function (li, k) { li.classList.toggle('is-current', k === i); });
    if (i === cur) return; cur = i;
    var apply = function () { var s = STEPS[i]; hTitle.textContent = s.h; hText.textContent = s.p; hImg.src = s.img; hImg.width = s.w; hImg.height = s.hgt; hImg.alt = s.alt; how.classList.remove('is-swapping'); };
    if (reduce) { apply(); return; }
    how.classList.add('is-swapping'); clearTimeout(timer); timer = setTimeout(apply, 200);
  }
  range.addEventListener('input', function () { setStep(parseInt(range.value, 10)); });
  document.querySelectorAll('[data-stop]').forEach(function (b) { b.addEventListener('click', function () { setStep(parseInt(b.getAttribute('data-stop'), 10)); range.focus(); }); });
  setStep(0);

  /* ---- Bars: p95 per route, run d28cacd6 ---- */
  var DATA = [
    ['store_home', 1, 25, 575], ['catalog_list', 1, 25, 77], ['product_detail', 1, 25, 81],
    ['store_home', 2, 50, 292], ['catalog_list', 2, 50, 128], ['product_detail', 2, 50, 43],
    ['store_home', 3, 100, 910], ['catalog_list', 3, 100, 226], ['product_detail', 3, 100, 138],
    ['store_home', 4, 200, 1611], ['catalog_list', 4, 200, 618], ['product_detail', 4, 200, 794]
  ];
  var bars = document.getElementById('bars'), note = document.getElementById('bar-note'), defaultNote = note.textContent;
  var phone = window.matchMedia('(max-width: 48rem)').matches;
  var order = phone ? [9, 6, 11, 10, 0, 3, 7, 8] : DATA.map(function (_, i) { return i; });
  order.forEach(function (idx, pos) {
    var r = DATA[idx], b = document.createElement('button');
    b.type = 'button'; b.className = 'bar' + (idx === 9 ? ' bar--accent' : '');
    b.style.setProperty('--v', r[3]); b.style.setProperty('--i', pos);
    var label = r[0] + ', stage ' + r[1] + ' at ' + r[2] + ' users: p95 ' + fmt(r[3]) + ' ms';
    b.setAttribute('aria-label', label);
    if (idx === 9 || idx === 6 || idx === 11) { var s = document.createElement('span'); s.className = 'bar__val'; s.textContent = fmt(r[3]); b.appendChild(s); }
    var show = function () { note.textContent = label.charAt(0).toUpperCase() === label.charAt(0) ? label : label; };
    b.addEventListener('mouseenter', show); b.addEventListener('focus', show);
    b.addEventListener('mouseleave', function () { note.textContent = defaultNote; }); b.addEventListener('blur', function () { note.textContent = defaultNote; });
    bars.appendChild(b);
  });

  /* ---- CTA form: preview only ---- */
  document.getElementById('cta-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var em = document.getElementById('cta-email');
    document.getElementById('cta-note').textContent = em.checkValidity() && em.value
      ? 'Thanks. This preview is not connected yet, so nothing was sent.'
      : 'Enter an email address first.';
  });

  /* ---- Reveals ---- */
  var targets = document.querySelectorAll('[data-reveal], #bridge-figure, #stage, #bars');
  if (!('IntersectionObserver' in window) || reduce) { targets.forEach(function (el) { el.classList.add('in'); }); document.getElementById('bridge-frame').classList.add('in'); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      /* the shutter frame starts fully clipped, so the observer watches its figure */
      if (en.target.id === 'bridge-figure') document.getElementById('bridge-frame').classList.add('in');
      en.target.classList.add('in'); io.unobserve(en.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  targets.forEach(function (el) { io.observe(el); });

  /* one moving picture: the bridge photo drifts slowly with scroll */
  var frame = document.getElementById('bridge-frame');
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      var r = frame.getBoundingClientRect(), vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, 1 - (r.bottom / (vh + r.height))));
      frame.style.setProperty('--drift', (1 + p * 0.06).toFixed(4));
      ticking = false;
    });
  }, { passive: true });
})();
