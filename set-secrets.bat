@echo off
REM Script to set/update Cloudflare Worker secrets
REM Run this after deployment to restore lost secrets

echo [SECRETS] Setting up Cloudflare Worker secrets...

echo.
echo [GARMIN] Garmin Connect credentials:
set /p garmin_username="Enter your Garmin Connect email/username: "
echo %garmin_username% | wrangler secret put GARMIN_USERNAME

set /p garmin_password="Enter your Garmin Connect password: "
echo %garmin_password% | wrangler secret put GARMIN_PASSWORD

echo.
echo [WEBHOOK] Webhook security (optional):
set /p webhook_secret="Enter webhook secret (press Enter to skip): "
if not "%webhook_secret%"=="" (
    echo %webhook_secret% | wrangler secret put GARMIN_WEBHOOK_SECRET
)

echo.
echo [RIDEWITHGPS] Ride with GPS API credentials (optional):
set /p ridewithgps_key="Enter your Ride with GPS API key (press Enter to skip): "
if not "%ridewithgps_key%"=="" (
    echo %ridewithgps_key% | wrangler secret put RIDEWITHGPS_API_KEY
    set /p ridewithgps_secret="Enter your Ride with GPS API secret: "
    echo %ridewithgps_secret% | wrangler secret put RIDEWITHGPS_API_SECRET
)

echo.
echo [SUCCESS] Secrets have been set!
echo.
echo [VERIFY] Current secrets:
wrangler secret list

pause
