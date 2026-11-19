// Royal Run — telefon-joystik uchun internet "ko'prigi" (relay).
// Kompyuterdagi o'yin (host) va telefonlar shu serverga o'zlari ulanadi, shuning uchun
// Wi-Fi, firewall va hotspot sozlamalari ahamiyatga ega emas.
//
//   GET  /r/XXXXX            -> telefon sahifasi (o'yin yuborgan HTML)
//   WS   /host?room=XXXXX    -> o'yin (Unity) ulanadi
//   WS   /ws?room=XXXXX      -> telefon ulanadi
//
// Host -> server:  page|<html>   s|<id>|<matn>   k|<id>   ping|<t>
// Server -> host:  o|<id>        m|<id>|<matn>   c|<id>   pong|<t>
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const rooms = new Map();   // kod -> { host, page, phones: Map(id -> ws), next, empty }

const notFound = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Royal Run</title><meta http-equiv="refresh" content="3"></head>
<body style="background:#1d0a3a;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:60px 20px">
<h1 style="color:#ffd45a">ROYAL RUN</h1><p>Kompyuterda o'yin hali ochilmagan. Kuting...</p>
<p style="opacity:.7">Игра на компьютере ещё не открыта · The game isn't open on the computer yet</p></body></html>`;

function room(code) {
  let r = rooms.get(code);
  if (!r) { r = { host: null, page: null, phones: new Map(), next: 0, empty: 0 }; rooms.set(code, r); }
  return r;
}

function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  if (m) {
    const r = rooms.get(cleanCode(m[1]));
    const page = r && r.host && r.page;
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page || notFound);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Royal Run relay OK. Rooms: ' + rooms.size);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const code = cleanCode(url.searchParams.get('room'));
  if (!code || (url.pathname !== '/host' && url.pathname !== '/ws')) { socket.destroy(); return; }
  socket.setNoDelay(true);   // har bir tugma bosilishi darhol yuborilsin
  wss.handleUpgrade(req, socket, head, ws => {
    if (url.pathname === '/host') onHost(ws, code); else onPhone(ws, code);
  });
});

function onHost(ws, code) {
  const r = room(code);
  if (r.host && r.host !== ws) try { r.host.close(4000, 'replaced'); } catch (e) {}
  r.host = ws; r.empty = 0;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  // o'yin qayta ulansa, ochiq telefonlarni yana tanitamiz
  for (const id of r.phones.keys()) ws.send('o|' + id);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const s = data.toString();
    if (s.startsWith('s|')) {
      const k = s.indexOf('|', 2);
      const p = r.phones.get(+s.slice(2, k));
      if (p && p.readyState === 1) p.send(s.slice(k + 1));
    } else if (s.startsWith('page|')) {
      r.page = s.slice(5);
    } else if (s.startsWith('ping|')) {
      ws.send('pong|' + s.slice(5));
    } else if (s.startsWith('k|')) {
      const p = r.phones.get(+s.slice(2));
      if (p) p.close();
    }
  });
  ws.on('close', () => { if (r.host === ws) r.host = null; });
}

function onPhone(ws, code) {
  const r = rooms.get(code);
  if (!r || !r.host) { ws.close(4404, 'no game'); return; }
  const id = ++r.next;
  r.phones.set(id, ws);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  if (r.host.readyState === 1) r.host.send('o|' + id);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const h = r.host;
    if (h && h.readyState === 1) h.send('m|' + id + '|' + data.toString());
  });
  ws.on('close', () => {
    r.phones.delete(id);
    const h = r.host;
    if (h && h.readyState === 1) h.send('c|' + id);
  });
}

// uzilib qolgan ulanishlarni tozalash, bo'sh xonalarni o'chirish
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) {}
  }
  for (const [code, r] of rooms) {
    if (!r.host && r.phones.size === 0) { if (++r.empty > 20) rooms.delete(code); }
    else r.empty = 0;
  }
}, 15000);

server.listen(PORT, () => console.log('Royal Run relay: port ' + PORT));
