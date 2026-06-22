/* ===========================================================
   Absurdly Rational — interactions
   1. Intro: the rooster drops, rings burst, content + nav settle in.
   2. Scroll: nav collapses to a pill, hero rings contract, field parallax.
   =========================================================== */
(function () {
  'use strict';

  // Mark that JS is active so the CSS can hide intro pieces until we reveal them.
  document.documentElement.classList.add('js');

  var $ = function (id) { return document.getElementById(id); };

  var rooster = $('rooster'),
      rings   = $('rings'),
      wave    = $('wave'),
      wave2   = $('wave2'),
      glow    = $('glow'),
      field   = $('field'),
      nav     = $('nav');

  var content = ['badge', 'title', 'lead', 'cta'].map($).filter(Boolean);

  var timers = [];
  var at = function (ms, fn) { timers.push(setTimeout(fn, ms)); };
  var introDone = false;

  var reduce = window.matchMedia &&
               window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Scroll handling ---------- */
  function onScroll() {
    var pilled = window.scrollY > window.innerHeight * 0.72;
    nav.classList.toggle('is-pilled', pilled);

    // Hero rings contract toward the centre as the hero scrolls away.
    if (introDone && rings) {
      var p = Math.min(window.scrollY / window.innerHeight, 1);
      var eased = p * p;                 // stay full early, then collapse
      var scale = 1 - eased * 0.78;
      rings.style.transform = 'translate(-50%,-50%) scale(' + scale + ')';
      rings.style.opacity = String(1 - eased * 0.85);
    }

    // Ambient field parallax-scrolls at half speed for a seamless colour flow.
    if (field) {
      field.style.transform =
        'translate3d(0,' + (-window.scrollY * 0.5).toFixed(1) + 'px,0)';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Intro animation ---------- */
  function runIntro() {
    // Reduced motion or missing nodes: leave the resting state visible.
    if (reduce || !rooster) {
      if (rings) {
        rings.style.transition =
          'transform 0.35s cubic-bezier(0.25,1,0.5,1), opacity 0.35s ease';
      }
      content.forEach(function (c) { c.style.opacity = '1'; c.style.transform = 'none'; });
      introDone = true;
      onScroll();
      return;
    }

    // Measure the drop distance from the rooster's resting spot to the ring centre.
    var y = 0, el = rooster;
    while (el) { y += el.offsetTop; el = el.offsetParent; }
    var restCenter = y + rooster.offsetHeight / 2 - window.scrollY;
    var dyImpact = window.innerHeight * 0.46 - restCenter;
    var startY = -(restCenter + 200);

    // t0 — preposition everything (synchronous, before first paint → no flash).
    rooster.style.transition = 'none';
    rooster.style.transform = 'translateY(' + startY + 'px) scale(0.82)';
    rooster.style.opacity = '0';
    if (rings) { rings.style.transition = 'none'; rings.style.transform = 'translate(-50%,-50%) scale(0.32)'; rings.style.opacity = '0'; }
    if (wave)  { wave.style.transition  = 'none'; wave.style.transform  = 'translate(-50%,-50%) scale(0.1)'; wave.style.opacity  = '0'; }
    if (wave2) { wave2.style.transition = 'none'; wave2.style.transform = 'translate(-50%,-50%) scale(0.1)'; wave2.style.opacity = '0'; }
    if (glow)  { glow.style.transition  = 'none'; glow.style.transformOrigin = '50% 46%'; glow.style.transform = 'scale(0.55)'; glow.style.opacity = '0'; }
    content.forEach(function (c) { c.style.transition = 'none'; c.style.transform = 'translateY(-30px)'; c.style.opacity = '0'; });
    if (nav) { nav.style.transition = 'none'; nav.style.transform = 'translateY(-130%)'; nav.style.opacity = '0'; }
    void rooster.offsetWidth; // commit the start frame

    // DROP — accelerate down onto the ring centre.
    at(30, function () {
      rooster.style.transition = 'transform 0.62s cubic-bezier(0.5,0,0.9,0.42), opacity 0.28s ease';
      rooster.style.transform = 'translateY(' + dyImpact + 'px) scale(1.05)';
      rooster.style.opacity = '1';
    });

    // IMPACT — rings burst outward, a shockwave ring expands and fades.
    at(660, function () {
      if (rings) {
        rings.style.transition = 'transform 2.1s cubic-bezier(0.12,1.06,0.3,1), opacity 0.85s ease';
        rings.style.transform = 'translate(-50%,-50%) scale(1)';
        rings.style.opacity = '1';
      }
      if (wave) {
        wave.style.transition = 'none';
        wave.style.transform = 'translate(-50%,-50%) scale(0.12)';
        wave.style.opacity = '0.78';
      }
      rooster.style.transition = 'transform 0.16s ease-out';
      rooster.style.transform = 'translateY(' + (dyImpact + 8) + 'px) scale(0.95)';
      if (glow) {
        glow.style.transition = 'transform 1.5s cubic-bezier(0.14,0.9,0.28,1), opacity 0.9s ease-out';
        glow.style.transform = 'scale(1.12)';
        glow.style.opacity = '1';
      }
    });
    at(1180, function () {
      if (glow) {
        glow.style.transition = 'transform 1.6s cubic-bezier(0.22,1,0.36,1), opacity 0.9s ease';
        glow.style.transform = 'scale(1)';
      }
    });
    at(692, function () {
      if (wave) {
        wave.style.transition = 'transform 1.85s cubic-bezier(0.16,0.66,0.28,1), opacity 1.85s ease-out';
        wave.style.transform = 'translate(-50%,-50%) scale(1.62)';
        wave.style.opacity = '0';
      }
    });
    // Second, softer ripple for a lingering aftershock.
    at(900, function () {
      if (wave2) {
        wave2.style.transition = 'none';
        wave2.style.transform = 'translate(-50%,-50%) scale(0.18)';
        wave2.style.opacity = '0.4';
      }
    });
    at(940, function () {
      if (wave2) {
        wave2.style.transition = 'transform 1.8s cubic-bezier(0.16,0.66,0.28,1), opacity 1.8s ease-out';
        wave2.style.transform = 'translate(-50%,-50%) scale(1.45)';
        wave2.style.opacity = '0';
      }
    });

    // SETTLE — rooster rises home; content eases in from above (staggered).
    at(1080, function () {
      rooster.style.transition = 'transform 0.98s cubic-bezier(0.22,1,0.36,1)';
      rooster.style.transform = 'translateY(0) scale(1)';
    });
    content.forEach(function (c, i) {
      at(1150 + i * 190, function () {
        c.style.transition = 'opacity 0.7s ease, transform 0.8s cubic-bezier(0.22,1,0.36,1)';
        c.style.transform = 'translateY(0)';
        c.style.opacity = '1';
      });
    });
    // The bar drops down from above in sync with the first line of content.
    at(1150, function () {
      if (nav) {
        nav.style.transition = 'transform 0.95s cubic-bezier(0.34,1.32,0.5,1), opacity 0.6s ease';
        nav.style.transform = 'translateY(0)';
        nav.style.opacity = '1';
      }
    });

    // CLEANUP — force the resting state and drop the inline transforms so hover
    // and the scroll-driven pill behave normally afterwards.
    at(3150, function () {
      var clear = function (e, extra) {
        if (!e) return;
        e.style.transition = 'none';
        e.style.transform = extra || '';
        e.style.opacity = (e === wave || e === wave2) ? '0' : '1';
      };
      clear(rooster, '');
      clear(rings, 'translate(-50%,-50%)');
      clear(wave, 'translate(-50%,-50%) scale(1.62)');
      clear(wave2, 'translate(-50%,-50%) scale(1.45)');
      if (glow) { glow.style.transition = 'none'; glow.style.transform = 'scale(1)'; glow.style.opacity = '1'; }
      content.forEach(function (c) { clear(c, ''); });
      if (nav) {
        nav.style.transition = '';   // hand back to the CSS pill transition
        nav.style.transform = '';
        nav.style.opacity = '1';
      }
      if (rings) {
        rings.style.transition = 'transform 0.35s cubic-bezier(0.25,1,0.5,1), opacity 0.35s ease';
      }
      introDone = true;
      onScroll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runIntro);
  } else {
    runIntro();
  }
})();
