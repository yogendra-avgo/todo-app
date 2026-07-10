const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const metrics = require('./metrics');
const app = express();
const port = 3000;

// BASE_PATH lets the app be reverse-proxied under a subpath (e.g. Gateway API
// HTTPRoute serving it at /app) while probes/metrics scraping still hit the
// pod directly at the root path.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

const TEAM_PLANNER_TEMPLATE = fs.readFileSync(path.join(__dirname, 'static', 'team-planner.html'), 'utf8')
  .replace(/(href|src|hx-post)="\//g, `$1="${BASE_PATH}/`);

function logEvent(level, component, message, detail = '') {
  const timestamp = new Date().toISOString();
  const detailStr = detail ? ` | Detail: ${JSON.stringify(detail)}` : '';
  console.log(`[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}${detailStr}`);
}

logEvent('info', 'LIFECYCLE', 'Application bootstrapping initialized...');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/todo'
});

pool.on('connect', () => logEvent('debug', 'DATABASE', 'New client connection allocated by the pool'));
pool.on('error', (err) => {
  logEvent('error', 'DATABASE', 'Unexpected error on an idle pool client', err.message);
  metrics.incrementCounter('db_errors_total');
});

const SAMPLE_TASKS = [
  'Review Q2 regional sales performance targets',
  'Approve pending vendor payments and invoice batches',
  'Prepare agenda for the upcoming quarterly board meeting',
  'Finalize job descriptions for senior engineering roles',
  'Coordinate travel itinerary and hotel bookings for client visit',
  'Update internal team milestone and project schedule',
  'Review tenant feedback and lease renewal agreements',
  'Submit monthly expense reconciliation statements',
  'Schedule performance feedback sessions with direct reports',
  'Sign off on updated corporate compliance policy documents'
];

const SQL_CREATE = `
  CREATE TABLE IF NOT EXISTS todos (
    id SERIAL PRIMARY KEY,
    task TEXT NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

logEvent('info', 'DATABASE', 'Executing database schema initialisation...');
pool.query(SQL_CREATE)
  .then(() => logEvent('info', 'DATABASE', 'Schema validation successful.'))
  .catch(err => logEvent('error', 'DATABASE', 'DB Init Error during bootstrap', err.message));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(`${BASE_PATH}/css`, express.static(path.join(__dirname, 'node_modules/@picocss/pico/css')));
app.use(`${BASE_PATH}/js/htmx`, express.static(path.join(__dirname, 'node_modules/htmx.org/dist')));

function recordHttpMetrics(req, res, durationMs) {
  const route = req.route ? req.route.path : req.path;
  const requestLabels = { method: req.method, route, status: String(res.statusCode) };
  metrics.incrementCounter('http_requests_total', requestLabels);
  if (res.statusCode >= 500) {
    metrics.incrementCounter('http_errors_total', requestLabels);
  }

  const durationLabels = { method: req.method, route };
  metrics.incrementCounter('http_request_duration_seconds_sum', durationLabels, durationMs / 1000);
  metrics.incrementCounter('http_request_duration_seconds_count', durationLabels);
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logEvent('info', 'HTTP', `${req.method} ${req.originalUrl} -> Status: ${res.statusCode} (${duration}ms)`);
    recordHttpMetrics(req, res, duration);
  });
  next();
});

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderTaskComponent(todo) {
  const isEdited = todo.updated_at.getTime() !== todo.created_at.getTime();
  
  const timeLabel = isEdited 
    ? `<span class="time-stamp edited-stamp"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Updated: ${formatTime(todo.updated_at)}</span>`
    : `<span class="time-stamp creation-stamp"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Added: ${formatTime(todo.created_at)}</span>`;

  const statusIcon = todo.is_completed
    ? `<svg class="status-icon icon-complete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg class="status-icon icon-active" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>`;

  const textClass = todo.is_completed ? 'task-text line-through' : 'task-text';

  return `
    <article id="todo-${todo.id}" class="todo-card">
      <div class="card-meta-layout">
        <span class="${textClass}">
          ${statusIcon}
          ${todo.task}
        </span>
        <div class="time-badge-container">
          ${timeLabel}
        </div>
      </div>
      <button hx-post="${BASE_PATH}/api/todos/${todo.id}/toggle"
              hx-target="#todo-list" 
              class="outline secondary action-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
        ${todo.is_completed ? 'Mark Active' : 'Mark Done'}
      </button>
    </article>
  `;
}

