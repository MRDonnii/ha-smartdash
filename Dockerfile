FROM alpine:3.22

ARG TARGETARCH
ARG BUILD_VERSION=dev
ENV SMARTDASH_CONTAINER=1
LABEL org.opencontainers.image.title="HA Smartdash" \
      org.opencontainers.image.description="Touch-first Home Assistant dashboard" \
      org.opencontainers.image.source="https://github.com/MRDonnii/ha-smartdash" \
      org.opencontainers.image.licenses="MIT" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.type="app" \
      io.hass.arch="${TARGETARCH}"

RUN apk add --no-cache \
      ca-certificates curl gettext jq nginx php83 php83-curl php83-fpm \
      php83-mbstring php83-opcache php83-zip tzdata \
    && mkdir -p /run/nginx /run/php /var/www/smartdash /data

COPY . /var/www/smartdash/
COPY docker/nginx.conf.template /etc/nginx/http.d/default.conf.template
COPY docker/php-fpm.conf /etc/php83/php-fpm.d/www.conf
COPY docker/entrypoint.sh /usr/local/bin/smartdash-entrypoint

RUN chmod +x /usr/local/bin/smartdash-entrypoint \
    && rm -rf /var/www/smartdash/.git /var/www/smartdash/data \
    && ln -s /data /var/www/smartdash/data \
    && chown -R nginx:nginx /data /run/nginx /run/php

EXPOSE 8099
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8099/healthz && curl -fsS http://127.0.0.1:8099/api/config.php >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/smartdash-entrypoint"]
