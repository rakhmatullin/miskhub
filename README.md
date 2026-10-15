# MiskHub

Инструменты для инженера ПТО / зам. РП (компания МИСК).

**https://rakhmatullin.github.io/miskhub/**

- Граф: https://rakhmatullin.github.io/miskhub/
- Сборка актов: https://rakhmatullin.github.io/miskhub/sborka.html
- Сверка весов: https://rakhmatullin.github.io/miskhub/sverka-vesov.html
- Акт ТТР: https://rakhmatullin.github.io/miskhub/ttr.html

## Сборка актов

Страница на GitHub Pages. Chrome или Edge. Выбрать папку, ввести номер, акт сохраняется рядом. Шаблон встроен.

## Акт ТТР

Каждый день собирает «Акт фиксации технических и трудовых ресурсов»: дата сегодняшняя, план равен факту, рабочие / ИТР / машинисты берутся из диапазонов. Настройки и журнал лежат в `data/ttr`. Пароль Mail.ru в репозиторий не пишется — только секрет Actions `TTR_MAIL_PASSWORD`. Письмо отправляет workflow «Акт ТТР».
