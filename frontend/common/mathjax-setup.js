// Shared MathJax helpers for all pages.
// Provides a drop-in replacement for KaTeX's renderMathInElement that queues
// requests until MathJax is ready.
(function () {
  const pending = [];

  function typeset(el) {
    if (!el) return Promise.resolve();
    const run = () => {
      try {
        return (window.MathJax && MathJax.typesetPromise)
          ? MathJax.typesetPromise([el])
          : Promise.resolve();
      } catch {
        return Promise.resolve();
      }
    };
    if (window.MathJax && MathJax.typesetPromise) {
      return run().catch(() => {});
    }
    return new Promise((resolve) => {
      pending.push(() => run().then(resolve).catch(() => resolve()));
    });
  }

  window.renderMathInElement = (el, _opts) => typeset(el);

  window.__qbaseMathFlush = () => {
    if (!window.MathJax || !MathJax.typesetPromise) return;
    while (pending.length) {
      const fn = pending.shift();
      try {
        fn();
      } catch {}
    }
  };
})();
