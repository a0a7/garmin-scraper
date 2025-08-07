@echo off
REM Garmin Sync Worker Deployment Script for Windows
REM This script sets up and deploys the Cloudflare Worker for Garmin data sync

echo [SETUP] Setting up Garmin Sync Cloudflare Worker...

REM Check if wrangler is installed
wrangler --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Wrangler CLI not found. Please install it first:
    echo    npm install -g wrangler
    pause
    exit /b 1
)

REM Login to Cloudflare (if not already logged in)
echo [AUTH] Checking Cloudflare authentication...
wrangler whoami >nul 2>&1
if errorlevel 1 (
    echo [AUTH] Please log in to Cloudflare:
    wrangler login
)

REM Create D1 database
echo [DATABASE] Creating D1 database...
echo Please save the database ID that will be displayed and update wrangler.toml
wrangler d1 create garmin-activities

REM Create KV namespace
echo [KV] Creating KV namespace...
echo Please save the namespace ID that will be displayed and update wrangler.toml
wrangler kv:namespace create "GARMIN_SYNC_KV"

echo.
echo [IMPORTANT] Update wrangler.toml with the IDs shown above before continuing!
echo    Press any key when you've updated wrangler.toml...
pause >nul

REM Set up database schema
echo [SCHEMA] Setting up database schema...
wrangler d1 execute garmin-activities --file=./database-schema.sql

REM Set environment variables
echo [SECRETS] Setting up environment variables...
set /p garmin_username="Enter your Garmin Connect email/username: "
echo %garmin_username% | wrangler secret put GARMIN_USERNAME

set /p garmin_password="Enter your Garmin Connect password: "
echo %garmin_password% | wrangler secret put GARMIN_PASSWORD

set /p webhook_secret="Enter webhook secret (optional, press Enter to skip): "
if not "%webhook_secret%"=="" (
    echo %webhook_secret% | wrangler secret put GARMIN_WEBHOOK_SECRET
)

echo.
echo [RIDEWITHGPS] Setting up Ride with GPS integration (optional)...
set /p ridewithgps_key="Enter your Ride with GPS API key (press Enter to skip): "
if not "%ridewithgps_key%"=="" (
    echo %ridewithgps_key% | wrangler secret put RIDEWITHGPS_API_KEY
    set /p ridewithgps_secret="Enter your Ride with GPS API secret: "
    echo %ridewithgps_secret% | wrangler secret put RIDEWITHGPS_API_SECRET
)

REM Deploy the worker
echo [DEPLOY] Deploying worker...
wrangler deploy

echo.
echo [SUCCESS] Deployment complete!
echo.
echo [ENDPOINTS] Your worker endpoints:
echo    Health check: https://your-worker.your-subdomain.workers.dev/health
echo    Sync status: https://your-worker.your-subdomain.workers.dev/status
echo    Manual sync: https://your-worker.your-subdomain.workers.dev/sync
echo    Ride with GPS auth: https://your-worker.your-subdomain.workers.dev/auth/ridewithgps
echo    Ride with GPS webhook: https://your-worker.your-subdomain.workers.dev/ridewithgps-webhook
echo.
echo [SCHEDULE] Scheduled sync: Daily at 2 AM UTC
echo.
echo [MONITORING] Monitor logs with: wrangler tail
echo [TESTING] Test webhook with: curl -X POST https://your-worker.your-subdomain.workers.dev/sync
pause
