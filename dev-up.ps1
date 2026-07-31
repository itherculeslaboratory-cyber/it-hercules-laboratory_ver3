#requires -version 5.1
# V3-AIP-71: one-command Docker-only dev stack launcher.
# No Node required on the host - only Docker Desktop (or a Docker Engine +
# `docker compose` plugin) needs to be installed.
#
# What this does:
#   1. Checks that `docker` and `docker compose` are on PATH.
#   2. Detects port conflicts on 8787 (API) and 3000 (web) before starting.
#   3. Runs `docker compose up --build -d`.
#   4. Polls the API /health endpoint and the web root until both answer,
#      or times out.
#
# Usage: powershell -ExecutionPolicy Bypass -File dev-up.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

function Test-CommandExists($name) {
    $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "docker")) {
    Write-Error "docker not found on PATH. Install Docker Desktop first: https://www.docker.com/products/docker-desktop/"
    exit 1
}

# `docker compose` (v2 plugin) vs legacy `docker-compose` binary - support both.
$composeCmd = @("docker", "compose")
try {
    & docker compose version *> $null
} catch {
    if (Test-CommandExists "docker-compose") {
        $composeCmd = @("docker-compose")
    } else {
        Write-Error "Neither 'docker compose' nor 'docker-compose' works. Update Docker Desktop."
        exit 1
    }
}

function Test-PortFree($port) {
    $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -eq $inUse -or $inUse.Count -eq 0)
}

$portsToCheck = @(8787, 3000)
$conflicts = @()
foreach ($p in $portsToCheck) {
    if (-not (Test-PortFree $p)) {
        $conflicts += $p
    }
}
if ($conflicts.Count -gt 0) {
    Write-Warning ("Port(s) already in use: " + ($conflicts -join ", ") + ". docker-compose.yml maps 8787->api and 3000->web; free these ports or edit docker-compose.yml before continuing.")
    exit 1
}

if (-not (Test-Path (Join-Path $repoRoot "apps\api\.dev.vars"))) {
    Write-Warning "apps/api/.dev.vars not found. The worker may boot without some secrets configured (this script never reads that file's contents)."
}

Write-Host "Starting API (8787) + web (3000) via docker compose..." -ForegroundColor Cyan
& $composeCmd[0] $composeCmd[1..($composeCmd.Length - 1)] up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker compose up failed (exit $LASTEXITCODE). See output above."
    exit $LASTEXITCODE
}

function Wait-Http($url, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -lt 500) { return $true }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

Write-Host "Waiting for API health (http://127.0.0.1:8787/health)..." -ForegroundColor Cyan
$apiOk = Wait-Http "http://127.0.0.1:8787/health" 90
if (-not $apiOk) {
    Write-Error "API did not become healthy within 90s. Run 'docker compose logs api' to inspect."
    exit 1
}
Write-Host "API OK." -ForegroundColor Green

Write-Host "Waiting for web (http://127.0.0.1:3000/)..." -ForegroundColor Cyan
$webOk = Wait-Http "http://127.0.0.1:3000/" 90
if (-not $webOk) {
    Write-Error "web did not respond within 90s. Run 'docker compose logs web' to inspect."
    exit 1
}
Write-Host "web OK." -ForegroundColor Green

Write-Host ""
Write-Host "Stack is up:" -ForegroundColor Green
Write-Host "  API  -> http://127.0.0.1:8787/health"
Write-Host "  Web  -> http://127.0.0.1:3000/"
Write-Host ""
Write-Host "Stop with:  docker compose down"
