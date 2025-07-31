# Coder Chrome Automation and MCP

Provision a Coder workspace with headless Chrome browser, CDP proxy, and noVNC interface for browser automation and monitoring.

## 🚀 Features

- Preconfigured Chrome with undetected-chromedriver
- CDP (Chrome DevTools Protocol) HTTP proxy API
- noVNC remote desktop access
- Randomized browser fingerprint generation
- Persistent user profile storage
- Supervisor process management

## 📦 Getting Started

### 1. Build the Docker image

```bash
docker build -t coder-chrome .
```

### 2. Run the container

```bash
docker run -d \
  -p 6080:6080 \
  -p 9223:9223 \
  --name chrome-workspace \
  coder-chrome
```

### 3. Access the workspace

- **noVNC**: http://localhost:6080
- **CDP Proxy**: http://localhost:9223
- **Chrome Profile**: `/home/chrome/profile` (persistent volume)

## 🧱 Architecture

The workspace includes:

1. **Xvfb** - Virtual display server
2. **Fluxbox** - Lightweight window manager
3. **x11vnc + noVNC** - Remote desktop access
4. **Chrome Browser** - With undetected-chromedriver
5. **CDP Proxy Server** - HTTP API for DevTools commands
6. **Supervisor** - Process management

## 🛠️ Example API Requests

### 1. Get browser fingerprint

```bash
curl -X POST http://localhost:9223 \
  -H "Content-Type: application/json" \
  -d '{"method": "Browser.getFingerprint"}'
```

### 2. Set network conditions

```bash
curl -X POST http://localhost:9223 \
  -H "Content-Type: application/json" \
  -d '{
    "method": "Network.emulateNetworkConditions",
    "params": {
      "offline": false,
      "latency": 50,
      "downloadThroughput": 1024000,
      "uploadThroughput": 512000
    }
  }'
```

### 3. Get page load metrics

```bash
curl -X POST http://localhost:9223 \
  -H "Content-Type: application/json" \
  -d '{"method": "Performance.getMetrics"}'
```

## 🧪 Advanced Usage

### Custom User-Agent

```bash
curl -X POST http://localhost:9223 \
  -H "Content-Type: application/json" \
  -d '{
    "method": "Network.setUserAgentOverride",
    "params": {
      "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
    }
  }'
```

### Add browser extensions

1. Mount extension directory as volume
2. Update `init_chrome.py` to load extensions
3. Example configuration:

```python
options.add_argument('--load-extension=/home/chrome/extensions/your-extension')
```

## 📦 File Structure

```
workspace/
├── Dockerfile            # Base image configuration
├── init_chrome.py        # Main browser initialization script
├── supervisord.conf      # Process management configuration
└── /home/chrome/
    ├── profile/          # Persistent browser profile
    └── extensions/       # Optional browser extensions
```

## 🧪 Testing the Setup

1. Start the container
2. Open noVNC at http://localhost:6080
3. Verify Chrome is running with:

```bash
docker exec -it chrome-workspace ps aux
```

## 🧼 Maintenance

### Update dependencies

```bash
docker build --no-cache -t coder-chrome .
```

### Clean up old containers

```bash
docker rm -f chrome-workspace
```
