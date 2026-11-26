"""Test the add-on scripts on fixtures in Chromium: python -B tests/test_extension.py."""
import json
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://exon.exonproject.ru"

LOGIN = """<!doctype html><html lang="ru"><title>Войти в Экзон</title>
<div id="keycloakRoot">
  <form method="post" action="/auth/realms/SpringBoot/login-actions/authenticate">
    <label>Электронная почта <input name="username" type="text" required></label>
    <label>Пароль <input name="password" type="password" required></label>
    <button type="submit">Войти</button>
  </form>
</div>
"""
WORK = """<!doctype html><html lang="ru"><head><title>Проекты</title></head>
<body>
  <main>
    <h1>Проекты Экзона</h1>
    <a href="/projects/125?token=QUERY_SECRET#FRAGMENT_SECRET">Строительство</a>
    <a href="https://outside.invalid/tracker">Документация</a>
    <table><tr><th>№</th><th>Наименование</th></tr><tr><td>125</td><td>Объект №125</td></tr></table>
    <button data-testid="create-project" onclick="document.body.dataset.ran='1'">Создать проект</button>
    <input name="title" value="INPUT_SECRET" placeholder="Введите название">
    <input type="hidden" value="HIDDEN_SECRET">
    <textarea>TEXTAREA_SECRET</textarea>
    <div contenteditable="true">EDITABLE_SECRET<span>вложенный текст</span></div>
    <div hidden>HIDDEN_TEXT_SECRET</div>
    <div style="display:none">CSS_SECRET</div>
    <script>window.accountState = 'SCRIPT_SECRET';</script>
    <template>TEMPLATE_SECRET</template>
  </main>
</body></html>
"""


def main():
    attempts, external = [], []

    def dispatch(route):
        request = route.request
        url = urlsplit(request.url)
        if url.hostname != "exon.exonproject.ru":
            external.append(url.hostname)
            return route.abort()
        if request.method == "POST":
            attempts.append(parse_qs(request.post_data))
            return route.fulfill(body='<script>location.replace("/projects?token=PAGE_SECRET")</script>', content_type="text/html")
        if url.path == "/":
            return route.fulfill(body='<script>location.replace("/auth/realms/SpringBoot/protocol/openid-connect/auth?state=FIXTURE")</script>', content_type="text/html")
        if url.path.startswith(("/auth/", "/callback")):
            return route.fulfill(status=200, content_type="text/html; charset=UTF-8", body=LOGIN)
        return route.fulfill(status=200, content_type="text/html; charset=UTF-8", body=WORK)

    with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
        browser = p.chromium.launch_persistent_context(
            profile,
            headless=True,
            executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"),
        )
        try:
            browser.route("**/*", dispatch)
            page = browser.pages[0]
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            manifest = json.loads((ROOT / "manifest.json").read_text())
            scripts = manifest["content_scripts"][0]
            assert scripts["matches"] == [ORIGIN + "/*"]
            for path in ("auth", "callback"):
                assert ORIGIN + "/" + path + "/*" in scripts["exclude_matches"]

            # Unpacked extensions are blocked by this environment's browser policy.
            # Exercise the exact scripts on test-owned fixtures without changing policy.
            page.goto(ORIGIN)
            expect(page.get_by_label("Электронная почта")).to_be_visible()
            assert page.locator("#exon-addon-tools").count() == 0
            page.get_by_label("Электронная почта").fill("fixture@example.invalid")
            page.get_by_label("Пароль").fill("Synthetic password")
            page.get_by_role("button", name="Войти", exact=True).click()
            expect(page.get_by_role("heading", name="Проекты Экзона")).to_be_visible()
            for script in scripts["js"]:
                page.add_script_tag(content=(ROOT / script).read_text())
            action = page.get_by_role("button", name="Скачать страницу")
            expect(action).to_be_visible()
            with page.expect_download() as result:
                action.click()
            download = result.value
            assert download.suggested_filename.startswith("экзон-") and download.suggested_filename.endswith(".html")
            contents = download.path().read_text(encoding="utf-8")
            for value in ["Проекты Экзона", "Объект №125", 'data-testid="create-project"', 'data-exon-path="/projects/125"']:
                assert value in contents, value
            for value in ["_SECRET", "outside.invalid", "<script", "onclick=", "exon-addon-tools", "Скачать страницу"]:
                assert value not in contents, value
            assert attempts == [{"username": ["fixture@example.invalid"], "password": ["Synthetic password"]}]
            assert not external, external
            page.evaluate("history.pushState({}, '', '/callback?code=FIXTURE')")
            expect(action).to_be_hidden()
            page.evaluate("history.pushState({}, '', '/projects')")
            expect(action).to_be_visible()
            page.evaluate("""() => {
                const login = document.createElement('form');
                login.innerHTML = '<input name="password" type="password">';
                document.body.append(login);
            }""")
            expect(action).to_be_hidden()
            assert not errors, errors

            preview = os.getenv("EXON_PREVIEW")
            if preview:
                target = Path(preview)
                target.mkdir(parents=True, exist_ok=True)
                (target / "projects.html").write_text(contents, encoding="utf-8")
                page.locator("form").evaluate("(form) => form.remove()")
                expect(action).to_be_visible()
                page.screenshot(path=target / "work-page.png")
        finally:
            browser.close()
    print("PASS: штатная форма входа, видимость кнопки, загрузка HTML и очистка копии")


if __name__ == "__main__":
    main()
