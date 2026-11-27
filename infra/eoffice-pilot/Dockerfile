FROM public.ecr.aws/lambda/nodejs:22

# Amazon Linux currently ships an obsolete ClamAV whose updater is rejected by
# the signature CDN. Pin the supported upstream LTS RPM and verify its content.
ARG CLAMAV_VERSION=1.4.7
ARG CLAMAV_SHA256=22c59e4ee04a8d5632234f695245f2963c4dccaf6cd7b45c9ae06b175f810512
RUN curl -fsSL "https://www.clamav.net/downloads/production/clamav-${CLAMAV_VERSION}.linux.x86_64.rpm" \
      -o /tmp/clamav.rpm && \
    echo "${CLAMAV_SHA256}  /tmp/clamav.rpm" | sha256sum -c - && \
    rpm -ivh /tmp/clamav.rpm && \
    ln -s /usr/local/bin/clamscan /usr/bin/clamscan && \
    sed '/^Example$/d' /usr/local/etc/freshclam.conf.sample > /usr/local/etc/freshclam.conf && \
    echo 'DatabaseOwner root' >> /usr/local/etc/freshclam.conf && \
    /usr/local/bin/freshclam && /usr/bin/clamscan --version && \
    rm -f /tmp/clamav.rpm && dnf clean all && rm -rf /var/cache/dnf
COPY artifacts/eoffice/handler.cjs ${LAMBDA_TASK_ROOT}/handler.cjs
CMD ["handler.handler"]
