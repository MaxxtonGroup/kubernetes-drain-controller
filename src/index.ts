import "reflect-metadata";
import { Container } from "typedi";
import * as winston from "winston";
import { logger } from "./config/property-keys";
import { Settings } from "./config/settings";
import { WebConfig } from "./config/web.config";

winston.configure({
  level: Settings.get(logger.level, "info"),
  transports: [
    new (winston.transports.Console)()
  ]
});

const webConfig: WebConfig = Container.get(WebConfig);

webConfig.init();
