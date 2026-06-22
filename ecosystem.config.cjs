module.exports = {
  apps: [
    {
      name: 'MindMap',
      script: 'server.cjs',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        PORT: 5010,
        NODE_ENV: 'production'
      }
    }
  ]
};
