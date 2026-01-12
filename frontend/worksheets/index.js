// Thin proxy to load the existing script during the transition.
(function(){
  try {
    var s = document.createElement('script');
    s.src = './worksheets/worksheet_index.js';
    s.defer = true;
    document.head.appendChild(s);
  } catch (e) { console && console.error && console.error(e); }
})();
