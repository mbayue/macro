# Egress_Proxy image. Build from the repository root:
#   docker build -t macro-proxy:latest -f proxy/Dockerfile .
FROM oven/bun:1.4-slim

WORKDIR /app
COPY proxy/proxy.ts proxy/ip.ts ./

EXPOSE 3128
USER bun
CMD ["bun","proxy.ts"]
