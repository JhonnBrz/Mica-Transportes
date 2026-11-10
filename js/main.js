(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}) => {
    const n = document.createElementNS(SVG, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ════════════════════════════════════════════════════════
     Liquid glass
     ════════════════════════════════════════════════════════ */
  const ua = navigator.userAgent;
  const canRefract = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua)
    && !matchMedia('(prefers-reduced-transparency: reduce)').matches;

  const defs = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(defs);
  let glassId = 0;

  // Mapa de deslocamento de uma lente em retângulo arredondado:
  // as bordas puxam a imagem de trás em direção ao centro, como vidro espesso.
  function lensMap(w, h, radius, bezel) {
    const k = w * h > 120000 ? .5 : 1;
    const cw = Math.max(2, Math.round(w * k)), ch = Math.max(2, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const d = img.data;
    const hx = w / 2, hy = h / 2;
    const r = Math.min(radius, hx, hy);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const px = (x + .5) / k - hx, py = (y + .5) / k - hy;
        const ax = Math.abs(px), ay = Math.abs(py);
        const qx = ax - (hx - r), qy = ay - (hy - r);
        let dist, nx = 0, ny = 0;
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1;
          dist = r - l; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py);
        } else if (qx > qy) { dist = hx - ax; nx = Math.sign(px); }
        else { dist = hy - ay; ny = Math.sign(py); }
        const t = dist < 0 ? 0 : clamp(1 - dist / bezel);
        const m = t * t * (3 - 2 * t) * t;
        const i = (y * cw + x) * 4;
        d[i] = 128 - nx * m * 127;
        d[i + 1] = 128 - ny * m * 127;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  const glasses = new Set();
  let glassRaf = 0, glassLast = 0;

  class Glass {
    constructor(node) {
      this.el = node;
      this.soft = node.dataset.lg === 'soft' || node.dataset.lg === 'static';
      this.fixed = node.dataset.lg === 'static';
      this.fx = document.createElement('span'); this.fx.className = 'lg-fx';
      this.shine = document.createElement('span'); this.shine.className = 'lg-shine';
      node.prepend(this.fx, this.shine);
      // molas: posição do ponteiro (x, y), hover (h) e pressão (p)
      this.s = { x: 0, y: 0, h: 0, p: 0 };
      this.v = { x: 0, y: 0, h: 0, p: 0 };
      this.t = { x: 0, y: 0, h: 0, p: 0 };
      this.rect = null; this.disp = null; this.baseScale = 0; this.w = 0; this.h = 0;

      if (canRefract) {
        new ResizeObserver(() => this.refract()).observe(node);
      }
      if (this.fixed) return;
      const on = (type, fn) => node.addEventListener(type, fn, { passive: true });
      on('pointerenter', e => { this.rect = node.getBoundingClientRect(); this.point(e); this.t.h = 1; this.wake(); });
      on('pointermove', e => { if (!this.rect) this.rect = node.getBoundingClientRect(); this.point(e); this.wake(); });
      on('pointerdown', e => { this.rect = node.getBoundingClientRect(); this.point(e); this.t.h = 1; this.t.p = 1; this.wake(); });
      const release = e => {
        this.t.p = 0;
        if (e.pointerType !== 'mouse') setTimeout(() => this.leave(), 160);
        this.wake();
      };
      on('pointerup', release);
      on('pointercancel', release);
      on('pointerleave', () => this.leave());
    }
    point(e) {
      const r = this.rect;
      this.t.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
      this.t.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.2, 1.2);
    }
    leave() { this.t.h = 0; this.t.p = 0; this.t.x = 0; this.t.y = 0; this.rect = null; this.wake(); }
    wake() {
      glasses.add(this);
      if (!glassRaf) { glassLast = performance.now(); glassRaf = requestAnimationFrame(glassTick); }
    }
    refract() {
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      if (!w || !h || (Math.abs(w - this.w) < 2 && Math.abs(h - this.h) < 2)) return;
      this.w = w; this.h = h;
      const radius = parseFloat(getComputedStyle(this.el).borderTopLeftRadius) || 0;
      const bezel = Math.min(h * .5, w * .5, this.soft ? 22 : 26);
      this.baseScale = bezel * (this.soft ? 1.5 : 1.9);
      const id = this.id || (this.id = 'lg-' + (++glassId));
      let f = this.filter;
      if (!f) {
        f = this.filter = el('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
        this.image = el('feImage', { preserveAspectRatio: 'none', result: 'map' });
        this.disp = el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' });
        const blur = el('feGaussianBlur', { in: 'bent', stdDeviation: this.soft ? 9 : 2.4 });
        f.append(this.image, this.disp, blur);
        defs.appendChild(f);
      }
      for (const n of [f, this.image]) { n.setAttribute('x', 0); n.setAttribute('y', 0); n.setAttribute('width', w); n.setAttribute('height', h); }
      this.image.setAttribute('href', lensMap(w, h, radius, bezel));
      this.disp.setAttribute('scale', this.baseScale);
      const css = `url(#${id}) saturate(175%) brightness(1.06)`;
      this.fx.style.backdropFilter = css;
    }
    step(dt) {
      // molas sem sobressalto: o vidro não se move nem estica, só a luz e a bolha interna respondem
      const spring = (key, k, c) => {
        const a = -k * (this.s[key] - this.t[key]) - c * this.v[key];
        this.v[key] += a * dt; this.s[key] += this.v[key] * dt;
      };
      spring('x', 150, 24); spring('y', 150, 24); spring('h', 190, 27); spring('p', 260, 26);
      const { x, y, h, p } = this.s;
      const st = this.el.style;
      st.setProperty('--lx', (50 + x * 50).toFixed(2) + '%');
      st.setProperty('--ly', (50 + y * 50).toFixed(2) + '%');
      st.setProperty('--h', clamp(h, 0, 1).toFixed(3));
      st.setProperty('--p', clamp(p, 0, 1).toFixed(3));
      st.setProperty('--ang', (160 + x * 40 * h).toFixed(1) + 'deg');
      // resposta sutil: o vidro é puxado de leve na direção do ponteiro
      const pull = this.soft ? 1 : 1;
      st.setProperty('--tx', (x * h * 3.2 * pull).toFixed(2) + 'px');
      st.setProperty('--ty', (y * h * 2.2 * pull).toFixed(2) + 'px');

      if (this.disp) this.disp.setAttribute('scale', (this.baseScale * (1 + .2 * h)).toFixed(2));
      let rest = true;
      for (const key in this.s) if (Math.abs(this.s[key] - this.t[key]) > .002 || Math.abs(this.v[key]) > .01) rest = false;
      return rest;
    }
  }
  function glassTick(now) {
    const dt = Math.min(.05, (now - glassLast) / 1000) || .016;
    glassLast = now;
    for (const g of glasses) if (g.step(dt)) glasses.delete(g);
    glassRaf = glasses.size ? requestAnimationFrame(glassTick) : 0;
  }
  $$('.lg').forEach(n => new Glass(n));

  /* ════════════════════════════════════════════════════════
     Hero: o vídeo roda em loop, sem ligação com o scroll.
     O scroll só troca os textos e revela os atalhos de vidro.
     ════════════════════════════════════════════════════════ */
  const hero = $('.hero'), pin = $('.hero-pin'), video = $('.hero-video'), videoToggle = $('.hero-toggle');
  const callouts = $$('.callout');
  function renderHero() {
    const span = hero.offsetHeight - pin.offsetHeight;
    const p = span > 0 ? clamp(-hero.getBoundingClientRect().top / span) : 0;
    const st = pin.style;
    if (RM) {
      st.setProperty('--next', 0); st.setProperty('--copy', 1);
      callouts.forEach(c => c.classList.add('on'));
      return;
    }
    st.setProperty('--copy', (1 - smooth(.06, .34, p)).toFixed(3));
    st.setProperty('--next', smooth(.4, .6, p).toFixed(3));
    st.setProperty('--dim', smooth(.3, .6, p).toFixed(3));
    st.setProperty('--end', smooth(.9, 1, p).toFixed(3));
    callouts.forEach((c, i) => c.classList.toggle('on', p >= .5 + i * .06));
  }
  const setPlaying = on => {
    videoToggle.setAttribute('aria-pressed', String(!on));
    videoToggle.setAttribute('aria-label', on ? 'Pausar vídeo' : 'Reproduzir vídeo');
  };
  videoToggle.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  video.addEventListener('play', () => setPlaying(true));
  video.addEventListener('pause', () => setPlaying(false));
  if (RM) { video.removeAttribute('autoplay'); video.pause(); setPlaying(false); }
  // pausa o vídeo fora da tela para poupar bateria
  let userPaused = false;
  videoToggle.addEventListener('click', () => { userPaused = !video.paused ? false : true; });
  new IntersectionObserver(([e]) => {
    if (RM || userPaused) return;
    if (e.isIntersecting) video.play().catch(() => {}); else video.pause();
  }).observe(pin);

  /* ════════════════════════════════════════════════════════
     Seções guiadas pelo scroll
     ════════════════════════════════════════════════════════ */
  // manifesto: palavras acendem conforme a leitura avança
  const manifesto = $('[data-words]');
  const words = manifesto.textContent.trim().split(/\s+/).map(w => {
    const s = document.createElement('span'); s.className = 'w'; s.textContent = w; return s;
  });
  manifesto.textContent = '';
  words.forEach((w, i) => { manifesto.append(w, i < words.length - 1 ? ' ' : ''); });
  function renderWords() {
    const r = manifesto.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) return;
    const q = clamp((innerHeight * .82 - r.top) / (r.height + innerHeight * .32));
    const head = q * (words.length + 4);
    words.forEach((w, i) => { w.style.opacity = RM ? 1 : (.16 + .84 * clamp(head - i)).toFixed(2); });
  }

  // serviços: scroll vertical vira deslocamento horizontal
  const services = $('.services'), servicesPin = $('.services-pin'), track = $('.services-track');
  const cards = $$('.svc').map(n => ({ n, fig: $('figure', n) }));
  const bar = $('.services-bar i'), count = $('.services-count b');
  let shiftMax = 0, scrollLen = 0;
  function layoutServices() {
    shiftMax = Math.max(0, track.scrollWidth - innerWidth);
    scrollLen = shiftMax * .6;
    services.style.height = (servicesPin.offsetHeight + scrollLen) + 'px';
  }
  function renderServices() {
    const r = services.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const q = scrollLen ? clamp(-r.top / scrollLen) : 0;
    track.style.transform = `translate3d(${(-q * shiftMax).toFixed(1)}px,0,0)`;
    bar.style.transform = `scaleX(${q.toFixed(3)})`;
    count.textContent = '0' + (Math.round(q * (cards.length - 1)) + 1);
    cards.forEach(c => {
      const cr = c.n.getBoundingClientRect();
      const off = (cr.left + cr.width / 2 - innerWidth / 2) / innerWidth;
      c.fig.style.transform = `translate3d(${(off * -52).toFixed(1)}px,0,0)`;
    });
  }

  // tecnologia: a rota se desenha e o caminhão passa pelas paradas
  const route = $('.route'), routeSvg = $('.route-svg'), routeBase = $('.route-base'), routeLive = $('.route-live');
  const routeTruck = $('.route-truck'), stops = $$('.route-stop');
  let routeLen = 0, stopY = [];
  function layoutRoute() {
    const h = route.offsetHeight, w = routeSvg.clientWidth || 64;
    routeSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    stopY = stops.map(s => s.offsetTop + parseFloat(getComputedStyle(s).paddingTop) + 10);
    let px = w / 2, py = 0, d = `M${px} 0`;
    const to = (x, y) => { const m = (py + y) / 2; d += `C${px} ${m} ${x} ${m} ${x} ${y}`; px = x; py = y; };
    stopY.forEach((y, i) => to(w / 2 + (i % 2 ? 1 : -1) * w * .26, y));
    to(w / 2, h);
    routeBase.setAttribute('d', d); routeLive.setAttribute('d', d);
    routeLen = routeLive.getTotalLength();
    routeLive.style.strokeDasharray = routeLen;
  }
  function renderRoute() {
    const r = route.getBoundingClientRect();
    if (r.bottom < -100 || r.top > innerHeight + 100) return;
    const q = clamp((innerHeight * .62 - r.top) / r.height);
    const L = routeLen * q;
    routeLive.style.strokeDashoffset = routeLen - L;
    const pt = routeLive.getPointAtLength(L);
    routeTruck.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
    stops.forEach((s, i) => s.classList.toggle('on', pt.y >= stopY[i] - 4));
  }

  // compromissos: anel de 70%
  const ringBox = $('.commit-figure'), ring = $('.ring-live'), ringNum = $('.ring-num b');
  function renderRing() {
    const r = ringBox.getBoundingClientRect();
    if (r.bottom < -100 || r.top > innerHeight + 100) return;
    const q = RM ? 1 : easeOut(clamp((innerHeight * .92 - r.top) / (innerHeight * .55)));
    ring.style.strokeDashoffset = 100 - 70 * q;
    ringNum.textContent = Math.round(70 * q);
  }

  // contato: o sol nasce
  const contact = $('.contact'), contactSun = $('.contact-sun');
  function renderContact() {
    const r = contact.getBoundingClientRect();
    if (r.top > innerHeight) return;
    contactSun.style.setProperty('--rise', clamp((innerHeight - r.top) / r.height).toFixed(3));
  }

  // menu: uma bolha de vidro desliza sob a palavra em foco, como os círculos da Apple
  const linksBox = $('.nav-links'), bubble = $('.nav-bubble');
  if (linksBox && bubble && matchMedia('(hover: hover)').matches) {
    const links = $$('a', linksBox);
    let shown = false;
    const place = (a, instant) => {
      if (instant) bubble.style.transition = 'none';
      bubble.style.setProperty('--bx', a.offsetLeft + 'px');
      bubble.style.setProperty('--bw', a.offsetWidth + 'px');
      if (instant) { void bubble.offsetWidth; bubble.style.transition = ''; }
    };
    const show = a => {
      if (!shown) { place(a, true); shown = true; } else place(a, false);
      bubble.classList.add('on');
    };
    links.forEach(a => {
      a.addEventListener('pointerenter', () => show(a));
      a.addEventListener('pointermove', e => {
        const r = a.getBoundingClientRect();
        bubble.style.setProperty('--sx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
      });
      a.addEventListener('pointerdown', () => bubble.classList.add('press'));
      a.addEventListener('focus', () => { if (a.matches(':focus-visible')) show(a); });
    });
    addEventListener('pointerup', () => bubble.classList.remove('press'));
    linksBox.addEventListener('pointerleave', () => { shown = false; bubble.classList.remove('on', 'press'); });
    linksBox.addEventListener('focusout', () => { if (!linksBox.matches(':hover')) { shown = false; bubble.classList.remove('on'); } });
    addEventListener('resize', () => bubble.classList.remove('on'));
  }

  // navegação
  const nav = $('#nav'), navLinks = $$('.nav-links a');
  const sections = navLinks.map(a => $(a.getAttribute('href')));
  function renderNav() {
    const y = scrollY;
    nav.classList.toggle('scrolled', y > hero.offsetHeight - innerHeight * 1.05);
    document.body.classList.toggle('past-hero', y > hero.offsetHeight - innerHeight * 1.05);
    document.body.classList.toggle('at-contact', contact.getBoundingClientRect().top < innerHeight * .55);
    let cur = -1;
    sections.forEach((s, i) => { if (s.getBoundingClientRect().top < innerHeight * .45) cur = i; });
    navLinks.forEach((a, i) => a.classList.toggle('current', i === cur));
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      renderHero(); renderWords(); renderServices(); renderRoute(); renderRing(); renderContact(); renderNav();
    });
  }
  function onResize() {
    layoutServices(); layoutRoute(); onScroll();
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  addEventListener('load', onResize);
  onResize();
  renderHero();

  /* ════════════════════════════════════════════════════════
     Entradas, contadores e menu
     ════════════════════════════════════════════════════════ */
  const reveal = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -12% 0px' });
  $$('[data-reveal]').forEach(n => reveal.observe(n));

  const fmt = (v, dec) => v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const counters = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      counters.unobserve(e.target);
      const n = e.target, end = +n.dataset.count, dec = +(n.dataset.decimals || 0);
      if (RM) return;
      const t0 = performance.now(), dur = 1700;
      const tick = now => {
        const t = clamp((now - t0) / dur);
        n.textContent = fmt(end * (1 - Math.pow(1 - t, 4)), dec);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: .6 });
  $$('[data-count]').forEach(n => counters.observe(n));

  const toggle = $('.nav-toggle'), sheet = $('#menu');
  const setMenu = open => {
    sheet.hidden = !open;
    toggle.setAttribute('aria-expanded', open);
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  };
  toggle.addEventListener('click', () => setMenu(sheet.hidden));
  sheet.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) { setMenu(false); toggle.focus(); } });

})();
