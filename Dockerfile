# k6 is a single static binary; copy it from Grafana's image at a pinned version.
FROM grafana/k6:2.3.0 AS k6

FROM alpine:3.22

# The AWS CLI publishes the results to the S3 path the CDP Portal gives each run.
RUN apk add --no-cache aws-cli

COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6

WORKDIR /opt/perftest

COPY lib/ ./lib/
COPY tests/ ./tests/
COPY entrypoint.sh .

RUN chmod +x ./entrypoint.sh

ENV S3_ENDPOINT=https://s3.eu-west-2.amazonaws.com
ENV PROFILE=all

ENTRYPOINT [ "./entrypoint.sh" ]
