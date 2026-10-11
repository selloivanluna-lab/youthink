'use strict';
// Radio infinita a partir de un "seed" (videoId o texto) usando ytmusicapi.
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

function findPython() {
  const cands = ['python3', 'python', 'py'];
  for (const c of cands) {
    const dirs = (process.env.PATH || '').split(path.delimiter);
    const exe = process.platform === 'win32' ? c + '.exe' : c;
    for (const d of dirs) {
      if (!d) continue;
      try { if (fs.existsSync(path.join(d, exe))) return c; } catch (e) {}
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function radio(seed, limit, cb) {
  const script = path.join(__dirname, '..', 'py', 'ytmusic_radio.py');
  if (!fs.existsSync(script)) return cb(new Error('ytmusic_radio.py no encontrado'));
  const py = process.env.PYTHON_BIN || findPython();
  let p;
  try { p = cp.spawn(py, [script, String(seed || ''), String(limit || 25)], { windowsHide: true }); }
  catch (e) { return cb(e); }
  let out = '', err = '', done = false;
  const finish = (e, data) => { if (done) return; done = true; cb(e, data); };
  const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} finish(new Error('timeout de radio (>45s)')); }, 45000);
  p.stdout.on('data', (d) => { out += d.toString(); });
  p.stderr.on('data', (d) => { err += d.toString(); });
  p.on('error', (e) => { clearTimeout(timer); finish(e); });
  p.on('close', () => {
    clearTimeout(timer);
    try {
      const data = JSON.parse(out);
      if (!data.ok) return finish(new Error(data.error || 'radio falló'));
      finish(null, data.tracks || []);
    } catch (e) {
      finish(new Error((err || out || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ') || 'JSON de radio inválido'));
    }
  });
}

module.exports = { radio };
