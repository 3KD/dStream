FROM alpine:edge

RUN apk add --no-cache monero --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

COPY entrypoint.sh /usr/local/bin/dstream-xmr-wallet-rpc-entrypoint
RUN chmod +x /usr/local/bin/dstream-xmr-wallet-rpc-entrypoint

ENTRYPOINT ["dstream-xmr-wallet-rpc-entrypoint"]
