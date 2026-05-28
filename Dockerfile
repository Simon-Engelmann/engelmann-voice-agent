FROM node:20-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV LIVEKIT_REGION=eu
ENV NODE_OPTIONS=--dns-result-order=ipv4first

EXPOSE 8080

CMD ["npm", "start"]
