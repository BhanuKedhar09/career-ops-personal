#!/usr/bin/env node
/**
 * scrape-jobs.mjs
 * Scrapes LinkedIn job listings via Apify (bebity/linkedin-jobs-scraper),
 * filters for Fortune 500/1000 scale companies, last 30 days, entry/associate level.
 * Output: data/linkedin-jobs.json
 *
 * Usage: node scrape-jobs.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ── Load env ──────────────────────────────────────────────────────────────────
let dotenv;
try { dotenv = require('dotenv'); dotenv.config(); } catch {}

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error('❌  APIFY_API_TOKEN not found in .env');
  process.exit(1);
}

const BASE_URL  = 'https://api.apify.com/v2';
const ACTOR_ID  = 'bebity~linkedin-jobs-scraper';

// ── LinkedIn search URL with all filters baked in ────────────────────────────
// f_TPR=r2592000  → posted in last 30 days
// f_E=2,3         → Entry level (2) + Associate (3)  [≤2 years exp]
// f_CS=H,I        → 5,001-10,000 (H) + 10,001+ (I) employees  [Fortune 500 proxy]
// sortBy=DD       → most recent first
const LINKEDIN_SEARCH_URL =
  'https://www.linkedin.com/jobs/search/?' +
  'keywords=Data%20Scientist' +
  '&location=Bengaluru%2C%20Karnataka%2C%20India' +
  '&f_TPR=r2592000' +
  '&f_E=2%2C3' +
  '&f_CS=H%2CI' +
  '&sortBy=DD';

// ── Actor input ───────────────────────────────────────────────────────────────
const ACTOR_INPUT = {
  searchUrl:  LINKEDIN_SEARCH_URL,    // primary: URL-based search with all filters
  // Fallback flat params (some actor versions use these instead of searchUrl):
  keyword:    'Data Scientist',
  location:   'Bengaluru, Karnataka, India',
  experienceLevel: ['ENTRY_LEVEL', 'ASSOCIATE'],
  datePosted: 'PAST_MONTH',
  companySize: ['G', 'H', 'I'],       // 1001+ employees
  maxItems:   100,
  proxy: {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apify(method, path, body) {
  const url  = `${BASE_URL}${path}?token=${APIFY_TOKEN}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res  = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify ${method} ${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// One month ago timestamp for client-side post-filter
const ONE_MONTH_AGO = Date.now() - 30 * 24 * 60 * 60 * 1000;

function isRecent(job) {
  if (!job.postedAt && !job.postedDate && !job.publishedAt) return true; // keep if unknown
  const raw = job.postedAt || job.postedDate || job.publishedAt;
  const ts  = typeof raw === 'number' ? raw : Date.parse(raw);
  return isNaN(ts) || ts >= ONE_MONTH_AGO;
}

function isLargeCompany(job) {
  const size = (job.companySize || job.companySizeRange || '').toLowerCase();
  if (!size) return true; // keep if unknown — let the user decide
  // Keep if company has 1000+ employees
  return /10[,\s]?001|5[,\s]?001|1[,\s]?001|large|enterprise|\+/.test(size);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀  Starting Apify LinkedIn Jobs scraper...');
  console.log(`   Actor : ${ACTOR_ID}`);
  console.log(`   Search: Data Scientist | Bengaluru | ≤2 yrs exp | large cos | last 30 days\n`);

  // 1. Start actor run
  console.log('▶  Starting actor run...');
  let runData;
  try {
    runData = await apify('POST', `/acts/${ACTOR_ID}/runs`, ACTOR_INPUT);
  } catch (err) {
    console.error('❌  Failed to start actor run:', err.message);
    process.exit(1);
  }

  const runId     = runData?.data?.id;
  const datasetId = runData?.data?.defaultDatasetId;
  if (!runId) {
    console.error('❌  No run ID returned. Response:', JSON.stringify(runData, null, 2));
    process.exit(1);
  }
  console.log(`   Run ID   : ${runId}`);
  console.log(`   Dataset  : ${datasetId}`);
  console.log(`   Monitor  : https://console.apify.com/actors/runs/${runId}\n`);

  // 2. Poll until run completes
  console.log('⏳  Waiting for run to complete (this can take 2-5 minutes)...');
  const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
  let status = 'RUNNING';
  let attempt = 0;
  while (!TERMINAL.has(status)) {
    await sleep(Math.min(5000 + attempt * 2000, 20000)); // 5s → 20s backoff
    attempt++;
    try {
      const info = await apify('GET', `/actor-runs/${runId}`);
      status = info?.data?.status || status;
      const stats = info?.data?.stats || {};
      process.stdout.write(`\r   Status: ${status.padEnd(12)} | Items: ${stats.itemCount ?? '?'} | Retries: ${attempt}`);
    } catch (e) {
      process.stdout.write(`\r   Polling error (retry ${attempt}): ${e.message.slice(0, 60)}`);
    }
  }
  console.log('');

  if (status !== 'SUCCEEDED') {
    console.error(`\n❌  Run ended with status: ${status}`);
    console.error(`   Check: https://console.apify.com/actors/runs/${runId}`);
    process.exit(1);
  }
  console.log('✅  Run completed successfully.\n');

  // 3. Fetch dataset items
  console.log('📥  Fetching results...');
  let items = [];
  try {
    const dsData = await apify('GET', `/datasets/${datasetId}/items`);
    items = Array.isArray(dsData) ? dsData : (dsData?.items || dsData?.data || []);
  } catch (err) {
    console.error('❌  Failed to fetch dataset:', err.message);
    process.exit(1);
  }
  console.log(`   Raw items fetched: ${items.length}`);

  // 4. Client-side filters (belt-and-suspenders on top of LinkedIn filters)
  const filtered = items.filter(j => isRecent(j) && isLargeCompany(j));
  console.log(`   After date + company-size filter: ${filtered.length} jobs\n`);

  if (filtered.length === 0) {
    console.warn('⚠️   No jobs passed the filters. Saving raw results instead so you can inspect them.');
  }

  const output = filtered.length > 0 ? filtered : items;

  // 5. Save to data/linkedin-jobs.json
  if (!existsSync('data')) mkdirSync('data', { recursive: true });

  const payload = {
    meta: {
      scraped_at: new Date().toISOString(),
      actor: ACTOR_ID,
      search_url: LINKEDIN_SEARCH_URL,
      filters: {
        keyword: 'Data Scientist',
        location: 'Bengaluru, India',
        experience: '≤2 years (Entry/Associate)',
        date_posted: 'Last 30 days',
        company_size: 'Large (1001+ employees)',
      },
      total_raw: items.length,
      total_filtered: output.length,
    },
    jobs: output,
  };

  writeFileSync('data/linkedin-jobs.json', JSON.stringify(payload, null, 2));
  console.log(`💾  Saved ${output.length} jobs → data/linkedin-jobs.json`);

  // 6. Quick preview
  console.log('\n📋  Preview (first 10 jobs):');
  console.log('─'.repeat(80));
  output.slice(0, 10).forEach((j, i) => {
    const title   = j.title || j.jobTitle || j.position || 'Unknown Title';
    const company = j.company || j.companyName || j.employer || 'Unknown Company';
    const loc     = j.location || j.jobLocation || '';
    const posted  = j.postedAt || j.postedDate || j.publishedAt || '';
    console.log(`${String(i + 1).padStart(2)}. ${title} @ ${company}`);
    console.log(`    📍 ${loc}  |  🗓  ${posted}`);
    if (j.jobUrl || j.url || j.applyUrl) {
      console.log(`    🔗 ${j.jobUrl || j.url || j.applyUrl}`);
    }
    console.log();
  });
  if (output.length > 10) {
    console.log(`   ... and ${output.length - 10} more in data/linkedin-jobs.json`);
  }

  console.log('\n✅  Done! Next steps:');
  console.log('   1. Paste the contents of data/linkedin-jobs.json back into your Claude Code session');
  console.log('   2. I will evaluate, rank, and generate tailored CVs for the top matches.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
