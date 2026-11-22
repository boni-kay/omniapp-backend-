const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { Pool } = require('pg');
const { GoogleGenAI } = require('@google/genai');
const Flutterwave = require('flutterwave-node-v3');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static front-end files (index.html) directly from this folder
app.use(express.static(__dirname));

// 1. Initialize Supabase PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2. Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 3. Initialize Flutterwave
const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY,
  process.env.FLW_SECRET_KEY
);

// Serve the front-end home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'OmniApp AI Engine (Gemini 3.8, Supabase & Flutterwave)' });
});

// 🤖 Gemini AI App Generation Endpoint
app.post('/api/generate-app', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  try {
    const systemInstruction = `You are an expert full-stack web developer. Generate a complete front-end web application. 
Return ONLY a valid JSON object:
{
  "appName": "App Title",
  "summary": "Short explanation",
  "files": [
    { "file_path": "index.html", "file_content": "HTML code", "file_type": "html" },
    { "file_path": "styles.css", "file_content": "CSS styling", "file_type": "css" },
    { "file_path": "app.js", "file_content": "JavaScript logic", "file_type": "js" }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json'
      }
    });

    const resultJson = JSON.parse(response.text);

    // Save generated app build into Supabase
    try {
      await pool.query(
        `INSERT INTO apps (app_name, prompt, summary, files) VALUES ($1, $2, $3, $4)`,
        [resultJson.appName, prompt, resultJson.summary, JSON.stringify(resultJson.files)]
      );
      console.log(`💾 App "${resultJson.appName}" saved to Supabase!`);
    } catch (dbErr) {
      console.error('⚠️ Supabase Save Error:', dbErr.message);
    }

    res.json(resultJson);
  } catch (error) {
    console.error('Gemini Generation Error:', error.message || error);
    res.status(500).json({ error: 'Failed to generate app', details: error.message });
  }
});

// 💳 Flutterwave Payment Link Endpoint (UGX - MTN/Airtel & Cards)
app.post('/api/pay-flutterwave', async (req, res) => {
  const { email, name, phone_number, amount_ugx } = req.body;

  const tx_ref = 'OMNI-TX-' + Date.now();

  const payload = {
    tx_ref: tx_ref,
    amount: amount_ugx || '10000',
    currency: 'UGX',
    redirect_url: `${req.protocol}://${req.get('host')}/api/verify-payment`,
    payment_options: 'mobilemoneyuganda,card',
    customer: {
      email: email || 'customer@example.com',
      phonenumber: phone_number || '0700000000',
      name: name || 'OmniApp User'
    },
    customizations: {
      title: 'OmniApp AI Credits',
      description: 'App Generation Subscription',
      logo: 'https://cdn-icons-png.flaticon.com/512/2103/2103633.png'
    }
  };

  try {
    const response = await flw.Payment.create(payload);
    if (response.status === 'success') {
      res.json({ status: 'success', payment_url: response.data.link, tx_ref: tx_ref });
    } else {
      res.status(400).json({ error: 'Payment initialization failed', details: response });
    }
  } catch (error) {
    console.error('Flutterwave Error:', error.message || error);
    res.status(500).json({ error: 'Payment error', details: error.message });
  }
});

// Payment Verification Endpoint
app.get('/api/verify-payment', async (req, res) => {
  const { transaction_id, tx_ref, status } = req.query;

  if (status === 'successful' || status === 'completed') {
    try {
      const response = await flw.Transaction.verify({ id: transaction_id });
      if (response.data.status === 'successful' && response.data.amount >= 10000 && response.data.currency === 'UGX') {
        res.send(`
          <div style="font-family: system-ui, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #22c55e;">🎉 Payment Successful!</h1>
            <p>Transaction Reference: <strong>${tx_ref}</strong></p>
            <p>Amount Paid: <strong>${response.data.amount} ${response.data.currency}</strong></p>
            <br>
            <a href="/" style="background: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Return to App Builder</a>
          </div>
        `);
      } else {
        res.send('<h2 style="font-family: sans-serif; text-align: center; padding: 50px;">⚠️ Payment verification failed or amount mismatch.</h2>');
      }
    } catch (err) {
      res.send('<h2 style="font-family: sans-serif; text-align: center; padding: 50px;">❌ Verification error occurred.</h2>');
    }
  } else {
    res.send('<h2 style="font-family: sans-serif; text-align: center; padding: 50px;">❌ Payment was cancelled or failed.</h2>');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 OmniApp AI Engine running on port ${PORT}`);
});