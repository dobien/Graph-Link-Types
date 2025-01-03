// Импортируем из локальных (или относительных) путей необходимые интерфейсы и enum’ы, а также некоторые классы из внешних библиотек.
// ObsidianRenderer, ObsidianLink, LinkPair, GltLink, DataviewLinkType, GltLegendGraphic — описывают структуры и типы данных нашего плагина
// getAPI — функция, дающая доступ к Dataview API
// Text, TextStyle, Graphics, Color — классы из библиотеки pixi.js для рендеринга
// extractLinks — функция, позволяющая извлекать ссылки из строк Markdown
import { ObsidianRenderer, ObsidianLink, LinkPair, GltLink, DataviewLinkType, GltLegendGraphic } from 'src/types';
import { getAPI } from 'obsidian-dataview';
import { Text, TextStyle, Graphics, Color } from 'pixi.js';
// @ts-ignore отключает проверку типов TS для импортируемой функции
import extractLinks from 'markdown-link-extractor';

/**
 * Класс LinkManager отвечает за создание, хранение и обновление ссылок (GltLink),
 * а также за управление легендой типов ссылок (tagColors, tagLegend).
 */
export class LinkManager {
    // Храним все созданные ссылки (ключ — строка "sourceId-targetId", значение — GltLink).
    linksMap: Map<string, GltLink>;

    // Доступ к Dataview API (например, для получения данных о заметках).
    api = getAPI();

    // Текущая тема (theme-dark или theme-light).
    currentTheme: string;

    // Цвет текста, соответствующий текущей теме (например, белый для dark или почти чёрный для light).
    textColor: string;

    // Сопоставление названия типа (key) с объектом GltLegendGraphic (цвет и элементы легенды).
    tagColors: Map<string, GltLegendGraphic>;

    // Набор цветов в формате 0xRRGGBB, используемых для цветных линий.
    categoricalColors: number[] = [
        0xF44336, // Red
        0x03A9F4, // Light Blue
        0xFF9800, // Orange
        0x9C27B0, // Purple
        0xCDDC39, // Lime
        0x3F51B5, // Indigo
        0xFFC107, // Amber
        0x00BCD4, // Cyan
        0xE91E63, // Pink
        0x4CAF50, // Green
        0xFF5722, // Deep Orange
        0x673AB7, // Deep Purple
        0x9E9E9E, // Grey
        0x2196F3, // Blue
        0x8BC34A, // Light Green
        0x795548, // Brown
        0x009688, // Teal
        0x607D8B, // Blue Grey
        0xFFEB3B, // Yellow
        0x000000  // Black for contrast
    ];

    // Индекс текущего цвета (мы будем проходить циклично по массиву выше).
    currentTagColorIndex = 0;

    // Начальное смещение по вертикали для следующего элемента легенды.
    yOffset = 5;
    // Отступ слева (xOffset) для позиции текста легенды.
    xOffset = 20;

    // Высота каждой строки легенды (например, 17 пикселей).
    lineHeight = 17;

    // Ширина цветной черты (line) рядом с текстом легенды.
    lineLength = 40;

    // Отступ между текстом и началом линии легенды.
    spaceBetweenTextAndLine = 1;

    /**
     * Конструктор класса LinkManager.
     * Инициирует пустую карту linksMap и карту tagColors,
     * а также включает слежение за изменением темы (detectThemeChange).
     */
    constructor() {
        this.linksMap = new Map<string, GltLink>();
        this.tagColors = new Map<string, GltLegendGraphic>();

        // Отслеживаем изменения темы и цветовой схемы.
        this.detectThemeChange();
    }

    /**
     * Генерирует ключ для Map по двум идентификаторам (sourceId, targetId).
     * Например, "PageA-PageB".
     */
    generateKey(sourceId: string, targetId: string): string {
        return `${sourceId}-${targetId}`;
    }
    
