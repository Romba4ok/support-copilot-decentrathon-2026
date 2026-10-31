# Локально подготовленный эксперимент LoRA / QLoRA

## Сохранность результатов: 31.10.2026

Большой GGUF-архив совместного 100-step прогона не был получен на ноутбук до потери временной Colab-сессии. Ниже сохранены фактические доказательства завершённого обучения и облачного экспорта; они не означают наличие этих весов локально. Бесплатная GPU-квота затем была недоступна. Обход квоты и платные ресурсы не использовались.

Из ранее скачанного исходного 20-step архива отдельно восстановлен его адаптер на точной исходной базе. Итоговый Q4 GGUF полностью сохранён на ноутбук: **396704608 байт**, SHA-256 `eb9000457afb58d527d5523a118b84edfdd7ae43588d0e13c001e987ced7e782`. Все 190 частей, полный файл и структура GGUFv3 (310 тензоров, 596049920 параметров) проверены; сохранены исходный архив, immutable export proof и локальные receipts. Это **20-step модель**, не восстановленный 100-step checkpoint. Целостность не подтверждает качество и не активирует генератор.

Отдельный кандидат — официальный pretrained Qwen3-1.7B, revision `90862c4b9d2787eaed51d12237eafdfe7c5f6077`: исходный Q8_0 1834426016 байт, SHA-256 `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a`. CPU-конвертация Q8→Q4 в бесплатной Colab-сессии завершена; все 529 блоков и полный GGUF уже сохранены на ноутбук. Итог: **1107408544 байта**, SHA-256 `54c0f1203a724e9f33e76916beab3bdfaffef56cf7b42a93b1bc21319fc0bf97`, GGUFv3, 310 тензоров и 1720574976 параметров. Независимые полные SHA и строгая локальная проверка исходного Q8, Q4, документов конвертации и 51 файла Windows runtime прошли. Это не проектное дообучение и не восстановленный 100-step checkpoint. Качество и рабочий профиль генератора ещё проверяются; модель пока не активирована.

Локальная проверка нового pretrained-кандидата завершила загрузку, два диагностических ответа, настоящий принудительный abort и cleanup за **41.33 s**, с минимальным запасом свободной памяти **455073792 байта**. На следующем фиксированном авторском focus-наборе выполнены и прошли JSON/операционные проверки **42/42**, но правильная тема получена только в **30/42** случаях: payment 6/6, account 6/6, appeal 5/6, complaint 1/6, technical 4/6, question 5/6, clarification 3/6. Порог **38/42 и ≥4/6 в каждом классе не пройден**. Этот маршрут не активирован и не допущен к следующему независимому контролю. Это авторская неэкспертная оценка; успешный запуск модели не равен готовому генератору.

## Численный BF16 retry и учёт реальных optimizer updates

