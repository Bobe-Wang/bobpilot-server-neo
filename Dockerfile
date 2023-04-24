# First stage: Build Cabana
FROM node:16-alpine AS cabana

ENV CABANA_REF="73f338c543382ea3615d0dfd60a5901b05171719"

RUN apk update && \
    apk add --no-cache git python3 make g++

RUN git clone https://github.com/RetroPilot/cabana.git

WORKDIR /cabana

RUN git checkout $CABANA_REF

RUN yarn install && \
    yarn netlify-sass && \
    yarn build

# Second stage: Build server
FROM node:16-alpine AS server

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

COPY .env.docker .env

COPY --from=cabana /cabana/build cabana

# Install PM2 globally
RUN npm install -g pm2

# Create the ecosystem.config.js file
RUN echo 'module.exports = {\
  apps: [\
    {\
      name: "server",\
      script: "./dist/server/index.js",\
      watch: false,\
      instances: 1,\
      autorestart: true,\
    },\
    {\
      name: "worker",\
      script: "./dist/worker/index.js",\
      watch: false,\
      instances: 1,\
      autorestart: true,\
    },\
  ],\
};' > ecosystem.config.js

EXPOSE 8080
CMD ["pm2-runtime", "ecosystem.config.js"]
