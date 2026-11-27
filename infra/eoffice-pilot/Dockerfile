FROM public.ecr.aws/lambda/nodejs:22
COPY artifacts/eoffice/handler.cjs ${LAMBDA_TASK_ROOT}/handler.cjs
CMD ["handler.handler"]