    /**
     * Настраивает MutationObserver, чтобы отслеживать изменения класса body (theme-dark / theme-light)
     * или изменений href для CSS-файлов (если Obsidian меняет тему).
     * При изменении темы вычисляет новый цвет текста через getComputedColorFromClass.
     */
    private detectThemeChange(): void {
        let lastTheme = '';
        let lastStyleSheetHref = '';
        let debounceTimer: number;
    
        const themeObserver = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => {
                // Определяем, установлена ли тема dark или light
                this.currentTheme = document.body.classList.contains('theme-dark')
                    ? 'theme-dark'
                    : 'theme-light';

                // Проверяем, какой сейчас используется CSS (если в href есть "theme")
                const currentStyleSheetHref = document
                    .querySelector('link[rel="stylesheet"][href*="theme"]')
                    ?.getAttribute('href');

                // Если тема поменялась или CSS поменялся
                if (
                    (this.currentTheme && this.currentTheme !== lastTheme) ||
                    (currentStyleSheetHref !== lastStyleSheetHref)
                ) {
                    // Получаем цвет текста для текущей темы
                    this.textColor = this.getComputedColorFromClass(this.currentTheme, '--text-normal');
                    lastTheme = this.currentTheme;
                    if (currentStyleSheetHref) {
                        lastStyleSheetHref = currentStyleSheetHref;
                    }
                }
            }, 100); // Задержка 100 мс (debounce)
        });
    
        // Наблюдаем за изменением атрибутов 'class' на body (переключение theme-dark/theme-light)
        themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });

        // Наблюдаем за изменениями <head>, чтобы отслеживать переключение CSS-файлов (theme.css)
        themeObserver.observe(document.head, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href']
        });
    }
    
    /**
     * Вспомогательный метод, который создаёт временный элемент с классом className,
     * считывает CSS-переменную cssVariable (например, --text-normal), а потом удаляет элемент.
     * Если значение цвета в формате HSL, возвращаем запасной цвет,
     * иначе возвращаем полученное значение as-is (например, #333333).
     */
    private getComputedColorFromClass(className: string, cssVariable: string): string {
        // Создаём временный div
        const tempElement = document.createElement('div');
    
        // Применяем к нему класс (theme-dark / theme-light)
        tempElement.classList.add(className);
        document.body.appendChild(tempElement);
    
        // Считываем стили
        const style = getComputedStyle(tempElement);
        const colorValue = style.getPropertyValue(cssVariable).trim();
    
        // Удаляем временный элемент
        document.body.removeChild(tempElement);

        // Если значение цвета начинается на "hsl", возможно Obsidian возвращает hsl-цвет,
        // и мы решаем заменить его на некоторый дефолт
        if (colorValue.startsWith('hsl')) {
            return document.body.classList.contains('theme-dark')
                ? '#b3b3b3' // на тёмной схеме серый посветлее
                : '#5c5c5c'; // на светлой схеме серый потемнее
        } else {
            // Иначе возвращаем полученный цвет (часто это #... или rgb(...))
            return colorValue;
        }
    }

    /**
     * Добавляет новую ссылку (obLink) в карту linksMap.
     * Если уже существует ссылка в обратную сторону (reverseKey),
     * то меняем статус pairStatus (First / Second).
     * @param renderer - текущий ObsidianRenderer
     * @param obLink - ссылка (ObsidianLink)
     * @param tagColors - включена ли цветовая дифференциация
     * @param tagLegend - показывать ли легенду
     */
    addLink(renderer: ObsidianRenderer, obLink: ObsidianLink, tagColors: boolean, tagLegend: boolean): void {
        const key = this.generateKey(obLink.source.id, obLink.target.id);
        const reverseKey = this.generateKey(obLink.target.id, obLink.source.id);

        // Если в карте есть обратная ссылка, считаем эту ссылку Second, а ту - First
        const pairStatus = (
            obLink.source.id !== obLink.target.id
            && this.linksMap.has(reverseKey)
        )
            ? LinkPair.Second
            : LinkPair.None;

        // Создаём расширенный объект GltLink
        const newLink: GltLink = {
            obsidianLink: obLink,
            pairStatus: pairStatus,
            // Инициализируем текст (если надо), с учётом pairStatus
            pixiText: this.initializeLinkText(renderer, obLink, pairStatus),
            // Инициализируем линию (Graphics), если включён tagColors
            pixiGraphics: tagColors
                ? this.initializeLinkGraphics(renderer, obLink, tagLegend)
                : null,
        };

        // Запоминаем в карте
        this.linksMap.set(key, newLink);

        // Если обнаружили обратную ссылку, ставим её pairStatus = First
        if (
            obLink.source.id !== obLink.target.id
            && this.linksMap.has(reverseKey)
        ) {
            const reverseLink = this.linksMap.get(reverseKey);
            if (reverseLink) {
                reverseLink.pairStatus = LinkPair.First;
            }
        }
    }

    /**
     * Удаляет ссылку из linksMap и со сцены (и текст, и Graphics),
     * а также корректирует легенду, если конкретный тип ссылки больше не используется.
     * @param renderer - текущий ObsidianRenderer
     * @param link - ссылка (ObsidianLink), которую надо удалить
     */
    removeLink(renderer: ObsidianRenderer, link: ObsidianLink): void {
        const key = this.generateKey(link.source.id, link.target.id);
        const reverseKey = this.generateKey(link.target.id, link.source.id);

        const gltLink = this.linksMap.get(key);
        
        // Если есть pixiText, и он присутствует на сцене, убираем его
        if (
            gltLink
            && gltLink.pixiText
            && renderer.px
            && renderer.px.stage
            && renderer.px.stage.children
            && renderer.px.stage.children.includes(gltLink.pixiText)
        ) {
            renderer.px.stage.removeChild(gltLink.pixiText);
            gltLink.pixiText.destroy();
        }

        // Аналогично для pixiGraphics (линию тоже надо удалить)
        if (
            gltLink
            && gltLink.pixiGraphics
            && renderer.px
            && renderer.px.stage
            && renderer.px.stage.children
            && renderer.px.stage.children.includes(gltLink.pixiGraphics)
        ) {
            renderer.px.stage.removeChild(gltLink.pixiGraphics);
            gltLink.pixiGraphics.destroy();
        }

        // colorKey — это сама строка, которая была на pixiText (например, "subordinates")
        let colorKey = gltLink?.pixiText?.text?.replace(/\r?\n/g, "");
        if (colorKey) {
            // Проверяем, используем ли мы такой тег / ключ в легенде
            if (this.tagColors.has(colorKey)) {
                const legendGraphic = this.tagColors.get(colorKey);
                if (legendGraphic) {
                    // Уменьшаем счётчик использования
                    legendGraphic.nUsing -= 1;
                    // Если счётчик упал ниже 1, значит больше никто не использует этот тип,
                    // нужно убрать его из легенды
                    if (legendGraphic.nUsing < 1) {
                        // Сдвигаем yOffset обратно на одну строку
                        this.yOffset -= this.lineHeight;
                        // Уменьшаем индекс текущего цвета (чтобы "вернуться назад" в выборе)
                        this.currentTagColorIndex -= 1;
                        if (this.currentTagColorIndex < 0) {
                            this.currentTagColorIndex = this.categoricalColors.length - 1;
                        }
                        // Удаляем текст легенды, если он есть
                        if (
                            legendGraphic.legendText
                            && renderer.px
                            && renderer.px.stage
                            && renderer.px.stage.children
                            && renderer.px.stage.children.includes(legendGraphic.legendText)
                        ) {
                            renderer.px.stage.removeChild(legendGraphic.legendText);
                            legendGraphic.legendText.destroy();
                        }
                        // Удаляем графический элемент легенды (цветную линию)
                        if (
                            legendGraphic.legendGraphics
                            && renderer.px.stage.children.includes(legendGraphic.legendGraphics)
                        ) {
                            renderer.px.stage.removeChild(legendGraphic.legendGraphics);
                            legendGraphic.legendGraphics.destroy();
                        }
                        // Удаляем запись из tagColors
                        this.tagColors.delete(colorKey);
                    }
                }
            }
        }

        // Удаляем саму запись о ссылке из карты
        this.linksMap.delete(key);

        // Если была парная связь (B->A), у неё устанавливаем pairStatus = None
        const reverseLink = this.linksMap.get(reverseKey);
        if (reverseLink && reverseLink.pairStatus !== LinkPair.None) {
            reverseLink.pairStatus = LinkPair.None;
        }
    }

    /**
     * Синхронизирует нашу карту linksMap со списком текущих ссылок (currentLinks).
     * Если в linksMap есть ссылки, которых уже нет в currentLinks, удаляем их.
     * @param renderer - рендерер
     * @param currentLinks - массив ссылок (ObsidianLink), актуальный для данного кадра
     */
    removeLinks(renderer: ObsidianRenderer, currentLinks: ObsidianLink[]): void {
        // Собираем ключи "source-target" для всех текущих ссылок
        const currentKeys = new Set(
            currentLinks.map(link => this.generateKey(link.source.id, link.target.id))
        );
        // Идём по linksMap и удаляем те, которых нет в currentKeys
        this.linksMap.forEach((_, key) => {
            if (!currentKeys.has(key)) {
                const link = this.linksMap.get(key);
                if (link) {
                    this.removeLink(renderer, link.obsidianLink);
                }
            }
        });
    }

    /**
     * Возвращает статус пары ссылки (None, First, Second).
     */
    getLinkPairStatus(key: string): LinkPair {
        const link = this.linksMap.get(key);
        return link ? link.pairStatus : LinkPair.None;
    }

    /**
     * Обновляет позицию текста на ссылке. Вычисляем midpoint (середину линии),
     * переносим координаты в систему rендерера (pan, scale), и ставим text туда.
     * @param renderer - рендерер
     * @param link - ссылка
     * @param tagNames - флаг, отображать ли названия (или делать их прозрачными)
     */
    updateLinkText(renderer: ObsidianRenderer, link: ObsidianLink, tagNames: boolean): void {
        // Если чего-то нет, выходим
        if (!renderer || !link || !link.source || !link.target) {
            return;
        }
        const linkKey = this.generateKey(link.source.id, link.target.id);
        const gltLink = this.linksMap.get(linkKey);
        let text;
        if (gltLink) {
            text = gltLink.pixiText;
        } else {
            return;
        }

        // Середина по X и по Y
        const midX: number = (link.source.x + link.target.x) / 2;
        const midY: number = (link.source.y + link.target.y) / 2;

        // Переводим координаты с учётом pan и scale
        const { x, y } = this.getLinkToTextCoordinates(
            midX,
            midY,
            renderer.panX,
            renderer.panY,
            renderer.scale
        );

        // Если text присутствует на сцене, задаём ему позицию, масштаб и прозрачность
        if (
            text
            && renderer.px
            && renderer.px.stage
            && renderer.px.stage.children
            && renderer.px.stage.children.includes(text)
        ) {
            text.x = x;
            text.y = y;
            // Масштаб уменьшается обратно пропорционально nodeScale (примерная настройка)
            text.scale.set(1 / (3 * renderer.nodeScale));
            // Задаём цвет текста (например, #fff или #333)
            text.style.fill = this.textColor;

            if (tagNames) {
                // Если у source.text.alpha или target.text.alpha нет значений, ставим альфа = 0.9
                if (
                    !link.source
                    || !link.target
                    || !link.source.text
                    || !link.target.text
                    || !link.target.text.alpha
                    || !link.source.text.alpha
                ) {
                    text.alpha = 0.9;
                } else {
                    // Иначе берём максимум из альфа значений source и target
                    text.alpha = Math.max(link.source.text.alpha, link.target.text.alpha);
                }
            } else {
                // Если tagNames=false, делаем текст полностью прозрачным
                text.alpha = 0.0;
            }
        }
    }

    /**
     * Обновляет позицию (и вид) цветной линии на ссылке (если включен tagColors).
     * @param renderer - рендерер
     * @param link - ссылка
     */
    updateLinkGraphics(renderer: ObsidianRenderer, link: ObsidianLink): void {
        if (!renderer || !link || !link.source || !link.target) {
            return;
        }
        const linkKey = this.generateKey(link.source.id, link.target.id);
        const gltLink = this.linksMap.get(linkKey);
        let graphics;
        if (gltLink) {
            graphics = gltLink.pixiGraphics;
        } else {
            return;
        }

        // Считаем нормаль (nx, ny) и параллель (px, py) к вектору source->target
        let { nx, ny } = this.calculateNormal(
            link.source.x,
            link.source.y,
            link.target.x,
            link.target.y
        );
        let { px, py } = this.calculateParallel(
            link.source.x,
            link.source.y,
            link.target.x,
            link.target.y
        );
        
        // Умножаем нормаль на 1.5 * sqrt(scale), чтобы линия чуть смещалась от центра
        nx *= 1.5 * Math.sqrt(renderer.scale);
        ny *= 1.5 * Math.sqrt(renderer.scale);

        // Параллель умножаем на 8 * sqrt(scale), чтобы линия располагалась "выше" или "ниже" узла
        px *= 8 * Math.sqrt(renderer.scale);
        py *= 8 * Math.sqrt(renderer.scale);

        // Координаты узлов в системе рендерера
        let { x: x1, y: y1 } = this.getLinkToTextCoordinates(
            link.source.x,
            link.source.y,
            renderer.panX,
            renderer.panY,
            renderer.scale
        );
        let { x: x2, y: y2 } = this.getLinkToTextCoordinates(
            link.target.x,
            link.target.y,
            renderer.panX,
            renderer.panY,
            renderer.scale
        );

        // Смещаем x1, y1, x2, y2 на нормаль + параллель
        x1 += nx + (link.source.weight / 36 + 1) * px;
        x2 += nx - (link.target.weight / 36 + 1) * px;
        y1 += ny + (link.source.weight / 36 + 1) * py;
        y2 += ny - (link.target.weight / 36 + 1) * py;
      
        if (
            graphics
            && renderer.px
            && renderer.px.stage
            && renderer.px.stage.children
            && renderer.px.stage.children.includes(graphics)
        ) {
            // Через @ts-ignore, потому что _lineStyle — приватное свойство PIXI.Graphics
            // Но нам нужно узнать текущий цвет
            // @ts-ignore
            const color = graphics._lineStyle.color;

            // Очищаем старое содержимое Graphics
            graphics.clear();
            // Настраиваем стиль линии (толщина 3 / sqrt(nodeScale), цвет color)
            graphics.lineStyle(
                3 / Math.sqrt(renderer.nodeScale),
                color
            );
            graphics.alpha = 0.6;

            // Рисуем линию от (x1, y1) до (x2, y2)
            graphics.moveTo(x1, y1);
            graphics.lineTo(x2, y2);
        }
    }

    /**
     * Создаёт новый текст (PIXI.Text) для ссылки, если у неё есть подходящий ключ в Dataview (getMetadataKeyForLink).
     * Учитывает pairStatus, чтобы при двунаправленной связи делать перенос строки (\n\n).
     * @param renderer - рендерер
     * @param link - ObsidianLink
     * @param pairStatus - LinkPair (None, First, Second)
     * @returns PIXI.Text или null, если нет нужных данных.
     */
    private initializeLinkText(
        renderer: ObsidianRenderer,
        link: ObsidianLink,
        pairStatus: LinkPair
    ): Text | null {
        // Пытаемся получить YAML-ключ (например, 'parent', 'subordinates' и т.п.)
        let linkString: string | null = this.getMetadataKeyForLink(link.source.id, link.target.id);
        if (linkString === null) {
            // Если нет ключа, не создаём текст
            return null;
        }
        // Если ссылка петляет сама на себя (sourceId === targetId), очищаем текст
        if (link.source.id === link.target.id) {
            linkString = "";
        }

        // Если есть пара, добавляем переносы строк, чтобы подписи не наложились
        if (pairStatus === LinkPair.First) {
            linkString = linkString + "\n\n";
        } else if (pairStatus === LinkPair.Second) {
            linkString = "\n\n" + linkString;
        }
        // LinkPair.None — ничего не делаем

        // Создаём стиль текста (большой шрифт 36, цвет заполнится позже)
        const textStyle: TextStyle = new TextStyle({
            fontFamily: 'Arial',
            fontSize: 36,
            fill: this.textColor
        });

        // Создаём объект PIXI.Text
        const text: Text = new Text(linkString, textStyle);
        // zIndex повыше, чтобы текст был выше линий
        text.zIndex = 1;
        // Якорь по центру
        text.anchor.set(0.5, 0.5);

        // Сразу обновляем позицию (но передаём false, чтобы скрыть до включения tagNames)
        this.updateLinkText(renderer, link, false);
        // Добавляем текст на сцену
        renderer.px.stage.addChild(text);
        
        return text;
    }

    /**
     * Создаёт (или переиспользует) цветную линию для ссылки + при необходимости создаёт элемент легенды.
     * @param renderer - рендерер
     * @param link - ObsidianLink
     * @param tagLegend - показывать ли саму легенду
     * @returns PIXI.Graphics или null, если нет ключа
     */
    private initializeLinkGraphics(
        renderer: ObsidianRenderer,
        link: ObsidianLink,
        tagLegend: boolean
    ): Graphics | null {
        // Определяем ключ (например, 'subordinates')
        let linkString: string | null = this.getMetadataKeyForLink(link.source.id, link.target.id);
        if (linkString === null) {
            return null;
        }

        let color;

        // Если ссылка на саму себя, обнуляем строку
        if (link.source.id === link.target.id) {
            linkString = "";
        } else {
            // Если ещё нет такого ключа в tagColors — выбираем очередной цвет
            if (!this.tagColors.has(linkString)) {
                color = this.categoricalColors[this.currentTagColorIndex];

                // Сдвигаем индекс и берём по модулю длины массива цветов
                this.currentTagColorIndex = (this.currentTagColorIndex + 1) % this.categoricalColors.length;

                // Создаём текст для легенды (14 размер, чтобы влезало)
                const textL = new Text(linkString, {
                    fontFamily: 'Arial',
                    fontSize: 14,
                    fill: this.textColor
                });
                // Располагаем в (this.xOffset, this.yOffset) на сцене
                textL.x = this.xOffset;
                textL.y = this.yOffset;
                // Добавляем на сцену
                renderer.px.stage.addChild(textL);

                // Линия возле текста — чтобы показать цвет
                const lineStartX = this.xOffset + textL.width + this.spaceBetweenTextAndLine;
                const graphicsL = new Graphics();
                // Толщина 2px, цвет color
                graphicsL.lineStyle(2, color, 1);
                // Рисуем короткую линию рядом с текстом
                graphicsL.moveTo(lineStartX, this.yOffset + (this.lineHeight / 2));
                graphicsL.lineTo(lineStartX + this.lineLength, this.yOffset + (this.lineHeight / 2));
                renderer.px.stage.addChild(graphicsL);

                // Увеличиваем смещение по вертикали для следующего элемента
                this.yOffset += this.lineHeight;

                // Если легенду скрывать, делаем элементы прозрачными
                if (!tagLegend) {
                    graphicsL.alpha = 0.0;
                    textL.alpha = 0.0;
                }

                // Создаём структуру для легенды
                const newLegendGraphic: GltLegendGraphic = {
                    color: color,
                    legendText: textL,
                    legendGraphics: graphicsL,
                    nUsing: 0,
                };

                // Сохраняем в карту
                this.tagColors.set(linkString, newLegendGraphic);
            } else {
                // Если ключ уже есть в tagColors, значит цвет уже выбран
                const legendGraphic = this.tagColors.get(linkString);
                if (legendGraphic) {
                    color = legendGraphic.color;
                    legendGraphic.nUsing += 1;
                } else {
                    // На случай, если что-то пошло не так
                    color = 0xFFFFFF;
                }
            }
        }

        // Создаём Graphics для рисования линии
        const graphics = new Graphics();
        graphics.lineStyle(
            3 / Math.sqrt(renderer.nodeScale),
            color
        );
        // zIndex=0, чтобы линия была под текстом
        graphics.zIndex = 0;
        renderer.px.stage.addChild(graphics);

        // Сразу обновляем её координаты
        this.updateLinkGraphics(renderer, link);

        return graphics;
    }

    /**
     * Вспомогательная функция для извлечения первого URL/ссылки из Markdown-ссылки ([Text](URL)).
     */
    private extractPathFromMarkdownLink(markdownLink: string | unknown): string {
        // extractLinks(...) вернёт объект вида { links: [...], content: '...' }
        const links = extractLinks(markdownLink).links;
        // Возвращаем первую ссылку, если она есть
        return links.length > 0 ? links[0] : '';
    }

    /**
     * Определяем тип значения, пришедшего из Dataview (WikiLink, MarkdownLink, String, Array, или Other).
     * @param value - значение поля (Yaml) из Dataview
     * @returns DataviewLinkType
     */
    private determineDataviewLinkType(value: any): DataviewLinkType {
        if (
            typeof value === 'object'
            && value !== null
            && 'path' in value
        ) {
            // Dataview отдаёт wiki-ссылки в виде { path: "..." }
            return DataviewLinkType.WikiLink;
        } else if (
            typeof value === 'string'
            && value.includes('](')
        ) {
            // Если это строка, содержащая "](", считаем это MarkdownLink
            return DataviewLinkType.MarkdownLink;
        } else if (typeof value === 'string') {
            return DataviewLinkType.String;
        } else if (Array.isArray(value)) {
            return DataviewLinkType.Array;
        } else {
            return DataviewLinkType.Other;
        }
    }

    /**
     * Удаляет все текстовые узлы и линии, связанные с каждой ссылкой, из графа.
     * @param renderer - текущий рендерер
     */
    destroyMap(renderer: ObsidianRenderer): void {
        if (this.linksMap.size > 0) {
            // Удаляем каждую ссылку (а внутри removeLink удаляются и pixiText, и graphics)
            this.linksMap.forEach((gltLink, linkKey) => {
                this.removeLink(renderer, gltLink.obsidianLink);
            });
        }
    }

    /**
     * Пытается найти в Dataview-данных страницы (sourceId) ключ (например, 'subordinates'),
     * в котором содержится ссылка (WikiLink/MarkdownLink/Array) на страницу (targetId).
     * Если находит, возвращает название ключа, иначе null.
     */
    private getMetadataKeyForLink(sourceId: string, targetId: string): string | null {
        // Получаем структуру (DataviewPage) для заметки sourceId
        const sourcePage: any = this.api.page(sourceId);
        // Если нет страницы, возвращаем null
        if (!sourcePage) return null;

        // Проходимся по всем полям YAML
        for (const [key, value] of Object.entries(sourcePage)) {
            // Пропускаем пустые значения
            if (value === null || value === undefined || value === '') {
                continue;
            }
            // Определяем, что это за тип
            const valueType = this.determineDataviewLinkType(value);

            switch (valueType) {
                case DataviewLinkType.WikiLink:
                    // @ts-ignore - игнорируем предупреждение TS, что value может не иметь .path
                    if (value.path === targetId) {
                        return key;
                    }
                    break;
                case DataviewLinkType.MarkdownLink:
                    // Если это markdown-ссылка, извлекаем из неё путь и сравниваем
                    if (this.extractPathFromMarkdownLink(value) === targetId) {
                        return key;
                    }
                    break;
                case DataviewLinkType.Array:
                    // Если это массив, проверяем каждый элемент
                    // @ts-ignore
                    for (const item of value) {
                        // Если элемент — WikiLink и path совпадает
                        if (
                            this.determineDataviewLinkType(item) === DataviewLinkType.WikiLink
                            && item.path === targetId
                        ) {
                            return key;
                        }
                        // Или элемент — MarkdownLink и извлечённый путь совпадает
                        if (
                            this.determineDataviewLinkType(item) === DataviewLinkType.MarkdownLink
                            && this.extractPathFromMarkdownLink(item) === targetId
                        ) {
                            return key;
                        }
                    }
                    break;
                default:
                    // Если это просто String или другой тип, пробуем следующее поле
                    continue;
            }
        }
        // Ничего не нашли — возвращаем null
        return null;
    }

    /**
     * Переводит координаты (linkX, linkY) в координаты с учётом pan и scale рендерера.
     * Возвращает объект { x, y }.
     */
    private getLinkToTextCoordinates(
        linkX: number,
        linkY: number,
        panX: number,
        panY: number,
        scale: number
    ): { x: number; y: number } {
        // Просто умножаем X,Y на scale, потом прибавляем panX, panY
        return {
            x: linkX * scale + panX,
            y: linkY * scale + panY
        };
    }

    /**
     * Рассчитывает вектор нормали (nx, ny) к вектору (sourceX->targetX, sourceY->targetY).
     * Используется, чтобы рисовать линию/текст немного "выше" или "в стороне" от прямой.
     */
    private calculateNormal(
        sourceX: number,
        sourceY: number,
        targetX: number,
        targetY: number
    ): { nx: number; ny: number } {
        // Вектор D
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;

        // Поворот на 90 градусов: (dx, dy) -> (-dy, dx)
        let nx = -dy;
        let ny = dx;

        // Нормируем вектор
        const length = Math.sqrt(nx * nx + ny * ny);
        nx /= length;
        ny /= length;

        return { nx, ny };
    }

    /**
     * Рассчитывает параллельный вектор (px, py) вдоль линии от source к target.
     * Нужен для "сдвига" линии вперёд/назад относительно узлов.
     */
    private calculateParallel(
        sourceX: number,
        sourceY: number,
        targetX: number,
        targetY: number
    ): { px: number; py: number } {
        // Вектор D
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;

        // Нормализуем D
        const length = Math.sqrt(dx * dx + dy * dy);
        const px = dx / length;
        const py = dy / length;

        return { px, py };
    }
}
