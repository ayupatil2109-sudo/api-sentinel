
const express = require('express');
const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

app.post('/api/send', async (req, res) => {
  const { url, method = 'GET', body = '' } = req.body || {};

  let target;
  try {
    target = new URL(url);

    if (!['http:', 'https:'].includes(target.protocol)) {
      return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are allowed.' });
    }

    if (target.username || target.password) {
      return res.status(400).json({ error: 'URLs containing credentials are not allowed.' });
    }

    if (['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
      return res.status(400).json({ error: 'Localhost URLs are blocked.' });
    }
  } catch {
    return res.status(400).json({ error: 'Please enter a valid API URL.' });
  }

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return res.status(400).json({ error: 'Unsupported HTTP method.' });
  }

  if (body && ['GET', 'DELETE'].includes(method)) {
    // Ignore the optional body for these methods.
  } else if (body) {
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
        ? { 'Content-Type': 'application/json' }
        : {},
      body: body && !['GET', 'DELETE'].includes(method) ? body : undefined,
      redirect: 'error',
      signal: controller.signal
    });

    const responseBody = await response.text();

    res.json({
      status: response.status,
      statusText: response.statusText,
      timeMs: Date.now() - start,
      headers: Object.fromEntries(response.headers),
      body: responseBody.slice(0, 100000),
      sizeBytes: Buffer.byteLength(responseBody)
    });
  } catch (error) {
    res.status(502).json({
      error: error.name === 'AbortError'
        ? 'Request timed out after 10 seconds.'
        : 'Could not reach the API. Check the URL and connection.'
    });
  } finally {
    clearTimeout(timer);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('API Sentinel running at http://localhost:3000');
});

