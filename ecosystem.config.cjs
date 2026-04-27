module.exports = {
  apps: [
    {
      name: 'clinic-api',
      script: './src/index.js',
      cwd: '/var/www/clinic/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,

      // Memory limit — restart if RSS exceeds this (1G is generous for a clinic API;
      // 512M catches real leaks before the VPS swaps out).
      max_memory_restart: '512M',

      // Exponential backoff on crashes: 100ms → 200ms → 400ms … up to 16s.
      // Prevents hammering the system if the DB is temporarily unreachable.
      exp_backoff_restart_delay: 100,

      // Stop restarting after 15 consecutive crashes in a short window.
      max_restarts: 15,

      // Structured log timestamps make it easy to correlate with nginx logs.
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/clinic/error.log',
      out_file: '/var/log/clinic/out.log',
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
}
