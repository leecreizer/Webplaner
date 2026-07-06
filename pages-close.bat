@echo off
rem -----------------------------------------------------------
rem GitHub Pages CLOSE - delete gh-pages branch (site goes 404)
rem 소스에는 영향 없음. 다시 열기: pages-open.bat
rem -----------------------------------------------------------
cd /d %~dp0
git push https://github.com/leecreizer/Webplaner.git --delete gh-pages
if errorlevel 1 (
  echo [INFO] gh-pages 브랜치가 이미 없거나 삭제 실패 - 현재 상태 확인 필요
) else (
  echo [OK] closed. https://leecreizer.github.io/Webplaner/ = 404
)