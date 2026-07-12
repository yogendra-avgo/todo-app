const METRIC_DEFINITIONS = {
  app_uptime_seconds: { type: 'gauge', help: 'Time in seconds since the process started.' },
  http_requests_total: { type: 'counter', help: 'Total number of HTTP requests handled.' },
  http_errors_total: { type: 'counter', help: 'Total number of HTTP requests that resulted in a 5xx response.' },
  http_request_duration_seconds_sum: { type: 'counter', help: 'Cumulative HTTP request duration in seconds, per method/route.' },
  http_request_duration_seconds_count: { type: 'counter', help: 'Count of HTTP requests measured for duration, per method/route.' },
  tasks_created_total: { type: 'counter', help: 'Total number of tasks ever created.' },
  tasks_completed_total: { type: 'counter', help: 'Total number of times a task was marked complete.' },
  tasks_completed_last_5m: { type: 'gauge', help: 'Number of tasks marked complete in the last 5 minutes.' },
  tasks_total: { type: 'gauge', help: 'Current total number of tasks.' },
  tasks_complete: { type: 'gauge', help: 'Current number of completed tasks.' },
  tasks_incomplete: { type: 'gauge', help: 'Current number of incomplete tasks.' },
  db_errors_total: { type: 'counter', help: 'Total number of database errors encountered.' },
  process_resident_memory_bytes: { type: 'gauge', help: 'Resident memory size in bytes.' }
};

// In-memory metrics store. incrementCounter/setGauge are the only functions that
// touch this state, so swapping it for Redis (or another external store) later
// only means rewriting those two functions, not every call site.
const metricsStore = {
  startTime: Date.now(),
  values: new Map(),
  taskCompletionTimestamps: []
};

function labelKey(name, labels) {
  if (!labels) return name;
  const parts = Object.keys(labels).sort().map(k => `${k}="${labels[k]}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

function incrementCounter(name, labels, value = 1) {
  const key = labelKey(name, labels);
  metricsStore.values.set(key, (metricsStore.values.get(key) || 0) + value);
}

function setGauge(name, labels, value) {
  metricsStore.values.set(labelKey(name, labels), value);
}

function recordTaskCompleted() {
  incrementCounter('tasks_completed_total');
  metricsStore.taskCompletionTimestamps.push(Date.now());
}

function getTasksCompletedLast5m() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  metricsStore.taskCompletionTimestamps = metricsStore.taskCompletionTimestamps.filter(ts => ts >= cutoff);
  return metricsStore.taskCompletionTimestamps.length;
}

function renderPrometheusText() {
  setGauge('app_uptime_seconds', null, Number(((Date.now() - metricsStore.startTime) / 1000).toFixed(3)));
  setGauge('tasks_completed_last_5m', null, getTasksCompletedLast5m());
  setGauge('process_resident_memory_bytes', null, process.memoryUsage().rss);

  const seriesByName = new Map();
  for (const [key, value] of metricsStore.values) {
    const name = key.split('{')[0];
    if (!seriesByName.has(name)) seriesByName.set(name, []);
    seriesByName.get(name).push(`${key} ${value}`);
  }

  const lines = [];
  for (const [name, def] of Object.entries(METRIC_DEFINITIONS)) {
    const series = seriesByName.get(name);
    if (!series) continue;
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} ${def.type}`);
    lines.push(...series);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  incrementCounter,
  setGauge,
  recordTaskCompleted,
  renderPrometheusText
};
