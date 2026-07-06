@echo off
rem -----------------------------------------------------------
rem GitHub Pages OPEN - build locally and publish to gh-pages
rem https://leecreizer.github.io/Webplaner/
rem -----------------------------------------------------------
setlocal
cd /d %~dp0

echo [1/3] build (base=/Webplaner/)...
call npx tsc -b || goto :err
call npx vite build --base=/Webplaner/ || goto :err

echo [2/3] push dist to gh-pages...
cd dist
type nul > .nojekyll
git init -b gh-pages
git add -A
git commit -m "deploy: local publish"
git push -f https://github.com/leecreizer/Webplaner.git gh-pages || goto :err
cd ..
rmdir /s /q dist\.git

echo [3/3] done. site: https://leecreizer.github.io/Webplaner/
echo (첫 공개나 Pages 설정이 풀린 경우: GitHub Settings - Pages - Branch: gh-pages 확인)
goto :eof

:err
echo [FAIL] publish failed.
exit /b 1