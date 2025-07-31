// InteractiveElementSelector.mjs
import { CdpAutomation } from "./CdpAutomation.mjs";

export class InteractiveElementSelector extends CdpAutomation {
  // Приватная карта для хранения найденных интерактивных элементов: номер -> { selector, bounds, description, objectId, backendNodeId }
  #mappedElements = new Map();
  #elementCounter = 1; // Счетчик для нумерации элементов

  /**
   * Создает новый экземпляр InteractiveElementSelector.
   * @param {string} cdpEndpoint URL-адрес конечной точки CDP (например, "http://192.168.88.100:31091").
   */
  constructor(cdpEndpoint) {
    super(cdpEndpoint); // Вызываем конструктор родительского класса CdpAutomation
  }

  /**
   * Скрипт проверки видимости, который будет выполнен в контексте браузера
   * для конкретного элемента через Runtime.callFunctionOn.
   * this здесь будет ссылаться на DOM-элемент.
   */
  #visibilityCheckScript = `
    function() {
      const el = this;
      const rect = el.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(el);

      // 1. Базовая проверка видимости элемента через CSS и размеры
      const isVisibleByCssAndSize = (
        rect.width > 0 &&
        rect.height > 0 &&
        computedStyle.visibility !== 'hidden' &&
        computedStyle.display !== 'none' &&
        computedStyle.opacity !== '0' &&
        el.offsetParent !== null // Элемент должен быть в потоке документа
      );

      if (!isVisibleByCssAndSize) {
        return { isVisible: false };
      }

      // 2. Проверка, находится ли элемент в пределах видимой области (viewport)
      const isInViewport = (
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        rect.bottom > 0 &&
        rect.right > 0
      );

      if (!isInViewport) {
        return { isVisible: false };
      }

      // 3. Проверка на перекрытие другими элементами с помощью elementFromPoint
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Получаем элемент по центру, если он есть
      let elementAtPoint = null;
      try {
          elementAtPoint = document.elementFromPoint(centerX, centerY);
      } catch (e) {
          // Иногда elementFromPoint может выбрасывать ошибки для очень специфичных случаев
          // или когда элемент находится вне видимой области документа
      }

      // Если элемент под точкой не существует, или он не является нашим элементом
      // и не является его потомком, значит, наш элемент перекрыт.
      const isObscured = !elementAtPoint || !(elementAtPoint === el || el.contains(elementAtPoint));

      if (isObscured) {
        return { isVisible: false };
      }

      // 4. Проверка на слишком малые размеры (например, прозрачные 1x1 пиксельные трекеры)
      if (rect.width < 5 || rect.height < 5) {
          return { isVisible: false };
      }

      let selector = '';

      // Приоритет ID: наиболее надежный
      if (el.id) {
        selector = '#' + CSS.escape(el.id); // Использование CSS.escape для безопасной обработки ID
      } else {
        let parts = [el.tagName.toLowerCase()];

        // Общие атрибуты: используем точное совпадение для 'name' и 'type', так как они обычно стабильны.
        if (el.name) parts.push('[name="' + CSS.escape(el.name) + '"]');
        if (el.type) parts.push('[type="' + CSS.escape(el.type) + '"]');
        
        // Используем *= для aria-label, placeholder, title, если они содержат пробелы (вероятно, описательный текст).
        // В противном случае, используем точное совпадение.
        if (el.hasAttribute('aria-label')) {
            const label = el.getAttribute('aria-label');
            const escapedLabel = CSS.escape(label);
            if (label.includes(' ') && label.length > 0) {
                parts.push('[aria-label*="' + escapedLabel + '"]');
            } else if (label.length > 0) {
                parts.push('[aria-label="' + escapedLabel + '"]');
            }
        }
        if (el.placeholder) {
            const placeholderText = el.placeholder;
            const escapedPlaceholder = CSS.escape(placeholderText);
            if (placeholderText.includes(' ') && placeholderText.length > 0) {
                parts.push('[placeholder*="' + escapedPlaceholder + '"]');
            } else if (placeholderText.length > 0) {
                parts.push('[placeholder="' + escapedPlaceholder + '"]');
            }
        }
        if (el.hasAttribute('title')) {
            const titleText = el.getAttribute('title');
            const escapedTitle = CSS.escape(titleText);
            if (titleText.includes(' ') && titleText.length > 0) {
                parts.push('[title*="' + escapedTitle + '"]');
            } else if (titleText.length > 0) {
                parts.push('[title="' + escapedTitle + '"]');
            }
        }
        if (el.hasAttribute('role')) parts.push('[role="' + CSS.escape(el.getAttribute('role')) + '"]');


        // --- ЛОГИКА ОБРАБОТКИ DATA-* АТРИБУТОВ (строгая фильтрация) ---
        // Функция для определения, является ли часть строки (для data-атрибутов) высоко обфусцированной.
        const isHighlyObfuscatedDataPart = (part) => {
            if (!part || part.trim() === '') return true;
            // Фильтр сделан более гибким: теперь он помечает как обфусцированные
            // только короткие, явно сгенерированные хэши (например, nCP5yc, ksBjEc),
            // исключая из этой категории классы типа VfPpkd-*, которые пользователь может
            // считать достаточно стабильными для включения в селектор.
            return /^\\s*[nAjDuLQBJTl][a-zA-Z0-9]{4}[a-zA-Z0-9]?[cCe7b]?/.test(part);
        };

        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (attr.name.startsWith('data-')) {
                const attrValue = attr.value;
                const escapedAttrName = CSS.escape(attr.name);
                const escapedAttrValue = CSS.escape(attr.value);
                const attrValueParts = attrValue.split(' ').filter(p => p);

                const allPartsAreHighlyObfuscated = attrValueParts.length > 0 && attrValueParts.every(isHighlyObfuscatedDataPart);

                if (attrValueParts.length === 1 && !isHighlyObfuscatedDataPart(attrValueParts[0])) {
                    // Одно значение, и оно не является высоко обфусцированным -> точное совпадение.
                    parts.push('[' + escapedAttrName + '="' + escapedAttrValue + '"]');
                } else if (attrValueParts.length > 1 && allPartsAreHighlyObfuscated) {
                    // Несколько значений, и все они высоко обфусцированы (например, data-idom-class).
                    // Используем первое значение с селектором "содержит" (*=).
                    parts.push('[' + escapedAttrName + '*="' + CSS.escape(attrValueParts[0]) + '"]');
                }
                // В остальных случаях (пустое значение, одно высоко обфусцированное значение,
                // или несколько значений, но не все высоко обфусцированы) - атрибут пропускается.
                // Это предотвращает добавление длинных и нестабильных data-* селекторов.
            }
        }
        // --- КОНЕЦ ЛОГИКИ ОБРАБОТКИ DATA-* АТРИБУТОВ ---

        // --- ЛОГИКА ОБРАБОТКИ ОБЫЧНЫХ КЛАССОВ (гибкая фильтрация и лимит) ---

        // Функция для определения, является ли класс потенциально динамическим (самая базовая фильтрация).
        const isPotentiallyDynamicClass = (part) => {
            if (!part || part.trim() === '') return true;
            if (part.length <= 2) return true; // Очень короткие классы (часто динамические)
            if (/^\\d+$/.test(part)) return true; // Только цифры
            if (/^[a-z]\\d+$/.test(part)) return true; // Буква + цифры (например, 'a1')
            if (/-_/.test(part)) return true; // Дефис и подчеркивание вместе (редко, но может быть признаком динамики)

            // Динамические префиксы
            if (part.startsWith('js-')) return true;
            if (part.startsWith('is-')) return true;
            if (part.startsWith('has-')) return true;
            if (part.startsWith('v-')) return true; // Vue.js

            return false;
        };

        // Функция для определения, является ли класс "сильно обфусцированным" по новым правилам.
        // Эти классы проходят isPotentiallyDynamicClass, но требуют особого внимания.
        const isHighlyObfuscatedCssClass = (part) => {
            if (!part || part.trim() === '') return false;
            // Включаем VfPpkd- и другие обфусцированные паттерны, которые могут быть длинными.
            return /^\\s*VfPpkd-.+/.test(part) || 
                   /^\\s*[nAjDuLQBJTl][a-zA-Z0-9]{4}[a-zA-Z0-9]?[cCe7b]?/.test(part);
        };

        if (el.className && typeof el.className === 'string') {
            const classList = el.className.split(' ').filter(c => c);
            
            // Шаг 1: Отфильтровываем базово динамические/нестабильные классы
            const stableAndPotentiallyObfuscatedClasses = classList.filter(c => !isPotentiallyDynamicClass(c)); 
            
            if (stableAndPotentiallyObfuscatedClasses.length > 0) {
                let finalClasses = [];
                let hasHighlyObfuscated = false;
                let longestHighlyObfuscatedClass = '';

                // Шаг 2: Проверяем, есть ли среди оставшихся классов "сильно обфусцированные"
                for (const cls of stableAndPotentiallyObfuscatedClasses) {
                    if (isHighlyObfuscatedCssClass(cls)) {
                        hasHighlyObfuscated = true;
                        if (cls.length > longestHighlyObfuscatedClass.length) {
                            longestHighlyObfuscatedClass = cls;
                        }
                    }
                }

                if (hasHighlyObfuscated) {
                    // Если найдены сильно обфусцированные, используем только самый длинный из них
                    finalClasses.push(longestHighlyObfuscatedClass);
                } else {
                    // Если сильно обфусцированных нет, используем до 3 обычных "стабильных" классов
                    finalClasses = stableAndPotentiallyObfuscatedClasses.slice(0, 3);
                }
                
                if (finalClasses.length > 0) {
                    parts.push('.' + finalClasses.map(c => CSS.escape(c)).join('.'));
                }
            } 
        }
        // --- КОНЕЦ ЛОГИКИ ОБРАБОТКИ ОБЫЧНЫХ КЛАССОВ ---

        // Объединяем все части селектора.
        selector = parts.join('');

        // Если сгенерированный селектор слишком общий (например, только тег)
        // и элемент не является первым в своем роде среди сиблингов,
        // добавляем :nth-of-type для большей специфичности.
        if (el.parentElement && el.parentElement.querySelectorAll(selector).length > 1) {
            let nthChild = 1;
            let sibling = el.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === el.tagName) {
                    nthChild++;
                }
                sibling = sibling.previousElementSibling;
            }
            if (nthChild > 1) { // Добавляем только если это не первый элемент своего типа
                 selector += ':nth-of-type(' + nthChild + ')'; // Конкатенация
            }
        }
        
        // Крайний случай: если селектор все еще пуст, используем только тег (что маловероятно после parts.join)
        if (!selector) {
            selector = el.tagName.toLowerCase();
        }
      }
      
      // Очистка текста: удаляем все переносы строк и схлопываем множественные пробелы
      const cleanedText = (el.innerText || '').replace(/\\s+/g, ' ').trim();

      return {
        isVisible: true,
        tagName: el.tagName.toLowerCase(),
        text: cleanedText.substring(0, 100), // Ограничиваем длину
        selector: selector,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      };
    }
  `;


  /**
   * Находит интерактивные и видимые элементы на странице, нумерует их,
   * сохраняет селекторы и возвращает отформатированный список.
   * @param {string} filterBySelector CSS-селектор для фильтрации или "ANY" для всех.
   * @param {boolean} includeHidden Включать ли в результат невидимые элементы.
   * @returns {Promise<string>} Текстовое представление пронумерованных интерактивных элементов.
   */
  async getInteractiveElements(filterBySelector, includeHidden = false) {
    this.#mappedElements.clear();
    this.#elementCounter = 1;

    console.log(`🔍 Поиск интерактивных элементов (Фильтр: ${filterBySelector}, Скрытые: ${includeHidden})...`);

    const baseInteractiveSelectors = [
      "a[href]", "button", 'input:not([type="hidden"])', "textarea",
      "select", "[onclick]", '[role="button"]', '[role="link"]',
      '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
      '[role="menuitem"]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])', 'label[for]'
    ];

    const finalSelector = (filterBySelector && filterBySelector.toUpperCase() !== 'ANY')
      ? baseInteractiveSelectors.map(s => `${s}${filterBySelector}`).join(',')
      : baseInteractiveSelectors.join(',');

    const { root: { nodeId: documentNodeId } } = await this.cdpRequest("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await this.cdpRequest("DOM.querySelectorAll", {
      nodeId: documentNodeId,
      selector: finalSelector,
    });

    let output = "Найденные интерактивные элементы:\n";
    let foundCount = 0;

    for (const nodeId of nodeIds) {
      try {
        const { object } = await this.cdpRequest("DOM.resolveNode", { nodeId });
        if (!object || !object.objectId) continue;

        const evalResult = await this.cdpRequest("Runtime.callFunctionOn", {
          functionDeclaration: this.#visibilityCheckScript.toString(),
          objectId: object.objectId,
          returnByValue: true,
          awaitPromise: true,
        });

        if (!includeHidden && (!evalResult?.result?.value?.isVisible || evalResult.exceptionDetails)) {
          continue;
        }
        
        const elInfo = evalResult.result.value;
        if (!elInfo) continue; // Пропускаем, если скрипт не вернул информацию

        const number = this.#elementCounter++;
        this.#mappedElements.set(number, {
          selector: elInfo.selector,
          bounds: elInfo.bounds,
          description: elInfo.text || elInfo.tagName,
          objectId: object.objectId,
        });

        output += `${number}. [${elInfo.tagName}]`;
        if (elInfo.text) {
          output += ` "${elInfo.text.substring(0, 100)}"`;
        }
        output += ` (Селектор: ${elInfo.selector})\n`;
        foundCount++;

      } catch (error) {
        console.warn(`Error processing node ${nodeId}:`, error.message);
      }
    }

    if (foundCount === 0) {
      output += "Подходящие элементы не найдены.\n";
    }
    console.log(`✅ Найдено ${foundCount} интерактивных элементов.`);
    return output;
  }

  /**
   * Выполняет клик по интерактивному элементу, найденному по его номеру.
   * @param {number} elementNumber Номер элемента, полученный из getInteractiveElements.
   */
  async clickElementByNumber(elementNumber) {
    const element = this.#mappedElements.get(elementNumber);
    if (!element) {
      throw new Error(`The element with the number ${elementNumber} was not found.`);
    }
    console.log(
      `⚡️ Выполняем клик по элементу #${elementNumber}: ${element.description}`,
    );
    await this.clickElement(element.selector);
  }

  /**
   * Вводит текст в интерактивный элемент, найденный по его номеру.
   * @param {number} elementNumber Номер элемента, полученный из getInteractiveElements.
   * @param {string} text Текст для ввода.
   */
  async typeTextByNumber(elementNumber, text) {
    const element = this.#mappedElements.get(elementNumber);
    if (!element) {
      throw new Error(`The element with the number ${elementNumber} was not found.`);
    }
    console.log(
      `⌨️ Вводим текст в элемент #${elementNumber}: ${element.description}`,
    );
    await this.clickElement(element.selector);
    await this.clearInputField(element.selector);
    await this.typeText(text);
  }

  /**
   * Находит все видимые прокручиваемые контейнеры на странице.
   * @param {string} filterBySelector CSS-селектор для фильтрации или "ANY" для всех.
   * @returns {Promise<Array<Object>>} Массив объектов с информацией о контейнерах.
   */
  async getScrollableContainers(filterBySelector) {
    console.log(`🔍 Поиск прокручиваемых контейнеров (Фильтр: ${filterBySelector})...`);
    
    const query = (filterBySelector && filterBySelector.toUpperCase() !== 'ANY') ? filterBySelector : '*';

    const scrollableContainersScript = `
      (() => {
        const containers = [];
        const elements = document.querySelectorAll('${query}');
        elements.forEach(el => {
          if (el === document.body || el === document.documentElement) return;
          const computedStyle = window.getComputedStyle(el);
          const hasScrollStyle = ['scroll', 'auto', 'overlay'].includes(computedStyle.overflowY) || ['scroll', 'auto', 'overlay'].includes(computedStyle.overflowX);
          if (hasScrollStyle) {
            const isActuallyScrollable = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0 && computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
            if (isActuallyScrollable && isVisible) {
              let selector = '';
              if (el.id) selector = '#' + el.id;
              else if (el.className && typeof el.className === 'string') selector = '.' + el.className.split(' ').filter(c=>c).join('.');
              if (!selector) selector = el.tagName.toLowerCase();
              const cleanedText = (el.innerText || '').replace(/\\s+/g, ' ').trim();
              containers.push({
                selector: selector,
                text: cleanedText.substring(0, 50) || el.tagName.toLowerCase(),
                canScrollVertically: el.scrollHeight > el.clientHeight,
                canScrollHorizontally: el.scrollWidth > el.clientWidth,
                scrollX: el.scrollLeft,
                scrollY: el.scrollTop,
                scrollWidth: el.scrollWidth,
                scrollHeight: el.scrollHeight,
              });
            }
          }
        });
        return containers;
      })();
    `;

    const result = await this.cdpRequest("Runtime.evaluate", {
      expression: scrollableContainersScript,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
        console.error("❌ Ошибка при выполнении скрипта поиска контейнеров:", result.exceptionDetails.text);
        return [];
    }
    const containers = result.result.value;
    console.log(`✅ Найдено ${containers.length} прокручиваемых контейнеров.`);
    return containers;
  }

  /**
   * Возвращает статус прокрутки всей страницы (documentElement/body).
   * @returns {Promise<object>} Объект со статусом прокрутки.
   */
  async getPageScrollStatus() {
    console.log("ℹ️ Получаем статус глобальной прокрутки страницы...");
    const scrollStatus = await this.cdpRequest("Runtime.evaluate", {
      expression: `
        (() => {
          const body = document.body;
          const html = document.documentElement;
          const scrollX = window.pageXOffset || html.scrollLeft || body.scrollLeft;
          const scrollY = window.pageYOffset || html.scrollTop || body.scrollTop;
          const scrollWidth = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
          const scrollHeight = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
          const viewportWidth = window.innerWidth || html.clientWidth || body.clientWidth;
          const viewportHeight = window.innerHeight || html.clientHeight || body.clientHeight;
          return {
            scrollX: scrollX,
            scrollY: scrollY,
            scrollWidth: scrollWidth,
            scrollHeight: scrollHeight,
            viewportWidth: viewportWidth,
            viewportHeight: viewportHeight,
            canScrollVertically: scrollHeight > viewportHeight,
            canScrollHorizontally: scrollWidth > viewportWidth
          };
        })();
      `,
      returnByValue: true,
    });

    if (!scrollStatus || !scrollStatus.result || !scrollStatus.result.value) {
      console.error("❌ Не удалось получить статус прокрутки страницы:", scrollStatus);
      return null;
    }
    console.log("✅ Статус глобальной прокрутки получен.");
    return scrollStatus.result.value;
  }

  /**
   * Собирает ключевые наблюдения о состоянии браузера для LLM.
   * @param {boolean} includeInteractiveElements Включать ли список интерактивных элементов.
   * @param {boolean} includeScrollStatus Включать ли статус глобальной прокрутки.
   * @param {boolean} includeScrollableContainers Включать ли список локальных контейнеров прокрутки.
   * @returns {Promise<string>} Строка в формате Markdown.
   */
  async getPageOverview(
      includeInteractiveElements = true,
      includeScrollStatus = true,
      includeScrollableContainers = true
  ) {
    console.log("📝 Сбор наблюдений о браузере для LLM...");

    let markdownOutput = "# Текущее состояние страницы\n\n";

    const currentUrl = await this.cdpRequest("Runtime.evaluate", { expression: "window.location.href", returnByValue: true }).then(res => res.result.value).catch(() => "N/A");
    const pageTitle = await this.cdpRequest("Runtime.evaluate", { expression: "document.title", returnByValue: true }).then(res => res.result.value).catch(() => "N/A");

    markdownOutput += `## Информация о странице\n- **URL:** ${currentUrl}\n- **Заголовок:** ${pageTitle}\n\n`;

    if (includeScrollStatus) {
      const globalScrollStatus = await this.getPageScrollStatus();
      markdownOutput += `## Глобальная прокрутка страницы\n`;
      if (globalScrollStatus) {
        markdownOutput += `- **Прокрутка по вертикали:** ${globalScrollStatus.canScrollVertically ? "Да" : "Нет"}\n`;
        markdownOutput += `- **Текущая позиция (Y):** ${Math.round(globalScrollStatus.scrollY)} / ${Math.round(globalScrollStatus.scrollHeight - globalScrollStatus.viewportHeight)}\n\n`;
      } else {
        markdownOutput += `Не удалось получить информацию.\n\n`;
      }
    }

    if (includeScrollableContainers) {
      const localScrollableContainers = await this.getScrollableContainers('ANY');
      markdownOutput += `## Локальные прокручиваемые контейнеры\n`;
      if (localScrollableContainers.length > 0) {
        localScrollableContainers.forEach((container, index) => {
          markdownOutput += `### Контейнер #${index + 1}: \`${container.selector}\`\n`;
          markdownOutput += `- Текст: "${container.text}"\n`;
          markdownOutput += `- Вертикальная прокрутка: ${container.canScrollVertically ? "Да" : "Нет"}\n\n`;
        });
      } else {
        markdownOutput += "Локальные прокручиваемые контейнеры не найдены.\n\n";
      }
    }
    
    if (includeInteractiveElements) {
      const interactiveElementsList = await this.getInteractiveElements('ANY', false);
      markdownOutput += `## Интерактивные элементы\n`;
      markdownOutput += interactiveElementsList || "Элементы не найдены или произошла ошибка.\n";
    }

    console.log("✅ Наблюдения для LLM успешно сформированы.");
    return markdownOutput;
  }
}