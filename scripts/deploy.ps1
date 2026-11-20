<#
.SYNOPSIS
  Ships main to production (macro.my.id): push, pull on the VM, rebuild, purge Cloudflare, verify.

.DESCRIPTION
  Run only after the owner has reviewed the change locally and said "ship". Each step waits for the
  previous one and stops on the first failure:
    1. The checkout is on a clean `main`.
    2. git push origin main, then confirm GitHub has the local HEAD.
    3. On the VM: git pull --ff-only, then confirm the VM is on the same commit.
    4. Rebuild macro-api and wait for it to report healthy (a failed build leaves the old one running).
    5. Purge the Cloudflare cache (cf CLI, OAuth login on this PC).
    6. Fetch -VerifyPath and check it contains -Expect, a string only the new code has.

.EXAMPLE
  ./scripts/deploy.ps1 -Expect 'Load your own deck'
  ./scripts/deploy.ps1 -Expect 'Privacy policy' -VerifyPath '/privacy'
#>
param(
  [Parameter(Mandatory)] [string] $Expect,
  [string] $VerifyPath = '/',
  [switch] $SkipPurge
)
$ErrorActionPreference = 'Stop'
$Vm = 'root@139.180.219.252'
$Key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$Zone = '484e7c4c286d02411f56c6a808bd5257'
$Compose = 'docker compose -f deploy/macro/docker-compose.yml'
function Step($text) { Write-Host "==> $text" }
function Fail($text) { Write-Host "FAILED: $text" -ForegroundColor Red; exit 1 }
function OnVm($cmd) { ssh -i $Key -o BatchMode=yes $Vm "cd /opt/macro && $cmd" }

Step 'Checking the local checkout'
if ((git branch --show-current) -ne 'main') { Fail 'not on main' }
if (git status --porcelain --untracked-files=no) { Fail 'uncommitted changes' }
$head = git rev-parse HEAD

Step "Pushing $($head.Substring(0, 7)) to GitHub"
git push origin main
if ($LASTEXITCODE -ne 0) { Fail 'git push' }
$remote = (git ls-remote origin refs/heads/main) -split '\s+' | Select-Object -First 1
if ($remote -ne $head) { Fail "GitHub main is $remote, expected $head" }

Step 'Pulling on the VM'
OnVm 'git pull --ff-only origin main'
if ($LASTEXITCODE -ne 0) { Fail 'git pull on the VM (check untracked files: git status --untracked-files=all)' }
$vmHead = (OnVm 'git rev-parse HEAD').Trim()
if ($vmHead -ne $head) { Fail "VM is on $vmHead, expected $head" }

Step 'Rebuilding macro-api (a few minutes)'
OnVm "$Compose up -d --build macro-api"
if ($LASTEXITCODE -ne 0) { Fail 'image build; the previous container is still serving' }
$healthy = $false
for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
  Start-Sleep 4
  $healthy = (OnVm "$Compose ps --format '{{.Service}} {{.Status}}'") -match 'macro-api .*\(healthy\)'
}
if (-not $healthy) { Fail 'macro-api did not report healthy within 2 minutes' }

if (-not $SkipPurge) {
  Step 'Purging the Cloudflare cache'
  cf cache purge --zone $Zone --body '{"purge_everything":true}' --force | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'cache purge (run cf auth login?)' }
}

Step "Verifying https://macro.my.id$VerifyPath"
$body = (curl.exe -s "https://macro.my.id$VerifyPath`?v=$(Get-Random)") -join "`n"
if (-not $body.Contains($Expect)) { Fail "the live page does not contain '$Expect'" }
Write-Host "Shipped $($head.Substring(0, 7)); macro.my.id serves it." -ForegroundColor Green
