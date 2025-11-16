// Simple Express.js backend for your enrichment API
// Deploy on Railway.app or Render.com (free tier)

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Initialize Anthropic client (get API key from console.anthropic.com)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Main enrichment endpoint
app.post('/api/enrich', upload.single('file'), async (req, res) => {
  try {
    const { buffer } = req.file;
    const results = [];
    const companies = [];

    // Parse CSV
    const stream = Readable.from(buffer.toString());
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => {
          // Find company name column (flexible matching)
          const companyName = row.company || row.Company || row.business_name || 
                              row['Company Name'] || Object.values(row)[0];
          if (companyName) companies.push({ name: companyName, originalRow: row });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Enrich each company (batch for production)
    for (const company of companies.slice(0, 50)) { // Limit for demo
      try {
        const enrichedData = await enrichCompany(company.name);
        results.push({
          ...company.originalRow,
          ...enrichedData,
          enrichment_cost: calculateCost(enrichedData),
          enriched_at: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error enriching ${company.name}:`, error);
        results.push({
          ...company.originalRow,
          error: 'Enrichment failed'
        });
      }
    }

    res.json({
      success: true,
      total_processed: results.length,
      estimated_cost: results.length * 0.15, // Your actual cost
      retail_value: results.length * 10, // What others charge
      margin: ((results.length * 10) - (results.length * 0.15)),
      data: results
    });

  } catch (error) {
    console.error('Enrichment error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Core enrichment function using Claude
async function enrichCompany(companyName) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Research "${companyName}" and return ONLY a JSON object with:
{
  "industry": "primary industry",
  "employee_range": "estimated count like 50-200",
  "revenue_range": "estimated annual revenue",
  "headquarters": "city, country",
  "founded_year": "year or null",
  "tech_stack": ["technology1", "technology2", "technology3"],
  "pain_points": ["challenge1", "challenge2"],
  "decision_maker": "typical buyer title",
  "linkedin_url": "best guess at company linkedin",
  "ideal_pitch": "30 word pitch for selling to them",
  "buying_signals": ["signal1", "signal2"]
}

Be specific and actionable. No markdown, just JSON.`
    }]
  });

  const responseText = message.content[0].text;
  
  // Extract JSON (handle potential markdown wrapping)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  
  return JSON.parse(jsonMatch[0]);
}

// Calculate your actual cost per enrichment
function calculateCost(data) {
  // Claude costs roughly $0.003 per 1K input tokens, $0.015 per 1K output
  // Average enrichment: ~500 input + ~300 output tokens = $0.006
  // Add buffer for API calls, processing: ~$0.15 total per record
  return 0.15;
}

// Webhook for Stripe payments
app.post('/api/webhook/stripe', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  // Verify and handle payment webhook
  // Grant access to user after successful payment
  res.json({ received: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'data-enrichment-api' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Enrichment API running on port ${PORT}`);
  console.log(`Estimated margin per enrichment: $${(10 - 0.15).toFixed(2)}`);
});