FROM public.ecr.aws/lambda/nodejs:22
# Runtime never installs or inspects packages. Remove the unused RPM parser so
# attacker-controlled document bytes cannot reach package-processing CVEs in
# the base image; application dependencies are bundled into handler.cjs.
RUN rpm -e --nodeps rpm rpm-libs sqlite-libs
COPY artifacts/eoffice/handler.cjs ${LAMBDA_TASK_ROOT}/handler.cjs
CMD ["handler.handler"]
