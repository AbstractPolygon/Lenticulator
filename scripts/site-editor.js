// In-page text editor for the website artifact (added by scripts/build-site-artifact.mjs; not part of
// the GitHub Pages site). Must run before #site-script so the snapshot is the page exactly as authored.
(function () {
  // the host's document skeleton, reproduced exactly so a later publish replaces it instead of nesting it
  var PREFIX = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
  var SEL = 'h1, h2, h3, p, li, dt, dd, .dl-file, .docs b, .docs a > span, footer span';
  var page = document.getElementById('page');
  if (!page) return;
  var pick = function (root) {
    return Array.prototype.filter.call(root.querySelectorAll(SEL), function (el) {
      // skip the tilt demo and anything nested in another editable element
      return !el.closest('.tilt') && !(el.parentElement && el.parentElement.closest(SEL));
    });
  };
  var snapshot = page.cloneNode(true); // before #site-script changes classes (tilt view, "Your system")
  var live = pick(page), snap = pick(snapshot);
  if (live.length !== snap.length) return;

  // keep only simple inline formatting and safe links
  var ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, A: 1, CODE: 1, SMALL: 1, BR: 1, SPAN: 1, TIME: 1 };
  function clean(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (c) {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1 || !ALLOWED[c.tagName]) {
        // unwrap unknown elements (keep their text), drop everything else
        if (c.nodeType === 1) { clean(c); while (c.firstChild) node.insertBefore(c.firstChild, c); }
        node.removeChild(c);
        return;
      }
      Array.prototype.slice.call(c.attributes).forEach(function (a) {
        var keep = (c.tagName === 'A' && a.name === 'href' && /^(https?:|#|[\w./-]+$)/i.test(a.value)) ||
          (c.tagName === 'TIME' && a.name === 'datetime') || (a.name === 'class' && /^[\w -]+$/.test(a.value));
        if (!keep) c.removeAttribute(a.name);
      });
      clean(c);
    });
    return node;
  }

  function outer(id) { var el = document.getElementById(id); return el ? el.outerHTML : ''; }

  function buildDocument() {
    live.forEach(function (el, i) {
      var t = document.createElement('div');
      t.innerHTML = el.innerHTML;
      snap[i].innerHTML = clean(t).innerHTML;
    });
    var title = document.querySelector('title');
    var sides = document.querySelector('meta[name="claude:viewport-fit-sides"]');
    return PREFIX + '\n' +
      (title ? title.outerHTML : '') + '\n' +
      (sides ? sides.outerHTML : '') + '\n' +
      outer('site-style') + '\n' + outer('editor-style') + '\n' +
      snapshot.outerHTML + '\n' +
      outer('editor-script') + '\n' + outer('site-script') + '\n' +
      '</body></html>';
  }

  // toolbar
  var bar = document.createElement('div');
  bar.className = 'editbar';
  bar.hidden = true;
  bar.innerHTML = '<button type="button" data-a="edit">Edit text</button>' +
    '<button type="button" data-a="save" hidden>Save</button>' +
    '<button type="button" data-a="cancel" hidden>Cancel</button>' +
    '<span class="editbar-msg" role="status"></span>';
  document.body.appendChild(bar);
  var btn = function (a) { return bar.querySelector('[data-a="' + a + '"]'); };
  var msg = bar.querySelector('.editbar-msg');
  var editing = false, originals = [];

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('editing', on);
    btn('edit').hidden = on; btn('save').hidden = !on; btn('cancel').hidden = !on;
    live.forEach(function (el) {
      if (on) el.setAttribute('contenteditable', 'true'); else el.removeAttribute('contenteditable');
    });
    msg.textContent = '';
  }

  // single-line feel: Enter would create blocks that break the layout; Shift+Enter makes a line break
  page.addEventListener('keydown', function (e) {
    if (!editing || e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) document.execCommand('insertLineBreak');
  });
  page.addEventListener('paste', function (e) {
    if (!editing) return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  page.addEventListener('click', function (e) {
    if (editing && e.target.closest('a')) e.preventDefault();
  }, true);

  btn('edit').addEventListener('click', function () {
    originals = live.map(function (el) { return el.innerHTML; });
    setEditing(true);
    live[0] && live[0].focus();
  });
  btn('cancel').addEventListener('click', function () {
    live.forEach(function (el, i) { el.innerHTML = originals[i]; });
    setEditing(false);
  });

  var host = window.claude;
  if (!host || typeof host.use !== 'function') return;
  host.use('artifact').then(function (artifact) {
    if (!artifact) return;
    bar.hidden = false;
    function failed(err) {
      var code = err && err.code;
      btn('save').disabled = false;
      if (code === 'conflict') { msg.textContent = 'A newer version was published; reloading it.'; return; }
      if (code === 'not_writer' || code === 'not_granted') {
        msg.textContent = 'This view is read-only.';
        btn('edit').hidden = true;
        return;
      }
      msg.textContent = 'Could not save' + (code ? ' (' + code + ')' : '') + ': ' + ((err && err.message) || 'unknown error');
      setEditing(true);
    }
    btn('save').addEventListener('click', function () {
      btn('save').disabled = true;
      msg.textContent = 'Saving…';
      setEditing(false);
      var html = buildDocument();
      // files form keeps this view running and leaves the images untouched; the whole-page form is the fallback
      artifact.publish({ 'index.html': html }).catch(function (err) {
        var code = err && err.code;
        if (code === 'capability_disabled' || code === 'bad_request' || code === 'invalid_content') return artifact.publish(html);
        throw err;
      }).then(function () {
        btn('save').disabled = false;
        msg.textContent = 'Saved';
        setTimeout(function () { if (msg.textContent === 'Saved') msg.textContent = ''; }, 3000);
      }, failed);
    });
  });
})();
