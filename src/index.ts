import "reflect-metadata";
import { Container } from "typedi";
import * as winston from "winston";
import { HttpKubeClient } from "./clients/http/http-kube.client";
import { KubeConfig } from "./config/kube.config";
import { logger } from "./config/property-keys";
import { Settings } from "./config/settings";
import { WebConfig } from "./config/web.config";
import { NodeDrainService } from "./services/node-drain.service";

winston.configure({
  level: Settings.get(logger.level, "info"),
  transports: [
    new (winston.transports.Console)()
  ]
});

Container.set("kube-client", new HttpKubeClient(new KubeConfig()));
const webConfig: WebConfig = Container.get(WebConfig);

webConfig.init();

const nodeService: NodeDrainService = Container.get(NodeDrainService);
nodeService.init();
