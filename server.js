import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const app = express();

const LIPILA_API_KEY = process.env.LIPILA_API_KEY || "lsk_019d494a-8253-7699-b7a9-3891047dc269";
const LIPILA_BASE_URL = process.env.LIPILA_BASE_URL || "https://api.lipila.dev/api/v1";

app.use(cors());
app.use(express.json());

function buildReceipt(data, status) {
  return {
    receipt: {
      status: status,
      referenceId: data.referenceId || null,
      identifier: data.identifier || null,
      amount: data.amount || null,
      currency: data.currency || null,
      accountNumber: data.accountNumber || null,
      paymentType: data.paymentType || null,
      type: data.type || null,
      externalId: data.externalId || null,
      narration: data.narration || null,
      message: data.message || null,
      createdAt: data.createdAt || new Date().toISOString(),
    },
    raw: data,
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text || text.trim() === "") {
    return { _raw: "", _parseError: "Lipila returned an empty response body." };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return { _raw: text, _parseError: `Lipila response could not be parsed as JSON. Raw response: ${text}` };
  }
}

function getLipilaErrorMessage(response, data) {
  if (response.status === 401) {
    return "Lipila rejected the request with HTTP 401 UNAUTHORIZED. Check that LIPILA_API_KEY on Render is correct and active.";
  }

  if (response.status === 403) {
    return "Lipila rejected the request with HTTP 403 FORBIDDEN. Your API key may not have access to this transaction type, or withdrawals/disbursements may not be enabled on your Lipila account.";
  }

  if (response.status === 429) {
    return "Lipila rejected the request with HTTP 429 TOO MANY REQUESTS. Please slow down and try again shortly.";
  }

  if (data?._parseError) {
    return data._raw
      ? data._parseError
      : `Lipila returned HTTP ${response.status} with an empty response body.`;
  }

  return (
    data?.message ||
    data?.error ||
    JSON.stringify(data) ||
    "Unknown error from Lipila API"
  );
}

app.post("/initiate", async (req, res) => {
  const { phoneNumber, amount } = req.body;

  if (!phoneNumber || !amount) {
    return res
      .status(400)
      .send("Error: Both phoneNumber and amount are required to initiate a payment.");
  }

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res
      .status(400)
      .send("Error: Amount must be a valid positive number.");
  }

  const referenceId = uuidv4().replace(/-/g, "").slice(0, 12);

  const payload = {
    referenceId: referenceId,
    amount: numericAmount,
    narration: "STK Push Payment",
    accountNumber: String(phoneNumber),
    currency: "ZMW",
  };

  let lipilResponse;
  try {
    lipilResponse = await fetch(`${LIPILA_BASE_URL}/collections/mobile-money`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-api-key": LIPILA_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    return res
      .status(502)
      .send(`Error: Could not connect to Lipila API. Check your internet or try again. Detail: ${networkError.message}`);
  }

  const lipilData = await safeJson(lipilResponse);

  if (!lipilResponse.ok) {
    const errorMsg = getLipilaErrorMessage(lipilResponse, lipilData);
    return res
      .status(lipilResponse.status)
      .send(`Error ${lipilResponse.status} (${lipilResponse.statusText}): ${errorMsg}`);
  }

  if (lipilData._parseError) {
    return res
      .status(502)
      .send(`Error: Lipila API responded with HTTP ${lipilResponse.status} but returned an unreadable body. ${lipilData._parseError}`);
  }

  const statusLabel = lipilData.status || "Pending";
  const receipt = buildReceipt({ ...lipilData, referenceId }, statusLabel);

  return res.status(200).json({
    notification: "Payment request sent successfully. Please check your phone for a PIN prompt.",
    referenceId: referenceId,
    ...receipt,
  });
});

