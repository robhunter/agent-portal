// outputs.js — Outputs tab client-side JavaScript
// Includes output list, detail view, feedback panel, delete, TTS playback

/**
 * Get the outputs tab client-side JS string.
 */
function getOutputsTabJS() {
  return `
let currentOutputFile = null;
let currentOutputRaw = null;
let ttsAudio = null;
let ttsPlaying = false;
let ttsPlaybackRate = parseFloat(localStorage.getItem('ttsPlaybackRate') || '1');
let ttsScrubInterval = null;

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function updateScrubBar() {
  if (!ttsAudio) return;
  var scrub = document.getElementById('tts-scrub');
  var elapsed = document.getElementById('tts-elapsed');
  var remaining = document.getElementById('tts-remaining');
  if (scrub && isFinite(ttsAudio.duration)) {
    scrub.max = Math.floor(ttsAudio.duration);
    scrub.value = Math.floor(ttsAudio.currentTime);
  }
  if (elapsed) elapsed.textContent = formatTime(ttsAudio.currentTime);
  if (remaining) remaining.textContent = '-' + formatTime(ttsAudio.duration - ttsAudio.currentTime);
}

function showAudioPlayer() {
  var player = document.getElementById('tts-player');
  if (player) player.style.display = 'flex';
}

function hideAudioPlayer() {
  var player = document.getElementById('tts-player');
  if (player) player.style.display = 'none';
  if (ttsScrubInterval) { clearInterval(ttsScrubInterval); ttsScrubInterval = null; }
}

function updatePlayPauseBtn() {
  var btn = document.getElementById('tts-playpause');
  if (!btn) return;
  btn.textContent = ttsPlaying ? '\\u23F8' : '\\u25B6';
  btn.title = ttsPlaying ? 'Pause' : 'Play';
}

function ttsPlayPause() {
  if (!ttsAudio) return;
  if (ttsPlaying) {
    ttsAudio.pause();
    ttsPlaying = false;
  } else {
    ttsAudio.play();
    ttsPlaying = true;
  }
  updatePlayPauseBtn();
}

function ttsSkip(seconds) {
  if (!ttsAudio || !isFinite(ttsAudio.duration)) return;
  ttsAudio.currentTime = Math.max(0, Math.min(ttsAudio.duration, ttsAudio.currentTime + seconds));
  updateScrubBar();
}

function ttsScrubTo(value) {
  if (!ttsAudio) return;
  ttsAudio.currentTime = Number(value);
  updateScrubBar();
}

function ttsSetSpeed(rate) {
  ttsPlaybackRate = parseFloat(rate);
  localStorage.setItem('ttsPlaybackRate', String(ttsPlaybackRate));
  if (ttsAudio) ttsAudio.playbackRate = ttsPlaybackRate;
}

async function listenToOutput() {
  if (!currentOutputFile) return;
  var listenBtn = document.getElementById('listen-btn');
  if (!listenBtn) return;

  // If audio is already loaded, toggle play/pause
  if (ttsAudio && ttsAudio.src) {
    ttsPlayPause();
    return;
  }

  // Fetch and play audio
  listenBtn.textContent = 'Generating...';
  listenBtn.disabled = true;
  try {
    var res = await fetch('/api/tts/' + encodeURIComponent(currentOutputFile));
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      alert('TTS error: ' + (err.error || res.status));
      listenBtn.textContent = '\\u{1F50A} Listen';
      listenBtn.disabled = false;
      return;
    }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    if (ttsAudio) {
      ttsAudio.pause();
      if (ttsAudio._objectUrl) URL.revokeObjectURL(ttsAudio._objectUrl);
    }
    ttsAudio = new Audio();
    ttsAudio._objectUrl = url;
    ttsAudio.src = url;
    ttsAudio.playbackRate = ttsPlaybackRate;
    ttsAudio.onended = function() {
      ttsPlaying = false;
      updatePlayPauseBtn();
      updateScrubBar();
    };
    ttsAudio.onerror = function() {
      ttsPlaying = false;
      hideAudioPlayer();
      listenBtn.style.display = '';
      listenBtn.textContent = '\\u{1F50A} Listen';
      alert('Audio playback error');
    };
    ttsAudio.onloadedmetadata = function() {
      updateScrubBar();
    };
    await ttsAudio.play();
    ttsPlaying = true;
    listenBtn.style.display = 'none';
    showAudioPlayer();
    updatePlayPauseBtn();
    if (ttsScrubInterval) clearInterval(ttsScrubInterval);
    ttsScrubInterval = setInterval(updateScrubBar, 250);
    // Set speed dropdown to current value
    var speedSel = document.getElementById('tts-speed');
    if (speedSel) speedSel.value = String(ttsPlaybackRate);
  } catch (e) {
    alert('Failed to generate audio: ' + e.message);
    listenBtn.textContent = '\\u{1F50A} Listen';
  }
  listenBtn.disabled = false;
}

async function copyRawOutput() {
  if (!currentOutputRaw) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(currentOutputRaw);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = currentOutputRaw;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    const btn = document.getElementById('copy-raw-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy Raw'; }, 2000); }
  } catch { alert('Failed to copy to clipboard'); }
}

async function loadOutputs() {
  const contentEl = document.getElementById('content');
  currentOutputFile = null;
  // Clear file param from URL when returning to list
  var params = new URLSearchParams(window.location.search);
  if (params.has('file')) {
    params.delete('file');
    var qs = params.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }
  const slug = typeof currentSlug !== 'undefined' ? currentSlug : null;
  const url = slug ? '/api/projects/' + encodeURIComponent(slug) + '/outputs' : '/api/outputs';
  contentEl.innerHTML = '<div class="empty">Loading outputs...</div>';
  try {
    const res = await fetch(url);
    const outputs = await res.json();
    if (!outputs || outputs.length === 0) {
      contentEl.innerHTML = '<div class="empty" style="margin-top:60px">No outputs yet.</div>';
      return;
    }
    let html = '<div class="outputs-list" style="max-width:800px">';
    html += '<h2 style="margin-bottom:16px;color:#444">Outputs</h2>';
    outputs.forEach(function(o) {
      const reviewBadge = o.reviewed
        ? '<span class="state-badge state-merged">' + (o.rating === 'up' ? '\\u{1F44D}' : o.rating === 'down' ? '\\u{1F44E}' : 'reviewed') + '</span>'
        : '<span class="unreviewed-badge">unreviewed</span>';
      const dateStr = formatShortDate(o.modified);
      html += '<div class="gh-item" style="cursor:pointer" onclick="viewOutput(\\'' + escapeHtml(o.filename) + '\\')">'
        + '<a style="flex:1">' + escapeHtml(o.filename) + '</a>'
        + reviewBadge
        + '<span class="date">' + dateStr + '</span>'
        + '</div>';
    });
    html += '</div>';
    contentEl.innerHTML = html;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load outputs</div>';
  }
}

async function viewOutput(filename) {
  currentOutputFile = filename;
  // Reset TTS state when switching output files
  if (ttsAudio) {
    ttsAudio.pause();
    if (ttsAudio._objectUrl) URL.revokeObjectURL(ttsAudio._objectUrl);
    ttsAudio = null;
  }
  ttsPlaying = false;
  // Update URL to allow deep linking to this output
  var params = new URLSearchParams(window.location.search);
  params.set('tab', 'outputs');
  params.set('file', filename);
  history.replaceState(null, '', '?' + params.toString());
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading output...</div>';
  try {
    const res = await fetch('/api/output/' + encodeURIComponent(filename));
    const data = await res.json();
    if (res.status !== 200) {
      contentEl.innerHTML = '<div class="empty">Output not found</div>';
      return;
    }
    currentOutputRaw = data.content;
    let html = '<div style="max-width:800px">';
    html += '<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">';
    html += '<a href="#" onclick="loadOutputs();return false" style="color:#1a73e8;text-decoration:none;font-size:13px">&larr; Back to outputs</a>';
    html += '<div style="display:flex;gap:6px">';
    if (PORTAL_CONFIG.hasTTS) {
      html += '<button class="refresh-btn" onclick="listenToOutput()" id="listen-btn" style="font-size:12px;padding:4px 10px">\\u{1F50A} Listen</button>';
      html += '<div id="tts-player" class="tts-player" style="display:none">';
      html += '<button class="tts-ctrl" onclick="ttsSkip(-10)" title="Back 10s">\\u23EA</button>';
      html += '<button class="tts-ctrl tts-playpause-btn" onclick="ttsPlayPause()" id="tts-playpause" title="Play/Pause">\\u23F8</button>';
      html += '<button class="tts-ctrl" onclick="ttsSkip(10)" title="Forward 10s">\\u23E9</button>';
      html += '<span id="tts-elapsed" class="tts-time">0:00</span>';
      html += '<input type="range" id="tts-scrub" class="tts-scrub" min="0" max="100" value="0" oninput="ttsScrubTo(this.value)">';
      html += '<span id="tts-remaining" class="tts-time">-0:00</span>';
      html += '<select id="tts-speed" class="tts-speed" onchange="ttsSetSpeed(this.value)" title="Playback speed">';
      html += '<option value="1">1.0x</option><option value="1.1">1.1x</option><option value="1.2">1.2x</option>';
      html += '<option value="1.3">1.3x</option><option value="1.5">1.5x</option><option value="1.75">1.75x</option><option value="2">2.0x</option>';
      html += '</select>';
      html += '</div>';
    }
    html += '<button class="refresh-btn" onclick="copyRawOutput()" id="copy-raw-btn" style="font-size:12px;padding:4px 10px">Copy Raw</button>';
    html += '</div>';
    html += '</div>';
    html += '<div class="status-card"><div class="md-content">' + marked.parse(data.content) + '</div></div>';

    // Feedback panel
    html += '<div id="feedback-panel" style="margin-top:16px;padding:16px;background:#fff;border-radius:8px;border:1px solid #e8e8e8">';
    html += '<h3 style="font-size:14px;color:#555;margin-bottom:12px">Feedback</h3>';
    html += '<div id="feedback-content">Loading feedback...</div>';
    html += '<textarea id="feedback-notes" rows="3" placeholder="Notes (optional)" style="width:100%;box-sizing:border-box;margin-top:12px;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical"></textarea>';
    html += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;justify-content:flex-end">';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', 2)">\\u{1F44D}</button>';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', 1)">\\u{1F44E}</button>';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', null)">Submit</button>';
    html += '</div>';
    html += '<div style="margin-top:8px"><button class="refresh-btn" style="background:#fce4ec;color:#c62828" onclick="deleteOutput(\\'' + escapeHtml(filename) + '\\')">Delete Output</button></div>';
    html += '</div>';

    html += '</div>';
    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;

    // Load existing feedback
    loadFeedback(filename);
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load output</div>';
  }
}

async function loadFeedback(filename) {
  const el = document.getElementById('feedback-content');
  if (!el) return;
  try {
    const res = await fetch('/api/feedback/' + encodeURIComponent(filename));
    if (res.status === 404) {
      el.innerHTML = '<div style="color:#888;font-size:13px">No feedback yet</div>';
      return;
    }
    const data = await res.json();
    el.innerHTML = '<pre style="font-size:12px;background:#f5f5f5;padding:8px;border-radius:4px;overflow-x:auto">' + escapeHtml(data.content) + '</pre>';
  } catch {
    el.innerHTML = '<div style="color:#888;font-size:13px">Could not load feedback</div>';
  }
}

async function submitFeedback(filename, rating) {
  const notesEl = document.getElementById('feedback-notes');
  const notes = notesEl ? notesEl.value.trim() : '';
  if (!rating && !notes) return;
  const body = {};
  if (rating) body.rating = rating;
  if (notes) body.notes = notes;
  try {
    const res = await fetch('/api/feedback/' + encodeURIComponent(filename), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(function() { return {}; });
      alert('Feedback error: ' + (err.error || res.status));
      return;
    }
    loadFeedback(filename);
    if (notesEl) notesEl.value = '';
    // Refresh project list so unreviewed badges update immediately
    if (typeof loadProjects === 'function') loadProjects();
    alert('Feedback submitted!');
  } catch(e) { alert('Failed to submit feedback: ' + e.message); }
}

async function deleteOutput(filename) {
  if (!confirm('Delete ' + filename + '?')) return;
  try {
    await fetch('/api/output/' + encodeURIComponent(filename), { method: 'DELETE' });
    loadOutputs();
  } catch { alert('Failed to delete output'); }
}
`;
}

module.exports = { getOutputsTabJS };
