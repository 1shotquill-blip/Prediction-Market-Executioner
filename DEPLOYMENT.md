# DEPLOYMENT GUIDE

## Prerequisites

- Ubuntu Server 20.04 LTS or later
- 4+ CPU cores
- 8+ GB RAM
- 50+ GB disk space
- PostgreSQL 13+
- Redis 6+
- Node.js 18+

## One-Command Bootstrap

```bash
cd /opt/poly-shore
./install.sh
```
This automatically:
- Installs system dependencies
- Installs Node.js packages (pnpm)
- Creates database schema
- Configures PM2 ecosystem
- Sets up systemd service
- Initializes journal database
- Validates configuration

## Configuration

### 1. Environment File
```bash
cp .env.example .env
vim .env
```
Required Variables:
```bash
# Execution Mode
NODE_ENV=production
EXECUTION_MODE=live  # or 'paper' for testing

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/poly_shore
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Polymarket
POLYMARKET_PRIVATE_KEY=xxx
POLYMARKET_FUNDER_ADDRESS=xxx
POLYMARKET_API_KEY=xxx
POLYMARKET_API_SECRET=xxx
POLYMARKET_API_PASSPHRASE=xxx

# Risk Limits
MAX_POSITION_USD=100
MAX_DRAWDOWN_PCT=8
KILLSWITCH_ARMED=true

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
PROMETHEUS_PUSH_GATEWAY=http://localhost:9091
SENTRY_DSN=https://xxx@sentry.io/xxx

# LLM
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=xxx
```

### 2. Database Setup
```bash
# Create database
sudo -u postgres createdb poly_shore

# Run migrations
pnpm db:push

# Verify schema
sudo -u postgres psql -d poly_shore -c "\dt"
```

### 3. Redis Setup
```bash
# Install Redis
sudo apt-get install redis-server

# Enable service
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify
redis-cli ping
```

## Deployment

### Start Service
```bash
sudo systemctl start poly-shore
```

### Check Status
```bash
sudo systemctl status poly-shore
```

### View Logs
```bash
# Recent logs
journalctl -u poly-shore -f

# Application logs
tail -f logs/combined.log

# Error logs
tail -f logs/error.log
```

## Metrics
```bash
# Prometheus endpoint
curl http://localhost:9090/metrics

# Grafana dashboard
http://localhost:3000
```

## Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Execution Dashboard
```bash
curl http://localhost:3000/api/trpc/execution.getStatus
```

### Recent Orders
```bash
curl http://localhost:3000/api/trpc/orders.recent
```

## Troubleshooting

### WebSocket Connection Issues
```bash
# Check Redis connectivity
redis-cli ping

# Check exchange API
curl https://clob.polymarket.com/health

# Enable debug logs
export LOG_LEVEL=debug
sudo systemctl restart poly-shore
```

### High Order Latency
```bash
# Check Redis performance
redis-cli --latency

# Check database performance
psql -d poly_shore -c "EXPLAIN ANALYZE SELECT * FROM orders LIMIT 1;"

# Check network
mtr clob.polymarket.com
```

### Recovery After Crash
```bash
# Automatic recovery starts on restart
sudo systemctl start poly-shore

# Check recovery status
journalctl -u poly-shore | grep Recovery

# Manual recovery if needed
pnpm tsx scripts/recovery.ts
```

## Upgrades

### Backup Before Upgrade
```bash
# PostgreSQL backup
pg_dump poly_shore > backup-$(date +%Y%m%d).sql

# Redis backup
redis-cli BGSAVE

# Configuration backup
cp .env .env.backup
```

### Perform Upgrade
```bash
# Stop service
sudo systemctl stop poly-shore

# Pull latest code
git pull origin main

# Install new dependencies
pnpm install

# Run migrations
pnpm db:push

# Start service
sudo systemctl start poly-shore

# Verify
journalctl -u poly-shore -f
```

## Performance Tuning

### PostgreSQL
```sql
-- Increase connections
alter system set max_connections = 200;

-- Optimize cache
alter system set shared_buffers = '4GB';
alter system set effective_cache_size = '12GB';

-- Apply changes
SELECT pg_reload_conf();
```

### Redis
```bash
# Increase memory
sudo vim /etc/redis/redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru

# Restart
sudo systemctl restart redis-server
```

### Network
```bash
# Increase file descriptors
ulimit -n 65536

# TCP tuning
sudo sysctl -w net.core.rmem_max=134217728
sudo sysctl -w net.core.wmem_max=134217728
```
