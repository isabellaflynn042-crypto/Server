const express = require('express');
const cors = require('cors');

const app = express();

const MERCHANT_ID = 'NiThTzsBSYNo';
const API_KEY = 'HReEITtwMf2SutaThlyZG37cJwIj';
const API_SECRET = 'JIIPI9PNOCaOjAP6XxMTcObdMqfgwX7REQUwTj';

const LWORX_BASE = 'https://lworx.ug-web.com/api/v1';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

function normalizePhone(input) {
  if (!input) return '';
  let p = String(input).trim().replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('256') && p.length === 12) return p;
  if (p.startsWith('0') && p.length === 10) return p;
  if (p.length === 9) return '0' + p;
  if (p.startsWith('256')) return p;
  return p;
}

function parseAmount(input) {
  if (input === undefined || input === null || input === '') return NaN;
  const cleaned = String(input).replace(/[, ]/g, '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}

function genRef(prefix = 'ORD') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function safeFetch(url, options) {
  let res, rawText;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    return {
      ok: false,
      networkError: true,
      status: 0,
      rawBody: '',
      json: null,
      errorMessage: `Network error reaching ${url}: ${networkErr.message}`,
    };
  }
  try {
    rawText = await res.text();
  } catch (readErr) {
    rawText = `<<failed to read body: ${readErr.message}>>`;
  }
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    json = null;
  }
  return {
    ok: res.ok,
    networkError: false,
    status: res.status,
    statusText: res.statusText,
    rawBody: rawText,
    json,
    errorMessage: null,
  };
}

function htmlReceipt({ success, title, lines, errorText }) {
  const bg = success ? '#0f5132' : '#842029';
  const accent = success ? '#198754' : '#dc3545';
  const badge = success ? '✓ PAYMENT SUCCESSFUL' : '✗ PAYMENT FAILED';
  const rowsHtml = (lines || [])
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.15);font-weight:600;color:#ffd6a5;">${k}</td>
        <td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.15);color:#fff;text-align:right;font-family:'Courier New',monospace;">${v}</td>
      </tr>`
    )
    .join('');
  const errorBlock = errorText
    ? `
    <div style="margin-top:18px;padding:14px;background:#1b1f23;border:1px solid #ff6b6b;border-radius:8px;">
      <div style="color:#ff6b6b;font-weight:700;margin-bottom:8px;">Full error details (share with support):</div>
      <pre style="white-space:pre-wrap;word-break:break-word;color:#ffd1d1;font-size:12px;margin:0;">${escapeHtml(errorText)}</pre>
    </div>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#111;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.6);">
    <div style="background:${bg};padding:22px 24px;color:#fff;">
      <div style="font-size:13px;letter-spacing:2px;opacity:0.8;">LWORXPAY RECEIPT</div>
      <div style="display:inline-block;margin-top:10px;padding:8px 14px;background:${accent};color:#fff;border-radius:999px;font-weight:700;font-size:14px;">${badge}</div>
      <div style="margin-top:12px;font-size:20px;font-weight:600;">${escapeHtml(title)}</div>
    </div>
    <div style="background:#1a1a1a;padding:8px 0;">
      <table style="width:100%;border-collapse:collapse;color:#fff;font-size:14px;">
        ${rowsHtml}
      </table>
      ${errorBlock}
      <div style="padding:16px 22px;color:#9aa0a6;font-size:12px;text-align:center;">
        ${new Date().toLocaleString()}<br/>
        Powered by LworxPay
      </div>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatErrorTextDirect(upstream, sentBody) {
  const parts = [];
  parts.push(`Endpoint: POST ${LWORX_BASE}/direct-charge`);
  parts.push(`HTTP Status: ${upstream.status} ${upstream.statusText || ''}`.trim());
  if (upstream.networkError) parts.push('Type: NETWORK ERROR (could not reach LworxPay server)');
  if (upstream.errorMessage) parts.push(`Detail: ${upstream.errorMessage}`);
  if (upstream.json && (upstream.json.error || upstream.json.message)) {
    parts.push(`Server message: ${upstream.json.error || upstream.json.message}`);
  }
  parts.push('--- Request sent ---');
  parts.push(JSON.stringify(sentBody, null, 2));
  parts.push('--- Raw response from LworxPay ---');
  parts.push(upstream.rawBody || '(empty)');
  return parts.join('\n');
}

