# Runs only the disposable local Ishikeit test lab (not production).
# All test containers, networks and PostgreSQL data are removed afterwards.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'compose.test.yaml'
$project = 'ishikeit-phase1-test'
$previous = [Environment]::GetEnvironmentVariable('COMPOSE_DISABLE_ENV_FILE', 'Process')
$env:COMPOSE_DISABLE_ENV_FILE = '1'
$exitCode = 1
$cleanupExitCode = 0

try {
    & docker version --format '{{.Server.Version}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop engine is unavailable.' }

    & docker compose -f $compose -p $project config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Disposable Compose configuration is invalid.' }

    & docker compose -f $compose -p $project up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL did not become healthy.' }

    & docker compose -f $compose -p $project run --rm -T tests
    $exitCode = $LASTEXITCODE
}
finally {
    # This targets only the exact dedicated Compose project.
    & docker compose -f $compose -p $project down --volumes --remove-orphans
    $cleanupExitCode = $LASTEXITCODE
    if ($cleanupExitCode -ne 0) {
        Write-Warning 'Disposable test cleanup failed; inspect the ishikeit-phase1-test Docker project only.'
    }
    [Environment]::SetEnvironmentVariable('COMPOSE_DISABLE_ENV_FILE', $previous, 'Process')
}

if ($cleanupExitCode -ne 0) { exit 2 }
if ($exitCode -ne 0) { exit $exitCode }
Write-Output 'Ishikeit isolated Docker test suite passed; temporary containers and volumes removed.'
