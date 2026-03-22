// Loader control: hide overlay at First Contentful Paint or when images finish loading
(function(){
  var loader = document.getElementById('page-loader');
  if (!loader) return;
  var fallbackTimeout = null;

  function hideLoader(){
    if (!loader) return;
    document.body.style.overflow = '';
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
    loader.addEventListener('transitionend', function(){
      try{ loader.remove(); } catch(e){}
    });
    if (fallbackTimeout){ clearTimeout(fallbackTimeout); fallbackTimeout = null; }
  }

  function checkImagesThenHide(){
    var imgs = Array.from(document.images || []);
    if (imgs.length === 0) return hideLoader();
    var unfinished = imgs.filter(function(img){ return !img.complete; });
    if (unfinished.length === 0) return hideLoader();

    var remaining = unfinished.length;
    function oneDone(){ remaining--; if (remaining <= 0) hideLoader(); }
    unfinished.forEach(function(img){
      img.addEventListener('load', oneDone, {once:true});
      img.addEventListener('error', oneDone, {once:true});
    });
  }

  // Safety: hide after 5s even if something hangs
  fallbackTimeout = setTimeout(hideLoader, 5000);

  // Hide on First Contentful Paint if supported
  if ('PerformanceObserver' in window) {
    try {
      var obs = new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          if (entry.name === 'first-contentful-paint') {
            hideLoader();
            try { obs.disconnect(); } catch(e) {}
          }
        });
      });
      obs.observe({ type: 'paint', buffered: true });
    } catch (e) {
      // ignore
    }
  }

  if (document.readyState === 'complete') {
    checkImagesThenHide();
  } else {
    window.addEventListener('load', checkImagesThenHide);
  }
})();