app.get('/', (_req, res) => {
  res.type('text/plain').send('LworxPay payment server is running. POST /pay to initiate a payment.');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/pay', async (req, res) => {
  const body = req.body || {};
  const phone = normalizePhone(body.phone || body.msisdn || body.number);
  const amount = parseAmount(body.amount);
  const currency = (body.currency || 'UGX').toString().toUpperCase();
  const description = body.description || 'Payment';
  const reference = body.reference || genRef('ORD');
  const ipnUrl = body.ipn_url || `${req.protocol}://${req.get('host')}/webhook/lworxpay`;

  if (!phone || (phone.length !== 10 && phone.length !== 12)) {
    const txt = `Invalid phone number. Provide MTN/Airtel Uganda number (e.g. 0700123456 or 256700123456). Received: "${body.phone}"`;
    return res.status(400).json({
      success: false,
      error: txt,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Invalid phone number',
        lines: [['Provided', body.phone || '(none)'], ['Expected', '0700123456 or 256700123456']],
        errorText: txt,
      }),
    });
  }
  if (!Number.isFinite(amount) || amount < 500) {
    const txt = `Invalid amount. Minimum is 500 UGX. Received: "${body.amount}" -> parsed as ${amount}`;
    return res.status(400).json({
      success: false,
      error: txt,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Invalid amount',
        lines: [['Provided', body.amount ?? '(none)'], ['Parsed', String(amount)], ['Minimum', '500 UGX']],
        errorText: txt,
      }),
    });
  }

  const sentBody = {
    phone,
    amount,
    currency,
    description,
    reference,
    ipn_url: ipnUrl,
  };

  const upstream = await safeFetch(`${LWORX_BASE}/direct-charge`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(sentBody),
  });

  if (!upstream.ok || !upstream.json || upstream.json.success === false) {
    const errText = formatErrorTextDirect(upstream, sentBody);
    return res.status(upstream.status && upstream.status >= 400 ? upstream.status : 502).json({
      success: false,
      error: (upstream.json && (upstream.json.error || upstream.json.message)) || `LworxPay request failed (HTTP ${upstream.status}).`,
      full_error: errText,
      http_status: upstream.status,
      raw_response: upstream.rawBody,
      sent: sentBody,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Payment could not be initiated',
        lines: [
          ['Reference', reference],
          ['Phone', phone],
          ['Amount', `${amount} ${currency}`],
          ['HTTP', String(upstream.status)],
        ],
        errorText: errText,
      }),
    });
  }

  const data = upstream.json;
  return res.json({
    success: true,
    message: data.message || 'Payment prompt sent. Customer should approve on their phone.',
    trx_id: data.trx_id,
    reference: data.reference || reference,
    amount: data.amount ?? amount,
    fee: data.fee,
    net_amount: data.net_amount,
    currency: data.currency || currency,
    status: data.status || 'pending',
    status_url: data.status_url,
    receipt_html: htmlReceipt({
      success: true,
      title: 'Payment prompt sent',
      lines: [
        ['Reference', data.reference || reference],
        ['Transaction ID', data.trx_id || '(pending)'],
        ['Phone', phone],
        ['Amount', `${data.amount ?? amount} ${data.currency || currency}`],
        ['Fee', data.fee != null ? `${data.fee} ${data.currency || currency}` : '—'],
        ['Net amount', data.net_amount != null ? `${data.net_amount} ${data.currency || currency}` : '—'],
        ['Status', (data.status || 'pending').toUpperCase()],
      ],
    }),
  });
});

