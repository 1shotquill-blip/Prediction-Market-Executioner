# Railway Deployment Config

## Live URL
https://poly-shore-production.up.railway.app

## IDs
| Name | ID |
|---|---|
| Project | 940ddb65-7c6a-47d2-86d0-606c90dcd69b |
| Environment | cb01de75-2bf4-4f40-b529-dc2f224a3ce1 |
| POLY-SHORE Service | 34053d25-39a7-48d3-b041-a306b66ce5fe |
| MySQL Service | a94c78a5-d989-4c2f-b627-8260d808da93 |

## Environment Variables (set on POLY-SHORE service)
| Variable | Value |
|---|---|
| DATABASE_URL | ${{MySQL.MYSQL_URL}} |
| NODE_ENV | production |
| LIVE_TRADING_ENABLED | false |
| KILLSWITCH_ARMED | false |
| DEEP_EDGE_MIN_SCORE | 0.7 |
| DEEP_EDGE_MIN_CONFIDENCE | 0.8 |
| POLYMARKET_HOST | https://clob.polymarket.com |
| POLYMARKET_CHAIN_ID | 137 |
| KILLSWITCH_NOTIONAL_CAP_USD | 500 |
| KILLSWITCH_ORDERS_PER_MIN | 10 |
| KILLSWITCH_PER_MARKET_CAP_USD | 100 |
| KILLSWITCH_MAX_SPREAD_BPS | 500 |

> Secrets (project token, MySQL password, API keys) are stored in Railway's
> environment variables UI — never commit them to this file.
