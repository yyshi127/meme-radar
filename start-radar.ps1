$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node .\src\index.mjs watch
