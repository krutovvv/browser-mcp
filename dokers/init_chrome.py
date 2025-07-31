import os
import sys
import time
import json
import random
import undetected_chromedriver as uc
from fake_useragent import UserAgent
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

# Настройка логирования для вывода информации в консоль контейнера
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [%(levelname)s] - %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

# Глобальная переменная для хранения экземпляра драйвера
global_driver = None

class CDPHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status_code=200):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            command_data = json.loads(post_data.decode('utf-8'))
            method = command_data.get("method")
            params = command_data.get("params", {})

            if global_driver and method:
                logger.info(f"Received CDP command: {method} with params: {params}")
                result = global_driver.execute_cdp_cmd(method, params)
                response = {"success": True, "result": result}
                self._set_headers(200)
            else:
                response = {"success": False, "error": "Driver not initialized or method missing"}
                self._set_headers(400)
        except Exception as e:
            logger.error(f"Error processing CDP command: {e}", exc_info=True)
            response = {"success": False, "error": str(e)}
            self._set_headers(500)
        
        self.wfile.write(json.dumps(response).encode('utf-8'))

def run_cdp_server(driver_instance, port=9223):
    global global_driver
    global_driver = driver_instance
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, CDPHandler)
    logger.info(f"CDP Proxy HTTP server is running on http://0.0.0.0:{port}")
    httpd.serve_forever()