По фактическому Colab manifest попытка runner2944 завершилась interrupted из-за nonfinite grad_norm, не сохранив адаптер. Старые поля optimizer_steps=1 / actual_training=true отражали Trainer.global_step и **не доказывают успешный update**; исходные файлы/лог не переписаны. В точных исходниках pinned Transformers5.10.4 Trainer увеличивает global_step даже при Accelerate GradScaler skipped update. Это согласуется с FP16 overflow, но отсутствие записанного hook не позволяет ретроспективно утверждать ни ноль, ни один успешный update. Первичный код: [Trainer5.10.4](https://github.com/huggingface/transformers/blob/v5.10.4/src/transformers/trainer.py), [Accelerate1.15 optimizer](https://github.com/huggingface/accelerate/blob/v1.15.0/src/accelerate/optimizer.py).

Для единственного bounded retry явно выбран bf16_allow_emulation: на T4 native_bf16_supported=false, bf16_emulated=true при фактической загрузке. Это повторяет режим первого успешного исторического 20-step пилота, не заявляет аппаратный BF16 и не обещает успех новой задачи. FP16 не используется как молчаливый fallback. Проверки finite grad_norm/loss/adapter weights и changed final hash сохранены. Underlying nonfused optimizer оборачивается через официальный [PyTorch2.13 register_step_post_hook](https://raw.githubusercontent.com/pytorch/pytorch/v2.13.0/torch/optim/optimizer.py); counter увеличивается только после реального underlying step, отдельно от Trainer attempts и Accelerate skip flag. Любой skip/расхождение прерывает run; завершение требует ровно 100 hooked updates, 100 attempts, ноль skips и прежний budget600. Никакого скрытого 101/200-step продолжения нет.

| Retry artifact | SHA-256 |
|---|---|
| Runner | `b2e6418099068affdd12e9fbc7ff00e665f01fd85addacfdbb349d440372a68a` |
| Small UI patch, 14577 bytes | `4993f9206fba79d8e619c1f0eb19304ce04b424f6af3c5adfbb3dd7b192f837e` |
| Public reproducible notebook bundle | `fe6f1ca67b32eef2568beee84091c0196372e91d6b4eb586e5367f7c9e44cc15` |
| Public notebook | `f4ff582201fc224120e52ff89d0352f7f7ebaa9a1f4972c796f351fb83e2f35d` |

New RUN: `/content/support-plan-pilot/runs/joint-eba0c985bd60-6bc4d603-5c0ea248-b2e64180-bf16retry`. Patch training/colab-bf16-retry-patch.py меняет только собственный runner и сохраняет его backup, проверяет SHA2944/immutable manifest d1599/failed proof, не трогает исходный failed run или данные, задаёт RESUME=False и ничего не запускает. Main сообщил actual patch PASS и completed retry. Локально прочитан его exact run-manifest:100 underlying hook updates/100 attempts/0 skips, weights_saved/changed/adapter_weights_finite/finite_training_loss=true, native BF16=false/emulated=true. Training+generation elapsed571.7718065s <600; train_runtime422.9908s,train_loss0.11365578899101819. Это подтверждение обучения, не end-to-end качества. Локально full training suite **23/23 passed, 0 skipped**; независимый review 16/16 stdlib +4/4 targeted passed. Эти локальные mock/source checks сами по себе не были GPU proof; фактический completed manifest теперь указан отдельно выше.

Новый публичный notebook строится из exact frozen dataset manifest SHA d1599 через --frozen-data-dir. Historical generator56a4 сверяется с исходным training receipt/sourceidentity5c0e, а не с более поздним runtime generator15d18d. Тесты по-прежнему требуют byte-equality текущего runner/helpers/pins и hash frozen manifest; исключение исторического runtime явно ограничено исходным проверенным SHA, не снижает source guard. Новую двухфазную интеграцию и активацию проверяет main отдельно; старые run identity не переписываются.


Подтверждённый remote safetensors SHA нового joint-адаптера из actual manifest: `e6df28ad7e63ea0ac5a6e33198945f8a0b09ad78d950b1b115679fa97e95b6cf`. Новый совместный адаптер/GGUF ещё не объявлен локально импортированным или quality-verified; main выполняет отдельный paired export.

| Малый авторский holdout, не expert gold | Baseline | Joint adapter |
|---|---:|---:|
| Focus correct |14/42|30/42|
| Focus macro-F1 |0.2781346|0.7045764|
| Conditional plan valid |0/12|12/12|
| Conditional plan exact |—|11/12|
| Plan request precision |—|23/23|
| Plan request recall |—|23/24|

Plan rows имеют правильную авторскую тему, supplied by code; это не end-to-end classifier→plan score. Все synthetic/human_reviewed=false ограничения и необходимость независимого локального R16 сохраняются. Actual source proof: `runtime/training/joint-bf16-run-manifest.json`; UI evidence: `runtime/training/joint-bf16-completed-ui.log`. Эти приватные proof файлы не входят в публичную поставку.

## Joint focus + plan эксперимент: данные и сохранённые snapshots

После отдельного решения main текущая цель — один 100-step author-only GPU эксперимент, объединяющий две задачи. **Первая joint FP16-попытка прервана: Trainer attempt 1, successful optimizer updates неизвестны, weights_saved=false. Main применил проверенный малый patch и завершил отдельную BF16-emulated retry:100 actual updates/100 attempts/0 skips, веса сохранены и изменились, finite guards passed.** Shared factory 6bc4, dataset/prompts и historical training generator 56a4 не изменены. Первый completed 94cc/528d run и удалённый paired export остаются отдельной историей.

Исторический receipt первоначальной FP16-попытки 6bc4/56a4: неудачная попытка не стала completed training. Предыдущий b8d7/e51 bundle сохранён приватно; исправления общих context guards не изменили авторские rows, prompts или split.

Receipt:

| Артефакт | SHA-256 / identity |
|---|---|
| Shared factory | `6bc4d60353c0eaaabb4d70894aa15eb1b42602be0025211c4e97056cedbf721b` |
| Runtime generator | `56a4a2e8f3d077db34af0bc5cd148ecd8b4c5a1d4e74f17fe865fff132ac4ac5` |
| Source component identity | `5c0ea2489487a40b37cb0b5595b2954690b986ebbb39b2d09dcd9eeb0f1fe5f5` |
| Mixed dataset | `eba0c985bd60c10d704aa14f8de42bc815f7b31698cdc4ab40c7f49e8b7640cf` |
| GPU runner | `2944e533ba085de9cf78e4815735f83d4d98262b045db5f31f4f1412568a662e` |
| Embedded notebook bundle | `e518f4629ef99eae3601cf91c4d862a24687da5945ebeaadb389270b9f9622d1` |
| Notebook file, 1136401 bytes | `5a41656fddd9125441660ae271865b87bb7d669833ec12b1b967db87ac0b82c6` |

Private snapshot: `runtime/training/joint-author-6bc4-56a4`. New VM RUN: `/content/support-plan-pilot/runs/joint-eba0c985bd60-6bc4d603-5c0ea248-2944e533`. Source identity включает shared factory, runtime generator, author module и preparation contracts; self-hash runner и прежний hash 17 pins записываются дополнительно. Старые first528d/20steps, dbd7 и все промежуточные snapshots сохранены.

Авторские классификационные данные находятся в модуле `training/focus-author-data.mjs`, SHA `32a7aa4d59c71a029aaf55607737fbbc8b801f802f4675fbde3bb2d9a60f3ce2`. Это 168 новых примеров: семь тем × четыре самостоятельные группы × шесть языков ru/en/kk/uz/es/pt. Есть разные времена/порядок слов, прямые отрицания и 42 multi-message examples; все сообщения внутри примеров принадлежат авторскому player. Переводы/варианты одного сценария всегда в одной части. Данные не скопированы из QA controls, приватных правил или логов, `human_reviewed=false`; это авторский intent, не экспертный gold.

Граница тем согласована до обучения: account — заявленная потеря доступа, собственного имущества или несанкционированная передача собственности; technical — сбой клиента/устройства/интерфейса, включая визуально пустой UI без утверждения о фактической потере имущества. Appeal касается собственного наказания, complaint — поведения другого участника; general nonincident information — question, greeting/vague help — clarification. Сам классификатор выбирает только тему, не достоверность утверждения и не human policy.

Fixed grouped hash split даёт focus 126 train / 42 holdout: на класс 18/6, на class-language 3/1, одна из четырёх целых групп каждого класса удержана отдельно. Seed `focus-author-joint-v1` зафиксирован до модельных scores. Существующие 60 plan examples и прежний grouped seed дают 48/12. Итого **228 = 174 train + 54 holdout**, на язык 29/9. Только focus-часть class-balanced. Plan human true/false остаются 42/6 и 6/6; split/targets не подбираются по scores. Canonical normalization NFKC/case/punctuation/whitespace + общий cross-task group check отклоняют копии, пересекающие группы или части; это не обещание автоматического поиска всех семантических дубликатов.

`training/prepare-joint.mjs` замораживает точные runtime `buildFocusMessages/buildFocusSchema/validateFocus` и plan factory. Focus user message содержит только поддерживаемый explicit language и raw player messages, без baseline category/citations/admin/outcomes. Target — ровно `{focus}`. Plan target остаётся support-plan-v1; его контекст получает авторскую тему через `proposedFocus`, но факты/field states и original/contextual human gate определяет код. Запрашивается только state absent; unavailable/mentioned_uncertain не превращаются в выдуманные значения. Runtime JSONL остаётся приватным; третьего публичного JSONL не создаётся.

Runner `run_plan_lora.py` поддерживает task union schema 3 и прежнюю plan schema 2. Для joint реальный запуск допускает **ровно 100 steps**, не 20 и не 200; прежние 17 pins, base c189, rank8/alpha16/dropout0.05/q-k-v-o, seed42, batch1/accum4 и lr0.0002 сохранены. Первоначальная native-only policy выбрала FP16 на T4 и завершилась ошибкой. В новой отдельной попытке BF16 разрешён явно включая emulation, с отдельными native/emulated flags; старый выбор и failure сохранены. Генерация baseline, обучение и adapter generation после загрузки модели вместе ограничены 600 секундами с проверкой на каждом generation case, optimizer step и prediction batch; model download/load учитывается отдельной стадией, а фактическое время ещё не измерено. Nonfinite loss/gradient или adapter weights останавливают run. Checkpoints каждые 10 steps, own resume только при полном совпадении code/data/prompts/dependencies/hyperparameters; уже completed 100-step run повторным обучением не объявляется.

Baseline и adapter оцениваются отдельно по задачам: focus holdout42 даёт valid JSON, accuracy, macro-F1 по семи классам и confusion matrix; plan holdout12 — valid/exact plan, human gate и request precision/recall с собственными знаменателями. Единого blended quality score нет. **Plan holdout условен на правильной авторской теме**, переданной фабрике; это не end-to-end classifier+plan оценка. В сохранённом plan split нет appeal examples, а payment scenario находится в holdout — ограничение явно сохраняется. После GPU требуется независимая проверка реального pipeline/R16, не объявление успеха по формату. Для другого нового snapshot --mode joint использует текущий runtime и создаёт другую identity; его нельзя подменять историческим retry dataset.

Подготовка после окончательного freeze:

```powershell
node training/build-plan-notebook.mjs --frozen-data-dir runtime/training/joint-author-6bc4-56a4
python -B training/run_plan_lora.py --data-dir runtime/training/joint-author-6bc4-56a4 --output runtime/training/joint-dryrun-bf16-b2e64180 --dry-run --max-steps 100 --precision bf16_allow_emulation
node --test tests/training.test.mjs
```

Окончательный joint snapshot дал **21/21 passed, 0 failed, 0 skipped**, включая AST, реальные первые две локальные ячейки bootstrap/dry-run, совпадение всех встроенных runner/helpers/pins с текущими файлами и generator hash. Persistent stdlib dry-run `runtime/training/joint-dryrun-5c0ea248/dry-run.json` подтверждает 174/54, `actual_training=false`, `model_loaded=false`, `network_requests=0`. Проверены: authored-focus balance/group/privacy/source parity, joint228/174/54 preparation, 1248 mixed valid/mutated target parity cases плюс прежние 480 plan cases, stdlib dry-run без model/network, раздельные metric denominators, NaN/Inf/budget и resume guards. Все 228 target приняты; 1008 focus +240 joint-plan valid/mutated cases и прежние 480 plan cases прошли Python↔JS parity. Это не GPU training/finiteness execution proof. Main управляет только существующей бесплатной Colab VM/account; этот исполнитель не запускает cloud UI, optimizer, native models, Drive/OAuth, публикацию или платные ресурсы.


Ячейки нового notebook, JSON indexes: 1 bootstrap, 2 dry-run, 4 CHECK_GPU, 6 INSTALL_DEPENDENCIES, 8 RUN_TRAINING/RESUME/MAX_STEPS=100, 10 unique raw download, 13 explicit paired export/reuse tools. Все action flags по умолчанию False; RESUME=False. Готовый собственный venv можно использовать без повторной установки только если actual preflight/dependency checks совпадают. Source/bootstrap никогда не разрешает доступ к Drive или платному runtime. Main выполняет нормальный Colab UI запуск отдельно после source/data review.

Команда actual-stage, которая **здесь не выполнялась**:

```bash
/content/support-plan-pilot/venv/bin/python -u /content/support-plan-pilot/training/run_plan_lora.py --data-dir /content/support-plan-pilot/data --output /content/support-plan-pilot/runs/joint-eba0c985bd60-6bc4d603-5c0ea248-b2e64180-bf16retry --train --method qlora --precision bf16_allow_emulation --max-steps 100 --max-length 1536
```

## История plan-only пилота v0.3: support-plan-v1

После повторного открытия T002 текущим стал `notebooks/support-copilot-plan-qlora.ipynb` и runner `training/run_plan_lora.py`. Прежние 24 примера, notebook `support-copilot-author-synthetic-qlora.ipynb`, runner `run_lora.py`, fingerprint и свидетельства ниже сохранены как история v0.2. Новый пилот обучает **план**, не свободное поле `reply`:

**История подготовленного snapshot dbd7, обучение не запускалось:** factory `dbd7269f054d48b9269df22bd4c9364056f312e3000a0c9242f3021448594acc`, dataset `baff4a7e4564db03bca208e1776736c9e938fbc65c777cfe6f9eaf429698efe7`, runner `4b5104dcad9555fe625a5b69f7ffa3314d74690dd45a71394efc38ae2366d462`, notebook bundle `ef4455be3b3bf632ecf35401e88c4c13cddac3cee65c341bf21a3bddc06864a9`, notebook file SHA `212cd5fbb9e5435dc9b42a4c294b7ae7e791720c0566438124ad01c0ef20efac`. Данные отдельно в `runtime/training/plan-author-synthetic-dbd7`; все 60 target и 480 valid/mutated Python↔JS cases прошли, **17/17 training tests passed, 0 failed, 0 skipped**, включая AST/bootstrap/dry-run notebook и безопасный import/export. Seed, 48/12 split и class counts 42/6 +6/6 сохранены. Новый source ожидает независимого QA главного агента; R16 pass и второе GPU-обучение не заявляются.

**История подготовленного 35c8 snapshot, обучение не запускалось:** factory `35c87754a36445c22cd00f5d23f2ed10e03d167e0b70108e11ddf00cc784c460`, dataset `baff4a7e4564db03bca208e1776736c9e938fbc65c777cfe6f9eaf429698efe7`, runner `4b5104dcad9555fe625a5b69f7ffa3314d74690dd45a71394efc38ae2366d462`, notebook bundle `d98bcdd4f2329f0e8c4632b91695eacc78cf9d2561a36c86ea788c3ce4978c20`, notebook file SHA `fd1c2e312adf306d76c89d5bfbf988e03b1b61ea12b873e0bd6c82521e5afc92`. Отдельные данные: `runtime/training/plan-author-synthetic-35c8`. Все 60 target и 480 valid/mutated Python↔JS plans прошли; training 17 + API/legacy 24 = **41/41 passed, 0 skipped**. После последней защиты от изменения ZIP отдельно повторён import regression: 1/1 passed. Готовность R16 и запуск нового GPU-обучения ожидают независимых проверок главного агента.

**Исторический b9f3 bundle: второй training не запускался.** Новый deterministic context находится в исправлении; использовать b9f3 для нового обучения нельзя. Последняя завершённая локальная подготовка: factory `b9f340946578ceebfb0ec5aa6088a7fd06655c686cd8f8ae0aadd5dcd18c97b4`, dataset `baff4a7e4564db03bca208e1776736c9e938fbc65c777cfe6f9eaf429698efe7`, runner `4b5104dcad9555fe625a5b69f7ffa3314d74690dd45a71394efc38ae2366d462`, notebook bundle `7edbd481f3d9da40aa64889e336965328a966571a3e06d0ded5ecaa4708f8ff1`. Данные отдельно в `runtime/training/plan-author-synthetic-b9f3`; все 60 target приняты общим validator, 480 valid/mutated plans проверены Python↔JS. **16/16 training tests и 24/24 API+legacy server tests passed, 0 skipped**. Notebook file SHA `1644e3bb4509b3db84481ae8f6fe8385282fd189d61c2f34c24d882d91a8efd6`. После source QA и последующей regression v4 этот factory разморожен для общих исправлений. Новый aligned bundle появится только после следующего ML freeze и повторных проверок; local checks и прежний actual run не выдаются за обучение нового кандидата.

Подтверждённое текущее состояние первого результата: **94cc/528d — 20 actual optimizer steps completed; исходный raw LoRA уже скачан и проверен локально; exact-base paired F16/Q4_K_M экспорт завершён в Colab**. Готовый paired zip пока остаётся в удалённой VM: GGUF не импортированы локально и их качество/пригодность для приложения не проверены. Второе обучение не начиналось. Ни публикации, ни автоматической активации весов не было.

**История промежуточного 12dc snapshot:** factory `12dc30e5dbaa2db2102e45b957e4bbf4cadb8877636ee73b16f24ca4bd58c9ff`, dataset `c12ce89602e22fa148b6000a238e23c0fd79cf1658dde76ae81f86dd426ab9a0`, runner `35c540c206c649b5823ceaaebaac09a41f6e1247c1970d387b678d23afeba6bc`, notebook bundle `f6359cac9aa06757ec7592f38d336ee0b51e77ae7177ba669724a3f5499af9bc`. Данные сохранены отдельно в `runtime/training/plan-author-synthetic-12dc`. Все 48 target приняты общим factory; **14/14 локальных тестов passed**, включая Python parity, notebook, native dtype policy и безопасный export. В Colab прошли bootstrap/dry-run/preflight, но optimizer остался 0. Этот snapshot больше не используется для нового обучения; notebook f635 и данные сохранены приватно без перезаписи.

Промежуточный 0d8c source snapshot также сохранён: factory `0d8c8c868e1dcb1438a0940e58698662f88daea23481fd27c81b0ee5c083f0a9`, embedded bundle `a24f68106c2b93227a74e57e30ea5ffb7e2ac83b77f5636a8145f675caacfa72`, `runtime/training/plan-author-synthetic-0d8c`. Обучения не было. B9f3 исправил общий incident guard и renderer wording; авторские frozen rows остались одинаковыми, поэтому dataset fingerprint совпадает, а manifest.factory_source_sha256 и RUN различаются. При смене исходника guard теста остановил stale notebook (15/16 passed, один ожидаемый identity mismatch); после rebuild текущие 40/40 passed.

Первый реально выполненный пилот использовал factory `94cc45ff7cef6101b764a5231c65e68676bab17d76436448f9d459f62e7ad87d`, dataset `b50d4c88b73fd0484e9e9e0f00fa416a5cd2e297052280fe917dc667866e9512` и training bundle `aa636e34816d1ea20f7ae7d4c82dea6667b74a17581a32b3cf8245400a6ee5f8`. Подготовленные данные: `runtime/training/plan-author-synthetic-94cc`. На Colab подтверждены **completed manifest, 20 optimizer steps, weights_saved=true, weights_changed=true**; train_runtime 55.9163 s / finite train_loss 0.103882. На малом авторском holdout valid/exact plans изменились с 0/12 до 12/12. Это результат проверки формата/планов на двенадцати синтетических примерах, не доказательство полезности на реальных обращениях. Независимая QA уже выявила ошибки usefulness; готовность генератора и активация кандидата не заявляются.

Промежуточный source notebook с исправлением только export helpers имел bundle `ad03b9e6289cd0f646617b70faccee836a41b4a7204d43b6dfa79933191da66c`; это уже история. Фактически обучавшийся первый runner имел SHA `528d37323085d43b753069b4424336c42f9d62e1a33bef7574385d896f549700`. Его исходный код и notebook aa636 сохранены приватно в `runtime/training/bundle-history/`. Runner 35c5 и source bundle f635 относятся к историческому snapshot 12dc с optimizer 0; новые runner/bundle также не меняют provenance первого результата.

```json
{"schema_version":"support-plan-v1","focus":"technical","fact_ids":["fact_server"],"request_fields":["location","reproduction_steps"],"source_ids":[],"needs_human":true}
```

Prompt/context/schema получаются непосредственно из `src/intelligence/generation-contract.mjs`: `buildGenerationInput`, `buildPlanMessages`, `buildPlanSchema`, `validatePlan`. Все target-планы сначала проходят общий validator. Во время GPU-обучения читаются уже замороженные messages/context/schema; Python не извлекает факты заново и не получает приватные правила. Видимый ответ затем строит renderer приложения. В пилотных источниках `allowed_sources=[]`, поэтому обучение реальной релевантности правил не заявляется.

Исходный human gate проверяется отдельно по авторской аннотации baseline; target использует `context.needs_human = original_human_gate || contextual_human`. Нет проверенного ответа — `knowledge_gap` с обязательным человеком, без полей инцидента и неподтверждённой инструкции; пустой plan разрешён только кодовым исключением. Неопределённая помощь требует `problem_description`, явное приветствие/благодарность допускает пустой план. Поддерживаемый `input.lang` приоритетен. Origin/escalation metadata сохраняются в контексте; Python проверяет согласованность original/contextual/effective gate, а модель не выбирает политику сама.


Текущая fixture `fixtures/training-plan-author-synthetic.jsonl` содержит 60 самостоятельно составленных примеров: десять сценариев × шесть языков. Добавлены отдельные авторские группы благодарности и неопределённой просьбы о помощи; приватные данные/правила и независимые QA controls не читались и не копировались. Целые сценарии удерживают переводы вместе. Seed и гиперпараметры сохранены; split — 48 train / 12 holdout, в каждой части все шесть языков и оба effective human gate. Это **stratified coverage**, не равные классы. В train 42 true / 6 false (на каждом языке 7/1), в holdout 6/6 (на каждом языке 1/1); точные derived counts записаны в manifest.split_counts. Holdout группы — purchase-arrival и gratitude-only, выбраны прежним seeded hash. Это авторская синтетика с human_reviewed=false, не экспертный gold. Прежняя 48-row fixture сохранена приватно по SHA, а dataset 94cc/12dc и первый actual run неизменны.

Ниже команды воспроизводят текущую локальную подготовку dbd7. Cloud training включается отдельно главным агентом после независимого source/regression QA; здесь optimizer не запускался.

```powershell
node training/build-plan-fixture.mjs
node scripts/prepare-training.mjs --out runtime/training/plan-author-synthetic-dbd7
node training/build-plan-notebook.mjs
python -B training/run_plan_lora.py --data-dir runtime/training/plan-author-synthetic-dbd7 --output runtime/training/plan-dry-run-dbd7 --dry-run
node --test tests/training.test.mjs
```

`prepare-training.mjs` теперь по умолчанию готовит новый plan pilot; прежний экспорт `prepareTraining()` сохранён для воспроизведения истории/регрессий. Новый split не перезаписывает другое состояние назначения. Текущий подготовленный dataset fingerprint — `baff4a7e4564db03bca208e1776736c9e938fbc65c777cfe6f9eaf429698efe7`; предыдущий b50d относится к завершённому первому run. При изменении factory новый build требует повторных проверок. Manifest дополнительно фиксирует hash исходного factory и frozen context/messages/schema. Предыдущие snapshots сохранены и не используются вместо новых данных.

В Colab вручную загружается только новый самодостаточный notebook через обычный UI существующего аккаунта. Ни GitHub OAuth, ни `drive.mount()`, ни платный runtime не требуются. До pip выполняется `--preflight`: фактический Python 3.11–3.13, `nvidia-smi`, ≥5 GiB свободной VRAM и ≥15 GiB диска. Candidate packages ставятся только в venv, сохраняются install report и freeze. На фактическом Python 3.12.13 / Tesla T4 уже прошли установка 17 pins с транзитивными пакетами, `pip check`, импорты torch/Transformers/PEFT/bitsandbytes и CUDA tensor probe. Это подтверждает базовую совместимость выбранного GPU-окружения; завершение обучения и качество адаптера проверяются отдельно.

Для первой попытки в notebook включаются `CHECK_GPU`, затем `INSTALL_DEPENDENCIES`, затем `RUN_TRAINING`; `MAX_STEPS=20`, `RESUME=False`. Локальный эквивалент команды внутри VM:

```bash
/content/support-plan-pilot/venv/bin/python /content/support-plan-pilot/training/run_plan_lora.py --data-dir /content/support-plan-pilot/data --output /content/support-plan-pilot/runs/pilot-baff4a7e4564-dbd7269f-4b5104dc --train --method qlora --max-steps 20 --max-length 1536
```

`run-manifest.json` независимо показывает `model_loaded`, `training_started`, `optimizer_steps`, `weights_saved`; `actual_training` становится true только после optimizer step. Проверяются finite loss, наличие всех четырёх q/k/v/o adapter targets и изменение trainable weights. Checkpoints сохраняются каждые десять steps. Identity включает exact base revision, dataset/prompt/factory/code/dependencies и гиперпараметры. Для собственного resume добавляется `--resume`; только после полезного фактического прогресса допускается явное продолжение до 100 steps. История горизонтов и исходное число steps записываются отдельно; продолжение 20→100 не выдаётся за первоначально запланированный 100-step run.

Будущий RUN автоматически включает fingerprint данных, hash factory и hash runner, поэтому `runs/pilot-20` первого результата не перезаписывается. При обновлении bootstrap прежние code/data файлы сохраняются в собственный `source-history` по SHA. Текущий runner выбирает BF16 только через `torch.cuda.is_bf16_supported(including_emulation=False)`, иначе FP16, и записывает `native_bf16_supported`. Аргумент проверен по [официальному исходнику PyTorch 2.13](https://raw.githubusercontent.com/pytorch/pytorch/v2.13.0/torch/cuda/__init__.py); unit test проверил оба пути. Эмулируемый BF16 первого run остаётся частью его фактической истории и не объявляется native аппаратной поддержкой T4.

Baseline без адаптера и adapter получают одинаковые frozen holdout messages без target. Отчёты содержат valid-plan rate, focus/human-gate accuracy, request-field precision/recall с знаменателями, exact authored-plan match и сырой output. Это synthetic плановые метрики; они не заменяют внешнее QA или экспертную оценку ответа. После обучения проверяется совместимость renderer приложения отдельно.

Каждое скачивание создаёт новый `exports/<RUN.name>-raw-<uuid>` и новый zip в `downloads/`, не объединяя run directories и не перезаписывая первый архив. Выходной zip включает только собственный run/checkpoints, dataset manifest, install report и freeze; model cache и чужие файлы исключены. Старые веса не перезаписываются, кандидат автоматически не активируется. Для ноутбука с малой свободной RAM float merge и GGUF-конверсию целесообразно выполнить в этой же VM после завершения отдельного training process: original base `c1899de289a04d12100db370d81485cdf75e47ca`, merge helper ниже, converter/quantizer b11960, затем явное скачивание GGUF и provenance/hash manifest. Ни private-data upload, ни publication веса этим не разрешаются.

Локально выполнено на factory 94cc: все 48 target прошли общий app validator, новая подготовка и stdlib dry-run passed; после export-fix `tests/training.test.mjs` — **13 passed, 0 failed, 0 skipped**. Проверки покрывают точное совпадение prompt/schema, split по целым группам, admin exclusion, cross-group duplicate rejection, parity Python validator с общим JS validator на валидных/недопустимых, в том числе пустых бесполезных, планах, SHA, реальные первые две ячейки notebook, stdout/stderr/failure logging и hash-only обработку sidecar с чистой safetensors-копией. Фактические результаты завершённого первого run приведены ниже; обобщение на реальный поток не заявляется.

### История предстартового snapshot fb35 — не используется текущим запуском

В предыдущей предстартовой итерации snapshot сохранён отдельно в `runtime/training/plan-author-synthetic-fb35`; он не перезаписан и не используется текущим запуском. Ниже значения только этой исторической итерации. Ещё более ранний предстартовый dataset fingerprint был `7569b94b545750de29b7acb5dc76194f8f8f3d5c417242cb1ca0bd855be38a70`.

| Артефакт | SHA-256 / fingerprint |
|---|---|
| Factory source | `fb35f3c240bca6228df43cd969c9da043cee49b8b91383b09d4daea4ccae2992` |
| Dataset | `2ebd242be56dce7264abd42c1d79c548dc8085b0c993b6d42318c87d76d9f958` |
| Notebook embedded bundle | `96bac416e965c6f73e15c07fa293c5f1953eba3791e2627c1095a1d326900735` |
| Requirements, 17 unchanged pins | `e37a54d471a7582f92155775a32603c672f39f47a889a67460044085eadae5fe` |

Повторная проверка frozen factory: 48/48 target accepted, 11/11 training tests passed, 0 skipped. Главный агент выполнил normal-UI preflight существующего бесплатного Colab runtime: Tesla T4, total 15360 MiB / free 14913 MiB, driver 580.82.07, Python 3.12.13, свободный диск 71.29 GiB. Это **preflight_only**, не обучение и не проверка нового candidate venv. Предустановленные torch 2.11.0+cu128 / transformers 5.13.1 не используются вместо закреплённого isolated candidate. Аккаунт/Google Drive не подключались через OAuth grants или mount; платные ресурсы не выбирались.

Ячейки текущего notebook: JSON index 1 — bootstrap, 2 — dry-run, 4 — `CHECK_GPU`, 6 — `INSTALL_DEPENDENCIES`, 8 — `RUN_TRAINING`/`RESUME`/`MAX_STEPS`, 10 — `DOWNLOAD_RESULTS`. В порядке только code cells это 1–6. Сначала preflight и installation, затем отдельное явное включение 20-step train; download только после появления собственных результатов.

### История первого фактического run: factory 94cc

До первого обучения были исправлены дефекты provenance/negation/recency/usefulness в общем factory. Никакого optimizer step на более ранних snapshots не выполнялось. Снимок первого run сохранён в `runtime/training/plan-author-synthetic-94cc`, предыдущие также сохранены:

| Артефакт первого run / промежуточной поставки | Историческое значение |
|---|---|
| Factory SHA | `94cc45ff7cef6101b764a5231c65e68676bab17d76436448f9d459f62e7ad87d` |
| Dataset fingerprint | `b50d4c88b73fd0484e9e9e0f00fa416a5cd2e297052280fe917dc667866e9512` |
| Фактически обучавшийся bundle SHA | `aa636e34816d1ea20f7ae7d4c82dea6667b74a17581a32b3cf8245400a6ee5f8` |
| Последующий source notebook, исправление export | `ad03b9e6289cd0f646617b70faccee836a41b4a7204d43b6dfa79933191da66c` |
| 17 candidate pins SHA | `e37a54d471a7582f92155775a32603c672f39f47a889a67460044085eadae5fe` — без изменений |
| Отдельный bootstrap lock SHA | `e4ea4c3a44e5ddb100b98b2923080078035ac4135e7dd971d7d7f3c10df817d2` |

Python validator теперь повторяет и проверку usefulness: пустые fact/request списки отвергаются при имеющемся контексте, кроме разрешённой factory справки/простого приветствия. Поскольку публичный пилот не содержит rule text, его неграундированные FAQ запрашивают допустимое уточнение сервера; пустой ответ не учится как успешный. Все 48 target приняты общим JS validator, parity с Python включает mutated empty plans. В этой предстартовой итерации targeted suite дал 12 passed; после описанного ниже export-fix — **13 passed, 0 failed, 0 skipped**.

Фактически Colab Python не содержал `ensurepip`, поэтому стандартный `python -m venv` завершился ошибкой до установки пакетов. Исправление — отдельный `virtualenv==21.15.1`, устанавливаемый через base pip только в `WORKDIR/bootstrap-virtualenv`. Его builtin creator использует bundled pip; cache, config и новый venv ограничены WORKDIR, apt/глобальный Python не меняются. `requirements-bootstrap.txt` фиксирует bootstrap отдельно от неизменных 17 training pins. Это соответствует [официальному virtualenv CLI](https://virtualenv.pypa.io/en/stable/reference/cli.html).

Главный агент фактически создал таким способом CPython 3.12.13 venv и установил 17 pins с транзитивными пакетами. `pip check` вернул `No broken requirements found`. Дополнительный GPU probe подтвердил torch 2.13.0+cu126, CUDA available / 12.6, Tesla T4 и выполнение CUDA tensor `[2,3].sum()=5.0`; импорты Transformers 5.10.4 / PEFT 0.21.2 / bitsandbytes 0.50.2 прошли. После этого на bundle aa636 загружена модель и наблюдались 20/20 optimizer steps; Trainer сообщил finite loss 0.1039. Эти подтверждённые стадии **не доказывают завершение post-train evaluation/export** или улучшение качества.

### Фактически завершённый первый 20-step run и ограниченность результатов

Главный агент прочитал completed run manifest: optimizer_steps=20, weights_saved=true, weights_changed=true, train_runtime=55.9163 s, train_loss=0.103882. Начальный и конечный adapter hash различаются; полные hashes и первоначальный runner identity остаются в исходном manifest. Runtime сообщил `effective_dtype=torch.bfloat16`; аппаратная native BF16 поддержка Tesla T4 этим не утверждается.

| Paired holdout, одинаковые 12 frozen inputs | Без адаптера | После LoRA |
|---|---:|---:|
| Valid plans, unconstrained decoding | 0/12 | 12/12 |
| Exact authored plans | 0/12 | 12/12 |
| Правильные request fields | не заявлено | 30/30 |
| Время всей holdout generation | 58.782 s | 42.218 s |

Это маленький авторский holdout всего из двух целых сценариев с шестью языковыми вариантами каждого; labels не human-reviewed. Показатели не измеряют релевантность официальных цитат, реальную category accuracy, качество свободного ответа или HTTP p95. Отдельная QA на 24 контрольных примерах показала: 100% schema validity не означает usefulness — есть десять повторных запросов уже известных сведений, одно ложное Portuguese evidence и focus accuracy 75%. Контрольные примеры не добавлялись в обучение. Потребуются общие исправления factory и отдельный последующий run/повторная проверка; доказательства первого run не переписываются.

`Trainer.save_model` также сохранил `training_args.bin`. Новый merge helper проверяет hash **только этого точного sidecar**, никогда не десериализует его и не передаёт PEFT. Прочие `.bin`/pickle weights отвергаются. Для PEFT создаётся новый `clean-adapter`, содержащий только `adapter_config.json` и `adapter_model.safetensors`, с повторной проверкой копий; исходные manifest и файлы не меняются. Regression проверяет hash-only sidecar, отказ при tampering и запрет `adapter_model.bin`.

Сначала скачивается исходный raw run. После этого в существующей Colab VM можно применить `training/colab-export-helper-patch.py`: он заменяет только два export helper, сохраняет их предыдущий код и проверяет неизменность actual runner / original run manifest. Повторно bootstrap/train не выполняется. Затем отдельным явным действием запускается paired export. Главный агент фактически завершил exact-base float merge, оба F16 преобразования, CPU-сборку b11960 и оба Q4_K_M в Colab; paired export готов удалённо. Локального paired-GGUF архива пока нет, его импорт и качество не проверены. Активации кандидата нет.

Исходный raw run первого результата уже скачан пользователем и импортирован приватно в `runtime/training/imported-colab-94cc-20261030T111938Z`: архив 66,287,181 bytes, SHA `60d792546338235f1f81915d74f592020cc585ced88942c0b222fb0182694182`, CRC всех 40 entries и hashes семи adapter files проверены главным агентом. Helper patch для первого run по-прежнему ожидает runner 528d и не перегенерирован под 35c5; его SHA `42bb24c2c22c6d369345a92ae2fdf0657b264cb8675b7507cc7bb3d2ae6d9029`. Новый notebook не следует bootstrap поверх первой VM до применения этого отдельного export patch, если первый paired export ещё требуется. Публикация весов не выполнялась.

`notebook_tools.run_logged` сохраняет stdout+stderr в `WORKDIR/logs`, печатает tail/heartbeat и затем текущие stage-поля manifest; ненулевой exit вызывает явную ошибку. Это исправляет наблюдавшуюся Colab UI ситуацию, когда обычный subprocess показывал только `CompletedProcess` без дочернего stdout. Повторный bootstrap в той же VM обновляет только наш код/данные и helper; готовый candidate venv не переустанавливается, если `INSTALL_DEPENDENCIES=False`.

В конце notebook добавлена optional code cell JSON index 13: `EXPORT_PAIRED_GGUF=False`, `DOWNLOAD_PAIRED_CANDIDATE=False`. Подготовленный `training/export_plan_pair.py` допускает экспорт только completed support-plan run с ≥20 реальными steps и изменёнными сохранёнными весами. Он использует cached original c189 base, отдельные baseline/adapter float paths, safe merge, официальный source tag b11960, CPU-сборку quantizer (два jobs), одинаковые F16/Q4_K_M параметры и hashes обоих вариантов. Дополнительные converter packages ставятся в отдельный target, не меняя training venv. В первом Colab export float merge/F16 converter, CPU-сборка, оба Q4 и создание paired zip реально завершены; локальный download/import и quality verification ещё не выполнены. Ошибка ресурса/конвертера сохраняет `export_failed` и исключает автоактивацию. Выходной zip содержит paired Q4 и provenance/reports; публикации модели нет.

## Сохранённая история подготовки v0.2

На 30.10.2026 подготовлены данные, скрипт, notebook и локальные проверки. **GPU-обучение не запускалось, адаптер не получен, улучшение качества не измерено.** Бесплатный Colab рассматривается как возможная площадка: выделение GPU, длительность сессии и лимиты не гарантированы ([официальная FAQ](https://research.google.com/colaboratory/faq.html)). Аккаунт, платные ресурсы, принятие условий, публикация и загрузка приватных данных не выполнялись.

## Что проверяет эксперимент

Цель — попробовать научить Qwen3-0.6B возвращать короткий JSON-ответ в языке игрока и сохранять безопасное уточнение/передачу человеку. Контракт совпадает с локальным генератором:

```json
{"reply":"Текст черновика","source_ids":[],"needs_human":true}
```

Дополнительные поля запрещены. `needs_human=true` на входе нельзя понижать. Источники разрешены только из переданного списка точных canonical IDs. В этой авторской синтетике список пуст: нет копий приватных правил, выдуманных ссылок и обучения официальному цитированию. `guidance` — самостоятельно написанная общая инструкция поддержки, а не официальный игровой документ. Ответ опирается на неё и сведения игрока; утверждения игрока остаются непроверенными.

Это **не** обучение экспертной категории, не подтверждение качества kk/uz, не проверка правонарушений и не доказательство улучшения реальных ответов. Короткий набор может переобучиться. Проверки JSON, human gate и запрещённых формулировок не заменяют ручную оценку релевантности и безопасности. Отдельный контрольный набор T003 нельзя добавлять в train или использовать для выбора гиперпараметров.

## Данные и разделение

`fixtures/training-author-synthetic.jsonl` содержит 24 новых авторских примера, 12 сценариев и шесть языков. Provenance: `authored_synthetic`, `human_reviewed=false`, `contains_private_data=false`. Это не человеческая экспертная разметка.

Переводы и парафразы одного сценария имеют общий `group_id`. Подготовка объединяет эти группы, точные нормализованные повторы и близкие тексты с token-Jaccard ≥0.8, затем выполняет детерминированное разбиение по хешу группы. Дефолт: 18 train / 6 holdout, 9 / 3 независимые группы. Автоматический поиск переводов не заявляется: связь разных языков задана автором сценария. Внутри одной части повторы сохраняются как примеры; между частями общих scenario/group/duplicate keys нет.

Скрипт принимает только явно авторскую синтетику. Admin-сообщения, outcomes и labels из входа отбрасываются; они не становятся prompt или target. Target проверяется отдельно, а требование человека вычисляется baseline только из очищенного пользовательского входа. Импорт реальных исторических администраторских ответов как «правильного ответа» не поддерживается. Для реальных данных нужен отдельный согласованный процесс проверки и разрешение на конкретные площадку и набор; provenance-флаг сам по себе такого разрешения не даёт.

```powershell
node scripts/prepare-training.mjs
python training/run_lora.py --data-dir runtime/training/author-synthetic --output runtime/training/author-dry-run --dry-run
node --test tests/training.test.mjs
```

Подготовка разрешает выход только в выделенный подкаталог `runtime/`, сохраняет SHA-256 train/holdout и общий fingerprint. Другой split не перезаписывает существующее назначение. Все подготовленные наборы, checkpoints, логи и веса остаются в игнорируемом `runtime/training/`. Публичная поставка содержит только код, notebook с авторской синтетикой и исходную авторскую fixture.

## Notebook и GPU-кандидат

Открываемый вручную файл: `notebooks/support-copilot-author-synthetic-qlora.ipynb`. Он самодостаточен: содержит проверяемый SHA-256 bundle только авторских данных и нужного кода. Проверяются bundle SHA, manifest `cloud_eligible`, provenance, file SHA и fingerprint, а не имя файла. Изменённый/приватный набор отклоняется. Это проверка целостности подготовленного bundle, не криптографическая аттестация происхождения произвольного стороннего файла.

Первые две ячейки распаковывают синтетику и выполняют stdlib dry-run без пакетов, модели и сети. Остальные действия выключены: `INSTALL_DEPENDENCIES=False`, `RUN_TRAINING=False`, `DOWNLOAD_RESULTS=False`. Нет автоматического upload, Drive mount, login, чтения API-токенов, push_to_hub или публикации. Для Colab пользователь сам выбирает GPU и вручную включает нужные ячейки. При отсутствии подходящего GPU обучение прекращается с ошибкой.

Кандидат окружения: Linux x86_64, Python 3.11–3.12, CUDA 12.6 GPU ≥5 GiB VRAM. Это поддерживаемый диапазон эксперимента, а не утверждение о текущей версии Python в Colab: notebook проверяет фактический `sys.version_info`. Изолированный venv создаётся внутри рабочей папки notebook; глобальные Python-пакеты не изменяются. Для stdlib dry-run подходит установленный локально Python 3.14. Основные версии закреплены в `training/requirements-colab.txt`:

| Компонент | Версия |
|---|---|
| torch / CUDA wheels | 2.13.0+cu126 |
| transformers | 5.10.4 |
| peft | 0.21.2 |
| accelerate | 1.15.0 |
| bitsandbytes | 0.50.2 |
| safetensors | 0.8.0 |
| huggingface-hub | 1.31.0 |
| tokenizers / numpy | 0.22.2 / 2.2.6 |
| filelock / fsspec | 4.2.1 / 2026.6.0 |
| requests | 2.34.2 |

Совместимость 72 ограничений между выбранными direct dependencies проверена по официальным PyPI metadata для Python 3.11 и 3.12; GPU-установка и выполнение этого стека **не проверены**. Например, Transformers требует hub ≥1.5,<2 и tokenizers ≥0.22,≤0.23, которым выбранные версии удовлетворяют. Пакеты проверены отдельным `pip --dry-run --no-deps` для CPython 3.12/Linux: найдены все 17 direct wheels, без установки и без загрузки огромных Torch/CUDA wheels. Это не полное разрешение транзитивных зависимостей. После будущей реальной установки notebook запускает `pip check` и сохраняет install report / `pip freeze`; полного immutable wheel lock пока нет. Официальный CUDA 12.6 wheel выбран по [PyTorch version matrix](https://pytorch.org/get-started/previous-versions/); требования NF4 описаны в [bitsandbytes guide](https://huggingface.co/docs/bitsandbytes/v0.50.2/en/installation).

API runner проверен по AST самого опубликованного wheel Transformers 5.10.4: все 24 используемых TrainingArguments keywords и шесть Trainer keywords существуют; `processing_class` и `dtype` поддерживаются. Устаревший `save_safetensors` argument удалён; используются safe serialization по умолчанию и явный `use_safetensors=True` для загрузки весов. Это source/API check без импорта framework, не реальный training smoke ([Trainer v5.10](https://huggingface.co/docs/transformers/v5.10.0/en/main_classes/trainer), [модель Qwen](https://huggingface.co/Qwen/Qwen3-0.6B)).

При ревью первоначальные старые pins заменены: PyTorch 2.6 попадал в [CVE-2026-24747](https://github.com/pytorch/pytorch/security/advisories/GHSA-63cw-57p8-fm3p), Requests 2.32.3 — в advisory о `.netrc` credentials; metadata также потребовали обновить Transformers, Accelerate, filelock и fsspec. На дату проверки PyPI metadata для 17 выбранных direct versions не перечисляли advisories. **Отсутствие записи не доказывает полную безопасность** и не заменяет проверку будущего окружения. Допускаются только exact approved base и собственные проверенные checkpoints; неизвестные чужие checkpoints/configs не становятся доверенными из-за имени файла или `weights_only=True` ([Requests advisories](https://github.com/psf/requests/security/advisories), [PyPI Transformers 5.10.4](https://pypi.org/project/transformers/5.10.4/)).

Повторить metadata/API review можно без установки framework:

```powershell
node training/review-dependencies.mjs
python -B training/check_api.py
```

Evidence сохраняется приватно в `runtime/training/dependency-review/{metadata-review.json,api-review.json,pip-direct-report.json}`. Для AST скачивается только bounded pure-Python Transformers wheel с проверкой SHA-256; Torch wheel не загружается. Review читает только публичные metadata; реальных обращений и токенов в запросах нет.

Базовая модель: `Qwen/Qwen3-0.6B`, Apache-2.0, immutable revision `c1899de289a04d12100db370d81485cdf75e47ca`. Веса загружаются только при явном `--train`, либо передаются через `--local-model` из локального snapshot. `token=False`, `trust_remote_code=False`. Модель и кэш находятся в папке эксперимента.

QLoRA использует frozen NF4 base, double quantization, `prepare_model_for_kbit_training`, rank 8, alpha 16, dropout 0.05 и адаптеры `q_proj/k_proj/v_proj/o_proj`. Альтернатива `--method lora` использует float base; её требования памяти могут быть выше. Только assistant JSON участвует в loss: prompt закрыт `-100`. Слишком длинный пример отклоняется целиком, чтобы не обрезать grounding или JSON. BF16 выбирается только на поддерживаемом GPU, иначе FP16. Эти решения следуют [официальному PEFT guide](https://huggingface.co/docs/peft/v0.21.0/developer_guides/quantization).

## Checkpoints и честное сравнение

Дефолтный запуск ограничен 20 optimizer steps, batch 1, accumulation 4, контекст 1024. Каждые 10 steps сохраняется полный Trainer checkpoint; остаются два последних. Сохраняются модель/адаптер, optimizer, scheduler, Trainer/RNG state. Повтор с `--resume` требует тот же dataset fingerprint, base revision и параметры; выбирается последний полный checkpoint. Неполный запуск не называется завершённым ([Trainer resume](https://huggingface.co/docs/transformers/v5.10.0/en/main_classes/trainer)).

До обучения baseline без адаптера и после обучения адаптер получают одинаковые holdout prompts без target. Отдельно сохраняются сырой ответ, валидность JSON, базовые проверки контракта и human gate с числом примеров. Синтетические targets используются для supervised train и eval loss отдельно; они не передаются в генерацию. Эти показатели не называются экспертной оценкой качества.

Colab VM может исчезнуть вместе с локальными файлами, в том числе до первого checkpoint. Автоматического облачного backup нет. Пока сессия доступна, пользователь может явно скачать zip с run/checkpoints. После прерывания нужно вернуть сохранённый run на ту же структуру путей и выполнить ту же команду с `--resume`. Если checkpoint не был сохранён/скачан, точное продолжение невозможно; следует начать новый run в другой папке. Ограничения не обходятся аккаунтами или фоновыми сессиями.

## Локальный экспорт, проверка и GGUF

История v0.2: на момент написания этой последовательности адаптер ещё не был обучен/импортирован/конвертирован. Для текущего v0.3 это уже не общий статус: выше зафиксированы completed 94cc training, локально проверенный raw LoRA и готовый удалённый paired GGUF export. Следующая последовательность остаётся ручной инструкцией для отдельного собственного run. Архив синтетического run содержит `run-manifest.json`, `adapter/adapter_model.safetensors`, PEFT config, tokenizer и holdout reports; checkpoints нужны дополнительно для resume. Manifest фиксирует базовую revision, fingerprint, фактические зависимости и SHA-256 файлов. Приватные данные и производные веса в будущих экспериментах остаются приватными.

1. Распаковать скачанный синтетический run в новую папку `runtime/training/imported-run`, предварительно проверив пути архива. Не перезаписывать предыдущий run или рабочую GGUF.
2. В изолированном Python-окружении скачать **точный исходный float snapshot**, не quantized training copy. Это отдельное ручное действие с публичной моделью:

```python
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="Qwen/Qwen3-0.6B",
    revision="c1899de289a04d12100db370d81485cdf75e47ca",
    local_dir="runtime/training/base/c1899de289a04d12100db370d81485cdf75e47ca",
    token=False,
)
```

3. Проверить metadata/hash и затем выполнить float merge. Требуется достаточно свободной RAM/диска; на текущем ноутбуке операция не измерялась. Сначала `--inspect-only`, затем отдельная команда без этого флага:

```powershell
python training/merge_adapter.py --run runtime/training/imported-run --base runtime/training/base/c1899de289a04d12100db370d81485cdf75e47ca --output runtime/training/merged-qwen --inspect-only
python training/merge_adapter.py --run runtime/training/imported-run --base runtime/training/base/c1899de289a04d12100db370d81485cdf75e47ca --output runtime/training/merged-qwen
```

Проверяются completed run, exact base revision, authored provenance, LoRA module/rank и SHA-256 каждого перечисленного файла; pickle `.bin` не принимается. Локальный каталог base должен называться зафиксированной revision, а architecture — qwen3. Название/metadata каталога само по себе не доказывает неизменность чужих весов: использовать только snapshot, скачанный из указанной immutable revision. Для merge заново открывается исходная float base и выполняется `merge_and_unload(safe_merge=True)`; 4-bit training copy не сливается повторно ([PEFT merging](https://huggingface.co/docs/peft/v0.21.0/developer_guides/model_merging)).

4. Получить исходники **llama.cpp b11960**, совпадающие с проектным runtime. В отдельном venv установить [requirements конвертера](https://github.com/ggml-org/llama.cpp/blob/b11960/requirements/requirements-convert_hf_to_gguf.txt); они могут отличаться от training environment. Запустить [официальный converter](https://github.com/ggml-org/llama.cpp/blob/b11960/convert_hf_to_gguf.py) и quantizer из той же версии:

```powershell
python runtime/tools/llama.cpp-b11960/convert_hf_to_gguf.py runtime/training/merged-qwen --outfile runtime/training/Qwen3-0.6B-support-f16.gguf --outtype f16
runtime/tools/llama-b11960-cpu/llama-quantize.exe runtime/training/Qwen3-0.6B-support-f16.gguf runtime/training/Qwen3-0.6B-support-Q4_K_M.gguf Q4_K_M
```

Если данный converter/runtime не поддерживает фактическую architecture или LoRA export, остановиться и сохранить ошибку; совместимость не выдаётся за подтверждённую. Не применять адаптер к официальному Q8_0 другой/неподтверждённой исходной revision. Собственная merged GGUF создаётся из exact original base, а не заменой заголовка или имени файла.

5. Сохранить SHA-256 нового GGUF и manifest, поместить кандидат в новый подкаталог `runtime/models/`. Перед применением повторить source-integrity, six-language safety/hard-gates, отклонение выдуманных refs/URL/санкций/просмотра вложений, ручную релевантность, latency/memory benchmark. Эксперимент не снимает hard policies и human review приложения. До успешных проверок кандидат не включать.
6. Только после проверки можно явно задать локальные `LOCAL_GENERATOR=1` и `GENERATOR_MODEL_PATH` на новый GGUF; runtime остаётся `runtime/tools/llama-b11960-cpu/llama-server.exe`. Настройки действуют на запускаемый процесс, глобальная конфигурация не меняется. `GENERATOR_TIMEOUT_MS` должен оставаться в поддерживаемом диапазоне 1–60000. При ошибке/timeout/quality-failed приложение сохраняет безопасный исходный черновик. Адаптер/кандидат автоматически не активируется.

## Фактические проверки и ограничения

На Windows/Node 22/Python 3.14 выполнены:

- `node training/build-author-fixture.mjs`: 24 authored synthetic rows / 12 scenario groups.
- `node scripts/prepare-training.mjs`: 18 train / 6 holdout; fingerprint `9a3946297d7b862d7e0914c5c64d6e54268a892a8adc148f2fa359eaa7dd8f54`.
- `python training/run_lora.py ... --dry-run`: passed, `actual_training=false`, `model_loaded=false`, `network_requests=0`.
- `node --test tests/training.test.mjs`: 7 passed, 0 failed, 0 skipped. Включены deterministic group/duplicate split, admin/gold exclusion, provenance/target safety, SHA/private dataset rejection, notebook schema + Python syntax + реальные первые две ячейки, prompt loss masking и запрет обрезки supervised JSON.
- После dependency review: 17 direct package metadata проверены, 72 межпакетных/интерпретаторных ограничения удовлетворены; AST pinned Transformers wheel подтвердил 24 TrainingArguments и 6 Trainer keywords, `processing_class` и `dtype`. Direct-package pip dry-run для CPython 3.12/Linux passed; сначала требовалось добавить явный manylinux_2_24 target для bitsandbytes, после чего все 17 wheels разрешились. Огромные Torch/CUDA wheels не скачивались, ничего не установлено. Полная транзитивная resolution и GPU compatibility не проверялись.

Исторический статус v0.2, до actual Colab pilot: GPU allocation/install/training/merge/conversion были not-run. Текущее состояние v0.3 описано в начале: первый training и удалённый paired export завершены, raw LoRA проверен локально; улучшение реального качества, локальный GGUF import/QA и второе обучение не выполнены. Публикации набора/весов нет, доступность следующей бесплатной GPU-сессии не гарантируется.

### Проверяемое повторное использование export tools

Будущий экспорт может явно задать `--reuse-tools-from /content/support-plan-pilot/exports/paired-<own-prior-run>` (в notebook `REUSE_TOOLS_FROM`). Автоматического поиска внешних инструментов нет: путь должен быть непосредственным собственным `exports/paired-*`, manifest предыдущего экспорта — completed paired proof. Проверяются SHA quantizer, записанный git HEAD и tag b11960, точный официальный origin и чистое tracked tree. Только после совпадения используется прежний converter/CPU quantizer; float/merged/GGUF/zip назначения всегда новые. Converter extras ставятся отдельно заново. Локальный regression использует явно искусственный git repo/неисполняемый fake binary и проверяет отказы при hash/remote/commit/dirty tree/outside path — это проверка guard, не реальная сборка. Исторический first-run helper patch 528d не пересоздавался.

### Локальный импорт paired GGUF без активации

`training/import_plan_pair.py` использует только Python stdlib. Сначала запустите dry-run с явным SHA скачанного собственного paired zip и новым абсолютным назначением в project `runtime/models/<newdir>`:

```powershell
python -B training/import_plan_pair.py --archive D:/Downloads/own-paired.zip --expected-archive-sha256 <verified-zip-sha256> --destination D:/Коды/Decentrathon/support-copilot/runtime/models/own-paired-candidate
```

Без `--execute` файлов не создаёт. После успешной проверки то же действие с `--execute` создаёт эксклюзивный новый каталог; существующие назначения не перезаписываются. Разрешены ровно шесть entries: два Q4_K_M GGUF и четыре JSON proof/report. Не допускаются F16/посторонние entries, дубликаты/case collisions, traversal, links, шифрование и превышение размера. Проверяются архивный SHA, CRC, точный c189 base/b11960 quantization, completed authored 20–100-step run с изменёнными весами и finite loss, одинаковые dataset/factory/run identity, paired report IDs, размеры/SHA и magic включённых Q4. Записи F16 остаются remote derivation metadata: их содержимое локально не проверяется и в архиве их нет.

Ожидаемый архивный SHA задаётся оператором из доверенного собственного export evidence; внутренние assertions provenance не превращают чужой архив в проверенные обучающие данные. Импорт не десериализует pickle и не загружает модель, не меняет настройки генератора и не подтверждает качество. `import-manifest.json` фиксирует integrity/local paths, derivation и `quality_verified=false`, `activated=false`; после ошибки частичная новая папка сохраняется с failed manifest. Регрессия использует авторский миниатюрный **fake GGUF**, поэтому её успех не является выполненным импортом реальной модели или inference QA.

Для importer отдельно выполнен regression joint100-step manifest с focus-v1/support-plan-v1 identity и раздельными tasks metrics: оба JSON reports копируются без потери структуры, quality_verified остаётся false. Использованы только fake authored GGUF, не реальные модельные веса.