app.get('/status/:trxId', async (req, res) => {
  const trxId = req.params.trxId;
  const upstream = await safeFetch(`${LWORX_BASE}/charge-status/${encodeURIComponent(trxId)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!upstream.ok || !upstream.json) {
    const errText =
      `Endpoint: GET ${LWORX_BASE}/charge-status/${trxId}\n` +
      `HTTP Status: ${upstream.status} ${upstream.statusText || ''}\n` +
      (upstream.networkError ? 'Type: NETWORK ERROR\n' : '') +
      `--- Raw response ---\n${upstream.rawBody || '(empty)'}`;
    return res.status(upstream.status && upstream.status >= 400 ? upstream.status : 502).json({
      success: false,
      error: `Failed to fetch status (HTTP ${upstream.status}).`,
      full_error: errText,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Could not check payment status',
        lines: [['Transaction ID', trxId], ['HTTP', String(upstream.status)]],
        errorText: errText,
      }),
    });
  }

  const data = upstream.json;
  const status = (data.status || 'unknown').toLowerCase();
  const isSuccess = status === 'success' || status === 'completed';
  const isFailed = status === 'failed' || status === 'cancelled';

  return res.json({
    success: data.success !== false,
    trx_id: data.trx_id || trxId,
    status: data.status,
    amount: data.amount,
    fee: data.fee,
    net_amount: data.net_amount,
    currency: data.currency,
    reference: data.reference,
    created_at: data.created_at,
    updated_at: data.updated_at,
    receipt_html: htmlReceipt({
      success: isSuccess,
      title: isSuccess
        ? 'Payment confirmed'
        : isFailed
        ? 'Payment failed'
        : 'Payment pending',
      lines: [
        ['Transaction ID', data.trx_id || trxId],
        ['Reference', data.reference || '—'],
        ['Amount', data.amount != null ? `${data.amount} ${data.currency || ''}`.trim() : '—'],
        ['Fee', data.fee != null ? `${data.fee} ${data.currency || ''}`.trim() : '—'],
        ['Net amount', data.net_amount != null ? `${data.net_amount} ${data.currency || ''}`.trim() : '—'],
        ['Status', String(data.status || 'unknown').toUpperCase()],
        ['Updated', data.updated_at || '—'],
      ],
    }),
  });
});

app.post('/initiate-payment', async (req, res) => {
  const body = req.body || {};
  const amount = parseAmount(body.payment_amount ?? body.amount);
  const currency = (body.currency_code || body.currency || 'UGX').toString().toUpperCase();
  const refTrx = body.ref_trx || body.reference || genRef('ORDER');
  const description = body.description || 'Payment';
  const customerName = body.customer_name || 'Customer';
  const customerEmail = body.customer_email || '';
  const ipnUrl = body.ipn_url || `${req.protocol}://${req.get('host')}/webhook/lworxpay`;
  const successRedirect = body.success_redirect || `${req.protocol}://${req.get('host')}/payment/success`;
  const cancelRedirect = body.cancel_redirect || `${req.protocol}://${req.get('host')}/payment/cancelled`;

  if (!Number.isFinite(amount) || amount <= 0) {
    const txt = `Invalid amount: "${body.payment_amount ?? body.amount}".`;
    return res.status(400).json({
      success: false,
      error: txt,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Invalid amount',
        lines: [['Provided', body.payment_amount ?? body.amount ?? '(none)']],
        errorText: txt,
      }),
    });
  }

  const sentBody = {
    payment_amount: amount,
    currency_code: currency,
    ref_trx: refTrx,
    description,
    customer_name: customerName,
    customer_email: customerEmail,
    ipn_url: ipnUrl,
    success_redirect: successRedirect,
    cancel_redirect: cancelRedirect,
  };

  const upstream = await safeFetch(`${LWORX_BASE}/initiate-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Environment': 'production',
      'X-Merchant-Key': MERCHANT_ID,
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(sentBody),
  });

  if (!upstream.ok || !upstream.json || !upstream.json.payment_url) {
    const errText =
      `Endpoint: POST ${LWORX_BASE}/initiate-payment\n` +
      `HTTP Status: ${upstream.status} ${upstream.statusText || ''}\n` +
      (upstream.networkError ? 'Type: NETWORK ERROR\n' : '') +
      `--- Request sent ---\n${JSON.stringify(sentBody, null, 2)}\n` +
      `--- Raw response from LworxPay ---\n${upstream.rawBody || '(empty)'}`;
    return res.status(upstream.status && upstream.status >= 400 ? upstream.status : 502).json({
      success: false,
      error: (upstream.json && (upstream.json.error || upstream.json.message)) || `LworxPay request failed (HTTP ${upstream.status}).`,
      full_error: errText,
      http_status: upstream.status,
      raw_response: upstream.rawBody,
      sent: sentBody,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Could not start payment',
        lines: [
          ['Reference', refTrx],
          ['Amount', `${amount} ${currency}`],
          ['Customer', customerName],
          ['HTTP', String(upstream.status)],
        ],
        errorText: errText,
      }),
    });
  }

  const data = upstream.json;
  return res.json({
    success: true,
    payment_url: data.payment_url,
    info: data.info || null,
    ref_trx: refTrx,
    receipt_html: htmlReceipt({
      success: true,
      title: 'Payment link created',
      lines: [
        ['Reference', refTrx],
        ['Amount', `${amount} ${currency}`],
        ['Customer', customerName],
        ['Email', customerEmail || '—'],
      ],
    }),
  });
});

app.get('/verify/:refTrx', async (req, res) => {
  const refTrx = req.params.refTrx;
  const upstream = await safeFetch(`${LWORX_BASE}/verify-payment/${encodeURIComponent(refTrx)}`, {
    method: 'GET',
    headers: {
      'X-Merchant-Key': MERCHANT_ID,
      'X-API-Key': API_KEY,
      'X-Environment': 'production',
      'Accept': 'application/json',
    },
  });

  if (!upstream.ok || !upstream.json) {
    const errText =
      `Endpoint: GET ${LWORX_BASE}/verify-payment/${refTrx}\n` +
      `HTTP Status: ${upstream.status} ${upstream.statusText || ''}\n` +
      `--- Raw response ---\n${upstream.rawBody || '(empty)'}`;
    return res.status(upstream.status && upstream.status >= 400 ? upstream.status : 502).json({
      success: false,
      error: `Failed to verify payment (HTTP ${upstream.status}).`,
      full_error: errText,
      receipt_html: htmlReceipt({
        success: false,
        title: 'Could not verify payment',
        lines: [['Reference', refTrx], ['HTTP', String(upstream.status)]],
        errorText: errText,
      }),
    });
  }

  const data = upstream.json;
  const status = (data.status || 'unknown').toLowerCase();
  const isSuccess = status === 'completed' || status === 'success';
  const isFailed = status === 'failed' || status === 'cancelled';
  return res.json({
    success: true,
    status: data.status,
    ref_trx: data.ref_trx || refTrx,
    amount: data.amount,
    currency: data.currency,
    customer_name: data.customer_name,
    customer_email: data.customer_email,
    created_at: data.created_at,
    completed_at: data.completed_at,
    receipt_html: htmlReceipt({
      success: isSuccess,
      title: isSuccess ? 'Payment confirmed' : isFailed ? 'Payment failed' : 'Payment pending',
      lines: [
        ['Reference', data.ref_trx || refTrx],
        ['Amount', data.amount != null ? `${data.amount} ${data.currency || ''}`.trim() : '—'],
        ['Customer', data.customer_name || '—'],
        ['Email', data.customer_email || '—'],
        ['Status', String(data.status || 'unknown').toUpperCase()],
        ['Completed', data.completed_at || '—'],
      ],
    }),
  });
});

app.post('/webhook/lworxpay', (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));
  res.json({ status: 'ok' });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  const txt = `Server error: ${err.message}\n${err.stack || ''}`;
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
    full_error: txt,
    receipt_html: htmlReceipt({
      success: false,
      title: 'Server error',
      lines: [['Type', err.name || 'Error']],
      errorText: txt,
    }),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LworxPay payment server listening on port ${PORT}`);
});
