// Импортируем необходимые классы и типы из Obsidian (Plugin, Notice, App, PluginSettingTab, Setting),
// а также из Dataview (getAPI) и собственные типы (ObsidianRenderer, ObsidianLink), и класс LinkManager.
import { Plugin, Notice , App, PluginSettingTab, Setting} from 'obsidian'; 
import { getAPI } from 'obsidian-dataview';
import { ObsidianRenderer, ObsidianLink} from 'src/types';
import { LinkManager } from 'src/linkManager';

// Описываем интерфейс настроек плагина GraphLinkTypesPluginSettings.
export interface GraphLinkTypesPluginSettings {
    tagColors: boolean;  // Управляет раскраской связей по типам
    tagNames: boolean;   // Управляет отображением названий типов на связях
    tagLegend: boolean;  // Управляет отображением легенды (списка) типов
}

// Значения настроек по умолчанию.
const DEFAULT_SETTINGS: GraphLinkTypesPluginSettings = {
    tagColors: false, // По умолчанию разноцветная раскраска выключена
    tagNames: true,   // По умолчанию текст меток включен
    tagLegend: true,  // По умолчанию легенда включена
};

// Класс GraphLinkTypesSettingTab — вкладка настроек для нашего плагина в Obsidian.
class GraphLinkTypesSettingTab extends PluginSettingTab {
    // Храним ссылку на главный плагин, чтобы изменять/сохранять настройки
    plugin: GraphLinkTypesPlugin;

    // Конструктор получает ссылку на приложение и сам плагин
    constructor(app: App, plugin: GraphLinkTypesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Метод, который отрисовывает вкладку настроек в интерфейсе Obsidian
    display(): void {
        const {containerEl} = this;
        // Очищаем контейнер, чтобы при повторных открытиях настройки не дублировались
        containerEl.empty();
    
        // Первый переключатель (Type Names) — управляет показом подписей на связях
        new Setting(containerEl)
            .setName('Type Names')
            .setDesc('Toggle to enable or disable link type names in the graph view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.tagNames)
                .onChange(async (value) => {
                    this.plugin.settings.tagNames = value;
                    await this.plugin.saveSettings();
                    // Перезапускаем цикл обновления, чтобы изменения применились
                    this.plugin.startUpdateLoop();
                }));
    
        // Второй переключатель (Type Colors) — управляет цветовой дифференциацией связей
        new Setting(containerEl)
            .setName('Type Colors')
            .setDesc('Toggle to enable or disable link type colors in the graph view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.tagColors)
                .onChange(async (value) => {
                    this.plugin.settings.tagColors = value;
                    await this.plugin.saveSettings();
                    this.plugin.startUpdateLoop();
                }));
    
        // Третий переключатель (Show Legend) — управляет показом легенды типов
        new Setting(containerEl)
            .setName('Show Legend')
            .setDesc('Toggle to show or hide the legend for link type colors in the graph view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.tagLegend)
                .onChange(async (value) => {
                    this.plugin.settings.tagLegend = value;
                    await this.plugin.saveSettings();
                    this.plugin.startUpdateLoop();
                }));
    }
}


// Основной класс плагина GraphLinkTypesPlugin, расширяет Plugin.
export default class GraphLinkTypesPlugin extends Plugin {
    
    // Храним настройки плагина
    settings: GraphLinkTypesPluginSettings;

    // Dataview API
    api = getAPI();

    // Текущий рендерер графа (если найден)
    currentRenderer: ObsidianRenderer | null = null;

    // Идентификатор кадра анимации (для requestAnimationFrame)
    animationFrameId: number | null = null;

    // Экземпляр LinkManager — управляет отрисовкой ссылок, их цветами, подписями и т.п.
    linkManager = new LinkManager();

    // Флаг, указывающий, что индекс Dataview готов (dataview:index-ready)
    indexReady = false;

