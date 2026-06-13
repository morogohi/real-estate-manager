# -*- coding: utf-8 -*-
"""
desktop.py - 부동산 통합 관리 시스템 데스크톱 앱 (pywebview)

- 웹앱(index.html)을 독립 창에서 실행합니다.
- 프로그램 모드에서는 데이터를 브라우저 저장소 대신
  exe(또는 이 파일)와 같은 폴더의 '부동산관리_데이터.json'에 저장합니다.
"""
import os
import sys
import webbrowser

import webview


def base_dir():
    """데이터 파일을 둘 폴더: exe(빌드) 또는 소스 파일이 있는 폴더"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def resource_path(rel):
    """index.html 등 번들 리소스 경로 (PyInstaller --onefile 대응)"""
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, rel)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), rel)


DATA_FILE = os.path.join(base_dir(), '부동산관리_데이터.json')


class Api:
    """JS에서 window.pywebview.api 로 호출되는 파일 저장소"""

    def load_data(self):
        try:
            with open(DATA_FILE, encoding='utf-8') as f:
                return f.read()
        except FileNotFoundError:
            return ''
        except Exception:
            return ''

    def save_data(self, payload):
        tmp = DATA_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(payload)
        os.replace(tmp, DATA_FILE)  # 저장 중 중단되어도 원본 보호
        return True

    def data_file_path(self):
        return DATA_FILE

    def open_external(self, url):
        """지도·정부 사이트 링크를 기본(시스템) 브라우저로 열기"""
        try:
            webbrowser.open(url)
            return True
        except Exception:
            return False


def main():
    webview.create_window(
        '부동산 통합 관리 시스템',
        resource_path('index.html'),
        js_api=Api(),
        width=1380,
        height=900,
        min_size=(1000, 700),
    )
    webview.start()


if __name__ == '__main__':
    main()
