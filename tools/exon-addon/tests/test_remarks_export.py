"""Drive the local tool and the Exon forms with synthetic data in Chromium."""
import asyncio
import base64
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
ORIGIN = "https://exon.exonproject.ru"
TOOL = "https://local-extension.invalid"
AUTH = "/auth/realms/SpringBoot/protocol/openid-connect/auth"
POST = "/auth/realms/SpringBoot/login-actions/authenticate"
REMARKS = "/projects/test-project/buildControl/remarks"
LOGIN = """<!doctype html><div id="keycloakRoot">
<form novalidate>
<label>Электронная почта <input name="username" type="text" required></label>
<label>Пароль <input name="password" type="password" required></label>
<button type="submit">Войти</button>
</form></div>
<form hidden id="receiver" action="/auth/realms/SpringBoot/login-actions/authenticate" method="post">
<input type="hidden" name="username"><input type="hidden" name="password"></form>
<script>
document.querySelector('#keycloakRoot form').onsubmit = event => {
    event.preventDefault();
    for (const key of ['username', 'password']) document.querySelector('#receiver').elements[key].value = event.target.elements[key].value;
    document.querySelector('#receiver').submit();
};
</script>"""
TABLE = """<!doctype html><style>button,input{margin:3px}</style>
<div class="MuiDataGrid-root" id="table">
    <div class="searchAndFiltersToolbar"><button data-testid="reset-filters-btn">Сбросить фильтры</button></div>
    <div role="grid"><div role="columnheader">
      <input name="select_all_rows" type="checkbox" aria-label="Выбрать все строки">
    </div></div>
    <div class="MuiDataGrid-footerContainer">
      <p class="MuiDataGrid-selectedRowCount"></p>
      <p class="MuiTablePagination-displayedRows"></p>
      <button role="combobox" aria-label="rows per page">100</button>
      <button data-testid="table-first-page-btn">Первая</button>
      <button data-testid="table-next-page-btn">Следующая</button>
      <button id="select-global" hidden></button>
      <button id="bulk" hidden>Выбрать действие</button>
    </div>
</div>
<div id="menu" hidden></div>
<script>
const scenario = CASE;
const lookup = s => document.querySelector(s);
const check = lookup('input[name=select_all_rows]');
const reset = lookup('[data-testid=reset-filters-btn]');
const next = lookup('[data-testid=table-next-page-btn]');
const first = lookup('[data-testid=table-first-page-btn]');
const picker = lookup('[role=combobox]');
const all = lookup('#select-global');
const bulk = lookup('#bulk');
const table = lookup('#table');
const menu = lookup('#menu');
let selected = 0, total = scenario.filtered ? 2 : scenario.total, start = scenario.start || 1, size = 100;
function draw() {
    const end = Math.min(start + size - 1, total);
    lookup('.MuiTablePagination-displayedRows').textContent = total ? start + '–' + end + ' из ' + total : '0–0 из 0';
    lookup('.MuiDataGrid-selectedRowCount').textContent = selected ? 'Выбрано: ' + selected + ' строк' : '';
    check.checked = selected >= end && total > 0;
    check.disabled = !total;
    next.disabled = end >= total;
    first.disabled = start === 1;
    bulk.hidden = !selected;
    all.hidden = !scenario.global || !selected || selected === total;
    all.textContent = 'Выбрать все ' + total + ' строк';
}
reset.disabled = !scenario.filtered;
reset.onclick = () => { total = scenario.total; reset.disabled = true; draw(); };
check.onclick = () => { selected = check.checked ? Math.min(start + size - 1, total) : 0; draw(); };
all.onclick = () => { selected = total; draw(); };
next.onclick = () => {
    start += size;
    if (!scenario.preserve) selected = 0;
    draw();
};
first.onclick = () => { start = 1; selected = 0; draw(); };
function reveal(html) { table.setAttribute('aria-hidden', 'true'); menu.innerHTML = html; menu.hidden = false; }
function close() { menu.hidden = true; table.removeAttribute('aria-hidden'); }
picker.onclick = () => {
    const extra = scenario.larger ? '<button role="option">500</button>' : '';
    reveal('<div role="listbox"><button role="option" aria-selected="true">100</button>' + extra + '</div>');
    for (const option of menu.querySelectorAll('button')) option.onclick = () => {
      const value = Number(option.textContent);
      if (value !== size) { size = value; start = 1; selected = 0; }
      close();
      draw();
    };
};
bulk.onclick = () => {
    reveal('<button role="menuitem">Скачать в xls</button><button role="menuitem">Удалить</button>');
    menu.querySelector('button').onclick = () => {
        document.body.dataset.exportCount = selected;
        const bytes = Uint8Array.from(atob(WORKBOOK), c => c.charCodeAt(0));
        const download = document.createElement('a');
        download.href = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.ms-excel'}));
        download.download = 'document-remarks.xls';
        download.click();
        close();
    };
    menu.querySelector('button:last-child').onclick = () => document.body.dataset.wrongAction = 'true';
};
draw();
</script>"""
INIT = """() => {
if (location.origin !== 'https://local-extension.invalid') return;
window.chrome.tabs = {
    create: options => exonTestCall('create', options),
    get: id => exonTestCall('get', {id}),
    update: (id, options) => exonTestCall('update', {id, ...options})
};
window.chrome.scripting = {
    executeScript: ({target, func, args}) => exonTestCall('script', {id: target.tabId, code: func.toString(), args})
};
window.showDirectoryPicker = async () =>
    (await navigator.storage.getDirectory()).getDirectoryHandle('Тестовая папка', {create:true});
FileSystemHandle.prototype.queryPermission = async () => 'granted';
}"""


