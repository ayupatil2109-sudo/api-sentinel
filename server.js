const express = require('express');
const dns = require('node:dns').promises;
const net = require('node:net');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

function isPublicIp(ip) {
	const version = net.isIP(ip);
	if (version === 4) {
		const parts = ip.split('.').map(Number);
		const [a, b] = parts;
		return !(
			a === 0 || a === 10 || a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 192 && b === 0) ||
			(a === 198 && (b === 18 || b === 19)) ||
			a >= 224
		);
	}

	if (version === 6) {
		const x = ip.toLowerCase();
		return x !== '::' && x !== '::1' &&
			!x.startsWith('fc') && !x.startsWith('fd') &&
			!/^fe[89ab]/.test(x) &&
			!x.startsWith('::ffff:');
	}
	return false;
}

async function validateUrl(rawUrl) {
	const u = new URL(rawUrl);

	if (!['http:', 'https:'].includes(u.protocol) ||
			u.username || u.password) {
		throw new Error('Only public HTTP/HTTPS URLs are allowed.');
	}

	const hostname = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

	if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
			hostname.endsWith('.local')) {
		throw new Error('Local destinations are blocked.');
	}

	const literalVersion = net.isIP(hostname);
	const addresses = literalVersion
		? [{ address: hostname }]
		: await dns.lookup(hostname, { all: true, verbatim: true });

	if (!addresses.length || addresses.some(a => !isPublicIp(a.address))) {
		throw new Error('Private or non-public destination blocked.');
	}

	return u;
}

app.post('/api/send', async (req, res) => {
	const { url, method = 'GET', body = '' } = req.body || {};

	if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
		return res.status(400).json({ error: 'Unsupported HTTP method.' });
	}

	let target;
	try {
		target = await validateUrl(url);
	} catch (e) {
		return res.status(400).json({ error: e.message || 'Invalid URL.' });
	}

	if (body && !['GET', 'DELETE'].includes(method)) {
		try {
			JSON.parse(body);
		} catch {
			return res.status(400).json({ error: 'Request body must be valid JSON.' });
		}
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10000);

	try {
		const start = Date.now();
		const response = await fetch(target, {
			method,
			headers: body && !['GET', 'DELETE'].includes(method)
				? { 'Content-Type': 'application/json' } : {},
			body: body && !['GET', 'DELETE'].includes(method) ? body : undefined,
			redirect: 'error',
			signal: controller.signal
		});

		const text = await response.text();
		res.json({
			status: response.status,
			statusText: response.statusText,
			timeMs: Date.now() - start,
			headers: Object.fromEntries(response.headers),
			body: text.slice(0, 100000),
			sizeBytes: Buffer.byteLength(text)
		});
	} catch (e) {
		res.status(502).json({
			error: e.name === 'AbortError'
				? 'Request timed out after 10 seconds.'
				: 'Request failed. Check the URL and network.'
		});
	} finally {
		clearTimeout(timer);
	}
});

app.listen(process.env.PORT || 3000, () => {
	console.log('API Sentinel running');
});