def generate_fingerprint():
    """Генерирует или загружает fingerprint для браузера."""
    fingerprint_file = "/home/chrome/fingerprint.json"
    
    # Проверяем, существует ли файл с fingerprint
    if os.path.exists(fingerprint_file):
        try:
            with open(fingerprint_file, 'r') as f:
                fingerprint = json.load(f)
                logger.info("Loaded existing fingerprint from /home/chrome/fingerprint.json")
                return fingerprint
        except Exception as e:
            logger.warning(f"Failed to load fingerprint from {fingerprint_file}: {e}. Generating a new one.")
    
    # Генерируем новый fingerprint
    ua = UserAgent(platforms=['pc'], browsers=['chrome'], os=['windows', 'macos', 'linux'])
    
    # Список реальных разрешений экрана (сбалансированный для ПК)
    screen_resolutions = [
        "1920,1080", "1366,768", "1536,864", "1440,900", 
        "1280,720", "1600,900", "1024,768", "1280,1024"
    ]
    
    # Список языков и соответствующих регионов для согласованности
    language_options = [
        {"language": "en-US,en", "accept_language": "en-US,en;q=0.9", "locale": "en-US", "speech_voice": "en-US"},
        {"language": "en-GB,en", "accept_language": "en-GB,en;q=0.9", "locale": "en-GB", "speech_voice": "en-GB"},
        {"language": "ru-RU,ru", "accept_language": "ru-RU,ru;q=0.9", "locale": "ru-RU", "speech_voice": "ru-RU"},
        {"language": "de-DE,de", "accept_language": "de-DE,de;q=0.9", "locale": "de-DE", "speech_voice": "de-DE"},
        {"language": "fr-FR,fr", "accept_language": "fr-FR,fr;q=0.9", "locale": "fr-FR", "speech_voice": "fr-FR"}
    ]
    
    # Выбираем согласованный набор языковых настроек
    selected_language = random.choice(language_options)
    
    # Список реальных часовых поясов, соответствующих языку
    timezone_options = {
        "en-US": ["America/New_York", "America/Los_Angeles", "America/Chicago", "America/Denver", "America/Phoenix"],
        "en-GB": ["Europe/London"],
        "ru-RU": ["Europe/Moscow", "Asia/Yekaterinburg", "Asia/Vladivostok"],
        "de-DE": ["Europe/Berlin"],
        "fr-FR": ["Europe/Paris"]
    }
    
    # Дополнительные параметры для уникальности fingerprint
    cpu_cores = random.choice([2, 4, 8, 12])

    # Геолокация
    location_options = [
        {"latitude": 34.052235, "longitude": -118.243683, "accuracy": 20, "city": "Los Angeles"},
        {"latitude": 40.712776, "longitude": -74.005974, "accuracy": 20, "city": "New York"},
        {"latitude": 51.507351, "longitude": -0.127758, "accuracy": 20, "city": "London"},
        {"latitude": 55.755825, "longitude": 37.617298, "accuracy": 20, "city": "Moscow"},
        {"latitude": 48.856613, "longitude": 2.352222, "accuracy": 20, "city": "Paris"},
        {"latitude": 35.689487, "longitude": 139.691711, "accuracy": 20, "city": "Tokyo"},
        {"latitude": -33.868820, "longitude": 151.209290, "accuracy": 20, "city": "Sydney"}
    ]
    selected_location = random.choice(location_options)

    # WebGL Vendor и Renderer
    # Эти данные генерируются, но не будут использоваться для установки через CDP (Browser.setDeviceInfo)
    webgl_options = [
        {"vendor": "Google Inc. (NVIDIA)", "renderer": "ANGLE (NVIDIA GeForce RTX 3080)"},
        {"vendor": "Google Inc. (AMD)", "renderer": "ANGLE (AMD Radeon RX 6800 XT)"},
        {"vendor": "Google Inc. (Intel)", "renderer": "ANGLE (Intel(R) Iris(R) Xe Graphics)"},
        {"vendor": "Google Inc. (Apple)", "renderer": "ANGLE (Apple M1)"},
        {"vendor": "Google Inc. (Qualcomm)", "renderer": "ANGLE (Adreno (TM) 650)"}
    ]
    selected_webgl = random.choice(webgl_options)
    
    fingerprint = {
        "user_agent": ua.random,
        "resolution": random.choice(screen_resolutions),
        "language": selected_language["language"],
        "accept_language": selected_language["accept_language"],
        "locale": selected_language["locale"],
        "speech_voice": selected_language["speech_voice"],
        "timezone": random.choice(timezone_options[selected_language["language"].split(",")[0]]),
        "cpu_cores": cpu_cores,
        "latitude": selected_location["latitude"],
        "longitude": selected_location["longitude"],
        "accuracy": selected_location["accuracy"],
        "city": selected_location["city"],
        "webgl_vendor": selected_webgl["vendor"], 
        "webgl_renderer": selected_webgl["renderer"]
    }
    
    # Сохраняем новый fingerprint в файл
    try:
        with open(fingerprint_file, 'w') as f:
            json.dump(fingerprint, f, indent=4)
        logger.info(f"Saved new fingerprint to {fingerprint_file}")
    except Exception as e:
        logger.error(f"Failed to save fingerprint to {fingerprint_file}: {e}")
    
    return fingerprint

