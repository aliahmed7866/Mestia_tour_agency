/* Local images only; no trackers or external carousel dependency. */
(() => {
  'use strict';
  document.querySelectorAll('[data-destination-showcase]').forEach((carousel) => {
    const slides = Array.from(carousel.querySelectorAll('[data-destination-slide]'));
    const controls = carousel.querySelector('[data-slideshow-controls]');
    if (slides.length < 2 || !controls) return;

    const dots = Array.from(carousel.querySelectorAll('[data-slide-to]'));
    const play = carousel.querySelector('[data-slide-play]');
    const counter = carousel.querySelector('[data-slide-current]');
    const announcement = carousel.querySelector('[data-slide-announcement]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0;
    let manuallyPaused = reducedMotion.matches;
    let hovered = false;
    let focused = false;
    let timer = null;
    let transitionTimer = null;
    let animationFrame = null;

    const isRunning = () => !manuallyPaused && !hovered && !focused && !document.hidden;

    function updatePlayback() {
      window.clearTimeout(timer);
      const running = isRunning();
      carousel.classList.toggle('is-running', running);
      carousel.classList.toggle('is-paused', manuallyPaused);
      const label = manuallyPaused ? carousel.dataset.labelPlay : carousel.dataset.labelPause;
      play.setAttribute('aria-label', label);
      play.querySelector('[data-play-label]').textContent = label;
      if (running) timer = window.setTimeout(() => show(index + 1, false), 7000);
    }

    function show(nextIndex, manual) {
      if (manual) manuallyPaused = true;
      const next = (nextIndex + slides.length) % slides.length;
      window.clearTimeout(transitionTimer);
      window.cancelAnimationFrame(animationFrame);
      const previous = slides[index];
      slides.forEach((slide, position) => {
        if (position !== index) slide.hidden = true;
        slide.classList.remove('is-active');
        slide.setAttribute('aria-hidden', 'true');
        slide.setAttribute('inert', '');
      });
      index = next;
      const current = slides[index];
      current.hidden = false;
      current.setAttribute('aria-hidden', 'false');
      current.removeAttribute('inert');
      // Two frames allow the entering slide to crossfade from its initial opacity.
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => current.classList.add('is-active'));
      });
      transitionTimer = window.setTimeout(() => {
        if (previous !== current) previous.hidden = true;
      }, reducedMotion.matches ? 0 : 800);
      counter.textContent = String(index + 1).padStart(2, '0');
      dots.forEach((dot, position) => {
        dot.classList.toggle('is-current', position === index);
        dot.setAttribute('aria-current', String(position === index));
      });
      if (manual) {
        announcement.textContent = `${carousel.dataset.slideLabel} ${index + 1} / ${slides.length}: ${current.querySelector('[data-slide-title]').textContent}`;
      }
      updatePlayback();
    }

    carousel.querySelector('[data-slide-prev]').addEventListener('click', () => show(index - 1, true));
    carousel.querySelector('[data-slide-next]').addEventListener('click', () => show(index + 1, true));
    dots.forEach((dot) => dot.addEventListener('click', () => show(Number(dot.dataset.slideTo), true)));
    play.addEventListener('click', () => {
      manuallyPaused = !manuallyPaused;
      // An explicit Play action overrides the focus/hover that brought the user
      // to this button. A subsequent pointer or focus entry pauses again.
      if (!manuallyPaused) {
        hovered = false;
        focused = false;
      }
      updatePlayback();
    });
    carousel.addEventListener('keydown', (event) => {
      // Only our slideshow controls consume navigation keys, never links or fields.
      if (!controls.contains(event.target)) return;
      const targets = {ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1};
      if (!Object.prototype.hasOwnProperty.call(targets, event.key)) return;
      event.preventDefault();
      show(targets[event.key], true);
    });
    carousel.addEventListener('mouseenter', () => { hovered = true; updatePlayback(); });
    carousel.addEventListener('mouseleave', () => { hovered = false; updatePlayback(); });
    carousel.addEventListener('focusin', () => { focused = true; updatePlayback(); });
    carousel.addEventListener('focusout', (event) => {
      if (event.relatedTarget && carousel.contains(event.relatedTarget)) return;
      focused = false;
      updatePlayback();
    });
    document.addEventListener('visibilitychange', updatePlayback);
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) manuallyPaused = true;
      updatePlayback();
    });
    controls.hidden = false;
    updatePlayback();
  });
})();