app.post("/initiate-card", async (req, res) => {
  const {
    firstName,
    lastName,
    phoneNumber,
    email,
    city,
    country,
    address,
    zip,
    amount,
    narration,
    accountNumber,
    currency,
    backUrl,
    redirectUrl,
    callbackUrl,
  } = req.body;

  const missingFields = [];
  if (!firstName) missingFields.push("firstName");
  if (!lastName) missingFields.push("lastName");
  if (!phoneNumber) missingFields.push("phoneNumber");
  if (!email) missingFields.push("email");
  if (!city) missingFields.push("city");
  if (!country) missingFields.push("country");
  if (!address) missingFields.push("address");
  if (!zip) missingFields.push("zip");
  if (amount === undefined || amount === null || amount === "") missingFields.push("amount");
  if (!narration) missingFields.push("narration");
  if (!accountNumber) missingFields.push("accountNumber");
  if (!currency) missingFields.push("currency");
  if (!backUrl) missingFields.push("backUrl");
  if (!redirectUrl) missingFields.push("redirectUrl");

  if (missingFields.length > 0) {
    return res
      .status(400)
      .json({ error: `Error: Missing required fields: ${missingFields.join(", ")}.` });
  }

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res
      .status(400)
      .json({ error: "Error: Amount must be a valid positive number." });
  }

  const referenceId = uuidv4().replace(/-/g, "").slice(0, 12);

  const payload = {
    customerInfo: {
      firstName: String(firstName),
      lastName: String(lastName),
      phoneNumber: String(phoneNumber),
      city: String(city),
      country: String(country),
      address: String(address),
      zip: String(zip),
      email: String(email),
    },
    collectionRequest: {
      referenceId: referenceId,
      amount: numericAmount,
      narration: String(narration),
      accountNumber: String(accountNumber),
      currency: String(currency),
      backUrl: String(backUrl),
      redirectUrl: String(redirectUrl),
    },
  };

  const headers = {
    accept: "application/json",
    "x-api-key": LIPILA_API_KEY,
    "Content-Type": "application/json",
  };

  if (callbackUrl) {
    headers["callbackUrl"] = String(callbackUrl);
  }

  let lipilResponse;
  try {
    lipilResponse = await fetch(`${LIPILA_BASE_URL}/collections/card`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    return res
      .status(502)
      .json({ error: `Error: Could not connect to Lipila API. Check your internet or try again. Detail: ${networkError.message}` });
  }

  const lipilData = await safeJson(lipilResponse);

  if (!lipilResponse.ok) {
    const errorMsg = getLipilaErrorMessage(lipilResponse, lipilData);
    return res
      .status(lipilResponse.status)
      .json({ error: `Error ${lipilResponse.status} (${lipilResponse.statusText}): ${errorMsg}` });
  }

  if (lipilData._parseError) {
    return res
      .status(502)
      .json({ error: `Error: Lipila API responded with HTTP ${lipilResponse.status} but returned an unreadable body. ${lipilData._parseError}` });
  }

  const statusLabel = lipilData.status || "Pending";
  const receipt = buildReceipt({ ...lipilData, referenceId }, statusLabel);

  return res.status(200).json({
    notification: "Card payment initiated successfully. Please use the redirect URL to complete payment.",
    referenceId: referenceId,
    cardRedirectionUrl: lipilData.cardRedirectionUrl || null,
    ...receipt,
  });
});

app.post("/withdraw", async (req, res) => {
  const { phoneNumber, amount, narration, callbackUrl } = req.body;

  if (!phoneNumber || amount === undefined || amount === null || amount === "") {
    return res
      .status(400)
      .json({ error: "Error: Both phoneNumber and amount are required to initiate a withdrawal." });
  }

  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res
      .status(400)
      .json({ error: "Error: Amount must be a valid positive number." });
  }

  const referenceId = uuidv4().replace(/-/g, "").slice(0, 12);

  const payload = {
    referenceId: referenceId,
    amount: numericAmount,
    narration: narration ? String(narration) : "Mobile Money Withdrawal",
    accountNumber: String(phoneNumber),
    currency: "ZMW",
  };

  const headers = {
    accept: "application/json",
    "x-api-key": LIPILA_API_KEY,
    "Content-Type": "application/json",
  };

  if (callbackUrl) {
    headers["callbackUrl"] = String(callbackUrl);
  }

  let lipilResponse;
  try {
    lipilResponse = await fetch(`${LIPILA_BASE_URL}/disbursements/mobile-money`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    return res
      .status(502)
      .json({ error: `Error: Could not connect to Lipila API. Check your internet or try again. Detail: ${networkError.message}` });
  }

  const lipilData = await safeJson(lipilResponse);

  if (!lipilResponse.ok) {
    const errorMsg = getLipilaErrorMessage(lipilResponse, lipilData);
    return res
      .status(lipilResponse.status)
      .json({ error: `Error ${lipilResponse.status} (${lipilResponse.statusText}): ${errorMsg}` });
  }

  if (lipilData._parseError) {
    return res
      .status(502)
      .json({ error: `Error: Lipila API responded with HTTP ${lipilResponse.status} but returned an unreadable body. ${lipilData._parseError}` });
  }

  const statusLabel = lipilData.status || "Pending";
  const receipt = buildReceipt({ ...lipilData, referenceId }, statusLabel);

  return res.status(200).json({
    notification: "Withdrawal request sent successfully. Check the status for confirmation.",
    referenceId: referenceId,
    ...receipt,
  });
});

