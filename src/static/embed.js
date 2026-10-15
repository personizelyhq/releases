// Runs inside the /embed iframe. Token arrives in the URL hash so it never
// reaches server logs or a Referer header.
(function () {
  var post = function (type, data) {
    if (window.parent === window) return
    var msg = { source: 'releases', type: type }
    for (var k in data || {}) msg[k] = data[k]
    window.parent.postMessage(msg, '*') // counts only, nothing sensitive
  }

  var params = new URLSearchParams(location.hash.slice(1))
  var token = params.get('token')
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)

  // Links to the full page should leave the frame.
  document.querySelectorAll('.prose a').forEach(function (a) {
    a.target = '_blank'
    a.rel = 'noopener'
  })

  // Close on Escape so keyboard users can get back to the app.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') post('close')
  })

  post('ready')
  if (!token) return

  var auth = { Authorization: 'Bearer ' + token }
  fetch('/api/me/unread', { headers: auth })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status) })
    .then(function (data) {
      var unread = new Set(data.unread || [])
      document.querySelectorAll('.embed-item').forEach(function (li) {
        if (!unread.has(li.dataset.slug)) return
        li.classList.add('is-unread')
        li.querySelector('.unread-dot').hidden = false
      })
      if (!data.count) return post('seen', { count: 0 })
      return fetch('/api/me/seen', { method: 'POST', headers: auth }).then(function (r) {
        if (r.ok) post('seen', { count: 0 })
      })
    })
    .catch(function (status) {
      post('error', { status: typeof status === 'number' ? status : 0 })
    })
})()
