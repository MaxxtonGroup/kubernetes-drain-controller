# openshift-drain-controller

This controller drains pods from an unschedulable or not ready Openshift node.

## Build
```bash
docker build -t openshift-drain-controller .
```

## Develop with Docker
```bash
docker-compose up --build
```

## Develop without Docker
```bash
yarn run watch & yarn run debug
```