def main():
    """Основная функция для запуска Chrome."""
    try:
        fingerprint = generate_fingerprint()
        profile_path = "/home/chrome/profile"
        
        logger.info("Browser fingerprint details:")
        logger.info(f"User-Agent: {fingerprint['user_agent']}")
        logger.info(f"Resolution: {fingerprint['resolution']}")
        logger.info(f"Language: {fingerprint['language']}")
        logger.info(f"Accept-Language: {fingerprint['accept_language']}")
        logger.info(f"Locale: {fingerprint['locale']}")
        logger.info(f"Speech Voice: {fingerprint['speech_voice']}")
        logger.info(f"Timezone: {fingerprint['timezone']}")
        logger.info(f"CPU Cores: {fingerprint['cpu_cores']}")
        logger.info(f"Geolocation: {fingerprint['latitude']}, {fingerprint['longitude']} (Accuracy: {fingerprint['accuracy']}) - {fingerprint['city']}")
        logger.info(f"WebGL Vendor: {fingerprint['webgl_vendor']}") 
        logger.info(f"WebGL Renderer: {fingerprint['webgl_renderer']}") 
        
        options = uc.ChromeOptions()
        
        # Основные опции для запуска в Docker
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--start-maximized')
        options.add_argument('--enable-unsafe-extension-debugging')
        
        # Установка профиля и отпечатка
        options.add_argument(f"--user-data-dir={profile_path}")
        options.add_argument(f"--user-agent={fingerprint['user_agent']}")
        options.add_argument(f"--lang={fingerprint['language']}")
        options.add_argument(f"--accept-language={fingerprint['accept_language']}")
        options.add_argument(f"--window-size={fingerprint['resolution']}")
        
        # Загрузка расширений (если будут)
        options.add_argument('--disable-features=DisableLoadExtensionCommandLineSwitch')
        
        # Дополнительные параметры для реализма
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument('--enable-features=NetworkService,NetworkServiceInProcess')
        options.add_argument('--disable-infobars')
        options.add_argument('--disable-notifications')
        
        # --- ОБРАБОТКА ПАРАМЕТРОВ ПРОКСИ (Возврат к предыдущему рабочему варианту) ---
        proxy_host = os.getenv('PROXY_HOST', '').strip()
        proxy_port = os.getenv('PROXY_PORT', '').strip()
        proxy_username = os.getenv('PROXY_USERNAME', '').strip()
        proxy_password = os.getenv('PROXY_PASSWORD', '').strip()

        # Проверяем наличие хоста и порта
        if proxy_host and proxy_port:
            proxy_string = f"{proxy_host}:{proxy_port}"
            options.add_argument(f'--proxy-server={proxy_string}')
            logger.info(f"Using proxy: {proxy_string}")

            # Если есть логин и пароль, добавляем их для авторизации
            if proxy_username and proxy_password:
                options.add_argument(f'--proxy-auth={proxy_username}:{proxy_password}')
                logger.info("Proxy authentication details provided.")
            elif proxy_username or proxy_password:
                logger.warning("Proxy username or password provided, but not both. Proxy authentication might fail.")
        elif proxy_host or proxy_port or proxy_username or proxy_password:
            # Предупреждение, если предоставлены неполные данные прокси
            logger.warning("Incomplete proxy settings provided. Proxy will NOT be used. (Need host and port at minimum)")
        else:
            # Если никаких данных прокси не предоставлено
            logger.info("No proxy settings provided. Browser will connect directly.")
        # --------------------------------------------------------------------------

        logger.info("Starting Chrome with undetected-chromedriver...")
        # Убрана передача 'proxy' в конструктор, так как мы используем options.add_argument
        driver = uc.Chrome(
            options=options,
            headless=False  # Отключаем headless режим для большей реалистичности
        )
        
        # Запускаем HTTP сервер в отдельном потоке
        cdp_server_thread = threading.Thread(target=run_cdp_server, args=(driver,))
        cdp_server_thread.daemon = True # Поток завершится при завершении основного потока
        cdp_server_thread.start()

        # Установка геолокации через CDP
        logger.info(f"Setting geolocation to: Latitude={fingerprint['latitude']}, Longitude={fingerprint['longitude']}")
        driver.execute_cdp_cmd("Emulation.setGeolocationOverride", {
            "latitude": fingerprint["latitude"],
            "longitude": fingerprint["longitude"],
            "accuracy": fingerprint["accuracy"]
        })

        # Имитация человеческого поведения
        driver.get("https://www.maxmind.com/en/locate-my-ip-address")
        
        logger.info("Chrome started successfully!")
        logger.info(f"CDP Proxy HTTP server available at: http://<your-docker-host-ip>:9223")
        logger.info(f"noVNC available at: http://<your-docker-host-ip>:6080")
        logger.info(f"Profile path inside container: {profile_path}")
        
        # Бесконечный цикл для поддержания работы браузера
        logger.info("Browser is running. Script will keep it alive.")
        while True:
            time.sleep(3600)
            
    except Exception as e:
        logger.error(f"An error occurred during Chrome initialization: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()