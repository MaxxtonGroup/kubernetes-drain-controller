# kubernetes-drain-controller

This controller drains not high available pods from an unschedulable Kubernetes node in a safe manner.
It always wants to have at least 1 replica available. 

## Build
```bash
docker build -t kubernetes-drain-controller .
```

## Develop with Docker
```bash
docker-compose up --build
```

## Develop without Docker
```bash
yarn run watch
yarn run debug
```