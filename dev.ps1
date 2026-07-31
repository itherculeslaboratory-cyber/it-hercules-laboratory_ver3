#requires -version 5.1
# V3-AIP-71: short alias. Thin wrapper so `dev.ps1` (the name referenced in the
# requirement text) and `dev-up.ps1` (the actual implementation) never drift -
# all the logic lives in dev-up.ps1 only.
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $repoRoot "dev-up.ps1")
exit $LASTEXITCODE
