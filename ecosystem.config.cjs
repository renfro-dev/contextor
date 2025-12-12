module.exports = {
  apps: [
    {
      name: 'orchestrator-server',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.WEBHOOK_PORT || process.env.PORT || 3000
      }
    },
    {
      name: 'check-approvals',
      script: 'npm',
      args: ['run', 'dev', '--', 'check-approvals'],
      exec_mode: 'fork',
      cron_restart: '*/30 * * * *', // run every 30 minutes
      autorestart: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