async function getRenderedTaskList() {
  const result = await pool.query('SELECT * FROM todos ORDER BY created_at DESC');
  if (result.rows.length === 0) {
    return `<p id="empty-state" class="empty-placeholder">Your list is currently empty.</p>`;
  }
  return result.rows.map(row => renderTaskComponent(row)).join('');
}

// Always available at the root, unprefixed, so probes and Locust (hitting the
// pod/Service directly) work regardless of BASE_PATH.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get(BASE_PATH ? [BASE_PATH, `${BASE_PATH}/`] : '/', async (req, res) => {
  try {
    const listHtml = await getRenderedTaskList();
    res.send(TEAM_PLANNER_TEMPLATE.replace('<!--TODO_LIST-->', listHtml));
  } catch (err) {
    res.status(500).send("Something went wrong loading the planner.");
  }
});

app.post(`${BASE_PATH}/api/todos`, async (req, res) => {
  try {
    await pool.query('INSERT INTO todos (task) VALUES ($1)', [req.body.task]);
    metrics.incrementCounter('tasks_created_total');
    res.status(201).send(await getRenderedTaskList());
  } catch (err) {
    metrics.incrementCounter('db_errors_total');
    res.status(500).json({ error: err.message });
  }
});

app.post(`${BASE_PATH}/api/todos/:id/toggle`, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE todos SET is_completed = NOT is_completed, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING is_completed',
      [req.params.id]
    );
    if (result.rows[0] && result.rows[0].is_completed) {
      metrics.recordTaskCompleted();
    }
    res.status(200).send(await getRenderedTaskList());
  } catch (err) {
    metrics.incrementCounter('db_errors_total');
    res.status(500).json({ error: err.message });
  }
});

app.post(`${BASE_PATH}/api/todos/seed`, async (req, res) => {
  try {
    await pool.query('DROP TABLE todos;').catch(() => {});
    await pool.query(SQL_CREATE);
    const queries = SAMPLE_TASKS.map(task => pool.query('INSERT INTO todos (task) VALUES ($1)', [task]));
    await Promise.all(queries);
    metrics.incrementCounter('tasks_created_total', null, SAMPLE_TASKS.length);
    res.status(201).send(await getRenderedTaskList());
  } catch (err) {
    metrics.incrementCounter('db_errors_total');
    res.status(500).json({ error: err.message });
  }
});

app.post(`${BASE_PATH}/api/todos/clean`, async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE todos;');
    res.status(200).send(await getRenderedTaskList());
  } catch (err) {
    metrics.incrementCounter('db_errors_total');
    res.status(500).json({ error: err.message });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE is_completed) AS complete,
             COUNT(*) FILTER (WHERE NOT is_completed) AS incomplete
      FROM todos
    `);
    metrics.setGauge('tasks_total', null, Number(counts.rows[0].total));
    metrics.setGauge('tasks_complete', null, Number(counts.rows[0].complete));
    metrics.setGauge('tasks_incomplete', null, Number(counts.rows[0].incomplete));

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.renderPrometheusText());
  } catch (err) {
    metrics.incrementCounter('db_errors_total');
    res.status(500).send('# Failed to collect metrics\n');
  }
});

const server = app.listen(port, () => {
  logEvent('info', 'LIFECYCLE', `Network listener active on port ${port}`);
});

const gracefulShutdown = (signal) => {
  server.close(() => {
    pool.end(() => {
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));