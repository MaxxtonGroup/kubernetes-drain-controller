FROM node:8.9.1-alpine@sha256:b7f30d8810a8e10bd34cc12995c79dcdad81cd99c5ad6cfd0597e02683954de0
WORKDIR /app
EXPOSE 8080
CMD node dist/index.js

ADD ./package.json yarn.lock ./
RUN yarn --frozen-lockfile

ADD ./tsconfig.build.json ./tsconfig.json ./tslint.json ./README.md ./
ADD ./src ./src
RUN yarn run lint && \
    yarn test && \
    yarn run build
