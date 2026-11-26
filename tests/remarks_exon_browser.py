"""Verify local import of the Exon registry in Chromium."""
import base64
import functools
import json
import tempfile
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright

from remarks_attachments_browser import bitmap, colored_pdf, put_bytes
from remarks_browser import Handler, LINKS, ROOT, add, choose, dump, export, read, row, snapshot, start, write


BRIDGE = """() => {
    window.exonResponse = {type: 'setup'};
    window.refreshRequests = [];
    window.attachmentRequests = [];
    const listeners = () => {
        const callbacks = [];
        return {addListener: cb => callbacks.push(cb), emit: payload => callbacks.forEach(cb => cb(payload))};
    };
    window.chrome.runtime = {
        connect(id, options) {
            if (id !== 'homjedffdaffpgbenahhadeogepcjbno' || options.name !== 'miskhub-remarks-refresh') throw new Error('Wrong integration');
            const onMessage = listeners(), onDisconnect = listeners();
            let connected = true;
            return {
                onMessage, onDisconnect,
                disconnect() { connected = false; },
                postMessage(request) {
                    setTimeout(() => {
                        if (!connected) return;
                        if (request.type === 'refresh') {
                            window.refreshRequests.push(request);
                            onMessage.emit({type: 'connected', protocol: 2});
                            onMessage.emit({type: 'progress', text: 'Запрашиваем XLS у Экзона…'});
                            onMessage.emit(window.exonResponse);
                        } else if (request.type === 'plan') {
                            window.lastPlan = request;
                            onMessage.emit(window.exonCatalog);
                        } else if (request.type === 'files') {
                            window.attachmentRequests.push(request.ids);
                            for (const id of request.ids) onMessage.emit({type:'attachment', id, ...window.exonFiles[id]});
                            onMessage.emit({type:'complete', warnings:[]});
                        }
                    }, 10);
                }
            };
        }
    };
}"""


def payload(page, numbers, closed=()):
    return page.evaluate("""([numbers, closed]) => {
        const book = XLSX.utils.book_new();
        const rows = [['Номер', 'Статус', 'Описание', 'Дата', 'Срок устранения']];
        for (const n of numbers) rows.push([n, closed.includes(n) ? 'Закрыто' : 'К устранению',
            'Обновлённое замечание ' + n, '25.11.2026', '28.11.2026']);
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Реестр');
        const bytes = new Uint8Array(XLSX.write(book, {type: 'array', bookType: 'xlsx'}));
        return {name: 'document.xlsx', encoded: btoa(String.fromCharCode(...bytes)), count: numbers.length};
    }""", [numbers, list(closed)])


