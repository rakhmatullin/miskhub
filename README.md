# MiskHub

Инструменты для инженера ПТО / зам. РП (компания МИСК).

**https://rakhmatullin.github.io/miskhub/**

- Граф: https://rakhmatullin.github.io/miskhub/
- Устранение замечаний: https://rakhmatullin.github.io/miskhub/ustranenie.html
- Акты об устранении: https://rakhmatullin.github.io/miskhub/akty.html
- Сверка весов: https://rakhmatullin.github.io/miskhub/sverka-vesov.html

## Акты об устранении

Клиентский инструмент без ИИ.

1. Загрузить выгрузку Excel (колонки Номер, Дата, Срок, Статус, Описание…).
2. Опционально свой шаблон .docx с токенами `{{NOMER-AKTA}}` — в интерфейсе список токенов русскими ключами.
3. Дата акта отдельно, не трогает дату предписания.
4. В пакет попадают только «К устранению». Удалено/закрыто — статус выгрузки, не вечный номер.
5. Фото: `N_1` до, `N_2` после. В Word не вставляются.
6. Скачать список.xlsx, zip актов или полный пакет.