app.get("/status", async (req, res) => {
  const { referenceId } = req.query;

  if (!referenceId) {
    return res
      .status(400)
      .send("Error: referenceId query parameter is required.");
  }

  let lipilResponse;
  try {
    lipilResponse = await fetch(
      `${LIPILA_BASE_URL}/collections/check-status?referenceId=${encodeURIComponent(referenceId)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-api-key": LIPILA_API_KEY,
        },
      }
    );
  } catch (networkError) {
    return res
      .status(502)
      .send(`Error: Could not connect to Lipila API. Check your internet or try again. Detail: ${networkError.message}`);
  }

  const lipilData = await safeJson(lipilResponse);

  if (!lipilResponse.ok) {
    const errorMsg = getLipilaErrorMessage(lipilResponse, lipilData);
    return res
      .status(lipilResponse.status)
      .send(`Error ${lipilResponse.status} (${lipilResponse.statusText}): ${errorMsg}`);
  }

  if (lipilData._parseError) {
    return res
      .status(502)
      .send(`Error: Lipila API responded with HTTP ${lipilResponse.status} but returned an unreadable body. ${lipilData._parseError}`);
  }

  const transactionStatus = lipilData.status || "Unknown";
  const receipt = buildReceipt(lipilData, transactionStatus);

  let notification = "";
  if (transactionStatus === "Successful") {
    notification = `Payment Successful! Transaction of ${lipilData.amount} ${lipilData.currency} from ${lipilData.accountNumber} completed via ${lipilData.paymentType}.`;
  } else if (transactionStatus === "Failed") {
    notification = `Payment Failed. Reason: ${lipilData.message || "Unknown reason"}. Payment type: ${lipilData.paymentType || "Unknown"}.`;
  } else if (transactionStatus === "Pending") {
    notification = "Payment is still pending. The user has not yet entered their PIN. If using MTN, try dialing *115#.";
  } else {
    notification = `Transaction status: ${transactionStatus}. Message: ${lipilData.message || "No message provided."}`;
  }

  return res.status(200).json({
    notification,
    ...receipt,
  });
});

app.get("/withdraw-status", async (req, res) => {
  const { referenceId } = req.query;

  if (!referenceId) {
    return res
      .status(400)
      .json({ error: "Error: referenceId query parameter is required." });
  }

  let lipilResponse;
  try {
    lipilResponse = await fetch(
      `${LIPILA_BASE_URL}/disbursements/check-status?referenceId=${encodeURIComponent(referenceId)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-api-key": LIPILA_API_KEY,
        },
      }
    );
  } catch (networkError) {
    return res
      .status(502)
      .json({ error: `Error: Could not connect to Lipila API. Check your internet or try again. Detail: ${networkError.message}` });
  }

  const lipilData = await safeJson(lipilResponse);

  if (!lipilResponse.ok) {
    const errorMsg = getLipilaErrorMessage(lipilResponse, lipilData);
    return res
      .status(lipilResponse.status)
      .json({ error: `Error ${lipilResponse.status} (${lipilResponse.statusText}): ${errorMsg}` });
  }

  if (lipilData._parseError) {
    return res
      .status(502)
      .json({ error: `Error: Lipila API responded with HTTP ${lipilResponse.status} but returned an unreadable body. ${lipilData._parseError}` });
  }

  const transactionStatus = lipilData.status || "Unknown";
  const receipt = buildReceipt(lipilData, transactionStatus);

  let notification = "";
  if (transactionStatus === "Successful") {
    notification = `Withdrawal Successful! ${lipilData.amount} ${lipilData.currency} was sent to ${lipilData.accountNumber} via ${lipilData.paymentType}.`;
  } else if (transactionStatus === "Failed") {
    notification = `Withdrawal Failed. Reason: ${lipilData.message || "Unknown reason"}. Payment type: ${lipilData.paymentType || "Unknown"}.`;
  } else if (transactionStatus === "Pending") {
    notification = "Withdrawal is still pending. Check again shortly.";
  } else {
    notification = `Withdrawal status: ${transactionStatus}. Message: ${lipilData.message || "No message provided."}`;
  }

  return res.status(200).json({
    notification,
    ...receipt,
  });
});

app.use((_req, res) => {
  res.status(404).send("Error 404: Route not found on this server.");
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled server error:", err);
  res.status(500).send(`Error 500: Internal server error. ${err.message}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lipila STK server running on port ${PORT}`);
});
