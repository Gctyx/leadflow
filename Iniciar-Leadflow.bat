@echo off
setlocal
cd /d %~dp0
if not exist release\leadflow.cjs (
  echo Gerando launcher...
  npm run launcher:build
)
node release\leadflow.cjs start --yes
endlocal
