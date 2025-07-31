FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    wget curl unzip \
    xvfb x11vnc fluxbox \
    supervisor \
    python3 python3-pip \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libdrm2 \
    libxkbcommon0 libxss1 libgconf-2-4 libxrandr2 libpangocairo-1.0-0 \
    libatk1.0-0 libcairo-gobject2 libgtk-3-0 libgdk-pixbuf2.0-0 \
    libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libnss3 \
    libcups2 libappindicator1 lsb-release xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir selenium undetected-chromedriver fake-useragent websockify requests asyncio

RUN mkdir -p /opt/noVNC \
    && wget -qO- https://github.com/novnc/noVNC/archive/v1.4.0.tar.gz | tar xz --strip-components=1 -C /opt/noVNC \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

RUN useradd --create-home --shell /bin/bash chrome \
    && mkdir -p /home/chrome/.fluxbox \
    && mkdir -p /var/log/supervisor

RUN echo "session.screen0.workspaces: 1" > /home/chrome/.fluxbox/init \
    && echo "session.screen0.toolbar.visible: false" >> /home/chrome/.fluxbox/init \
    && echo "session.screen0.slit.visible: false" >> /home/chrome/.fluxbox/init \
    && chown -R chrome:chrome /home/chrome

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY init_chrome.py /init_chrome.py

RUN chown -R chrome:chrome /home/chrome \
    && chmod +x /init_chrome.py

EXPOSE 6080 9223

USER root
VOLUME /home/chrome

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]