def workbook_bytes():
    return subprocess.check_output(
        ["node", "-e", """
          const fs = require('node:fs'), vm = require('node:vm'), scope = {};
          vm.runInNewContext(fs.readFileSync('./assets/remarks/xlsx.full.min.js', 'utf8'), scope);
          const x = scope.XLSX;
          const book = x.utils.book_new();
          x.utils.book_append_sheet(book, x.utils.aoa_to_sheet([['Номер','Статус'],[125,'К устранению']]), 'Реестр');
          process.stdout.write(Buffer.from(x.write(book,{type:'array',bookType:'biff8'})));
        """],
        cwd=REPO,
    )


async def run(chromium, profile):
    workbook = workbook_bytes()
    binary = json.dumps(base64.b64encode(workbook).decode())
    browser = await chromium.launch_persistent_context(
        profile, headless=True, executable_path=os.getenv("CHROMIUM") or shutil.which("chromium")
    )
    attempts, visited, errors, tabs, downloads = [], [], [], {}, asyncio.Queue()
    case = {"total": 34, "filtered": True}
    bad_action = False

    async def route_request(route):
        request = route.request
        uri = urlsplit(request.url)
        host = f"{uri.scheme}://{uri.netloc}"
        if host == TOOL:
            name = uri.path.strip("/")
            if name not in {"popup.html", "popup.css", "popup.js", "vault.js", "export-page.js", "export.js"}:
                return await route.abort()
            return await route.fulfill(path=ROOT / name)
        if host != ORIGIN:
            visited.append(host)
            return await route.abort()
        if request.method == "POST":
            assert uri.path == POST
            attempts.append(parse_qs(request.post_data))
            return await route.fulfill(body='<script>location.replace("/projects")</script>',
                                       headers={"set-cookie": "fixture_session=1; Path=/; Secure"}, content_type="text/html")
        if uri.path == AUTH:
            html = LOGIN.replace('action="' + POST, 'action="https://wrong.invalid' + POST) if bad_action else LOGIN
            return await route.fulfill(body=html, content_type="text/html; charset=utf-8")
        if uri.path == REMARKS and (bad_action or "fixture_session=" not in (await request.header_value("cookie") or "")):
            return await route.fulfill(body=f'<script>location.replace("{AUTH}")</script>', content_type="text/html")
        if uri.path == REMARKS:
            html = TABLE.replace("CASE;", json.dumps(case) + ";").replace("atob(WORKBOOK)", "atob(" + binary + ")")
            return await route.fulfill(body=html, content_type="text/html; charset=utf-8")
        return await route.fulfill(body="<h1>Проекты</h1>", content_type="text/html; charset=utf-8")

    async def api(source, method, call):
        if method == "create":
            tab = await browser.new_page()
            tab.on("pageerror", lambda error: errors.append(str(error)))
            tab.on("download", downloads.put_nowait)
            ident = len(tabs) + 1
            tabs[ident] = tab
            await tab.goto(call["url"])
            return {"id": ident}
        tab = tabs[call["id"]]
        if method == "get":
            return {"id": call["id"], "status": "complete", "url": tab.url}
        if method == "update":
            if "url" in call:
                await tab.goto(call["url"])
            if call.get("active"):
                await tab.bring_to_front()
            return {"id": call["id"]}
        result = await tab.evaluate("({code, args}) => (0,eval)('(' + code + ')')(...args)", call)
        return [{"result": result}]

    await browser.route("**/*", route_request)
    await browser.expose_binding("exonTestCall", api)
    await browser.add_init_script(script=f"({INIT})()")
    tool = browser.pages[0]
    tool.on("pageerror", lambda error: errors.append(str(error)))
    try:
        await tool.goto(TOOL + "/popup.html")
        await tool.get_by_role("button", name="Выбрать папку", exact=True).click()
        await tool.get_by_label("Логин").fill("fixture@example.invalid")
        await tool.get_by_label("Пароль").fill("Синтетический пароль")
        await tool.get_by_role("button", name="Сохранить данные входа").click()
        await expect(tool.locator("#vault-status")).to_contain_text("Данные входа сохранены")
        raw = await tool.evaluate("""async () => {
            const parent = await showDirectoryPicker();
            const dir = await parent.getDirectoryHandle('MISKHub Экзон');
            return (await (await dir.getFileHandle('вход.json')).getFile()).text();
        }""")
        assert set(json.loads(raw)) == {"schemaVersion", "nonce", "ciphertext"}
        assert "fixture" not in raw and "Синтетический" not in raw
        await tool.reload()
        await expect(tool.get_by_label("Логин")).to_have_value("fixture@example.invalid")
        await expect(tool.get_by_label("Пароль")).to_have_value("Синтетический пароль")

        async def request(url=ORIGIN + REMARKS):
            await tool.locator("#remarks-url").fill(url)
            await tool.get_by_role("button", name="Скачать реестр замечаний", exact=True).click()

        async def receive(count):
            try:
                downloaded = await asyncio.wait_for(downloads.get(), 20)
            except TimeoutError as error:
                detail = await tool.locator("#export-status").text_content()
                raise AssertionError((detail, [tab.url for tab in tabs.values()], len(attempts), errors)) from error
            assert downloaded.suggested_filename.endswith(".xls")
            assert (await downloaded.path()).read_bytes() == workbook
            await expect(tool.locator("#export-status")).to_contain_text(f"строк выбрано: {count}")
            tab = tabs[max(tabs)]
            assert await tab.locator("body").get_attribute("data-export-count") == str(count)
            assert await tab.locator("body").get_attribute("data-wrong-action") is None

        await request()
        await receive(34)
        assert attempts == [{"username": ["fixture@example.invalid"], "password": ["Синтетический пароль"]}]

        for fixture in ({"total": 240, "larger": True}, {"total": 250, "global": True},
                        {"total": 250, "preserve": True, "start": 101}):
            case = fixture
            await request()
            await receive(fixture["total"])
        assert len(attempts) == 1

        case = {"total": 250}
        await request()
        await expect(tool.locator("#export-status")).to_contain_text("не подтвердил выбор всех")
        assert downloads.empty()
        await request("https://wrong.invalid/projects/test-project/buildControl/remarks")
        await expect(tool.locator("#export-status")).to_contain_text("Введите ссылку")
        assert not visited

        bad_action = True
        await request()
        await expect(tool.locator("#export-status")).to_contain_text("Завершите вход")
        auth = tabs[max(tabs)]
        await expect(auth.get_by_label("Пароль")).to_have_value("")
        await tool.get_by_role("button", name="Отменить", exact=True).click()
        await expect(tool.locator("#export-status")).to_have_text("Скачивание отменено.")
        assert len(attempts) == 1 and downloads.empty() and not errors, errors

        async def vault_file(script):
            return await tool.evaluate("""async () => {
                const dir = await (await showDirectoryPicker()).getDirectoryHandle('MISKHub Экзон');
                const file = await dir.getFileHandle('вход.json');
                """ + script + "}")

        await vault_file("const writer = await file.createWritable(); await writer.write('damaged'); await writer.close();")
        await tool.get_by_role("button", name="Сохранить данные входа").click()
        await expect(tool.locator("#vault-status")).to_contain_text("Не удалось прочитать")
        assert await vault_file("return (await file.getFile()).text();") == "damaged"
    finally:
        await browser.close()


async def main():
    with tempfile.TemporaryDirectory() as profile:
        async with async_playwright() as p:
            await run(p.chromium, profile)


if __name__ == "__main__":
    asyncio.run(main())
    print("PASS: encrypted folder, reload, verified official login, native XLS and full selection across pages")
