@echo off
chcp 65001 > nul
REM ============================================================
REM  부동산 통합 관리 시스템 - 데스크톱 프로그램(.exe) 빌드 스크립트
REM  화면(index.html, js, css)을 수정한 뒤 이 파일을 더블클릭하면
REM  dist\부동산관리시스템.exe 가 새로 만들어집니다.
REM ============================================================
cd /d "%~dp0"

echo [1/2] 필요한 패키지 확인/설치 중...
python -m pip install --quiet --user pywebview pyinstaller
if errorlevel 1 (
  echo.
  echo [오류] 패키지 설치에 실패했습니다. 인터넷 연결과 Python 설치를 확인하세요.
  pause
  exit /b 1
)

echo [2/2] 프로그램(exe) 빌드 중... (수십 초 걸릴 수 있습니다)
python -m PyInstaller --noconfirm "부동산관리시스템.spec"
if errorlevel 1 (
  echo.
  echo [오류] 빌드에 실패했습니다. 위 메시지를 확인하세요.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  빌드 완료!  ->  dist\부동산관리시스템.exe
echo ============================================================
pause
