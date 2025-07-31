import sharp from 'sharp'

// CdpAutomation.mjs
let currentMouseX = 0;
let currentMouseY = 0;

export class CdpAutomation {
  #cdpEndpoint; // Private field to store the endpoint

  /**
   * Создает новый экземпляр CdpAutomation.
   * @param {string} cdpEndpoint URL-адрес конечной точки CDP (например, "http://192.168.88.100:9223").
   */
  constructor(cdpEndpoint) {
    if (!cdpEndpoint) {
      throw new Error(
        "CDP Endpoint must be provided to CdpAutomation constructor.",
      );
    }
    this.#cdpEndpoint = cdpEndpoint;
  }

  /**
   * Базовая функция для отправки запросов к CDP.
   * @param {string} method Метод CDP для вызова (например, "Page.navigate", "Input.dispatchMouseEvent").
   * @param {object} params Параметры для метода CDP.
   * @returns {Promise<object>} Результат выполнения запроса CDP.
   * @throws {Error} Если запрос CDP завершается неудачей.
   */
  async cdpRequest(method, params) {
    const response = await fetch(this.#cdpEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });

    const json = await response.json();
    if (json.error) {
      const errorMessage = json.error.message || JSON.stringify(json.error);
      console.error(`❌ CDP Error for method ${method}: ${errorMessage}`);
      throw new Error(`CDP Error for method ${method}: ${errorMessage}`);
    }
    return json.result;
  }

  /**
   * // ИЗМЕНЕНО: Метод навигации сделан более надежным.
   * Навигирует браузер по указанному URL с улучшенной логикой ожидания загрузки.
   * @param {string} url URL для навигации.
   * @param {number} [timeout=10000] Общий таймаут для операции навигации в мс.
   * @returns {Promise<void>}
   */
  async navigate(url, timeout = 10000) {
    console.log(`🌐 Навигация на URL: ${url}...`);

    const navigationPromise = this.cdpRequest("Page.navigate", { url });

    const loadPromise = (async () => {
      // Эвристика для SPA: если тело документа почти пустое, ждем еще немного.
      // Это дает время для рендеринга контента через JavaScript.
      const { result } = await this.cdpRequest("Runtime.evaluate", {
        expression: "document.body.innerHTML.length",
        returnByValue: true,
      });

      if (result.value < 250) { // 250 байт - произвольное "маленькое" значение
        console.log("⏳ Body content is small, waiting for potential SPA render...");
        await new Promise(resolve => setTimeout(resolve, 3000)); // Дополнительное ожидание 3 сек
      }
    })();

    try {
      // Запускаем навигацию и ожидание загрузки параллельно, но с общим таймаутом
      await Promise.race([
        Promise.all([navigationPromise, loadPromise]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Navigation to ${url} timed out after ${timeout / 1000}s`)), timeout)
        ),
      ]);
      console.log(`✅ Успешно перешли на ${url} и страница загружена.`);
    } catch (error) {
      console.error(`❌ Ошибка навигации на ${url}:`, error.message);
      // Если это таймаут, считаем навигацию условно успешной, но выводим предупреждение.
      if (error.message.includes("timed out")) {
        console.warn(`⚠️ Навигация завершилась по таймауту, но переход мог произойти. Продолжаем выполнение.`);
        return;
      }
      throw error;
    }
  }
  
  // Остальные методы класса CdpAutomation остаются без изменений,
  // так как их доработка зависит от параметров, передаваемых из InteractiveElementSelector.
  // ... (waitForElement, clickElement, typeText, scrollPage, getCookiesCdp, getLocalStorageCdp, takeScreenshotBase64)
  // ... (весь остальной код CdpAutomation без изменений)
  /**
   * Ждет появления элемента на странице по CSS-селектору.
   * @param {string} selector CSS-селектор элемента.
   * @param {number} timeout Максимальное время ожидания в миллисекундах.
   * @returns {Promise<void>}
   */
  async waitForElement(selector, timeout = 5000) {
    console.log(
      `⏳ Ожидание элемента с селектором "${selector}" (таймаут: ${timeout}мс)...`,
    );
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        const { result } = await this.cdpRequest("Runtime.evaluate", {
          expression: `document.querySelector('${selector}')`,
          returnByValue: false,
        });
        if (result.objectId) {
          console.log(`✅ Элемент "${selector}" найден.`);
          return;
        }
      } catch (e) {
        // Игнорируем ошибки при поиске элемента, т.к. его может еще не быть
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // Короткая задержка перед повторной попыткой
    }
    throw new Error(`Таймаут ожидания элемента "${selector}".`);
  }

  /**
   * Кликает по элементу, используя реалистичные движения мыши.
   * @param {string} selector CSS-селектор элемента для клика.
   * @param {object} [options] Опции клика.
   * @param {number} [options.maxOffset=5] Максимальное случайное смещение от центра элемента.
   * @param {number} [options.preClickDelayMin=50] Минимальная задержка перед кликом.
   * @param {number} [options.preClickDelayMax=200] Максимальная задержка перед кликом.
   * @param {number} [options.pressReleaseDelayMin=30] Минимальная задержка между нажатием и отпусканием кнопки мыши.
   * @param {number} [options.pressReleaseDelayMax=100] Максимальная задержка между нажатием и отпусканием кнопки мыши.
   * @param {number} [options.clickCount=1] Количество кликов (1 для одиночного, 2 для двойного, 3 для тройного). // ADDED
   * @returns {Promise<void>}
   */
  async clickElement(selector, options = {}) {
    const {
      maxOffset = 5,
      preClickDelayMin = 50,
      preClickDelayMax = 200,
      pressReleaseDelayMin = 30,
      pressReleaseDelayMax = 100,
      clickCount = 1, // ADDED
    } = options;

    console.log(`🖱️ Клик${clickCount > 1 ? ` (${clickCount}x)` : ''} по элементу с селектором "${selector}"...`);
    try {
      // Получаем nodeId текущего документа динамически
      const { root: { nodeId: documentNodeId } } = await this.cdpRequest('DOM.getDocument');

      const { nodeId } = await this.cdpRequest("DOM.querySelector", {
        nodeId: documentNodeId, // Используем динамически полученный nodeId документа
        selector: selector,
      });

      if (!nodeId) {
        throw new Error(`Элемент с селектором "${selector}" не найден.`);
      }

      const { model } = await this.cdpRequest("DOM.getBoxModel", {
        nodeId: nodeId,
      });

      if (!model) {
        throw new Error(
          `Не удалось получить модель коробки для элемента "${selector}".`,
        );
      }

      const contentBox = model.content;
      const x = (contentBox[0] + contentBox[2]) / 2; // Центр X
      const y = (contentBox[1] + contentBox[5]) / 2; // Центр Y

      const targetX = x + (Math.random() - 0.5) * 2 * maxOffset;
      const targetY = y + (Math.random() - 0.5) * 2 * maxOffset;

      await this.cdpRequest("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: targetX,
        y: targetY,
      });
      currentMouseX = targetX;
      currentMouseY = targetY;

      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.random() * (preClickDelayMax - preClickDelayMin) +
            preClickDelayMin,
        ),
      );

      await this.cdpRequest("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: targetX,
        y: targetY,
        button: "left",
        clickCount: clickCount,
      });

      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.random() * (pressReleaseDelayMax - pressReleaseDelayMin) +
            pressReleaseDelayMin,
        ),
      );

      await this.cdpRequest("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: targetX,
        y: targetY,
        button: "left",
        clickCount: clickCount,
      });
      console.log(`✅ Успешно кликнули${clickCount > 1 ? ` (${clickCount}x)` : ''} по "${selector}".`);
    } catch (error) {
      console.error(`❌ Ошибка при клике по "${selector}":`, error.message);
      throw error;
    }
  }

  /**
   * Вводит текст в активное поле ввода.
   * @param {string} text Текст для ввода.
   * @param {object} [options] Опции ввода.
   * @param {number} [options.charDelayMin=50] Минимальная задержка между символами.
   * @param {number} [options.charDelayMax=150] Максимальная задержка между символами.
   * @returns {Promise<void>}
   */
  async typeText(text, options = {}) {
    const { charDelayMin = 50, charDelayMax = 150 } = options;
    console.log(`⌨️ Ввод текста: "${text}"...`);
    try {
      for (const char of text) {
        await this.cdpRequest("Input.dispatchKeyEvent", {
          type: "char",
          text: char,
          unmodifiedText: char,
        });
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.random() * (charDelayMax - charDelayMin) + charDelayMin,
          ),
        );
      }
      console.log(`✅ Текст успешно введен.`);
    } catch (error) {
      console.error(`❌ Ошибка при вводе текста:`, error.message);
      throw error;
    }
  }

  JavaScript
// CdpAutomation.mjs
// ... (начало файла, импорты, currentMouseX, currentMouseY, CdpAutomation constructor)

  // ... (методы cdpRequest, navigate, waitForElement, clickElement, typeText)

  /**
   * Выполняет реалистичную прокрутку страницы.
   * @param {number|'screenDown'|'screenUp'|'end'|'start'} scrollAmount Количество пикселей для прокрутки,
   * 'screenDown' для одной высоты окна вниз, 'screenUp' для одной высоты окна вверх,
   * 'end' для прокрутки до конца, 'start' для прокрутки в начало.
   * @param {object} [options] Опции прокрутки.
   * @param {number} [options.scrollDelta=120] Дельта прокрутки за один "тик" колеса мыши.
   * @param {number} [options.delayPerTickMin=50] Минимальная задержка между "тиками" прокрутки.
   * @param {number} [options.delayPerTickMax=150] Максимальная задержка между "тиками" прокрутки.
   * @returns {Promise<void>}
   */
  async scrollPage(scrollAmount, options = {}) {
    const {
      scrollDelta = 120,
      delayPerTickMin = 50,
      delayPerTickMax = 150,
    } = options;
    console.log(`↕️ Прокрутка страницы на ${scrollAmount}...`);
    try {
      const { layoutViewport } = await this.cdpRequest("Page.getLayoutMetrics");
      const viewportHeight = layoutViewport.clientHeight;
      const viewportWidth = layoutViewport.clientWidth;

      const { result: scrollResult } = await this.cdpRequest("Runtime.evaluate", {
          expression: `JSON.stringify({
              scrollY: window.scrollY,
              scrollHeight: document.documentElement.scrollHeight
          })`,
          returnByValue: true,
      });
      const { scrollY, scrollHeight } = JSON.parse(scrollResult.value);


      if (scrollAmount === "screenDown") {
        scrollAmount = viewportHeight;
      } else if (scrollAmount === "screenUp") {
        scrollAmount = -viewportHeight;
      } else if (scrollAmount === "end") {
        scrollAmount = scrollHeight - scrollY - viewportHeight;
        if (scrollAmount <= 0) {
          console.log("Страница уже внизу или нечего прокручивать.");
          return;
        }
      } else if (scrollAmount === "start") {
          scrollAmount = -scrollY;
          if (scrollAmount === 0) {
              console.log("Страница уже в начале.");
              return;
          }
      }

      let totalScrolled = 0;
      const absScrollAmount = Math.abs(scrollAmount);
      const direction = scrollAmount >= 0 ? 1 : -1;

      const mouseX = currentMouseX || viewportWidth / 2;
      const mouseY = currentMouseY || viewportHeight / 2;

      while (totalScrolled < absScrollAmount) {
        let deltaY = Math.min(scrollDelta, absScrollAmount - totalScrolled);
        deltaY *= direction;

        await this.cdpRequest("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: mouseX,
          y: mouseY,
          deltaX: 0,
          deltaY: deltaY,
        });
        totalScrolled += Math.abs(deltaY);
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.random() * (delayPerTickMax - delayPerTickMin) +
              delayPerTickMin,
          ),
        );
      }
      console.log(`✅ Прокрутка завершена.`);
    } catch (error) {
      console.error(`❌ Ошибка при прокрутке страницы:`, error.message);
      throw error;
    }
  }

  /**
   * Извлекает все куки из текущей сессии браузера или фильтрует по домену.
   * @param {string} [domain] Необязательный домен для фильтрации куки.
   * @returns {Promise<Array<object>>} Массив объектов куки.
   */
  async getCookiesCdp(domain) {
    console.log(
      `🍪 Извлечение куки ${domain ? `для домена "${domain}"` : "всех куки"}...`,
    );
    try {
      const { cookies } = await this.cdpRequest("Network.getCookies");

      if (domain) {
        const filteredCookies = cookies.filter((cookie) =>
          cookie.domain.includes(domain),
        );
        console.log(
          `✅ Отфильтровано ${filteredCookies.length} куки для домена "${domain}".`,
        );
        return filteredCookies;
      }
      console.log(`✅ Извлечено ${cookies.length} куки.`);
      return cookies;
    } catch (error) {
      console.error("❌ Ошибка при извлечении куки:", error.message);
      return [];
    }
  }

  /**
   * Извлекает все данные из localStorage для текущего домена.
   * @returns {Promise<Array<Array<string>>>} Массив массивов [ключ, значение] из localStorage.
   */
  async getLocalStorageCdp() {
    console.log(
      `💾 Извлечение данных из localStorage для текущего домена...`,
    );
    try {
        await this.cdpRequest("DOMStorage.enable");
        const { result: { value: securityOrigin } } = await this.cdpRequest("Runtime.evaluate", {
            expression: "window.location.origin",
            returnByValue: true,
        });

        if (!securityOrigin) {
            await this.cdpRequest("DOMStorage.disable");
            throw new Error("Could not determine the security origin of the page.");
        }

        const { items } = await this.cdpRequest("DOMStorage.getDOMStorageItems", {
            storageId: { securityOrigin: securityOrigin, isLocalStorage: true },
        });

        console.log(`✅ Извлечено ${items.length} элементов из localStorage для ${securityOrigin}.`);
        await this.cdpRequest("DOMStorage.disable");
        return items;
    } catch (error) {
        console.error("❌ Ошибка при извлечении данных из localStorage:", error.message);
        // Убедимся, что DOMStorage отключается даже в случае ошибки
        try {
            await this.cdpRequest("DOMStorage.disable");
        } catch (disableError) {
            console.error("Failed to disable DOMStorage on error:", disableError.message);
        }
        return [];
    }
  }


  /**
   * Делает скриншот текущей страницы и возвращает его в формате Base64.
   * Использует sharp для пропорционального уменьшения до 1024px по ширине и установки качества.
   * @param {"png"|"jpeg"|"webp"} [format="png"] Формат изображения (png, jpeg, webp).
   * @param {number} [quality=80] Качество изображения для форматов jpeg и webp (от 0 до 100).
   * @returns {Promise<string|null>} Строка Base64 скриншота или null в случае ошибки.
   */
  async takeScreenshotBase64(format = "jpeg", quality = 80) {
    console.log(
      `📸 Делаем скриншот страницы в формате ${format.toUpperCase()} и обрабатываем его (max 1024px width, quality ${quality})...`, // LOG MODIFIED
    );
    try {
      // 1. Получаем необработанный скриншот из CDP (без указания качества или формата, sharp это сделает)
      const cdpParams = {
        format: 'png', // Всегда запрашиваем PNG для наилучшего качества для sharp
        encoding: "base64",
      };
      const { data } = await this.cdpRequest("Page.captureScreenshot", cdpParams);

      // 2. Преобразуем Base64 в буфер для Sharp
      const imageBuffer = Buffer.from(data, 'base64');

      let processedImageBuffer;
      let sharpInstance = sharp(imageBuffer);

      // 3. Изменяем размер пропорционально до 1024px по ширине
      sharpInstance = sharpInstance.resize({ width: 1024, fit: 'inside' });

      // 4. Устанавливаем формат и качество
      switch (format) {
        case 'jpeg':
          processedImageBuffer = await sharpInstance.jpeg({ quality: quality }).toBuffer();
          break;
        case 'webp':
          processedImageBuffer = await sharpInstance.webp({ quality: quality }).toBuffer();
          break;
        case 'png': // PNG не использует качество, но мы все равно пропускаем его через sharp для ресайза
          processedImageBuffer = await sharpInstance.png().toBuffer();
          break;
        default:
          console.warn(`Неизвестный формат изображения "${format}". Используем 'jpeg'.`);
          processedImageBuffer = await sharpInstance.jpeg({ quality: quality }).toBuffer();
          format = 'jpeg'; // Обновим формат для лога
      }

      // 5. Преобразуем обработанный буфер обратно в Base64
      const processedBase64 = processedImageBuffer.toString('base64');

      console.log(`✅ Скриншот успешно сделан и обработан в формате ${format.toUpperCase()}.`);
      return processedBase64;
    } catch (error) {
      console.error("❌ Ошибка при создании или обработке скриншота:", error.message); // LOG MODIFIED
      return null;
    }
  }

  /**
   * Presses a specific key with more comprehensive key event parameters.
   * @param {string} keyName The key to press (e.g., 'Enter', 'Escape').
   * @returns {Promise<void>}
   */
  async pressKey(keyName) {

    let keyData = {
      key: keyName,
      text: '',
      code: '',
      windowsVirtualKeyCode: 0,
    };

    switch (keyName) {
      case 'Enter':
        keyData.code = 'Enter';
        keyData.windowsVirtualKeyCode = 13;
        break;
      case 'Escape':
        keyData.code = 'Escape';
        keyData.windowsVirtualKeyCode = 27;
        break;
      case 'Backspace':
        keyData.code = 'Backspace';
        keyData.windowsVirtualKeyCode = 8;
        break;
      default:
        keyData.text = keyName;
        console.warn(`⌨️ Попытка нажать неизвестную клавишу: '${keyName}'. Использование параметров события клавиши по умолчанию.`);
    }

    try {
      // Key Down event
      await this.cdpRequest("Input.dispatchKeyEvent", {
        type: "keyDown",
        modifiers: 0, // No modifiers (Shift, Ctrl, Alt)
        ...keyData,
      });

      // Optional: Add a small delay between key down and key up for more realism
      await new Promise(resolve => setTimeout(resolve, 50));

      // Key Up event
      await this.cdpRequest("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: 0,
        ...keyData,
      });
      console.log(`⌨️ Успешно нажали клавишу ${keyName}.`); // Updated success log
    } catch (error) {
      console.error(`❌ Ошибка при нажатии клавиши ${keyName}:`, error.message); // Updated error log
      throw error;
    }
  }

  /**
   * Clears the content of an input field by triple-clicking and pressing Backspace.
   * @param {string} selector CSS-selector of the input field to clear.
   * @returns {Promise<void>}
   */
  async clearInputField(selector) {
    console.log(`🧹 Очищаем поле ввода с селектором "${selector}"...`);
    try {
      // Triple-click to select all content
      await this.clickElement(selector, { clickCount: 3 });

      // Press Backspace to delete selected content
      await this.pressKey('Backspace');
      console.log(`✅ Поле ввода с селектором "${selector}" успешно очищено.`);
    } catch (error) {
      console.error(`❌ Ошибка при очистке поля ввода "${selector}":`, error.message);
      throw error;
    }
  }
}