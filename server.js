import { WebSocketServer } from "ws";
import os from "os";

let nextId = 1;
const port = 5566;
const wss = new WebSocketServer({ port: port });
const history = []
const taken = new Set();

const maxMsg = 7;
const windowMs = 5000;
const baseMute = 5000;
const maxMute = 300000;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

wss.on("connection", (ws) => {
    ws.id = nextId++;
    ws.name = null;
    ws.msgTimes = [];
    ws.mutedUntil = 0;
    ws.muteCount = 0;
    ws.lastClean = Date.now();
    log(`user ${ws.id} connected`);
    ws.send(JSON.stringify({ type: "id", id: ws.id }));
    ws.send(JSON.stringify({ type: "history", messages: history.slice(-15) }));

    ws.on("message", (raw) => {
        try {
            if (raw.length > 4096) return;
            const data = JSON.parse(raw.toString());

            if (data.join) {
                const n = String(data.join).slice(0, 20);
                if (!/^[a-zA-Z0-9_-]{1,20}$/.test(n)) {
                    ws.send(JSON.stringify({ type: "join-error", text: "name: a-z 0-9 _- only" }));
                    log(`user ${ws.id} has rejected name ${n} because bad chars`);
                    return;
                }
                const low = n.toLowerCase();
                if (taken.has(low)) {
                    ws.send(JSON.stringify({ type: "join-error", text: "name already taken" }));
                    log(`user ${ws.id} has rejected name ${n} because taken`);
                    return;
                }
                if (ws.name) taken.delete(ws.name.toLowerCase());
                ws.name = n;
                taken.add(low);
                log(`user ${ws.id} has name ${n}`);
                for (const c of wss.clients) {
                    if (c.readyState === 1) {
                        c.send(JSON.stringify({ type: "msg", id: 0, name: "server", text: `${n} joined`, ts: Date.now() }));
                    }
                }
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

            if (typeof data.typing === "boolean") {
                for (const c of wss.clients) if (c.readyState === 1 && c !== ws) c.send(JSON.stringify({ type: "typing", name: ws.name || String(ws.id), typing: data.typing }));
                    return;
            }

            if (!data.text || typeof data.text !== "string") return;

            const now = Date.now();
            if (now < ws.mutedUntil) return;
            ws.msgTimes = ws.msgTimes.filter(t => now - t < windowMs);
            if (ws.msgTimes.length >= maxMsg) {
                if (now - ws.lastClean > 300000) ws.muteCount = 0;
                const thisMute = Math.min(baseMute * 2 ** ws.muteCount, maxMute);
                ws.muteCount++;
                ws.lastClean = now;
                ws.mutedUntil = now + thisMute;
                ws.msgTimes = [];
                ws.send(JSON.stringify({ type: "muted", until: ws.mutedUntil, text: `muted for spamming (${thisMute / 1000}s)`, ts: now }));
                log(`user ${ws.id} name ${ws.name || "?"} muted for ${thisMute / 1000}s because spamming (mute count: ${ws.muteCount})`);
                return;
            }
            ws.msgTimes.push(now);

            const text = data.text.trim().slice(0, 500);
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
        } catch { }
    });
    ws.on("close", () => {
        if (ws.name) {
            taken.delete(ws.name.toLowerCase());
            for (const c of wss.clients) {
                if (c.readyState === 1) {
                    c.send(JSON.stringify({ type: "msg", id: 0, name: "server", text: `${ws.name} left`, ts: Date.now() }));
                }
            }
        }
    });
});

const ip = Object.values(os.networkInterfaces()).flat().find(i => i.family === "IPv4" && !i.internal)?.address;
console.log(`running on wss://${ip}:${port}`);