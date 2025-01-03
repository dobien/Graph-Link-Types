// Импортируем классы Text и Graphics из библиотеки pixi.js,
// которые используются для отрисовки текста и графических элементов (линий, фигур) на сцене.
import { Text , Graphics } from 'pixi.js';

/**
 * Интерфейс ObsidianRenderer описывает структуру объекта, который
 * Obsidian использует для рендеринга графа (как глобального, так и локального).
 */
export interface ObsidianRenderer {
    // Объект px — содержит сцену Pixi (stage), на которую мы добавляем/удаляем элементы (Text, Graphics).
    px: {
        stage: {
            sortableChildren: boolean;   // Флаг сортировки объектов по zIndex (если true, можно менять порядок отрисовки)
            addChild: (child: any) => void;      // Метод для добавления объекта (Text, Graphics и т.д.) на сцену
            removeChild: (child: any) => void;   // Метод для удаления объекта со сцены
            children: any[];                    // Массив объектов, уже находящихся на сцене
        };
    };

    // Массив ссылок, которые рендерер в данный момент отображает (каждый элемент — структура ObsidianLink).
    links: any[];

    // Масштаб узлов (вершин). Используется, чтобы понимать, как крупно отображаются вершины и текст.
    nodeScale: number;

    // Координаты "сдвига" (панорамирования) по оси X в графе.
    panX: number;

    // Координаты "сдвига" по оси Y в графе.
    panY: number;

    // Общий коэффициент масштабирования графа (включая все элементы, возможно помимо nodeScale).
    scale: number;
}

/**
 * Интерфейс ObsidianLink описывает структуру ссылки (ребра) между двумя вершинами (source и target).
 */
export interface ObsidianLink {
    // Источник ссылки (вершина), содержит:
    source: {
        id: string;   // Уникальный идентификатор, обычно имя (path) заметки
        x: number;    // Координата X в пространстве графа
        y: number;    // Координата Y в пространстве графа
        weight: number; // "Вес" ссылки или узла, может влиять на толщину/отображение
        text: {
            alpha: number; // Прозрачность текста, связанного с данной вершиной
        }
    };
    // Целевая вершина:
    target: {
        id: string;   // Аналогичные поля для целевой вершины
        x: number;
        y: number;
        weight: number;
        text: {
            alpha: number;
        }
    };
}

/**
 * Перечисление (enum) DataviewLinkType:
 * Определяет возможные типы значений, которые Dataview может вернуть при чтении YAML- или метаданных.
 */
export enum DataviewLinkType {
    WikiLink,       // Ссылка вида [[PageName]]
    MarkdownLink,   // Ссылка формата [Title](URL)
    String,         // Обычная строка (не распозналось как ссылка)
    Array,          // Массив значений
    Other           // Любой другой тип (числа, объекты без path, и т.п.)
}

/**
 * Перечисление (enum) LinkPair:
 * Нужно для пометки связей, которые существуют в обоих направлениях, чтобы правильно отображать подписи.
 * None   - нет пары (единственная связь между двумя заметками),
 * First  - первая из пары двунаправленных ссылок,
 * Second - вторая из пары.
 */
export enum LinkPair {
    None,
    First,
    Second,
}

/**
 * Интерфейс GltLink (Graph Link Types Link):
 * Описывает структуру "расширенной" ссылки, с дополнительными полями для отрисовки в Pixi.js.
 */
export interface GltLink {
    obsidianLink: ObsidianLink;   // Оригинальная ссылка из Obsidian
    pairStatus: LinkPair;         // Статус пары (None, First, Second)
    pixiText: Text | null;        // Объект текста (PIXI.Text) для подписи связи
    pixiGraphics: Graphics | null; // Объект графики (PIXI.Graphics), чтобы, например, рисовать цветную линию
}

/**
 * Интерфейс GltLegendGraphic:
 * Хранит информацию для отрисовки в легенде (цвет линии, подпись, количество использований и т.д.).
 */
export interface GltLegendGraphic {
    color: number;           // Цвет в формате 0xRRGGBB (числовое представление, понятное Pixi)
    legendText: Text;        // Текст (PIXI.Text), отображающий название типа связи в легенде
    legendGraphics: Graphics; // Небольшая цветная линия (PIXI.Graphics) рядом с текстом
    nUsing: number;          // Счётчик, сколько раз данный тип связи используется (чтобы удалять, когда он не нужен)
}
