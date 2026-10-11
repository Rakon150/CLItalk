import { WebSocketServer } from "ws";

let nextId = 1;
const wss = new WebSocketServer({ port: 5566 });
const history = []
const taken = new Set();

const maxMsg = 5;
const windowMs = 5000;
const muteMs = 10000;

wss.on("connection", (ws) => {
    ws.id = nextId++;
    ws.name = null;
    ws.msgTimes = [];
    ws.mutedUntil = 0;
    ws.send(JSON.stringify({ type: "id", id: ws.id}));
    ws.send(JSON.stringify({ type: "history", messages: history.slice(-15) }));

    ws.on("message", (raw) => {
        try {
            if (raw.length > 4096) return;
            const data = JSON.parse(raw.toString());

            if (data.join) {
                const n = String(data.join).slice(0,20);
                if (!/^[a-zA-Z0-9_-]{1,20}$/.test(n)) {
                    ws.send(JSON.stringify({ type: "join-error", text: "name: a-z 0-9 _- only" }));
                    return;
                }
                const low = n.toLowerCase();
                if (taken.has(low)) {
                    ws.send(JSON.stringify({ type: "join-error", text: "name already taken"}));
                    return;
                }
                if (ws.name) taken.delete(ws.name.toLowerCase());
                ws.name = n;
                taken.add(low);
                return;
            }

            if (data.ping) {
                ws.send(JSON.stringify({ type: "pong" }));
                return;
            }

            if (data.text === "/online") {
                const names = [...wss.clients].map(c => c.name || String(c.id)).filter(Boolean);
                ws.send(JSON.stringify({ type: "online", count: names.length, names, cid: data.cid || null }));
                return;
            }

            if (!data.text || typeof data.text !== "string") return;

            const now = Date.now();
            if (now < ws.mutedUntil) return;
            ws.msgTimes = ws.msgTimes.filter(t => now - t < windowMs);
            if (ws.msgTimes.length >= maxMsg) {
                ws.mutedUntil = now + muteMs;
                ws.msgTimes = [];
                ws.send(JSON.stringify({ type: "muted", until: ws.mutedUntil, text: `muted for spamming (${muteMs/1000}s)`, ts: now}));
                return;
            }
            ws.msgTimes.push(now);

            const text = data.text.trim().slice(0,500);
            if (!text) return;

            const msg = {
                type: "msg",
                id: ws.id,
                name: ws.name || String(ws.id),
                text,
                ts: now,
                cid: data.cid || null
            };
            history.push(msg);
            if (history.length > 15) history.shift();
            
            const out = JSON.stringify(msg);

            for (const c of wss.clients) {
                if (c.readyState === 1) c.send(out);
            }
        } catch {}
    });
    ws.on("close", () => {
        if (ws.name) taken.delete(ws.name.toLowerCase());
    });
});

console.log("running on ws://130.61.98.17:5566")