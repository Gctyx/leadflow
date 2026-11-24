@echo off
setlocal
cd /d %~dp0
node release\leadflow.cjs stop
endlocal
