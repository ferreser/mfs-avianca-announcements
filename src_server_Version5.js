/**
 * Servidor HTTP + WebSocket (bind + triggers + control)
 */

const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const log = require("pino")();
const { v4: uuidv4 } = require("uuid");

const { AnnouncementEngine, AUDIO_DIR } = require("./announcement-engine");
const simbrief = require("./simbrief-client");
const CONFIG = require("../announcements-config.json");

const PORT = parseInt(process.env.PORT || "3000", 10);
const BIND_SECRET = process.env.BIND_SECRET || null;

const app = express();
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const engine = new AnnouncementEngine();

// tokens store (in-memory)
const tokens = {};
const watchers = new Map();

function broadcastJSON(obj) {
  const str = JSON.stringify(obj);
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(str); });
}
engine.subscribe(ev => broadcastJSON(ev));

// POST /bind -> devuelve token
app.post("/bind", (req, res) => {
  const { name, secret } = req.body || {};
  if (BIND_SECRET && secret !== BIND_SECRET) return res.status(401).json({ ok: false, error: "invalid bind secret" });
  const token = uuidv4();
  tokens[token] = { name: name || "unknown", createdAt: Date.now() };
  log.info({ token, binder: name }, "Issued bind token");
  res.json({ ok: true, token });
});

// POST /trigger
app.post("/trigger", (req, res) => {
  const { trigger, context } = req.body || {};
  if (!trigger) return res.status(400).json({ error: "trigger required" });
  const candidates = engine.findForTrigger(trigger);
  if (!candidates || candidates.length === 0) return res.status(404).json({ error: `No announcements for trigger ${trigger}` });
  const enqueued = [];
  for (const cand of candidates) {
    const text = engine.renderTemplate(cand.template, context || {});
    const audioPath = cand.audio ? path.join(AUDIO_DIR, cand.audio) : null;
    const item = { id: cand.id, text, audioPath, priority: cand.priority || 0, context: context || {} };
    engine.enqueue(item);
    enqueued.push({ id: item.id, priority: item.priority, audioExists: audioPath && fs.existsSync(audioPath) });
  }
  broadcastJSON({ type: "queue_change", queue_snapshot: engine.queue.map(q => ({ id: q.id, priority: q.priority })) });
  res.json({ triggered: trigger, enqueued });
});

// POST /control
app.post("/control", (req, res) => {
  const { action } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: "action required" });
  try {
    switch ((action || "").toLowerCase()) {
      case "pause": engine.pause(); break;
      case "resume": engine.resume(); break;
      case "skip": engine.skipCurrent(); break;
      case "stop": engine.stopAll(); break;
      default: return res.status(400).json({ ok: false, error: "unknown action" });
    }
    return res.json({ ok: true, action });
  } catch (err) {
    log.error({ err }, "Control action failed");
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /triggers
app.get("/triggers", (req, res) => res.json({ triggers: engine.listTriggers() }));

// GET /flight/:id SimBrief proxy
app.get("/flight/:id", async (req, res) => {
  try {
    const data = await simbrief.fetchFlightPlan(req.params.id);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// WebSocket handling
wss.on("connection", (socket) => {
  socket.isRegistered = false;
  socket.on("message", (msg) => {
    try {
      const json = JSON.parse(msg.toString());
      if (json.type === "register") {
        const token = json.token;
        if (!token || !tokens[token]) { socket.send(JSON.stringify({ type: "register_response", ok: false, error: "invalid token" })); socket.close(); return; }
        socket.isRegistered = true;
        socket.token = token;
        watchers.set(token, socket);
        socket.send(JSON.stringify({ type: "register_response", ok: true }));
        return;
      }
      if (json.type === "trigger") {
        if (!socket.token || !tokens[socket.token]) { socket.send(JSON.stringify({ type: "ack", ok: false, error: "not registered" })); return; }
        const candidates = engine.findForTrigger(json.trigger);
        const enqueued = [];
        for (const cand of candidates) {
          const text = engine.renderTemplate(cand.template, json.context || {});
          const audioPath = cand.audio ? path.join(AUDIO_DIR, cand.audio) : null;
          const item = { id: cand.id, text, audioPath, priority: cand.priority || 0, context: json.context || {} };
          engine.enqueue(item);
          enqueued.push({ id: item.id, priority: item.priority });
        }
        socket.send(JSON.stringify({ type: "ack", ok: true, triggered: json.trigger, enqueued }));
        broadcastJSON({ type: "queue_change", queue_snapshot: engine.queue.map(q => ({ id: q.id, priority: q.priority })) });
        return;
      }
      if (json.type === "command") {
        if (!socket.token || !tokens[socket.token]) { socket.send(JSON.stringify({ type: "ack", ok: false, error: "not registered" })); return; }
        const action = (json.action || "").toLowerCase();
        switch (action) {
          case "pause": engine.pause(); socket.send(JSON.stringify({ type: "ack", ok: true, action })); break;
          case "resume": engine.resume(); socket.send(JSON.stringify({ type: "ack", ok: true, action })); break;
          case "skip": engine.skipCurrent(); socket.send(JSON.stringify({ type: "ack", ok: true, action })); break;
          case "stop": engine.stopAll(); socket.send(JSON.stringify({ type: "ack", ok: true, action })); break;
          default: socket.send(JSON.stringify({ type: "ack", ok: false, error: "unknown command" })); break;
        }
        return;
      }
      if (json.type === "snapshot") {
        socket.send(JSON.stringify({
          type: "snapshot",
          queue: engine.queue.map(q => ({ id: q.id, priority: q.priority })),
          current: engine.current ? { id: engine.current.item.id, priority: engine.current.item.priority } : null,
          paused: engine.paused || false
        }));
      }
    } catch (err) { try { socket.send(JSON.stringify({ type: "error", error: String(err) })); } catch (_) {} }
  });
  socket.on("close", () => { if (socket.token) watchers.delete(socket.token); });
});

server.listen(PORT, () => {
  log.info(`Announcement engine listening on http://localhost:${PORT} (WS enabled). POST /bind to obtain token.`);
});