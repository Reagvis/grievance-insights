FROM public.ecr.aws/docker/library/node:22.12.0-alpine3.21
ENV NODE_ENV=production PORT=8080 EOFFICE_CLAMD_SOCKET=/run/clamav/clamd.sock
WORKDIR /app
COPY artifacts/eoffice/server.mjs /app/server.mjs
USER node
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