    /**
     * Метод жизненного цикла, вызывается при загрузке плагина в Obsidian.
     * Здесь мы загружаем настройки, регистрируем вкладку настроек,
     * проверяем наличие Dataview API и подписываемся на события.
     */
    async onload(): Promise<void> {
        
        // Загружаем настройки
        await this.loadSettings();
        // Добавляем вкладку настроек в Obsidian
        this.addSettingTab(new GraphLinkTypesSettingTab(this.app, this));

        // Проверяем, доступен ли Dataview
        if (!this.api) {
            console.error("Dataview plugin is not available.");
            new Notice("Data plugin is not available.");
            return;
        }

        // Регистрируем обработчик события 'layout-change' — например, когда пользователь открывает/закрывает панели
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.handleLayoutChange();
        }));

        // Подписываемся на событие dataview:index-ready — когда Dataview полностью проиндексировал заметки
        // @ts-ignore отключает проверку TS, так как официального типа для этих событий может не быть
        this.registerEvent(this.app.metadataCache.on("dataview:index-ready", () => {
            this.indexReady = true;
        }));

        // Подписываемся на событие dataview:metadata-change — когда Dataview заметил изменения метаданных в заметках
        // и, если индекс готов, снова обновляем граф
        // @ts-ignore аналогично, чтобы TS не ругался
        this.registerEvent(this.app.metadataCache.on("dataview:metadata-change", () => {
            if (this.indexReady) {
                this.handleLayoutChange();
            }
        }));
    }

    // Метод для загрузки настроек из JSON-файла
    async loadSettings() {
        // Объединяем настройки по умолчанию с сохранёнными пользователем
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // Метод для сохранения настроек в JSON-файле
    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Ищет первый подходящий (валидный) рендерер графа, смотрит и в обычном 'graph', и в 'localgraph'.
     * Возвращает ObsidianRenderer или null, если не нашлось.
     */
    findRenderer(): ObsidianRenderer | null {
        // Сначала ищем листы типа 'graph'
        let graphLeaves = this.app.workspace.getLeavesOfType('graph');
        for (const leaf of graphLeaves) {
            // @ts-ignore: т.к. в типах Obsidian может не быть поля renderer
            const renderer = leaf.view.renderer;
            // Если это действительно ObsidianRenderer, возвращаем его
            if (this.isObsidianRenderer(renderer)) {
                return renderer;
            }
        }

        // Если среди 'graph' не нашли, ищем среди 'localgraph'
        graphLeaves = this.app.workspace.getLeavesOfType('localgraph');
        for (const leaf of graphLeaves) {
            // @ts-ignore
            const renderer = leaf.view.renderer;
            if (this.isObsidianRenderer(renderer)) {
                return renderer;
            }
        }
        // Если не нашли ни там, ни там, возвращаем null
        return null;
    }
    
    /**
     * Метод, который вызывается при изменении layout (например, открылись новые окна,
     * пользователь переключился на локальный граф и т.д.). Перезапускаем цикл рендеринга.
     */
    async handleLayoutChange() {
        // Если у нас уже есть запланированный frame обновления, отменяем его
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        // Ждём, пока появится новый рендерер (или подтвердится его отсутствие)
        await this.waitForRenderer();
        // Проверяем и обновляем текущий рендерер
        this.checkAndUpdateRenderer();
    }

    /**
     * Проверяет, появился ли новый рендерер,
     * если да — привязываемся к нему и запускаем обновление.
     */
    checkAndUpdateRenderer() {
        const newRenderer = this.findRenderer();
        // Если нет рендерера, сбрасываем ссылку
        if (!newRenderer) {
            this.currentRenderer = null;
            return;
        }
        // Включаем сортировку детей по zIndex
        newRenderer.px.stage.sortableChildren = true;
        // Запоминаем рендерер
        this.currentRenderer = newRenderer;
        // Запускаем цикл обновлений (рендеринга)
        this.startUpdateLoop();
    }

    /**
     * Ждёт в цикле, пока в интерфейсе не появится валидный рендерер.
     * Раз в N (500) миллисекунд пытается найти рендерер методом findRenderer().
     */
    waitForRenderer(): Promise<void> {
        return new Promise((resolve) => {
            const checkInterval = 500; // Интервал в мс для проверки

            const intervalId = setInterval(() => {
                const renderer = this.findRenderer();
                if (renderer) {
                    clearInterval(intervalId);
                    resolve();
                }
            }, checkInterval);
        });
    }

    /**
     * Запускает цикл обновления позиций (startUpdateLoop), где мы перерисовываем текст на связях.
     * @param verbosity - для отладки, если > 0, будем выводить уведомления.
     */
    startUpdateLoop(verbosity: number = 0): void {
        // Если рендерера нет, предупреждаем (если verbosity > 0) и выходим
        if (!this.currentRenderer) {
            if (verbosity > 0) {
                new Notice('No valid graph renderer found.');
            }
            return;
        }
        // Получаем рендерер
        const renderer : ObsidianRenderer = this.currentRenderer;
        // Сносим все предыдущие надписи (если были) — чтобы перерисовать заново
        this.linkManager.destroyMap(renderer);

        // Планируем обновление позиций в следующем кадре анимации
        requestAnimationFrame(this.updatePositions.bind(this));
    }

    /**
     * Функция, которая непрерывно обновляет позиции текстов (и при необходимости создаёт новые связи).
     * Вызывается в цикле через requestAnimationFrame.
     */
    updatePositions(): void {

        // Если рендерер пропал, прерываемся
        if (!this.currentRenderer) {
            return;
        }

        // Берём текущий рендерер
        const renderer: ObsidianRenderer = this.currentRenderer;

        // Флаг, указывающий, нужно ли обновить карту (удалить и пересоздать недостающие связи)
        let updateMap = false;

        // Если animationFrameId существует и делится на 10, запускаем обновление карты
        if (this.animationFrameId && this.animationFrameId % 10 == 0) {
            updateMap = true;
            // Удаляем все неактуальные ссылки (которых нет в renderer.links)
            this.linkManager.removeLinks(renderer, renderer.links);
        }
        
        // Проходимся по всем ссылкам из рендерера
        renderer.links.forEach((link: ObsidianLink) => {
            // Если пора обновить карту, добавляем ссылку в LinkManager, если её там ещё нет
            if (updateMap) {
                const key = this.linkManager.generateKey(link.source.id, link.target.id);
                if (!this.linkManager.linksMap.has(key)) {
                    this.linkManager.addLink(renderer, link, this.settings.tagColors, this.settings.tagLegend);
                }
            }
            // Обновляем позицию текста на связи (на случай, если узлы сдвинулись)
            this.linkManager.updateLinkText(renderer, link, this.settings.tagNames);
            // Если включена цветовая дифференциация, обновляем графику (цвет) связи
            if (this.settings.tagColors) {
                this.linkManager.updateLinkGraphics(renderer, link);
            }
        });

        // Продолжаем цикл анимации
        this.animationFrameId = requestAnimationFrame(this.updatePositions.bind(this));
    }

    /**
     * Проверяем, действительно ли переданный объект имеет структуру ObsidianRenderer:
     * содержит ли поля px, stage, panX, panY, метод addChild/removeChild и массив links.
     */
    private isObsidianRenderer(renderer: any): renderer is ObsidianRenderer {
        return renderer 
            && renderer.px 
            && renderer.px.stage 
            && renderer.panX
            && renderer.panY
            && typeof renderer.px.stage.addChild === 'function' 
            && typeof renderer.px.stage.removeChild === 'function'
            && Array.isArray(renderer.links);
    }
}