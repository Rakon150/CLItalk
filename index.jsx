import React, { useState, useEffect } from "react";
import { render, Box, Text, Spacer } from "ink";
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

				if (data.type === "pong") return;

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
		if (!text.trim()) return;
		if (Date.now() < mutedUntil) return;
		if (!socket || socket.readyState !== 1) {
			setStatus("reconnecting");
			return;
		}
		try {
			socket.send(JSON.stringify({ text }));
			setInput("");
		} catch {
			setStatus("reconnecting");
		}
	};

	return (
		<Box flexDirection="column" height={process.stdout.rows || 30}>
			<Box flexGrow={1} flexDirection="column" justifyContent="flex-end" overflow="hidden" paddingX={1} paddingTop={1}>
				<Text dimColor>Name: [{name}]</Text>
				{messages.map((m) => (
					<Text key={`${m.ts}-${m.id}-${m.text}`} wrap="truncate-end">
						<Text color={m.name === name ? "green":"cyan"} bold={m.name === name}>[{m.name}] </Text>
						<Text>{m.text}</Text>
					</Text>
				))}
			</Box>
			{Date.now() < mutedUntil ? (
				<Box borderStyle="round" borderColor="red" paddingX={1}>
					<Text color="red">muted for spamming</Text>
					<Spacer />
					<Text dimColor>{name} - muted</Text>
				</Box>
			) : (
				<Box borderStyle="round" borderColor={status === "online" ? "green" : "yellow"} paddingX={1}>
					<Text color="green">{"> "}</Text>
					<TextInput value={input} onChange={setInput} onSubmit={submit} />
					<Spacer />
					<Text dimColor>{name} - {status}</Text>
				</Box>
			)
			}
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
