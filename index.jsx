import React, { useState, useEffect, useRef } from "react";
import { render, Box, Text, Spacer, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import WebSocket from "ws";

const Chat = () => {
	const [nameInput, setNameInput] = useState("");
	const [name, setName] = useState(null);
	const [messages, setMessages] = useState([]);
	const [input, setInput] = useState("");
	const [socket, setSocket] = useState(null);
	const [status, setStatus] = useState("connecting");
	const [nameError, setNameError] = useState("");
	const [mutedUntil, setMutedUntil] = useState(0);
	const [cmdIndex, setCmdIndex] = useState(0);
	const {exit} = useApp();
	const pending = useRef(new Map());
	const muted = Date.now() < mutedUntil;
	const commands = [
		{ name: "/clear", desc: "clear messages" },
		{ name: "/online", desc: "show whos online" },
		{ name: "/quit", desc: "leave" },
		{ name: "/nick", desc: "change name" },
	];
	const cmdStem = input.split(" ")[0];
	const matches = !muted && input.startsWith("/")
		? commands.filter(c => c.name.startsWith(cmdStem)).slice(0, 3)
		: [];

	useEffect(() => {
		if (!name) return;
		let ws;
		let closed = false;
		let pingTimer;
		let checkTimer;
		let lastPong = Date.now();

		const connect = () => {
			setStatus("connecting");
			ws = new WebSocket("wss://clichat.rakon.qzz.io");

			ws.onopen = () => {
				setStatus("online");
				ws.send(JSON.stringify({ join: name }));

				clearInterval(pingTimer);
				clearInterval(checkTimer);
				pingTimer = setInterval(() => {
					if (ws.readyState === 1) ws.send(JSON.stringify({ ping: 1 }));
				}, 5000);
				checkTimer = setInterval(() => {
					if (Date.now() - lastPong > 12000) ws.close();
				}, 5000);
			};

			ws.onmessage = (e) => {
				lastPong = Date.now();

				const data = JSON.parse(e.data);
				if (data.type === "msg" && data.cid && pending.current.has(data.cid)) {
					clearTimeout(pending.current.get(data.cid));
					pending.current.delete(data.cid);
				}

				if (data.type === "pong") return;

				if (data.type === "online") {
					if (data.cid && pending.current.has(data.cid)) {
						clearTimeout(pending.current.get(data.cid));
						pending.current.delete(data.cid);
					}
					setMessages(prev => [...prev.slice(-15), { ts: Date.now(), id: 0, name: "server", text: `online (${data.count}): ${data.names.join(", ")}` }]);
					return;
				}

				if (data.type === "muted") {
					setInput("");
					setMutedUntil(data.until);
					setTimeout(() => setMutedUntil(0), data.until - Date.now());
					return;
				}

				if (data.type === "msg") {
					setMessages(prev => {
						if (prev.some(m => m.ts === data.ts && m.id === data.id && m.text === data.text)) return prev;
						return [...prev.slice(-15), data];
					});
				}

				if (data.type === "history") {
					setMessages(prev => {
						const seen = new Set(prev.map(m => `${m.ts}-${m.id}-${m.text}`));
						const fresh = data.messages.filter(m => !seen.has(`${m.ts}-${m.id}-${m.text}`));
						return [...prev, ...fresh].slice(-15);
					});
				}

				if (data.type === "join-error") {
					closed = true;
					setName(null);
					setNameError(data.text);
					setNameInput("");
					ws.close();
					return;
				}
			};

			ws.onclose = () => {
				setSocket(null);
				if (!closed) {
					setStatus("reconnecting");
					setTimeout(connect, 2000);
				}
			};

			ws.onerror = () => ws.close();
			setSocket(ws);
		};

		connect();
		return () => { closed = true; clearInterval(pingTimer); clearInterval(checkTimer); if (ws) ws.close(); };
	}, [name]);

	useInput((_, key) => {
		if (!matches.length) return;
		if (key.upArrow) setCmdIndex(i => (i - 1 + matches.length) % matches.length);
		else if (key.downArrow) setCmdIndex(i => (i + 1) % matches.length);
		else if (key.tab) {
			const pick = matches[cmdIndex];
			if (pick) setInput(pick.name === "/nick" ? "/nick " : pick.name)
		}
	}, { isActive: !!name && !muted });

	if (!name) {
		return (
			<Box flexDirection="column">
				<Box>
					<Text>Name: </Text>
					<TextInput
						value={nameInput}
						onChange={(v) => { setNameInput(v); setNameError(""); }}
						onSubmit={(v) => {
							const n = v.trim();
							if (!/^[a-zA-Z0-9_-]{1,20}$/.test(n)) {
								setNameError("no special chars (*§!...), max 20 chars")
								return;
							}
							setName(n);
						}}
					/>
				</Box>
				{nameError ? <Text color="red">{nameError}</Text> : null}
			</Box>
		);
	}

	const submit = (text) => {
		const t = text.trim();
		if (!t) return;
		if (Date.now() < mutedUntil) return;

		if (t === "/clear") { setMessages([]); setInput(""); return; }
		if (t === "/quit") { exit(); return; }
		if (t === "/online") {
			if (!socket || socket.readyState !== 1) return;
			const cid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			socket.send(JSON.stringify({ text: t, cid }));
			setInput("");
			const timer = setTimeout(() => {
				if (pending.current.has(cid)) {
					pending.current.delete(cid);
					setStatus("reconnecting");
					try { socket.close(); } catch {}
				}
			}, 5000);
			pending.current.set(cid, timer);
			return;
		}
		if (t.startsWith("/nick ")) {
			const n = t.slice(6).trim();
			if (!/^[a-zA-Z0-9_-]{1,20}$/.test(n)) { setMessages(prev => [...prev.slice(-15), { ts: Date.now(), id: 0, name: "server", text: "bad name" }]); }
			else { setName(n); setNameInput(n); }
			setInput("");
			return;
		}

		if (!socket || socket.readyState !== 1) {
			setStatus("reconnecting");
			return;
		}
		try {
			const cid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			socket.send(JSON.stringify({ text, cid }));
			setInput("");
			const t = setTimeout(() => {
				if (pending.current.has(cid)) {
					pending.current.delete(cid);
					setStatus("reconnecting");
					try { socket.close(); } catch { }
				}
			}, 5000);
			pending.current.set(cid, t);
		} catch {
			setStatus("reconnecting");
		}
	};

	return (
		<Box flexDirection="column" height={process.stdout.rows || 30}>
			<Box flexGrow={1} flexDirection="column" justifyContent="flex-end" overflow="hidden" paddingX={1} paddingTop={1}>
				<Text dimColor>Name: [{name}]</Text>
				{messages.map((m) => (
					<Box key={`${m.ts}-${m.id}-${m.text}`}>
						<Text wrap="truncate-end">
							<Text color={m.name === name ? "green" : "cyan"} bold={m.name === name}>[{m.name}] </Text>
							<Text>{m.text}</Text>
						</Text>
						<Spacer />
						<Text dimColor>{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
					</Box>
				))}
			</Box>

			{matches.length > 0 && (
				<Box flexDirection="column" borderStyle="round" paddingX={1} marginRight={1}>
					{matches.map((c, i) => (
						<Box key={c.name}>
							<Text color={i === cmdIndex ? "black" : "cyan"} backgroundColor={i === cmdIndex ? "cyan" : undefined}>
								{i === cmdIndex ? "> " : "  "}{c.name}
							</Text>
						</Box>
					))}
				</Box>
			)}

			<Box borderStyle="round" borderColor={Date.now() < mutedUntil ? "red" : status === "online" ? "green" : "yellow"} paddingX={1}>
				{Date.now() < mutedUntil ? (
					<>
						<Text color="red">muted for spamming</Text>
						<Spacer />
						<Text dimColor>{name} - muted</Text>
						<TextInput value="" onChange={() => { }} onSubmit={() => { }} focus={false} showCursor={false} />
					</>
				) : (
					<>
						<Text color="green">{"> "}</Text>
						<TextInput value={input} onChange={(v) => { setInput(v); setCmdIndex(0); }} onSubmit={submit} focus={true} />
						<Spacer />
						<Text dimColor>{name} - {status}</Text>
					</>
				)
				}
			</Box>
		</Box>
	);
};

process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");

const app = render(<Chat />);

const cleanup = () => process.stdout.write("\x1b[?1049l");
process.on("exit", cleanup);
process.on("SIGINT", () => { app.unmount(); cleanup(); process.exit(0); });
process.on("SIGTERM", () => { app.unmount(); cleanup(); process.exit(0); });

await app.waitUntilExit();
cleanup();