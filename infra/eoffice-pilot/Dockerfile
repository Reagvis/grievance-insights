FROM public.ecr.aws/lambda/nodejs:22

# AL2023 supplies maintained ClamAV. Signatures are refreshed at image build,
# then runtime age enforcement blocks stale images; requests never update them.
RUN dnf install -y clamav clamav-update && freshclam && \
    clamscan --version && dnf clean all && rm -rf /var/cache/dnf
COPY artifacts/eoffice/handler.cjs ${LAMBDA_TASK_ROOT}/handler.cjs
CMD ["handler.handler"]
