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
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
}
