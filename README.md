Minimal CLI global chat - for now only in "beta".
Uses websockets via my VPS to have a global chat with custom names, commands, simple moderation, antispam etc.

> [!NOTE]  
> Web demo will be added soon

---

# Quick start

```bash
npm i
node server.js
npx tsx index.jsx
```

Needs wss server to work or can use `wss://clichat.rakon.qzz.io` aka my VPS to work

## Features
 - **Chat**
    - global channel, live messages with history, typing indicator
 - **Names**
    - custom names, later registration, custom colors and maybe others
 - **Commands**
    - /clear /online /quit /nick
 - **UI**
    - simple minimalistic CLI chat using ink

---

Created for Hackclub event Terra