def run(chromium, origin, profile):
    errors, requests = [], []
    ctx, page = start(chromium, profile, origin, errors, requests)
    page.evaluate(BRIDGE)
    expect(page.locator("body")).to_have_attribute("data-version", "2.14")
    button = page.get_by_role("button", name="Обновить реестр", exact=True)
    status = page.locator("#registryStatus")
    button.click()
    expect(status).to_contain_text("Открыт «Экзон»")
    assert page.evaluate("refreshRequests.at(-1)") == {"type": "refresh", "protocol": 2, "workspaceReady": False}

    page.evaluate("window.exonResponse = {type:'folder'}")
    button.click()
    expect(status).to_contain_text("Выберите рабочую папку")

    dump(page, [126, 127])
    write(page, "комментарии.json", '{"126":{"c1":"Сохранить комментарий","skp":true}}')
    write(page, "интеграционные.json", '{"129":"ИНТ-129","127":"Ручной номер"}')
    put_bytes(page, "129_1.jpg", bitmap((60, 80, 100), "JPEG"))
    put_bytes(page, "129_2.png", bitmap((80, 90, 120)))
    page.locator("#pick").click()
    page.locator("#continueMigration").click()
    expect(page.locator("#open tr[data-remark]")).to_have_count(2)
    person = add(page, organization="ООО Тест")
    choose(page, row(page, 126), "тест")
    expect(row(page, 126)).to_contain_text("ООО Тест")
    before = snapshot(page)

    page.evaluate("""([image, pdf]) => {
        window.exonCatalog = {type:'catalog', project:'fixture-project',
            integration:{126:'205',129:'207'}, files:[
                {id:'photo1',name:'Фото.png',numbers:[129]},
                {id:'pdf1',name:'Приложение.pdf',numbers:[129]},
                {id:'closed-file',name:'Закрыто.png',numbers:[126]}
            ]};
        window.exonFiles = {photo1:{encoded:image,mime:'image/png'},pdf1:{encoded:pdf,mime:'application/pdf'}};
    }""", [base64.b64encode(data).decode() for data in
            [bitmap((220, 80, 100)), colored_pdf([(120, 50, 80), (90, 170, 65)])]])

    received = payload(page, [126, 129], closed=[126])
    page.evaluate("workbook => window.exonResponse = {type:'workbook', workbook}", {**received, "count": 3})
    button.click()
    expect(status).to_have_text("В файле Экзона неполный или некорректный реестр.")
    assert snapshot(page) == before

    page.evaluate("workbook => window.exonResponse = {type:'workbook', workbook}", received)
    button.click()
    expect(status).to_have_text("Реестр обновлён. Получено замечаний: 2. Добавлено изображений: 3.")
    assert page.evaluate("refreshRequests.at(-1).workspaceReady") is True
    assert page.evaluate("lastPlan") == {"type": "plan", "numbers": [126, 129], "open": [129]}
    assert page.evaluate("attachmentRequests.at(-1)") == ["photo1", "pdf1"]
    expect(page.locator("#open tr[data-remark]")).to_have_count(1)
    expect(page.locator('#open tr[data-remark="129"] .num')).to_have_text("129(207)")
    expect(page.locator('#open tr[data-remark="129"] .desc')).to_contain_text("Обновлённое замечание 129")
    rows = page.locator('#open tr[data-remark="129"] .remark-photo-row')
    expect(rows.nth(0).locator(".remark-photo-tile")).to_have_count(4)
    expect(rows.nth(1).locator(".remark-photo-tile")).to_have_count(1)
    final = snapshot(page)
    assert final["реестр-экзон.xlsx"] == received["encoded"]
    assert all(final[name] == value for name, value in before.items()
               if name not in {"последовательности_актов.json", "интеграционные.json"})
    assert json.loads(read(page, "интеграционные.json")) == {"126": "205", "127": "Ручной номер", "129": "207"}
    assert json.loads(read(page, LINKS))["assignments"]["126"] == person

    button.click()
    expect(status).to_have_text("Реестр обновлён. Получено замечаний: 2. Добавлено изображений: 0.")
    assert page.evaluate("attachmentRequests.at(-1)") == []
    assert snapshot(page) == final

    bad = {**received, "encoded": "Y29ycnVwdGVk"}
    page.evaluate("workbook => window.exonResponse = {type:'workbook', workbook}", bad)
    button.click()
    expect(status).to_contain_text("Файл Экзона не читается")
    assert snapshot(page) == final

    page.reload()
    expect(page.locator('#open tr[data-remark="129"]')).to_be_visible()
    with export(page, [129]) as report:
        assert "Обновлённое замечание 129" in report[0].get_text()

    page.locator('.version-switch a[href="./sborka-v2.12.html"]').click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.12")
    expect(page.locator('#open tr[data-remark="126"]')).to_be_visible()
    expect(page.locator("#refreshRegistry")).to_have_count(0)
    page.locator('.version-switch a[href="./sborka.html"]').click()
    button.click()
    expect(page).to_have_url(origin + "exon.html")
    assert not errors, errors
    assert not requests, requests
    ctx.close()
    print("PASS: integration numbers, attachments and PDF pages in row 1, deduplication, safe registry persistence")


def main():
    handler = functools.partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(p.chromium, f"http://127.0.0.1:{server.server_port}/", profile)
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
